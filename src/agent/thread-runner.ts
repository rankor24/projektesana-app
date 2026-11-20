// One run of one thread: the body of what AgentSession.run was, keyed by the thread instead of the project.
// The conversation in memory, the compaction counter and the transcript belong to the thread; the plan stays per project.
// No Electron imports: everything is injected through SessionDeps (+ the thread stores and the lock registry).
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow, normalizeContext, uuidv7, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { catalogProvider, isClaudeSub, NOT_CONNECTED } from "./claude/provider.js";
import { buildPrompt, withEarlier } from "./prompt.js";
import { fixedTokens, knowledgeFor, standingFor } from "./agents.js";
import { OfficeMemory } from "../core/office-memory.js";
import { declarationTokens } from "./declarations.js";
import { listSkills, officeSkillsDir } from "./skills.js";
import { type FixRemark, readProcess, statusText } from "../core/process.js";
import { EXPERT_META } from "../shared/expert-types.js";
import { ProjectStore } from "../core/store.js";
import { peekPendingPlanText, takePendingPlanText } from "../core/plan.js";
import type { ThreadStore } from "../core/threads.js";
import type { Pin } from "../core/model.js";
import { ctxEnv } from "./tools/context.js";
import { allTools, appLevels } from "./tools/defs.js";
import { PLANNING_TOOL_DATA } from "./tools/planning.js";
import { Gate, makeLevelOf, offered, type ConfirmRequest } from "./tools/levels.js";
import { pinsText } from "./tools/pins.js";
import { lockKeyOf, type LockRegistry } from "./locks.js";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOLS, MAIN_TOOL_LEVELS, capOf, ownTools, subagentTools } from "./subagents.js";
import { EKS, LEADER, PROCESS_OWN_TOOLS, stageCard } from "../core/process-def.js";
import { MAIL_TOOL_LEVELS, mailTools } from "./mail.js";
import { limitsOf, openTasks, openTopicsOf, topicsLine, type Mailbox } from "../core/messages.js";
import type { SessionDeps, ToolServer } from "./session.js";

/** The process tools that change the process file (not `process_status`); the name may carry the tools server's prefix. */
const PROCESS_TOOL = /process_(request_gate|skip_stage|set_profile|review_done|change_impact)$/;

/** What a write tool of an author gets during S5 (14.6): the expert is reading the project, so nobody but eks changes it. */
export const S5_BLOCK = "S5 laikā sadaļas autors nelabo projektu.";

/** Tools that stay open to the authors in S5 though they are above `read`: mail (they answer eks), the process tools, and the expert_* ones (remarks are the expert's record, not the project). */
const S5_OPEN = (name: string) => Object.hasOwn(MAIL_TOOL_LEVELS, name) || name.startsWith("process_") || name.startsWith("expert_");

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
	/** project data changed in the tools server's process (a process tool's result): the window reloads what shows it */
	dataChanged?: (what: string[]) => void;
}

export interface Conversation {
	key: string;
	messages: AgentMessage[];
	/** tokens the last run added to the context (estimated from the provider's counts); null = not known */
	lastAdded: number | null;
	/** Claude subscription engine: the SDK session holding the conversation (`messages` stays empty), and its size at the last turn */
	sessionId?: string;
	tokens?: number;
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

	/** The specialist a thread belongs to; null for the lead (and for one removed from the settings). */
	private specOf(thread: Thread): AgentSpec | null {
		return thread.agent === LEAD_ID ? null : ((this.d.agents?.() ?? DEFAULT_AGENTS).find((a) => a.id === thread.agent) ?? null);
	}

	/** The model a run of this agent uses: the spec's own model and effort when it has them, else the settings'. `key` names the conversation and the usage rows. */
	private modelFor(s: Settings, spec: AgentSpec | null): { provider: string; modelId: string; effort: PiEffort | undefined; key: string } {
		const modelId = spec?.model?.trim() || s.model;
		return { provider: s.provider, modelId, effort: ((spec?.effort || s.effort) || undefined) as PiEffort | undefined, key: `${s.provider}/${modelId}` };
	}

	/** Images the thread's live conversation holds, for the attachment limits (0 when it is not in memory or the model changed). */
	imagesInContext(thread: Thread): number {
		const s = this.d.settings();
		const conv = this.conversations.get(thread.id);
		return conv && conv.key === this.modelFor(s, this.specOf(thread)).key ? countImages(this.shrink(conv.messages)) : 0;
	}

	/** What every request starts with, built by standingFor (agents.ts): the lead's rules, roster and skills, or a specialist's shared rules, role,
	 *  own roster and own skills. `revitTools` are the Revit tools this run really has. */
	private standing(s: Settings, spec: AgentSpec | null, revitTools?: ReadonlySet<string>, lane = false, projectId: string | null = null): string {
		// a delegate lane has nobody to write to and no part in the process: no status for it
		return standingFor(spec, { ...this.standingDeps(s, spec, revitTools, lane ? null : projectId), lane });
	}

	/** Process mode (14.5): an agent of the profile carries the project's status, the stage's leader also the stage card. Read at each run, so a gate or a mode switch shows in
	 *  the next one. Co-work, no process file, an agent outside the profile (the lead unless the profile lists it) and a project without data have neither. */
	private processText(projectId: string | null, agent: string): { processCard?: string; status?: string } {
		if (!projectId) return {};
		try {
			const store = ProjectStore.load(this.d.ctx.projectsDir, projectId);
			const p = readProcess(store);
			if (!p || p.mode !== "process" || !p.profile.agents.includes(agent)) return {};
			const open = openTasks(this.d.mail?.(projectId).messages() ?? []);
			const status = statusText(p, { notes: store.notes(), open, now: new Date().toISOString(), viewer: agent, remarks: store.readMeta<FixRemark[]>(EXPERT_META, []) });
			return { status, ...(p.stage !== "mācības" && p.stage !== "done" && LEADER[p.stage] === agent ? { processCard: stageCard(p.stage) } : {}) };
		} catch {
			return {};
		}
	}

	private standingDeps(s: Settings, spec: AgentSpec | null, revitTools?: ReadonlySet<string>, projectId: string | null = null): Parameters<typeof standingFor>[1] {
		// a specialist carries what the office wrote down for it (13.4); the lead's text stays as the 0.6 guard measures it: it reads office memory with read_notes
		const knowledge = spec ? knowledgeFor(new OfficeMemory(join(this.d.ctx.appDir, "memory")), spec.id) : "";
		return { appDir: this.d.ctx.appDir, userName: s.userName, specs: this.d.agents?.() ?? DEFAULT_AGENTS, skills: listSkills(this.d.ctx.skillsDir ?? "", officeSkillsDir(this.d.ctx.appDir)), knowledge, revitTools, ...this.processText(projectId, spec ? spec.id : LEAD_ID) };
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

				const envOf = (agent: string) => ctxEnv({ ...this.d.ctx, projectId, runDir, agent, thread: thread.id });
				const env = envOf(spec ? spec.id : LEAD_ID);
				const appTools = allTools().map((t) => t.name);
				const app = appLevels();
				const appSet = new Set(appTools);
				// what this run is offered, with the Revit server or without it. A specialist's own tool list is what `delegate` gives its lanes plus,
				// when its spec says maxLevel "confirm", its confirm tools (its gate asks the user); `never` and the main process's tools stay out.
				const planFor = (rv: ToolServer | null) => {
					const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, app, rv?.levels ?? {});
					const revitTools = new Set(rv?.tools ?? []);
					const listed = [...offered(appTools, levelOf), ...(rv ? offered(rv.tools, levelOf) : [])];
					const own = spec ? new Set(ownTools(listed, levelOf, revitTools, spec, capOf(spec))) : null;
					return { revit: rv, levelOf, revitTools, listed, own };
				};
				let plan = planFor(this.d.revit());
				// One Revit takes one MCP connection: a run that would be offered a Revit tool takes the seat, and with it gets the Revit server. Without it
				// the run has no Revit server and no Revit tool, and its prompt says who has Revit. The run's finally frees the seat.
				let seatLine = "";
				if (plan.revit && (plan.own ? [...plan.own] : plan.listed).some((n) => plan.revitTools.has(n)) && !this.d.locks.takeSeat(owner, label)) {
					seatLine = `Revit šobrīd lieto ${this.d.locks.seatLabel() ?? "cits aģents"}; Revit darbu atstāj vai jautā lietotājam.`;
					plan = planFor(null);
				}
				const { revit, levelOf, revitTools, listed, own } = plan;
				const mcp: Record<string, McpLaunchSpec & { allow: readonly string[] }> = {};
				if (own) {
					const mine = [...own].filter((n) => appSet.has(n));
					if (mine.length) mcp["projektesana-tools"] = { ...this.d.toolsServer(env), allow: mine };
					const theirs = [...own].filter((n) => revitTools.has(n));
					if (revit && theirs.length) mcp["revit"] = { ...revit, allow: theirs };
				} else {
					mcp["projektesana-tools"] = { ...this.d.toolsServer(env), allow: offered(appTools, levelOf).filter((n) => !PROCESS_OWN_TOOLS.has(n)) };
					if (revit) mcp["revit"] = { ...revit, allow: offered(revit.tools, levelOf) };
				}

				const gate = new Gate(own ? (n) => (own.has(n) || Object.hasOwn(MAIL_TOOL_LEVELS, n) ? levelOf(n) : "never") : (n) => (PROCESS_OWN_TOOLS.has(n) ? "never" : levelOf(n)), async (req: ConfirmRequest) => {
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
				const agentId = spec ? spec.id : LEAD_ID;
				// the stage is read at the call, not at the run's start: a gate the user passes mid-run opens or closes the block for the next call
				const inS5 = (): boolean => {
					if (!projectId) return false;
					try {
						const p = readProcess(ProjectStore.load(this.d.ctx.projectsDir, projectId));
						return p?.mode === "process" && p.stage === "S5";
					} catch {
						return false;
					}
				};
				// cheap tests first: only a write call of an agent other than eks reads the process file. The lanes of this run use it too: one started in S4 may still be running in S5
				const s5Refusal = (name: string): string | null => {
					const level = levelOf(name);
					return agentId !== EKS && level !== "never" && LEVEL_RANK[level] >= LEVEL_RANK.propose && !S5_OPEN(name) && inS5() ? S5_BLOCK : null;
				};
				const beforeToolCall: NonNullable<Parameters<typeof runPi>[0]["beforeToolCall"]> = async (ctx, sig) => {
					const refused = s5Refusal(ctx.toolCall.name);
					if (refused) return { block: true, reason: refused };
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

				// the agent's own model and effort (13.3); an unknown model fails here with the provider's own error
				const { provider, modelId, effort, key } = this.modelFor(s, spec);
				const conv = this.conversations.get(thread.id);
				const rt = await this.d.runtime();
				const model = lookupPiModel(rt, catalogProvider(provider), modelId);
				// the engine: the Claude Agent SDK for a Claude subscription, pi for every other provider (lanes use the same one)
				const claude = isClaudeSub(provider);
				if (claude && !this.d.claudeRun) throw new Error(NOT_CONNECTED);
				const engine = claude ? this.d.claudeRun! : (this.d.runAgent ?? runPi);
				const resume = claude && conv && conv.key === key ? conv.sessionId : undefined;
				// the plan lines the user changed belong to the lead: a specialist neither carries nor clears them
				// this project's mailbox: the thread's open topics go into every prompt, and the mail tools write into it
				const mailbox = this.d.mail?.(projectId);
				const topics = mailbox ? topicsLine(openTopicsOf(thread, mailbox.topics(), mailbox.messages())) : "";
				const prompt = [buildPrompt(this.pinsOf(projectId), focus, [text.trim(), files.text].filter(Boolean).join("\n\n"), spec ? "" : this.planOf(projectId, true), topics), seatLine].filter(Boolean).join("\n\n");
				const promptTokens = estimateTextTokens(prompt) + files.images.length * IMAGE_TOKENS;
				const keepRecent = keepRecentFor(model.contextWindow);

				// 1. the cheap ways first: old screenshots out, old tool results cut (already-shrunk messages stay shrunk)
				let history = conv && conv.key === key ? this.shrink(conv.messages) : [];
				// 2. at the line (80% of the window, at most 200K) the older conversation becomes a summary, before the request is made
				if (history.length && estimateContext(history).tokens + promptTokens > compactLine(model.contextWindow)) {
					history = (await this.compactHistory({ thread, rt, model, history, signal, emit, keepRecent })) ?? history;
				}

				const standing = this.standing(s, spec, revitTools, false, projectId);
				// a resumed SDK session already holds the conversation: the earlier lines are not repeated (history stays [] for that engine)
				const seed = resume ? { summary: null, earlier: [] } : this.transcriptSeed(thread);
				const seeded = seed.summary ? `${standing}\n\nIepriekšējās sarunas kopsavilkums:\n${seed.summary}` : standing;
				// state changed inside the callbacks below (a plain object: TypeScript does not follow closure assignments of a local)
				const st = { toolsRan: false, overflowed: null as string | null, retried: false };
				const attempt = async (h: AgentMessage[]) => {
					st.overflowed = null;
					const base = estimateContext(h).tokens;
					const handle = (e: RunEvent): void => {
						if (e.type === "tool") st.toolsRan = true;
						// the tools server writes the process file in its own process: a process tool's result is how the main process learns a gate may be waiting
						if (e.type === "tool_result" && e.ok && PROCESS_TOOL.test(e.name)) {
							i.notesChanged?.();
							i.dataChanged?.(["process"]);
						}
						// the planning tools write in the tools server's process too: the window reloads what they changed
						const wrote = e.type === "tool_result" && e.ok ? PLANNING_TOOL_DATA[e.name] : undefined;
						if (wrote) i.dataChanged?.(wrote);
						if (e.type === "usage") {
							// the Claude session's size, for the context meter (the SDK holds the messages)
							if (claude && !e.model) {
								const c = this.conversations.get(thread.id);
								if (c && c.key === key) c.tokens = e.input + e.cacheRead + e.cacheWrite + e.output;
							}
							try {
								appendUsage(join(this.d.ctx.appDir, "usage.jsonl"), { at: new Date().toISOString(), run: runId, project: projectId, model: e.model ?? key, input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite, cost: e.cost });
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
						run: engine,
						base: { runtime: rt, provider, modelId, effort },
						// a lane has no Revit (a second connection to the one Revit): no Revit rules in its text, no Revit server below
						standing: (sp) => this.standing(s, sp, new Set(), true),
						// a delegated specialist's tools run as that specialist, in the lead's thread (the parent conversation): the log names who did the work
						mcpFor: (allowed, agentId) => {
							const m: Record<string, McpLaunchSpec & { allow: readonly string[] }> = {};
							const mine = allowed.filter((n) => appSet.has(n));
							if (mine.length) m["projektesana-tools"] = { ...this.d.toolsServer(agentId ? envOf(agentId) : env), allow: mine };
							return m;
						},
						levelOf,
						refuse: s5Refusal,
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
								limits: () => limitsOf(this.d.settings()),
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
								// read at each call: the user may switch the mode while a run goes on
								process: () => {
									if (!projectId) return null;
									try {
										return readProcess(ProjectStore.load(this.d.ctx.projectsDir, projectId));
									} catch {
										return null;
									}
								},
								notesChanged: () => i.notesChanged?.(),
								leadThread: () => this.store(thread).lead(projectId, join(this.d.chatDir, `${projectId ?? "_"}.jsonl`)),
							})
						: [];
					const extraTools = [...lanes, ...mail];
					await engine({
						runtime: rt,
						provider,
						modelId,
						effort,
						prompt,
						images: files.images,
						systemPrompt: h.length ? standing : withEarlier(seeded, seed.earlier),
						mcp,
						signal,
						beforeToolCall,
						afterToolCall,
						history: h,
						...(claude
							? {
									resume,
									// the session id comes with the run's first message: kept at once, so a stopped run still continues its session
									onSession: (sessionId: string) => this.conversations.set(thread.id, { key, messages: [], lastAdded: null, sessionId, tokens: conv?.key === key ? conv.tokens : undefined }),
								}
							: { onMessages: (messages: AgentMessage[]) => this.conversations.set(thread.id, { key, messages, lastAdded: Math.max(0, estimateContext(messages).tokens - base) }) }),
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
			// the seat first (after afterBatch, which ran above): a throw in endBatch or releaseOwner must not keep the next run off Revit for good
			this.d.locks.releaseSeat(owner);
			try {
				if (batchOpen) this.d.locks.endBatch(owner);
			} finally {
				this.d.locks.releaseOwner(owner);
			}
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
		// the thread's own agent: the lead's number is the guard's, a specialist's has its own text, declarations and model
		const agent = this.specOf(thread);
		const mf = this.modelFor(s, agent);
		const model = lookupPiModel(await this.d.runtime(), catalogProvider(mf.provider), mf.modelId);
		const conv = this.conversations.get(thread.id);
		const live = conv && conv.key === mf.key && conv.messages.length > 0 ? conv : null;
		const est = live ? estimateContext(live.messages) : null;
		const b = live ? breakdown(live.messages) : null;
		// a Claude session: its size is what the SDK reported for the last turn; there is no breakdown (the messages are the SDK's)
		const sdkTokens = !live && conv && conv.key === mf.key && conv.sessionId ? (conv.tokens ?? null) : null;
		return {
			window: model.contextWindow,
			compactAt: compactLine(model.contextWindow),
			used: est ? est.tokens : sdkTokens,
			source: est ? est.source : sdkTokens !== null ? "usage" : "none",
			parts: b ? { fixed: b.fixed, chat: b.chat, docs: b.docs, tools: b.tools, images: b.images } : null,
			imageCount: b?.imageCount ?? 0,
			messages: live?.messages.length ?? 0,
			fixedEstimate: fixedTokens(agent, this.standingDeps(s, agent, undefined, thread.projectId), declarationTokens(agent)),
			lastAdded: live?.lastAdded ?? null,
			compactions: this.compactions.get(thread.id) ?? 0,
			// the Fokuss line is sent with every message, "Fokuss: nekas" included
			draft: draft ? { text: estimateTextTokens(draft.text), focus: estimateTextTokens(focusText(draft.focus)), pins: estimateTextTokens(pinsText(this.pinsOf(thread.projectId))), plan: estimateTextTokens(this.planOf(thread.projectId, false)) } : null,
		};
	}

	/** Summarizes the thread's in-memory conversation now; the caller guards against a run going on. */
	async compactNow(thread: Thread, signal?: AbortSignal): Promise<{ before: number; after: number }> {
		const mf = this.modelFor(this.d.settings(), this.specOf(thread));
		if (isClaudeSub(mf.provider)) throw new Error("Claude abonementa sarunu Claude saspiež pats, kad tā tuvojas limitam. Jaunai tēmai sāc jaunu sarunu.");
		const conv = this.conversations.get(thread.id);
		if (!conv || conv.key !== mf.key || !conv.messages.length) throw new Error("Nav ko saspiest: šīs sarunas konteksts atmiņā ir tukšs (jauna saruna, mainīts modelis vai lietotne pārstartēta).");
		const rt = await this.d.runtime();
		const model = lookupPiModel(rt, mf.provider, mf.modelId);
		const history = this.shrink(conv.messages);
		const before = estimateContext(conv.messages).tokens;
		const c = await compactMessages(history, { complete: this.completeFn(rt), model, keepRecentTokens: keepRecentFor(model.contextWindow), signal, maxInputTokens: Math.floor(model.contextWindow * 0.7) });
		if (!c) throw new Error(`Nav ko saspiest: sarunā ir tikai viens posms, vai viss (${before} tokeni) ietilpst nesenajā daļā.`);
		this.rememberCompaction(thread, c.summary, before, c.tokensAfter);
		this.conversations.set(thread.id, { key: conv.key, messages: c.messages, lastAdded: null });
		return { before, after: c.tokensAfter };
	}
}
