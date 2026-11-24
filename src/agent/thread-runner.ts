// One run of one thread: the body of what AgentSession.run was, keyed by the thread instead of the project.
// The conversation in memory, the compaction counter and the transcript belong to the thread; the plan stays per project.
// No Electron imports: everything is injected through SessionDeps (+ the thread stores and the lock registry).
// Phase C: the tool ceiling a message brings (`RunInput.levelCap`, the Chief's level flowing down) lowers the agent's own; BPV and department leads get the task tools; an agent
// with `check` set has its final answer read by a checker and fixed, up to 3 checks and 2 fixes (core/check-work.ts, from OpenMausBot server/host/check-work.ts).
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isContextOverflow, normalizeContext, uuidv7, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatAttachmentRef, ChatEntry, ContextInfo, FocusItem } from "../shared/api.js";
import { findSpec, type AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID, type IncidentView, type RunMeta, type Thread } from "../shared/thread-types.js";
import type { CheckUsage, RunEvent, Settings } from "../shared/types.js";
import type { PreparedAttachments } from "./attachments.js";
import { compactMessages, type Complete } from "./compact.js";
import { appendUsage } from "./usage.js";
import { breakdown, compactLine, countImages, estimateContext, estimateTextTokens, IMAGE_TOKENS, pruneImages, trimToolResults } from "./context.js";
import { focusText } from "./focus.js";
import { lookupPiModel, runPi, streamFn, type McpLaunchSpec, type PiEffort, type PiRunOptions, type PiRuntime } from "./pi/index.js";
import { catalogProvider, isClaudeSub, NOT_CONNECTED } from "./claude/provider.js";
import { backupFor, classifyFailure, targetFor, type Failover, type Target } from "./failover/index.js";
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
import { freeWrite } from "./tools/project-write.js";
import { pinsText } from "./tools/pins.js";
import { lockKeyOf, type LockRegistry } from "./locks.js";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOLS, MAIN_TOOL_LEVELS, RULES, capOf, laneTools, ownTools, runLanes, subagentTools, type Job, type LaneDeps } from "./subagents.js";
import { agentMcpRun } from "./agent-mcp.js";
import { EKS, LEADER, PROCESS_OWN_TOOLS, stageCard } from "../core/process-def.js";
import { MAIL_TOOL_LEVELS, mailTools, type MailDeps } from "./mail.js";
import { chiefOf, taskTools } from "./task-tools.js";
import { holdsChiefTools, minLevel, type Level as CapLevel } from "../core/chief.js";
import { CHECKER_SYSTEM, CHECK_MAX_MS, addTally, addTurn, afterCheck, noUsage, checkBrief, fixBrief, readVerdict, roundsOf, worthChecking } from "../core/check-work.js";
import { limitsOf, openTasks, openTopicsOf, topicsLine, type Mailbox } from "../core/messages.js";
import type { SessionDeps, ToolServer } from "./session.js";

/** The process tools that change the process file (not `process_status`); the name may carry the tools server's prefix. */
const PROCESS_TOOL = /process_(request_gate|skip_stage|set_profile|review_done|change_impact)$/;

/** The tools that write what the search index holds beyond sources and conversations: the Markdown memory, and the notes the decision and question logs are made of.
 *  They write in the tools server's process, so this is how the main process learns to bring the index up to date (main.ts asks for a run on "memory" and "notes"). */
const INDEXED_TOOL = /(?:^|__)(memory_write|memory_write_office|write_note|close_topic|report_answer|send_message)$/;

/** What a write tool of an author gets during S5 (14.6): the expert is reading the project, so nobody but eks changes it. */
export const S5_BLOCK = "S5 laikā sadaļas autors nelabo projektu.";

/** Tools that stay open to the authors in S5 though they are above `read`: mail (they answer eks), the process tools, and the expert_* ones (remarks are the expert's record, not the project). */
const S5_OPEN = (name: string) => Object.hasOwn(MAIL_TOOL_LEVELS, name) || name.startsWith("process_") || name.startsWith("expert_");

/** Keep this much of the newest conversation word for word when compacting: 20K, or 15% of a small window. */
const keepRecentFor = (window: number) => Math.min(20_000, Math.floor(window * 0.15));

/** Names a conversation and its usage rows: the provider and the model as chosen. */
const keyOf = (t: Pick<Target, "provider" | "model">) => `${t.provider}/${t.model}`;

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
	/** this run answers another agent's mail (a task or an ask): a usage limit or a lost sign-in before any tool ran is resent once on the backup, whatever automatic recovery says */
	peer?: boolean;
	/** the tool ceiling the work came with (the Chief's level flows down, core/chief.ts): this run never goes above it, whatever its agent is allowed */
	levelCap?: CapLevel;
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
	/** where each thread's last run really went (its backup while its provider was held, the checker's provider for eks): the context meter and the attachment limits describe that model */
	private lastOn = new Map<string, Target>();

	constructor(private d: SessionDeps & { threads: (projectId: string | null) => ThreadStore; locks: LockRegistry; mail?: (projectId: string | null) => Mailbox; failover?: Failover; /** the words a handoff to a paused agent is refused with (null = it may work) */ held?: (agent: string) => string | null; /** the open incidents of a project, and an agent's Retry of one (coordinator.ts) */ incidents?: (projectId: string | null) => IncidentView[]; retryIncident?: (id: string, by: { agent: string; projectId: string | null }) => { runId: string | null; queued: boolean } }) {}

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

	/** The model a run of this agent uses: the spec's own provider, model and effort when it has them, else the settings'. `key` names the conversation and the usage rows.
	 *  With `thread`: the model its conversation in memory lives on, when that was not the agent's own (a backup, the checker's provider). */
	private modelFor(s: Settings, spec: AgentSpec | null, thread?: Thread): { provider: string; modelId: string; effort: PiEffort | undefined; key: string } {
		const own = targetFor(spec, s);
		const used = thread ? this.lastOn.get(thread.id) : undefined;
		const t = used && this.conversations.get(thread!.id)?.key === keyOf(used) ? used : own;
		return { provider: t.provider, modelId: t.model, effort: (t.effort || undefined) as PiEffort | undefined, key: keyOf(t) };
	}

	/** The engine of a provider: the Claude Agent SDK for the Claude subscription, pi for every other. Undefined = the subscription engine is not built in. */
	private engineOf(provider: string): ((o: PiRunOptions) => Promise<void>) | undefined {
		return isClaudeSub(provider) ? this.d.claudeRun : (this.d.runAgent ?? runPi);
	}

	/** Images the thread's live conversation holds, for the attachment limits (0 when it is not in memory or the model changed). */
	imagesInContext(thread: Thread): number {
		const s = this.d.settings();
		const conv = this.conversations.get(thread.id);
		return conv && conv.key === this.modelFor(s, this.specOf(thread), thread).key ? countImages(this.shrink(conv.messages)) : 0;
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
		const specs = this.d.agents?.() ?? DEFAULT_AGENTS;
		// BPV and a department's lead hold the Chief's tools, so their text carries the line on incidents
		const chief = !!spec && holdsChiefTools(spec.id, specs, this.d.departments?.() ?? []);
		return { appDir: this.d.ctx.appDir, userName: s.userName, specs, chief, skills: listSkills(this.d.ctx.skillsDir ?? "", officeSkillsDir(this.d.ctx.appDir)), knowledge, revitTools, ...this.processText(projectId, spec ? spec.id : LEAD_ID) };
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
		let heldDone = false;
		// the lane dependencies of the latest attempt (its model, its tools, its locks): what a check turn runs with
		let lastLaneDeps: LaneDeps | null = null;
		let batchOpen = false;
		// who this run is, for the agent log
		const logMeta: RunMeta = { threadId: thread.id, agent: thread.agent, projectId, wave: i.wave };
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
					const own = spec ? new Set(ownTools(listed, levelOf, revitTools, spec, minLevel(capOf(spec) as CapLevel, i.levelCap) ?? capOf(spec))) : null;
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
					// the agent's own MCP servers (agent-mcp.ts), this agent's thread only: never a lane (`delegate`), never another agent. Their tools are `confirm` (or `read`
					// where the user marked them); `app` (this run's own table of the app's levels) and `own` take the names, so the level lookup and the gate below know them.
					if (spec?.mcp?.length) {
						const mine = agentMcpRun(spec);
						Object.assign(mcp, mine.servers);
						Object.assign(app, mine.levels);
						for (const n of Object.keys(mine.levels)) own.add(n);
					}
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
				}, (tool, args) => freeWrite({ ...this.d.ctx, projectId }, tool, args));
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

				// `let`: a fix turn after a check carries on from the conversation as the first turn left it
				let conv = this.conversations.get(thread.id);
				const rt = await this.d.runtime();
				// Where this run goes (Phase A). The agent's own provider and model (13.3) and its backup; eks, with no provider of its own, on a provider other than its authors';
				// and the backup in place of a provider that is on hold (a usage limit, a lost sign-in) so the run starts there and not on a refusal. An unknown model fails
				// below with the provider's own error.
				const fo = this.d.failover;
				let primary: Target = targetFor(spec, s);
				if (fo && spec?.id === EKS) {
					const checker = await fo.checkerTarget(spec, this.d.agents?.() ?? DEFAULT_AGENTS, s);
					if (checker) primary = checker;
				}
				const backup = backupFor(spec, s);
				const needImages = files.images.length > 0 || (conv ? countImages(this.shrink(conv.messages)) > 0 : false);
				const started = fo ? await fo.start({ agent: agentId, name: label, primary, backup, needImages }) : { on: primary, id: primary.model, took: false, notice: undefined };
				if (started.notice) emit({ type: "text", text: `[lietotne] ${started.notice}\n\n` });
				// a run already on the backup has no second one; a retry on the backup is made once
				let retried = !!started.took;
				// everything that follows the choice of provider: the model, the engine (the Claude Agent SDK for a Claude subscription, pi for every other provider; lanes use the same
				// ones), the conversation's key and, for a Claude session, the one to resume
				const shapeFor = (target: Target) => {
					const model = lookupPiModel(rt, catalogProvider(target.provider), target.model);
					const claude = isClaudeSub(target.provider);
					if (claude && !this.d.claudeRun) throw new Error(NOT_CONNECTED);
					const key = keyOf(target);
					return { target, provider: target.provider, modelId: target.model, effort: (target.effort || undefined) as PiEffort | undefined, model, claude, engine: claude ? this.d.claudeRun! : (this.d.runAgent ?? runPi), key, resume: claude && conv && conv.key === key ? conv.sessionId : undefined, keepRecent: keepRecentFor(model.contextWindow) };
				};
				let shape = shapeFor(started.on);
				this.lastOn.set(thread.id, started.on);
				// the plan lines the user changed belong to the lead: a specialist neither carries nor clears them
				// this project's mailbox: the thread's open topics go into every prompt, and the mail tools write into it
				const mailbox = this.d.mail?.(projectId);
				const topics = mailbox ? topicsLine(openTopicsOf(thread, mailbox.topics(), mailbox.messages())) : "";
				let prompt = [buildPrompt(this.pinsOf(projectId), focus, [text.trim(), files.text].filter(Boolean).join("\n\n"), spec ? "" : this.planOf(projectId, true), topics), seatLine].filter(Boolean).join("\n\n");
				let promptTokens = estimateTextTokens(prompt) + files.images.length * IMAGE_TOKENS;
				// the images go with the first turn only (a fix turn after a check has none)
				let turnImages = files.images;

				// 1. the cheap ways first: old screenshots out, old tool results cut (already-shrunk messages stay shrunk)
				// 2. at the line (80% of the window, at most 200K) the older conversation becomes a summary, before the request is made
				// (a conversation that lives on another model than this run's is not carried over: it is rebuilt from the transcript, as after a change of model)
				const historyFor = async (sh: typeof shape): Promise<AgentMessage[]> => {
					let h = conv && conv.key === sh.key ? this.shrink(conv.messages) : [];
					if (h.length && estimateContext(h).tokens + promptTokens > compactLine(sh.model.contextWindow)) h = (await this.compactHistory({ thread, rt, model: sh.model, history: h, signal, emit, keepRecent: sh.keepRecent })) ?? h;
					return h;
				};
				const history = await historyFor(shape);

				const standing = this.standing(s, spec, revitTools, false, projectId);
				// a resumed SDK session already holds the conversation: the earlier lines are not repeated (history stays [] for that engine)
				const seedFor = (sh: typeof shape) => {
					const seed = sh.resume ? { summary: null, earlier: [] } : this.transcriptSeed(thread);
					return { seed, seeded: seed.summary ? `${standing}\n\nIepriekšējās sarunas kopsavilkums:\n${seed.summary}` : standing };
				};
				// send_message, close_topic and the task tools: the lead's threads and a specialist's alike, never a lane
				const md: MailDeps | null = mailbox ? ({
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
							departments: () => this.d.departments?.() ?? [],
							held: (agent) => this.d.held?.(agent) ?? null,
							incidents: () => this.d.incidents?.(projectId) ?? [],
							retryIncident: (id) => {
								if (!this.d.retryIncident) throw new Error("Atkārtošana šeit nav pieejama.");
								return this.d.retryIncident(id, { agent: spec ? spec.id : LEAD_ID, projectId });
							},
							// the ceiling this run works under goes with the work it hands on (never raised on the way)
							level: () => (spec ? minLevel(capOf(spec) as CapLevel, i.levelCap) : i.levelCap),
							threadChanged: (t) => this.d.onThread?.(t),
							}) : null;
				// state changed inside the callbacks below (a plain object: TypeScript does not follow closure assignments of a local)
				const st = { toolsRan: false, overflowed: null as string | null, retried: false, held: null as (RunEvent & { type: "error" }) | null };
				// the tally of the fix turn now running (check before done): its model turns are added to it as they report
				let fixTally: CheckUsage | null = null;
				const attempt = async (h: AgentMessage[], sh: typeof shape) => {
					const { provider, modelId, effort, key, claude, engine, resume } = sh;
					const { seed, seeded } = seedFor(sh);
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
						const indexed = e.type === "tool_result" && e.ok ? INDEXED_TOOL.exec(e.name)?.[1] : undefined;
						if (indexed) i.dataChanged?.([indexed.startsWith("memory_") ? "memory" : "notes"]);
						if (e.type === "usage") {
							if (fixTally) addTurn(fixTally, e);
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
						if (e.type === "done") {
							answer = e.text;
							// an agent whose answer is checked announces it done only when the checks are over (a check and a fix turn may follow)
							if (spec?.check) {
								heldDone = true;
								return;
							}
						}
						if (e.type === "error" && isContextOverflow({ stopReason: "error", errorMessage: e.message } as AssistantMessage)) {
							st.overflowed = e.message;
							// before any tool ran nothing has happened yet: held back, the run is compacted and repeated once
							if (!st.toolsRan && !st.retried) return;
							failed = true;
							emit({ ...e, message: `${e.message}\n\nKonteksts ir pilns. Spied «saspiest» virs ievades vai sāc jaunu sarunu.` });
							return;
						}
						if (e.type === "error") {
							// Before any tool ran, an error that a backup may answer (a limit, a lost sign-in, a provider that is down) is held back: below the run decides whether it is
							// tried again on the backup or shown as it is. After a tool ran nothing is resent, but the hold is still recorded so the next run starts on the backup.
							if (fo && !retried && !st.toolsRan && !signal.aborted && classifyFailure(e.message, e.hint).kind !== "other") {
								st.held = e;
								return;
							}
							fo?.record(sh.target, sh.model.id, e.message, e.hint);
							failed = true;
						}
						emit(e);
					};
					// helpers and specialists (task 8.15): lanes of their own, with the tools the gate allows them, writing one at a time
					const laneDeps: LaneDeps = {
						// each lane on the engine of its own provider (a specialist may be on another one than this run)
						run: (o) => {
							const e = this.engineOf(o.provider ?? provider);
							if (!e) throw new Error(NOT_CONNECTED);
							return e(o);
						},
						base: { runtime: rt, provider, modelId, effort },
						failover: fo,
						// a helper (no spec) carries on where this run's agent would
						backupOf: (sp) => backupFor(sp ?? spec, s),
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
						log: this.d.agentLog ? { start: (lane, info) => this.d.agentLog!.start(runId, logMeta, info, lane), event: (lane, e) => this.d.agentLog!.event(runId, e, undefined, lane) } : undefined,
						maxParallel: () => this.d.settings().maxParallelAgents,
						specs: () => this.d.agents?.() ?? DEFAULT_AGENTS,
						// a paused specialist is not handed work (holds.ts): the lead is told not to route around the pause
						held: (agentId) => this.d.held?.(agentId) ?? null,
					};
					// the check turns of a run with `check` use the same lane machinery, with their own event sink
					lastLaneDeps = laneDeps;
					const lanes = spec ? [] : subagentTools(laneDeps);
					// send_message and close_topic, and for every agent report_answer; BPV and a department's lead also assign_task and escalate
					const mail = md ? [...mailTools(md), ...taskTools(md, { chief: chiefOf(md) })] : [];
					const extraTools = [...lanes, ...mail];
					const systemPrompt = h.length ? standing : withEarlier(seeded, seed.earlier);
					// the agent log: what this attempt sends (the model, the system text, the prompt, the tools); everything that comes back arrives as events
					this.d.agentLog?.start(runId, logMeta, { provider, model: modelId, engine: claude ? "claude" : "pi", ...(effort ? { effort } : {}), system: systemPrompt, prompt, tools: [...Object.values(mcp).flatMap((m) => [...m.allow]), ...extraTools.map((t) => t.name)], history: h.length, ...(resume ? { resumed: true } : {}), ...(retried ? { backup: true } : {}), ...(turnImages.length ? { images: turnImages.length } : {}) });
					await engine({
						runtime: rt,
						provider,
						modelId,
						effort,
						prompt,
						images: turnImages,
						systemPrompt,
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
				await attempt(history, shape);
				if (st.overflowed && !st.toolsRan && !st.retried && !signal.aborted) {
					// the model refused the request for its size, although the estimate said it fits: summarize harder and ask again, once
					st.retried = true;
					const smaller = history.length ? await this.compactHistory({ thread, rt, model: shape.model, history, signal, emit, keepRecent: Math.floor(shape.keepRecent / 2) }) : null;
					if (smaller) await attempt(smaller, shape);
					else {
						failed = true;
						emit({ type: "error", engine: "pi", message: `${st.overflowed}\n\nKonteksts ir pilns, un to nevarēja saspiest. Sāc jaunu sarunu vai pievieno mazāk.` });
					}
				}
				// An error held back before any tool ran (a usage limit, a lost sign-in, a provider that is down): the provider is put on hold when the error says so, and the run is
				// tried once more on the backup when that is allowed (agent-to-agent work, or automatic recovery on); else the error is shown as the provider wrote it. The retry is
				// this same run, so it has the gate, the tools, the depth and the wave it had: a resend never carries more than the first try.
				if (st.held) {
					const err = st.held;
					st.held = null;
					const d = fo ? await fo.afterFailure({ agent: agentId, name: label, on: shape.target, id: shape.model.id, backup: retried ? null : backup, error: err.message, hint: err.hint, toolsRan: st.toolsRan, aborted: signal.aborted, mode: i.peer ? "peer" : "direct", recovery: s.automaticRecovery === true, needImages }) : null;
					if (d?.notice) emit({ type: "text", text: `

[lietotne] ${d.notice}

` });
					let next: typeof shape | null = null;
					if (d?.retryOn) {
						try {
							next = shapeFor(d.retryOn);
						} catch {
							// the backup cannot be set up (its model is gone from the catalogue): the first error stands
						}
					}
					if (next) {
						retried = true;
						shape = next;
						this.lastOn.set(thread.id, d!.retryOn!);
						// the notice above names the switch once per stretch; this line says it for this run
						if (!d?.notice) emit({ type: "text", text: `

[lietotne] Atkārto ar ${fo!.label(d!.retryOn!.provider)} (rezerve).

` });
						await attempt(await historyFor(shape), shape);
					} else {
						failed = true;
						emit(err);
					}
				}
				if (fo && !failed && !signal.aborted) fo.worked(agentId, shape.target, shape.model.id);
				// Check before done (the agent's `check` setting; OpenMausBot server/host/check-work.ts): the answer is read against the request by a checker, and the agent fixes what it
				// found, up to `maxChecks` checks (3) and one fix fewer; each is a full turn, shown on the run card. The loop's bounds are core/check-work.ts's, so they hold whatever the
				// models say. Any failure of the checking leaves the answer as it is.
				if (spec?.check && !failed && !signal.aborted && worthChecking(answer, st.toolsRan)) {
					const cw = spec.check;
					const max = roundsOf(cw);
					const began = Date.now();
					const request = [text.trim(), files.text].filter(Boolean).join("\n\n");
					const specs = this.d.agents?.() ?? DEFAULT_AGENTS;
					const checkerSpec = cw.agent ? findSpec(specs, cw.agent) : undefined;
					// who checks: the named agent; else the named provider and model; else another provider than the worker's; else the worker's own
					const on: Target | null = checkerSpec ? null : cw.provider?.trim() ? { provider: cw.provider.trim(), model: cw.model?.trim() ?? "", effort: "" } : fo ? await fo.otherProvider(shape.target) : null;
					const label = checkerSpec ? checkerSpec.name : fo && on ? fo.label(on.provider) : "pārbaudītājs";
					const usageSink = (e: RunEvent): void => {
						// the check turns' tokens are counted in the run and logged like any turn's; their lane lines are not shown (the check line says it)
						if (e.type !== "usage") return;
						addTurn(turn, e);
						try {
							appendUsage(join(this.d.ctx.appDir, "usage.jsonl"), { at: new Date().toISOString(), run: runId, project: projectId, model: e.model ?? keyOf(shape.target), input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite, cost: e.cost });
						} catch {
							// the log is a convenience
						}
						emit(e);
					};
					// what each check turn used on its own (the lane's model turns), and what the whole loop used
					let turn = noUsage();
					const all = noUsage();
					let checksMade = 0;
					let fixesMade = 0;
					const end = (n: number, v: { verdict: "pass" | "issues" | "cannot" | "unclear"; count?: number; report: string }) => {
						addTally(all, turn);
						emit({ type: "check", n, of: max, by: label, phase: "end", ...v, usage: turn });
					};
					let report = "";
					for (let round = 1; !signal.aborted; round++) {
						if (Date.now() - began > CHECK_MAX_MS) {
							end(round, { verdict: "cannot", report: `Pārbaude aizņēma vairāk par ${Math.round(CHECK_MAX_MS / 60_000)} min; atbilde nodota tāda, kāda ir.` });
							break;
						}
						emit({ type: "check", n: round, of: max, by: label, phase: "start" });
						turn = noUsage();
						checksMade++;
						const job: Job = {
							id: `c${Date.now().toString(36)}${round}`,
							label: `Pārbaude ${round}/${max}`,
							agent: checkerSpec?.name,
							...(checkerSpec ? { agentId: checkerSpec.id, spec: checkerSpec } : {}),
							task: checkBrief({ worker: spec.name, round, max, request, answer, earlier: report }),
							system: checkerSpec ? this.standing(s, checkerSpec, new Set(), true) + RULES : CHECKER_SYSTEM,
							// read tools only: it opens the files and pages the answer names, and changes nothing
							allowed: laneTools(listed, levelOf, "read").filter((n) => !revitTools.has(n)),
							...(checkerSpec
								? { ...(checkerSpec.provider?.trim() ? { provider: checkerSpec.provider.trim() } : {}), ...(checkerSpec.model?.trim() ? { model: checkerSpec.model.trim() } : {}), ...(checkerSpec.effort ? { effort: checkerSpec.effort } : {}) }
								: on
									? { provider: on.provider, ...(on.model ? { model: on.model } : {}) }
									: {}),
						};
						const [r] = await runLanes({ ...lastLaneDeps!, emit: usageSink }, [job], signal);
						if (signal.aborted) break;
						if (!r.ok) {
							end(round, { verdict: "cannot", report: `Pārbaudītājs nevarēja strādāt: ${r.report}` });
							break;
						}
						const v = readVerdict(r.report);
						report = r.report;
						end(round, { verdict: v.kind, ...(v.kind === "issues" ? { count: v.count } : {}), report: v.kind === "cannot" ? v.reason || r.report : r.report });
						if (afterCheck(v, round, max).do === "end") break;
						// the fix: a full turn of the agent itself, in its own conversation, on what the checker found
						emit({ type: "check", n: round, of: max, by: label, phase: "fix" });
						const before = answer;
						const fixText = fixBrief(label, r.report, round, max);
						this.remember(thread, "assistant", before);
						this.remember(thread, "user", fixText);
						conv = this.conversations.get(thread.id);
						prompt = fixText;
						promptTokens = estimateTextTokens(prompt);
						turnImages = [];
						st.held = null;
						st.overflowed = null;
						answer = "";
						shape = shapeFor(shape.target);
						const fixed = noUsage();
						fixTally = fixed;
						fixesMade++;
						try {
							await attempt(await historyFor(shape), shape);
						} finally {
							fixTally = null;
							addTally(all, fixed);
							emit({ type: "check", n: round, of: max, by: label, phase: "fixed", usage: fixed });
						}
						if (st.held) {
							failed = true;
							emit(st.held);
							st.held = null;
						}
						if (st.overflowed && !failed) {
							failed = true;
							emit({ type: "error", engine: "pi", message: `${st.overflowed}\n\nKonteksts ir pilns pārbaudes laikā.` });
						}
						if (failed || signal.aborted || !answer.trim()) {
							// the fix gave nothing: the answer stays as it was, and the checks end
							answer = before;
							break;
						}
					}
					// one line for the whole loop: the checks and fixes made and what they used
					if (checksMade) emit({ type: "check", n: checksMade, of: max, by: label, phase: "total", checks: checksMade, fixes: fixesMade, usage: all });
				}
				// the answer is final now: the "done" an agent with checks held back goes out with the last answer
				if (heldDone && !failed && !signal.aborted) emit({ type: "done", text: answer });
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
		const mf = this.modelFor(s, agent, thread);
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
		const mf = this.modelFor(this.d.settings(), this.specOf(thread), thread);
		if (isClaudeSub(mf.provider)) throw new Error("Claude abonementa sarunu Claude saspiež pats, kad tā tuvojas limitam. Jaunai tēmai sāc jaunu sarunu.");
		const conv = this.conversations.get(thread.id);
		if (!conv || conv.key !== mf.key || !conv.messages.length) throw new Error("Nav ko saspiest: šīs sarunas konteksts atmiņā ir tukšs (jauna saruna, mainīts modelis vai lietotne pārstartēta).");
		const rt = await this.d.runtime();
		const model = lookupPiModel(rt, catalogProvider(mf.provider), mf.modelId);
		const history = this.shrink(conv.messages);
		const before = estimateContext(conv.messages).tokens;
		const c = await compactMessages(history, { complete: this.completeFn(rt), model, keepRecentTokens: keepRecentFor(model.contextWindow), signal, maxInputTokens: Math.floor(model.contextWindow * 0.7) });
		if (!c) throw new Error(`Nav ko saspiest: sarunā ir tikai viens posms, vai viss (${before} tokeni) ietilpst nesenajā daļā.`);
		this.rememberCompaction(thread, c.summary, before, c.tokensAfter);
		this.conversations.set(thread.id, { key: conv.key, messages: c.messages, lastAdded: null });
		return { before, after: c.tokensAfter };
	}
}
