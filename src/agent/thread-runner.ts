// One run of one thread: the body of what AgentSession.run was, keyed by the thread instead of the project.
// The conversation in memory, the compaction counter and the transcript belong to the thread; the plan stays per project.
// No Electron imports: everything is injected through SessionDeps (+ the thread stores and the lock registry).
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow, normalizeContext, uuidv7, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { ChatAttachmentRef, ChatEntry, ContextInfo, FocusItem } from "../shared/api.js";
import type { AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID, type Thread } from "../shared/thread-types.js";
import type { RunEvent, Settings } from "../shared/types.js";
import type { PreparedAttachments } from "./attachments.js";
import { compactMessages, type Complete } from "./compact.js";
import { appendUsage } from "./usage.js";
import { breakdown, compactLine, countImages, estimateContext, estimateTextTokens, IMAGE_TOKENS, pruneImages, trimToolResults } from "./context.js";
import { focusText } from "./focus.js";
import { lookupPiModel, runPi, streamFn, type McpLaunchSpec, type PiEffort, type PiRuntime } from "./pi/index.js";
import { SYSTEM_PROMPT, buildPrompt, userLine, withEarlier } from "./prompt.js";
import { REVIT_RULES } from "./tools/revit.js";
import { listSkills, skillsText } from "./skills.js";
import { ProjectStore } from "../core/store.js";
import { peekPendingPlanText, takePendingPlanText } from "../core/plan.js";
import type { ThreadStore } from "../core/threads.js";
import type { Pin } from "../core/model.js";
import { ctxEnv } from "./tools/context.js";
import { allTools, appLevels } from "./tools/defs.js";
import { Gate, makeLevelOf, offered, type ConfirmRequest } from "./tools/levels.js";
import { pinsText } from "./tools/pins.js";
import { lockKeyOf, type LockRegistry } from "./locks.js";
import { DEFAULT_AGENTS, MAIN_TOOLS, MAIN_TOOL_LEVELS, RULES, rosterText, specialistTools, subagentDeclarations, subagentTools } from "./subagents.js";
import { MAIL_RULES, MAIL_TOOL_LEVELS, mailDeclarations, mailTools } from "./mail.js";
import { DEFAULT_LIMITS, openTopicsOf, topicsLine, type Mailbox } from "../core/messages.js";
import type { SessionDeps } from "./session.js";

/** Tokens of the app's own tool declarations, which every request carries. Revit's tools come on top when it is connected.
 *  The schema is counted as pi sends it: without `$schema` (pi/mcp.ts drops it), which is about 14 tokens a tool. */
let appToolTokens: number | null = null;
function toolDeclarationTokens(): number {
	if (appToolTokens === null) {
		const params = (t: { input: Parameters<typeof z.object>[0] }) => {
			const { $schema: _drop, ...rest } = z.toJSONSchema(z.object(t.input)) as Record<string, unknown>;
			return rest;
		};
		appToolTokens = estimateTextTokens(JSON.stringify([...allTools().map((t) => ({ name: t.name, description: t.description, parameters: params(t) })), ...subagentDeclarations(), ...mailDeclarations()]));
	}
	return appToolTokens;
}

/** Keep this much of the newest conversation word for word when compacting: 20K, or 15% of a small window. */
const keepRecentFor = (window: number) => Math.min(20_000, Math.floor(window * 0.15));

export interface RunInput {
	runId: string;
	thread: Thread;
	/** null = the lead; a specialist's thread runs with its own prompt and tools, no helpers */
	spec: AgentSpec | null;
	text: string;
	focus: FocusItem[];
	files: PreparedAttachments;
	wave: string;
	signal: AbortSignal;
	emit: (e: RunEvent) => void;
	/** the coordinator routes a batch confirmation to the user */
	ask: (req: ConfirmRequest) => Promise<boolean>;
	/** how many hops of messages brought this run about: 0 for a run the user started */
	depth?: number;
	/** a message was added to the mailbox: the coordinator delivers it */
	wake?: () => void;
	/** a question for the user was written into Atmiņa: "Gaida tevi" changed */
	notesChanged?: () => void;
}

export interface Conversation {
	key: string;
	messages: AgentMessage[];
	/** tokens the last run added to the context (estimated from the provider's counts); null = not known */
	lastAdded: number | null;
}

export class ThreadRunner {
	/** in-memory conversations, by thread id */
	readonly conversations = new Map<string, Conversation>();
	/** compactions per thread since the app started */
	private compactions = new Map<string, number>();

	constructor(private d: SessionDeps & { threads: (projectId: string | null) => ThreadStore; locks: LockRegistry; mail?: (projectId: string | null) => Mailbox }) {}

	private store(thread: Thread): ThreadStore {
		return this.d.threads(thread.projectId);
	}

	private remember(thread: Thread, role: "user" | "assistant", text: string, attachments?: ChatAttachmentRef[]) {
		const entry: ChatEntry = { role, text, at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
		if (text.trim() || attachments?.length) this.store(thread).append(thread.id, entry);
	}

	/** Images the thread's live conversation holds, for the attachment limits (0 when it is not in memory or the model changed). */
	imagesInContext(thread: Thread): number {
		const s = this.d.settings();
		const conv = this.conversations.get(thread.id);
		return conv && conv.key === `${s.provider}/${s.model}` ? countImages(this.shrink(conv.messages)) : 0;
	}

	/** What every request starts with: the rules, who the user is, Revit's rules, the skills. A specialist gets its own prompt and the shared rules,
	 *  the user line, and Revit's rules only when one of its tools is Revit's; no roster and no skills list. */
	private standing(s: Settings, spec: AgentSpec | null = null, hasRevitTool = false): string {
		const mail = this.d.mail ? MAIL_RULES : "";
		if (spec) return [spec.prompt + RULES, mail, userLine(s.userName), hasRevitTool ? REVIT_RULES : ""].filter(Boolean).join("\n\n");
		return [SYSTEM_PROMPT, mail, userLine(s.userName), REVIT_RULES, rosterText(this.d.agents?.() ?? DEFAULT_AGENTS), skillsText(listSkills(this.d.ctx.skillsDir ?? ""))].filter(Boolean).join("\n\n");
	}

	/** The cheap ways to keep a stored conversation small, always applied: old screenshots out, old tool results cut. Idempotent. */
	private shrink(messages: AgentMessage[]): AgentMessage[] {
		return trimToolResults(pruneImages(messages).messages).messages;
	}

	private completeFn(rt: PiRuntime): Complete {
		if (this.d.complete) return this.d.complete;
		const stream = streamFn(rt.models);
		return async (model, system, user, signal) => {
			const ctx = normalizeContext({ systemPrompt: system, messages: [{ role: "user", content: [{ type: "text", text: user }], timestamp: Date.now() }] });
			// a one-off request: no cache write for it
			return (await stream(model, ctx, { signal, cacheRetention: "none", sessionId: uuidv7() })).result();
		};
	}

	private rememberCompaction(thread: Thread, summary: string, before: number, after: number) {
		const entry: ChatEntry = { role: "assistant", kind: "compaction", text: summary, at: new Date().toISOString(), tokens: { before, after } };
		this.store(thread).append(thread.id, entry);
		this.compactions.set(thread.id, (this.compactions.get(thread.id) ?? 0) + 1);
	}

	/**
	 * Summarizes the older part of `history`. Returns the new messages, or null when nothing could be done (the reason goes
	 * out as a `compact` failed event): the run then goes on with what it has, never stops on a failed summary.
	 */
	private async compactHistory(o: { thread: Thread; rt: PiRuntime; model: Model<Api>; history: AgentMessage[]; signal: AbortSignal; emit?: (e: RunEvent) => void; keepRecent: number }): Promise<AgentMessage[] | null> {
		const before = estimateContext(o.history).tokens;
		o.emit?.({ type: "compact", phase: "start", before });
		try {
			const c = await compactMessages(o.history, { complete: this.completeFn(o.rt), model: o.model, keepRecentTokens: o.keepRecent, signal: o.signal, maxInputTokens: Math.floor(o.model.contextWindow * 0.7) });
			if (!c) {
				o.emit?.({ type: "compact", phase: "failed", before, message: "Nav ko saspiest: sarunā ir tikai viens posms, vai viss ietilpst nesenajā daļā." });
				return null;
			}
			this.rememberCompaction(o.thread, c.summary, before, c.tokensAfter);
			o.emit?.({ type: "compact", phase: "done", before, after: c.tokensAfter });
			return c.messages;
		} catch (e) {
			o.emit?.({ type: "compact", phase: "failed", before, message: (e as Error).message });
			return null;
		}
	}

	/** The newest compaction summary in the transcript and the lines after it, for a conversation that is not in memory (restart, model change). */
	private transcriptSeed(thread: Thread): { summary: string | null; earlier: { role: string; text: string }[] } {
		const all = this.store(thread).transcript(thread.id);
		const ci = all.map((e) => e.kind).lastIndexOf("compaction");
		const tail = all.slice(ci + 1).slice(-11, -1);
		return {
			summary: ci >= 0 ? all[ci].text : null,
			earlier: tail.map((e) => ({ role: e.role, text: e.attachments?.length ? `${e.text}\n[pielikumi: ${e.attachments.map((a) => a.name).join(", ")}]` : e.text })),
		};
	}

	async run(i: RunInput): Promise<{ ok: boolean; answer: string; confirmedBatches: number }> {
		const { runId, thread, spec, text, focus, files, signal } = i;
		const projectId = thread.projectId;
		const emit = i.emit;
		const owner = `run:${runId}`;
		const label = spec ? spec.name : "galvenais aģents";
		let answer = "";
		let confirmedBatches = 0;
		let failed = false;
		let batchOpen = false;
		// the run's end frees whatever its tool calls or its Revit batch still hold, whatever way it ends
		try {
			try {
				const s = this.d.settings();
				const runDir = join(this.d.runsDir, runId);
				mkdirSync(runDir, { recursive: true });
				writeFileSync(join(runDir, "focus.json"), JSON.stringify(focus), "utf8");
				this.remember(thread, "user", text, files.refs);

				const env = ctxEnv({ ...this.d.ctx, projectId, runDir, agent: spec ? spec.id : LEAD_ID, thread: thread.id });
				const appTools = allTools().map((t) => t.name);
				const app = appLevels();
				const revit = this.d.revit();
				const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, app, revit?.levels ?? {});
				const appSet = new Set(appTools);
				const revitTools = new Set(revit?.tools ?? []);
				const listed = [...offered(appTools, levelOf), ...(revit ? offered(revit.tools, levelOf) : [])];
				// a specialist's own tool list: what `delegate` gives its lanes. Its gate lets only these through; no confirm tool is in it (the cap keeps them out)
				const own = spec ? new Set(specialistTools(listed, levelOf, revitTools, spec)) : null;
				const mcp: Record<string, McpLaunchSpec & { allow: readonly string[] }> = {};
				if (own) {
					const mine = [...own].filter((n) => appSet.has(n));
					if (mine.length) mcp["projektesana-tools"] = { ...this.d.toolsServer(env), allow: mine };
					const theirs = [...own].filter((n) => revitTools.has(n));
					if (revit && theirs.length) mcp["revit"] = { ...revit, allow: theirs };
				} else {
					mcp["projektesana-tools"] = { ...this.d.toolsServer(env), allow: offered(appTools, levelOf) };
					if (revit) mcp["revit"] = { ...revit, allow: offered(revit.tools, levelOf) };
				}

				const gate = new Gate(own ? (n) => (own.has(n) || Object.hasOwn(MAIL_TOOL_LEVELS, n) ? levelOf(n) : "never") : levelOf, async (req: ConfirmRequest) => {
					if (signal.aborted) return false;
					const hasRevit = req.batch.some((b) => revitTools.has(b.tool) || b.tool.startsWith("revit_"));
					// a batch that changes the Revit model runs only on this project's working copy (never the office file)
					if (hasRevit && this.d.revitWork) {
						const w = await this.d.revitWork(projectId).catch((e: Error) => ({ ok: false, title: e.message }));
						if (!w.ok) {
							emit({ type: "error", engine: "pi", message: `Partija noraidīta: aktīvais Revit dokuments nav šī projekta darba kopija (${w.title}). Izveido to: Versijas → Revit → Darba kopija.` });
							return false;
						}
					}
					const ok = await i.ask(req);
					if (ok) {
						// a confirmed Revit batch stays whole: other agents' Revit calls wait until it ends
						if (hasRevit) {
							try {
								this.d.locks.beginBatch(owner, label);
								batchOpen = true;
							} catch (e) {
								emit({ type: "error", engine: "pi", message: `Partija noraidīta: ${(e as Error).message}` });
								return false;
							}
						}
						// counted only once the batch can run: afterBatch records a revision for it
						confirmedBatches++;
					}
					return ok;
				});
				// the lead's own writes take their lock after the gate has let them through, and free it when the call is done
				const locks = this.d.locks;
				const beforeToolCall: NonNullable<Parameters<typeof runPi>[0]["beforeToolCall"]> = async (ctx, sig) => {
					const blocked = await gate.before(ctx);
					if (blocked) return blocked;
					// run_subagent / delegate only start lanes; the lanes take the locks their writes need
					if (MAIN_TOOLS.has(ctx.toolCall.name)) return undefined;
					const key = lockKeyOf(ctx.toolCall.name, levelOf(ctx.toolCall.name), revitTools);
					if (!key) return undefined;
					const got = await locks.acquire(projectId, key, owner, ctx.toolCall.id, sig ?? signal, label);
					return got.ok ? undefined : { block: true, reason: got.reason };
				};
				const afterToolCall = async (ctx: { toolCall: { id: string } }) => {
					locks.release(ctx.toolCall.id);
					return undefined;
				};

				const key = `${s.provider}/${s.model}`;
				const conv = this.conversations.get(thread.id);
				const rt = await this.d.runtime();
				const model = lookupPiModel(rt, s.provider, s.model);
				// the plan lines the user changed belong to the lead: a specialist neither carries nor clears them
				// this project's mailbox: the thread's open topics go into every prompt, and the mail tools write into it
				const mailbox = this.d.mail?.(projectId);
				const topics = mailbox ? topicsLine(openTopicsOf(thread, mailbox.topics(), mailbox.messages())) : "";
				const prompt = buildPrompt(this.pinsOf(projectId), focus, [text.trim(), files.text].filter(Boolean).join("\n\n"), spec ? "" : this.planOf(projectId, true), topics);
				const promptTokens = estimateTextTokens(prompt) + files.images.length * IMAGE_TOKENS;
				const keepRecent = keepRecentFor(model.contextWindow);

				// 1. the cheap ways first: old screenshots out, old tool results cut (already-shrunk messages stay shrunk)
				let history = conv && conv.key === key ? this.shrink(conv.messages) : [];
				// 2. at the line (80% of the window, at most 200K) the older conversation becomes a summary, before the request is made
				if (history.length && estimateContext(history).tokens + promptTokens > compactLine(model.contextWindow)) {
					history = (await this.compactHistory({ thread, rt, model, history, signal, emit, keepRecent })) ?? history;
				}

				const standing = this.standing(s, spec, !!own && [...own].some((n) => revitTools.has(n)));
				const seed = this.transcriptSeed(thread);
				const seeded = seed.summary ? `${standing}\n\nIepriekšējās sarunas kopsavilkums:\n${seed.summary}` : standing;
				// state changed inside the callbacks below (a plain object: TypeScript does not follow closure assignments of a local)
				const st = { toolsRan: false, overflowed: null as string | null, retried: false };
				const attempt = async (h: AgentMessage[]) => {
					st.overflowed = null;
					const base = estimateContext(h).tokens;
					const handle = (e: RunEvent): void => {
						if (e.type === "tool") st.toolsRan = true;
						if (e.type === "usage") {
							try {
								appendUsage(join(this.d.ctx.appDir, "usage.jsonl"), { at: new Date().toISOString(), run: runId, project: projectId, model: key, input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite, cost: e.cost });
							} catch {
								// the log is a convenience: a full disk must not stop the run
							}
						}
						if (e.type === "done") answer = e.text;
						if (e.type === "error" && isContextOverflow({ stopReason: "error", errorMessage: e.message } as AssistantMessage)) {
							st.overflowed = e.message;
							// before any tool ran nothing has happened yet: held back, the run is compacted and repeated once
							if (!st.toolsRan && !st.retried) return;
							failed = true;
							emit({ ...e, message: `${e.message}\n\nKonteksts ir pilns. Spied «saspiest» virs ievades vai sāc jaunu sarunu.` });
							return;
						}
						if (e.type === "error") failed = true;
						emit(e);
					};
					// helpers and specialists (task 8.15): lanes of their own, with the tools the gate allows them, writing one at a time
					const lanes = spec ? [] : subagentTools({
						run: this.d.runAgent ?? runPi,
						base: { runtime: rt, provider: s.provider, modelId: s.model, effort: (s.effort || undefined) as PiEffort | undefined },
						mcpFor: (allowed) => {
							const m: Record<string, McpLaunchSpec & { allow: readonly string[] }> = {};
							const mine = allowed.filter((n) => appSet.has(n));
							if (mine.length) m["projektesana-tools"] = { ...this.d.toolsServer(env), allow: mine };
							const theirs = allowed.filter((n) => revitTools.has(n));
							if (revit && theirs.length) m.revit = { ...revit, allow: theirs };
							return m;
						},
						levelOf,
						listed,
						revitTools,
						locks: locks.forProject(projectId),
						ownerPrefix: owner,
						emit: handle,
						maxParallel: () => this.d.settings().maxParallelAgents,
						specs: () => this.d.agents?.() ?? DEFAULT_AGENTS,
					});
					// send_message and close_topic: the lead's threads and a specialist's alike, never a lane
					const mail = mailbox
						? mailTools({
								mailbox,
								threads: this.store(thread),
								agents: () => this.d.agents?.() ?? DEFAULT_AGENTS,
								limits: () => DEFAULT_LIMITS,
								self: { agent: spec ? spec.id : LEAD_ID, threadId: thread.id, projectId, wave: i.wave, depth: i.depth ?? 0 },
								enqueue: () => i.wake?.(),
								note: (line) => emit({ type: "text", text: line }),
								// the project's Atmiņa, from the main process; a thread with no project (or one without data yet) has none
								notes: () => {
									if (!projectId) return null;
									try {
										return ProjectStore.load(this.d.ctx.projectsDir, projectId);
									} catch {
										return null;
									}
								},
								notesChanged: () => i.notesChanged?.(),
							})
						: [];
					const extraTools = [...lanes, ...mail];
					await (this.d.runAgent ?? runPi)({
						runtime: rt,
						provider: s.provider,
						modelId: s.model,
						effort: (s.effort || undefined) as PiEffort | undefined,
						prompt,
						images: files.images,
						systemPrompt: h.length ? standing : withEarlier(seeded, seed.earlier),
						mcp,
						signal,
						beforeToolCall,
						afterToolCall,
						history: h,
						onMessages: (messages) => this.conversations.set(thread.id, { key, messages, lastAdded: Math.max(0, estimateContext(messages).tokens - base) }),
						onEvent: handle,
						extraTools: extraTools.length ? extraTools : undefined,
					});
				};
				await attempt(history);
				if (st.overflowed && !st.toolsRan && !st.retried && !signal.aborted) {
					// the model refused the request for its size, although the estimate said it fits: summarize harder and ask again, once
					st.retried = true;
					const smaller = history.length ? await this.compactHistory({ thread, rt, model, history, signal, emit, keepRecent: Math.floor(keepRecent / 2) }) : null;
					if (smaller) await attempt(smaller);
					else {
						failed = true;
						emit({ type: "error", engine: "pi", message: `${st.overflowed}\n\nKonteksts ir pilns, un to nevarēja saspiest. Sāc jaunu sarunu vai pievieno mazāk.` });
					}
				}
			} catch (e) {
				failed = true;
				emit({ type: "error", engine: "pi", message: (e as Error).message });
			} finally {
				this.remember(thread, "assistant", answer);
			}
			// after a batch the user confirmed: the app captures a revision and runs the room check (6.2, 6.5)
			if (confirmedBatches > 0 && projectId && this.d.afterBatch) {
				try {
					emit({ type: "text", text: "\n\n[lietotne] Fiksē revīziju un pārbauda telpas…" });
					const r = await this.d.afterBatch(projectId, answer.slice(0, 500));
					emit({ type: "text", text: `\n[lietotne] ${r}` });
				} catch (e) {
					emit({ type: "error", engine: "pi", message: `Revīzija netika fiksēta: ${(e as Error).message}` });
				}
			}
		} finally {
			if (batchOpen) this.d.locks.endBatch(owner);
			this.d.locks.releaseOwner(owner);
		}
		return { ok: !failed && !signal.aborted, answer, confirmedBatches };
	}

	private pinsOf(projectId: string | null): Pin[] {
		if (!projectId) return [];
		try {
			return ProjectStore.load(this.d.ctx.projectsDir, projectId).read("pins");
		} catch {
			return [];
		}
	}

	/** The plan lines this turn carries when the user changed the plan: `take` clears the mark (the prompt is being sent). */
	private planOf(projectId: string | null, take: boolean): string {
		if (!projectId) return "";
		try {
			const store = ProjectStore.load(this.d.ctx.projectsDir, projectId);
			return take ? takePendingPlanText(store) : peekPendingPlanText(store);
		} catch {
			return "";
		}
	}

	/** Forgets the in-memory conversation (new topic, or the model changed). The transcript stays. */
	reset(threadId: string) {
		this.conversations.delete(threadId);
		this.compactions.delete(threadId);
	}

	/** What the next request carries, where the limits are, and what the message being typed would add. */
	async context(thread: Thread, draft?: { text: string; focus: FocusItem[] }): Promise<ContextInfo> {
		const s = this.d.settings();
		const model = lookupPiModel(await this.d.runtime(), s.provider, s.model);
		const conv = this.conversations.get(thread.id);
		const live = conv && conv.key === `${s.provider}/${s.model}` && conv.messages.length > 0 ? conv : null;
		const est = live ? estimateContext(live.messages) : null;
		const b = live ? breakdown(live.messages) : null;
		return {
			window: model.contextWindow,
			compactAt: compactLine(model.contextWindow),
			used: est ? est.tokens : null,
			source: est ? est.source : "none",
			parts: b ? { fixed: b.fixed, chat: b.chat, docs: b.docs, tools: b.tools, images: b.images } : null,
			imageCount: b?.imageCount ?? 0,
			messages: live?.messages.length ?? 0,
			fixedEstimate: estimateTextTokens(this.standing(s)) + toolDeclarationTokens(),
			lastAdded: live?.lastAdded ?? null,
			compactions: this.compactions.get(thread.id) ?? 0,
			// the Fokuss line is sent with every message, "Fokuss: nekas" included
			draft: draft ? { text: estimateTextTokens(draft.text), focus: estimateTextTokens(focusText(draft.focus)), pins: estimateTextTokens(pinsText(this.pinsOf(thread.projectId))), plan: estimateTextTokens(this.planOf(thread.projectId, false)) } : null,
		};
	}

	/** Summarizes the thread's in-memory conversation now; the caller guards against a run going on. */
	async compactNow(thread: Thread, signal?: AbortSignal): Promise<{ before: number; after: number }> {
		const s = this.d.settings();
		const conv = this.conversations.get(thread.id);
		if (!conv || conv.key !== `${s.provider}/${s.model}` || !conv.messages.length) throw new Error("Nav ko saspiest: šīs sarunas konteksts atmiņā ir tukšs (jauna saruna, mainīts modelis vai lietotne pārstartēta).");
		const rt = await this.d.runtime();
		const model = lookupPiModel(rt, s.provider, s.model);
		const history = this.shrink(conv.messages);
		const before = estimateContext(conv.messages).tokens;
		const c = await compactMessages(history, { complete: this.completeFn(rt), model, keepRecentTokens: keepRecentFor(model.contextWindow), signal, maxInputTokens: Math.floor(model.contextWindow * 0.7) });
		if (!c) throw new Error(`Nav ko saspiest: sarunā ir tikai viens posms, vai viss (${before} tokeni) ietilpst nesenajā daļā.`);
		this.rememberCompaction(thread, c.summary, before, c.tokensAfter);
		this.conversations.set(thread.id, { key: conv.key, messages: c.messages, lastAdded: null });
		return { before, after: c.tokensAfter };
	}
}
