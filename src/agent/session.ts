// The agent as the main process runs it: one conversation per project, one run at a time, the approval gate, the Fokuss.
// No Electron imports: the runtime, the settings and the event sink are injected.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow, normalizeContext, uuidv7, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AgentStatus, ChatAttachment, ChatAttachmentRef, ChatEntry, ContextInfo, FileCost, FocusItem } from "../shared/api.js";
import { measureAttachment, prepareAttachments, type PreparedAttachments } from "./attachments.js";
import { compactMessages, type Complete } from "./compact.js";
import { breakdown, compactLine, countImages, estimateContext, estimateTextTokens, IMAGE_TOKENS, imageLimits, pruneImages, trimToolResults } from "./context.js";
import type { RunEvent, Settings } from "../shared/types.js";
import { focusText } from "./focus.js";
import { isPiProvider, lookupPiModel, piAuthState, piProviderInfo, runPi, seesImages, streamFn, type McpLaunchSpec, type PiEffort, type PiRuntime } from "./pi/index.js";
import { SYSTEM_PROMPT, buildPrompt, userLine, withEarlier } from "./prompt.js";
import { REVIT_RULES } from "./tools/revit.js";
import { listSkills, skillsText } from "./skills.js";
import { ProjectStore } from "../core/store.js";
import type { Pin } from "../core/model.js";
import { ctxEnv, type ToolCtx } from "./tools/context.js";
import { allTools, appLevels } from "./tools/defs.js";
import { Gate, makeLevelOf, offered, type ConfirmRequest, type Level } from "./tools/levels.js";
import { pinsText } from "./tools/pins.js";

/** Tokens of the app's own tool declarations, which every request carries. Revit's tools come on top when it is connected. */
let appToolTokens: number | null = null;
function toolDeclarationTokens(): number {
	if (appToolTokens === null) appToolTokens = estimateTextTokens(JSON.stringify(allTools().map((t) => ({ name: t.name, description: t.description, parameters: z.toJSONSchema(z.object(t.input)) }))));
	return appToolTokens;
}

/** Keep this much of the newest conversation word for word when compacting: 20K, or 15% of a small window. */
const keepRecentFor = (window: number) => Math.min(20_000, Math.floor(window * 0.15));

export interface ToolServer extends McpLaunchSpec {
	/** every tool name the server may list; the gate's level table filters what is offered */
	tools: readonly string[];
	levels: Record<string, Level>;
}

export interface SessionDeps {
	runtime: () => Promise<PiRuntime>;
	settings: () => Settings;
	/** how to start the app's tools server with a given context */
	/** how to start the app's tools server with a given context (env includes the Revit launch for the named commands) */
	toolsServer: (env: Record<string, string>) => McpLaunchSpec;
	/** the Revit MCP server, when configured; null = not connected */
	revit: () => ToolServer | null;
	ctx: Omit<ToolCtx, "projectId" | "runDir">;
	runsDir: string;
	chatDir: string;
	emit: (runId: string, event: RunEvent) => void;
	/** one model call for the summaries; the app streams through pi, tests inject a fake */
	complete?: Complete;
	/** the agent loop; defaults to pi's, tests inject a scripted one */
	runAgent?: typeof runPi;
	/** is the active Revit document this project's working copy? (6.3) */
	revitWork?: (projectId: string | null) => Promise<{ ok: boolean; title: string }>;
	/** after a run with a confirmed batch: capture a revision, run the room check; returns a line for the chat (6.2) */
	afterBatch?: (projectId: string, summary: string) => Promise<string>;
}

interface Conversation {
	key: string;
	messages: AgentMessage[];
	/** tokens the last run added to the context (estimated from the provider's counts); null = not known */
	lastAdded: number | null;
}

export class AgentSession {
	private conversations = new Map<string, Conversation>();
	/** compactions per conversation since the app started */
	private compactions = new Map<string, number>();
	private running: { id: string; abort: AbortController } | null = null;
	private confirms = new Map<string, (ok: boolean) => void>();
	private n = 0;

	constructor(private d: SessionDeps) {}

	async status(): Promise<AgentStatus> {
		const s = this.d.settings();
		const revit = this.d.revit() ? "savienots" : s.revitServerJs ? "nav savienojuma" : "nav konfigurēts";
		if (!isPiProvider(s.provider)) return { provider: s.provider, providerLabel: s.provider, model: s.model, signedIn: false, reason: `nezināms pakalpojums: ${s.provider}`, revit, images: null, imageLimits: null };
		const info = piProviderInfo(s.provider);
		try {
			const rt = await this.d.runtime();
			const auth = await piAuthState(rt, s.provider);
			let images: boolean | null = null;
			let limits: AgentStatus["imageLimits"] = null;
			try {
				const m = lookupPiModel(rt, s.provider, s.model);
				images = seesImages(m);
				limits = imageLimits(m);
			} catch {
				// unknown model: the run says why
			}
			return { provider: s.provider, providerLabel: info.label, model: s.model || "(noklusējums)", signedIn: auth.configured, reason: auth.configured ? `${auth.method ?? ""}` : "nav pieslēgts", revit, images, imageLimits: limits };
		} catch (e) {
			return { provider: s.provider, providerLabel: info.label, model: s.model, signedIn: false, reason: `nav pieslēgts: ${(e as Error).message}`, revit, images: null, imageLimits: null };
		}
	}

	private chatFile(projectId: string | null) {
		mkdirSync(this.d.chatDir, { recursive: true });
		return join(this.d.chatDir, `${projectId ?? "_"}.jsonl`);
	}

	history(projectId: string | null): ChatEntry[] {
		const f = this.chatFile(projectId);
		if (!existsSync(f)) return [];
		const out: ChatEntry[] = [];
		for (const line of readFileSync(f, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line));
			} catch {
				// a torn line is skipped
			}
		}
		return out;
	}

	private remember(projectId: string | null, role: "user" | "assistant", text: string, attachments?: ChatAttachmentRef[]) {
		const entry: ChatEntry = { role, text, at: new Date().toISOString(), ...(attachments?.length ? { attachments } : {}) };
		if (text.trim() || attachments?.length) appendFileSync(this.chatFile(projectId), JSON.stringify(entry) + "\n", "utf8");
	}

	/** Starts a run; events arrive through `emit`. Refuses while another run is going. Attachments are read and checked
	 *  first, so a file the model cannot take is refused here (the window keeps it in the strip) and no run starts. */
	async send(projectId: string | null, text: string, focus: FocusItem[], attachments: ChatAttachment[] = []): Promise<{ runId: string }> {
		if (this.running) throw new Error("Aģents jau strādā. Aptur vai pagaidi.");
		if (!text.trim() && !attachments.length) throw new Error("Tukšs ziņojums.");
		const runId = `r${Date.now().toString(36)}${++this.n}`;
		let files: PreparedAttachments = { images: [], text: "", refs: [] };
		if (attachments.length) {
			const s = this.d.settings();
			const model = await this.modelOf(s);
			const conv = this.conversations.get(projectId ?? "_");
			files = await prepareAttachments(attachments, {
				seesImages: model ? seesImages(model) : true,
				model: s.model || model?.id || "(noklusējums)",
				saveDir: join(this.d.runsDir, runId, "attachments"),
				limits: model ? imageLimits(model) : null,
				imagesInContext: conv && conv.key === `${s.provider}/${s.model}` ? countImages(this.shrink(conv.messages)) : 0,
			});
			// reading the files took a moment: another message may have started meanwhile
			if (this.running) throw new Error("Aģents jau strādā. Aptur vai pagaidi.");
		}
		const abort = new AbortController();
		this.running = { id: runId, abort };
		void this.run(runId, projectId, text, focus, files, abort.signal).finally(() => {
			this.running = null;
			for (const [, r] of this.confirms) r(false);
			this.confirms.clear();
		});
		return { runId };
	}

	stop() {
		this.running?.abort.abort();
	}

	confirm(id: string, allow: boolean) {
		const r = this.confirms.get(id);
		if (!r) throw new Error("Šis apstiprinājums vairs negaida.");
		this.confirms.delete(id);
		r(allow);
	}

	/** The chosen model, or null when it cannot be looked up (the run itself reports why). */
	private async modelOf(s: Settings): Promise<Model<Api> | null> {
		try {
			return lookupPiModel(await this.d.runtime(), s.provider, s.model);
		} catch {
			return null;
		}
	}

	/** What every request starts with: the rules, who the user is, Revit's rules, the skills. */
	private standing(s: Settings): string {
		return [SYSTEM_PROMPT, userLine(s.userName), REVIT_RULES, skillsText(listSkills(this.d.ctx.skillsDir ?? ""))].filter(Boolean).join("\n\n");
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

	private rememberCompaction(projectId: string | null, summary: string, before: number, after: number) {
		const entry: ChatEntry = { role: "assistant", kind: "compaction", text: summary, at: new Date().toISOString(), tokens: { before, after } };
		appendFileSync(this.chatFile(projectId), JSON.stringify(entry) + "\n", "utf8");
		const id = projectId ?? "_";
		this.compactions.set(id, (this.compactions.get(id) ?? 0) + 1);
	}

	/**
	 * Summarizes the older part of `history`. Returns the new messages, or null when nothing could be done (the reason goes
	 * out as a `compact` failed event): the run then goes on with what it has, never stops on a failed summary.
	 */
	private async compactHistory(o: { projectId: string | null; rt: PiRuntime; model: Model<Api>; history: AgentMessage[]; signal: AbortSignal; emit?: (e: RunEvent) => void; keepRecent: number }): Promise<AgentMessage[] | null> {
		const before = estimateContext(o.history).tokens;
		o.emit?.({ type: "compact", phase: "start", before });
		try {
			const c = await compactMessages(o.history, { complete: this.completeFn(o.rt), model: o.model, keepRecentTokens: o.keepRecent, signal: o.signal, maxInputTokens: Math.floor(o.model.contextWindow * 0.7) });
			if (!c) {
				o.emit?.({ type: "compact", phase: "failed", before, message: "Nav ko saspiest: sarunā ir tikai viens posms, vai viss ietilpst nesenajā daļā." });
				return null;
			}
			this.rememberCompaction(o.projectId, c.summary, before, c.tokensAfter);
			o.emit?.({ type: "compact", phase: "done", before, after: c.tokensAfter });
			return c.messages;
		} catch (e) {
			o.emit?.({ type: "compact", phase: "failed", before, message: (e as Error).message });
			return null;
		}
	}

	/** The newest compaction summary in the transcript and the lines after it, for a conversation that is not in memory (restart, model change). */
	private transcriptSeed(projectId: string | null): { summary: string | null; earlier: { role: string; text: string }[] } {
		const all = this.history(projectId);
		const ci = all.map((e) => e.kind).lastIndexOf("compaction");
		const tail = all.slice(ci + 1).slice(-11, -1);
		return {
			summary: ci >= 0 ? all[ci].text : null,
			earlier: tail.map((e) => ({ role: e.role, text: e.attachments?.length ? `${e.text}\n[pielikumi: ${e.attachments.map((a) => a.name).join(", ")}]` : e.text })),
		};
	}

	private async run(runId: string, projectId: string | null, text: string, focus: FocusItem[], files: PreparedAttachments, signal: AbortSignal) {
		const emit = (e: RunEvent) => this.d.emit(runId, e);
		let answer = "";
		let confirmedBatches = 0;
		try {
			const s = this.d.settings();
			const runDir = join(this.d.runsDir, runId);
			mkdirSync(runDir, { recursive: true });
			writeFileSync(join(runDir, "focus.json"), JSON.stringify(focus), "utf8");
			this.remember(projectId, "user", text, files.refs);

			const env = ctxEnv({ ...this.d.ctx, projectId, runDir });
			const appTools = allTools().map((t) => t.name);
			const app = appLevels();
			const revit = this.d.revit();
			const levelOf = makeLevelOf(app, revit?.levels ?? {});
			const mcp: Record<string, McpLaunchSpec & { allow: readonly string[] }> = { "projektesana-tools": { ...this.d.toolsServer(env), allow: offered(appTools, levelOf) } };
			if (revit) mcp["revit"] = { ...revit, allow: offered(revit.tools, levelOf) };

			const revitTools = new Set(revit?.tools ?? []);
			const gate = new Gate(levelOf, async (req: ConfirmRequest) => {
				if (signal.aborted) return false;
				// a batch that changes the Revit model runs only on this project's working copy (never the office file)
				if (req.batch.some((b) => revitTools.has(b.tool) || b.tool.startsWith("revit_")) && this.d.revitWork) {
					const w = await this.d.revitWork(projectId).catch((e: Error) => ({ ok: false, title: e.message }));
					if (!w.ok) {
						emit({ type: "error", engine: "pi", message: `Partija noraidīta: aktīvais Revit dokuments nav šī projekta darba kopija (${w.title}). Izveido to: Versijas → Revit → Darba kopija.` });
						return false;
					}
				}
				return new Promise<boolean>((resolve) => {
					this.confirms.set(req.id, (ok) => {
						if (ok) confirmedBatches++;
						resolve(ok);
					});
					emit({ type: "confirm", id: req.id, tool: req.batch.map((b) => b.tool).join(", "), batch: JSON.stringify(req.batch).slice(0, 4000) });
				});
			});

			const key = `${s.provider}/${s.model}`;
			const id = projectId ?? "_";
			const conv = this.conversations.get(id);
			const rt = await this.d.runtime();
			const model = lookupPiModel(rt, s.provider, s.model);
			const prompt = buildPrompt(this.pinsOf(projectId), focus, [text.trim(), files.text].filter(Boolean).join("\n\n"));
			const promptTokens = estimateTextTokens(prompt) + files.images.length * IMAGE_TOKENS;
			const keepRecent = keepRecentFor(model.contextWindow);

			// 1. the cheap ways first: old screenshots out, old tool results cut (already-shrunk messages stay shrunk)
			let history = conv && conv.key === key ? this.shrink(conv.messages) : [];
			// 2. at the line (80% of the window, at most 200K) the older conversation becomes a summary, before the request is made
			if (history.length && estimateContext(history).tokens + promptTokens > compactLine(model.contextWindow)) {
				history = (await this.compactHistory({ projectId, rt, model, history, signal, emit, keepRecent })) ?? history;
			}

			const standing = this.standing(s);
			const seed = this.transcriptSeed(projectId);
			const seeded = seed.summary ? `${standing}\n\nIepriekšējās sarunas kopsavilkums:\n${seed.summary}` : standing;
			// state changed inside the callbacks below (a plain object: TypeScript does not follow closure assignments of a local)
			const st = { toolsRan: false, overflowed: null as string | null, retried: false };
			const attempt = async (h: AgentMessage[]) => {
				st.overflowed = null;
				const base = estimateContext(h).tokens;
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
					beforeToolCall: gate.before,
					history: h,
					onMessages: (messages) => this.conversations.set(id, { key, messages, lastAdded: Math.max(0, estimateContext(messages).tokens - base) }),
					onEvent: (e) => {
						if (e.type === "tool") st.toolsRan = true;
						if (e.type === "done") answer = e.text;
						if (e.type === "error" && isContextOverflow({ stopReason: "error", errorMessage: e.message } as AssistantMessage)) {
							st.overflowed = e.message;
							// before any tool ran nothing has happened yet: held back, the run is compacted and repeated once
							if (!st.toolsRan && !st.retried) return;
							emit({ ...e, message: `${e.message}\n\nKonteksts ir pilns. Spied «saspiest» virs ievades vai sāc jaunu sarunu.` });
							return;
						}
						emit(e);
					},
				});
			};
			await attempt(history);
			if (st.overflowed && !st.toolsRan && !st.retried && !signal.aborted) {
				// the model refused the request for its size, although the estimate said it fits: summarize harder and ask again, once
				st.retried = true;
				const smaller = history.length ? await this.compactHistory({ projectId, rt, model, history, signal, emit, keepRecent: Math.floor(keepRecent / 2) }) : null;
				if (smaller) await attempt(smaller);
				else emit({ type: "error", engine: "pi", message: `${st.overflowed}\n\nKonteksts ir pilns, un to nevarēja saspiest. Sāc jaunu sarunu vai pievieno mazāk.` });
			}
		} catch (e) {
			emit({ type: "error", engine: "pi", message: (e as Error).message });
		} finally {
			this.remember(projectId, "assistant", answer);
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
	}

	private pinsOf(projectId: string | null): Pin[] {
		if (!projectId) return [];
		try {
			return ProjectStore.load(this.d.ctx.projectsDir, projectId).read("pins");
		} catch {
			return [];
		}
	}

	/** Forgets the in-memory conversation (new topic, or the model changed). The transcript stays. */
	reset(projectId: string | null) {
		this.conversations.delete(projectId ?? "_");
		this.compactions.delete(projectId ?? "_");
	}

	/** What the next request carries, where the limits are, and what the message being typed would add. */
	async context(projectId: string | null, draft?: { text: string; focus: FocusItem[] }): Promise<ContextInfo> {
		const s = this.d.settings();
		const model = lookupPiModel(await this.d.runtime(), s.provider, s.model);
		const id = projectId ?? "_";
		const conv = this.conversations.get(id);
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
			compactions: this.compactions.get(id) ?? 0,
			// the Fokuss line is sent with every message, "Fokuss: nekas" included
			draft: draft ? { text: estimateTextTokens(draft.text), focus: estimateTextTokens(focusText(draft.focus)), pins: estimateTextTokens(pinsText(this.pinsOf(projectId))) } : null,
		};
	}

	/** What one attached file adds to the context; throws when it could not be sent (a scanned PDF, an unknown format). */
	measureFile(a: ChatAttachment): Promise<FileCost> {
		return measureAttachment(a);
	}

	/** The user's own "saspiest": the same summary as at the limit, now. Refused while a run is going. */
	async compactNow(projectId: string | null): Promise<{ before: number; after: number }> {
		if (this.running) throw new Error("Aģents strādā. Aptur vai pagaidi.");
		const s = this.d.settings();
		const id = projectId ?? "_";
		const conv = this.conversations.get(id);
		if (!conv || conv.key !== `${s.provider}/${s.model}` || !conv.messages.length) throw new Error("Nav ko saspiest: šīs sarunas konteksts atmiņā ir tukšs (jauna saruna, mainīts modelis vai lietotne pārstartēta).");
		const rt = await this.d.runtime();
		const model = lookupPiModel(rt, s.provider, s.model);
		const abort = new AbortController();
		this.running = { id: "compact", abort };
		try {
			const history = this.shrink(conv.messages);
			const before = estimateContext(conv.messages).tokens;
			const c = await compactMessages(history, { complete: this.completeFn(rt), model, keepRecentTokens: keepRecentFor(model.contextWindow), signal: abort.signal, maxInputTokens: Math.floor(model.contextWindow * 0.7) });
			if (!c) throw new Error(`Nav ko saspiest: sarunā ir tikai viens posms, vai viss (${before} tokeni) ietilpst nesenajā daļā.`);
			this.rememberCompaction(projectId, c.summary, before, c.tokensAfter);
			this.conversations.set(id, { key: conv.key, messages: c.messages, lastAdded: null });
			return { before, after: c.tokensAfter };
		} finally {
			this.running = null;
		}
	}
}
