// The agent as the main process runs it: one conversation per project (the lead's thread), one run at a time, the approval gate, the Fokuss.
// The run itself lives in ThreadRunner (thread-runner.ts); this class is the facade the IPC handlers call.
// No Electron imports: the runtime, the settings and the event sink are injected.
import type { Api, Model } from "@earendil-works/pi-ai";
import { join } from "node:path";
import type { AgentStatus, ChatAttachment, ChatEntry, ContextInfo, FileCost, FocusItem } from "../shared/api.js";
import { measureAttachment, prepareAttachments, type PreparedAttachments } from "./attachments.js";
import { type Complete } from "./compact.js";
import { imageLimits } from "./context.js";
import type { RunEvent, Settings } from "../shared/types.js";
import { isPiProvider, lookupPiModel, piAuthState, piProviderInfo, runPi, seesImages, type McpLaunchSpec, type PiRuntime } from "./pi/index.js";
import type { ToolCtx } from "./tools/context.js";
import type { Level } from "./tools/levels.js";
import { findSpec, type AgentSpec } from "../shared/agent-types.js";
import { parseMention } from "../shared/mention.js";
import { LEAD_ID, type QueueView, type RunMeta, type Thread, type WaitingItem } from "../shared/thread-types.js";
import { DEFAULT_AGENTS } from "./subagents.js";
import { ThreadStore, knownProjects, threadsDir } from "../core/threads.js";
import { LockRegistry } from "./locks.js";
import { Coordinator } from "./coordinator.js";
import { ThreadRunner, type Conversation } from "./thread-runner.js";

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
	ctx: Omit<ToolCtx, "projectId" | "runDir" | "agent" | "thread">;
	/** the specialists the agent may delegate to (task 8.15); the shipped ones when absent */
	agents?: () => AgentSpec[];
	runsDir: string;
	chatDir: string;
	/** every event of a run; `meta` is the envelope the coordinator stamps (thread, agent, project, wave) */
	emit: (runId: string, event: RunEvent, meta: RunMeta) => void;
	/** a thread's stored state changed (running, waiting-confirm, idle) */
	onThread?: (t: Thread) => void;
	/** the run table or the queue changed */
	onQueue?: (v: QueueView) => void;
	/** what waits for the user changed (Gaida tevi) */
	onWaiting?: (items: WaitingItem[]) => void;
	/** one model call for the summaries; the app streams through pi, tests inject a fake */
	complete?: Complete;
	/** the agent loop; defaults to pi's, tests inject a scripted one */
	runAgent?: typeof runPi;
	/** is the active Revit document this project's working copy? (6.3) */
	revitWork?: (projectId: string | null) => Promise<{ ok: boolean; title: string }>;
	/** after a run with a confirmed batch: capture a revision, run the room check; returns a line for the chat (6.2) */
	afterBatch?: (projectId: string, summary: string) => Promise<string>;
}

const BUSY = "Aģents jau strādā. Aptur vai pagaidi.";

export class AgentSession {
	private runner: ThreadRunner;
	private coordinator: Coordinator;
	private stores = new Map<string, ThreadStore>();

	constructor(private d: SessionDeps) {
		this.runner = new ThreadRunner({ ...d, threads: (projectId) => this.threads(projectId), locks: new LockRegistry() });
		this.coordinator = new Coordinator({ runner: this.runner, threads: (projectId) => this.threads(projectId), settings: d.settings, emit: (runId, e, meta) => d.emit(runId, e, meta), onThread: d.onThread, onQueue: d.onQueue, onWaiting: d.onWaiting, queueFile: join(d.ctx.appDir, "queue.json"), specs: () => this.specs(), projects: () => knownProjects(d.ctx.appDir, d.ctx.projectsDir) });
	}

	private threads(projectId: string | null): ThreadStore {
		const id = projectId ?? "_";
		let s = this.stores.get(id);
		if (!s) this.stores.set(id, (s = new ThreadStore(threadsDir(this.d.ctx.appDir, this.d.ctx.projectsDir, projectId))));
		return s;
	}

	/** The specialists as they are now (the settings page may change them between two runs). */
	private specs(): AgentSpec[] {
		return this.d.agents?.() ?? DEFAULT_AGENTS;
	}

	/** The thread of this project, or a refusal. The id is looked up in this project's folder only, and the thread must say it belongs here. */
	private threadOf(threadId: string, projectId: string | null): Thread {
		const t = this.threads(projectId).get(threadId);
		if (!t || t.projectId !== projectId) throw new Error(`Saruna ${threadId} nav atrasta.`);
		return t;
	}

	/** The one chat of a project is the lead's thread; the old chat file is copied in once, when that thread is first made. */
	private leadOf(projectId: string | null): Thread {
		return this.threads(projectId).lead(projectId, join(this.d.chatDir, `${projectId ?? "_"}.jsonl`));
	}

	/** The lead's in-memory conversation by project id ("_" = no project). Kept for tests that seed or inspect it; the runner keys by thread. */
	get conversations() {
		const lead = (k: string) => this.leadOf(k === "_" ? null : k).id;
		return {
			get: (k: string) => this.runner.conversations.get(lead(k)),
			set: (k: string, c: Conversation) => this.runner.conversations.set(lead(k), c),
			clear: () => this.runner.conversations.clear(),
		};
	}

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

	history(projectId: string | null): ChatEntry[] {
		const t = this.leadOf(projectId);
		return this.threads(projectId).transcript(t.id);
	}

	/** Every thread of the project, newest `lastAt` first. */
	listThreads(projectId: string | null): Thread[] {
		return this.threads(projectId).list();
	}

	/** A new thread with `agent`: "lead" or a specialist (by id or name). The title defaults to the specialist's name. */
	openThread(projectId: string | null, agent: string, title?: string): Thread {
		const name = title?.trim();
		let t: Thread;
		if (agent === LEAD_ID) t = this.threads(projectId).create({ projectId, agent: LEAD_ID, title: name || "Saruna", startedBy: "user" });
		else {
			const spec = findSpec(this.specs(), agent);
			if (!spec) throw new Error(`Nav speciālista: ${agent}.`);
			t = this.threads(projectId).create({ projectId, agent: spec.id, title: name || spec.name, startedBy: "user" });
		}
		this.d.onThread?.(t);
		return t;
	}

	/** Ends a conversation: kept on disk, closed to new messages. Refused while its agent is running or waiting in the queue. */
	closeThread(threadId: string, projectId: string | null): Thread {
		const t = this.threadOf(threadId, projectId);
		if (this.coordinator.threadBusy(t.id)) throw new Error(BUSY);
		const next = this.threads(projectId).patch(t.id, { state: "closed" });
		this.d.onThread?.(next);
		return next;
	}

	threadHistory(threadId: string, projectId: string | null): ChatEntry[] {
		return this.threads(projectId).transcript(this.threadOf(threadId, projectId).id);
	}

	stopThread(threadId: string): void {
		this.coordinator.stopThread(threadId);
	}

	queueView(): QueueView {
		return this.coordinator.view();
	}

	pauseQueue(): void {
		this.coordinator.pause();
	}

	resumeQueue(): void {
		this.coordinator.resume();
	}

	/** The chat box: a text that starts with `@agent` goes to that agent's newest open thread in the project (one is opened when there is none),
	 *  without the mention; any other text goes to the lead. `onRunId` hears the run's id and the text that was sent. */
	async send(projectId: string | null, text: string, focus: FocusItem[], attachments: ChatAttachment[] = [], onRunId?: (runId: string, sent: string) => void): Promise<{ runId: string | null; queued: boolean }> {
		const m = parseMention(text, this.specs());
		if (!m) return this.sendTo(this.leadOf(projectId), text, focus, attachments, onRunId);
		// refused before a thread is opened for it
		if (!m.text.trim() && !attachments.length) throw new Error("Tukšs ziņojums.");
		const open = this.threads(projectId).list({ agent: m.agent, open: true })[0];
		return this.sendTo(open ?? this.openThread(projectId, m.agent), m.text, focus, attachments, onRunId);
	}

	/** A message to one thread (task 11.4). Refused for a closed thread, one whose specialist no longer exists, and one that is running or queued. */
	async sendToThread(threadId: string, projectId: string | null, text: string, focus: FocusItem[], attachments: ChatAttachment[] = [], onRunId?: (runId: string, sent: string) => void): Promise<{ runId: string | null; queued: boolean }> {
		return this.sendTo(this.threadOf(threadId, projectId), text, focus, attachments, onRunId);
	}

	/** Starts a run; events arrive through `emit`. Runs now, or waits in the queue when the cap is reached; refuses while this chat's own run is going or queued. Attachments are read and checked
	 *  first, so a file the model cannot take is refused here (the window keeps it in the strip) and no run starts. */
	private async sendTo(thread: Thread, text: string, focus: FocusItem[], attachments: ChatAttachment[], onRunId?: (runId: string, sent: string) => void): Promise<{ runId: string | null; queued: boolean }> {
		const projectId = thread.projectId;
		if (thread.state === "closed") throw new Error("Saruna ir slēgta.");
		if (thread.agent !== LEAD_ID && !this.specs().some((s) => s.id === thread.agent)) throw new Error(`Nav speciālista: ${thread.agent}.`);
		if (this.coordinator.busy() || this.coordinator.threadBusy(thread.id)) throw new Error(BUSY);
		if (!text.trim() && !attachments.length) throw new Error("Tukšs ziņojums.");
		const runId = this.coordinator.newRunId();
		let files: PreparedAttachments = { images: [], text: "", refs: [] };
		if (attachments.length) {
			const s = this.d.settings();
			const model = await this.modelOf(s);
			files = await prepareAttachments(attachments, {
				seesImages: model ? seesImages(model) : true,
				model: s.model || model?.id || "(noklusējums)",
				saveDir: join(this.d.runsDir, runId, "attachments"),
				limits: model ? imageLimits(model) : null,
				imagesInContext: this.runner.imagesInContext(thread),
			});
			// reading the files took a moment: another message may have started meanwhile
			if (this.coordinator.busy() || this.coordinator.threadBusy(thread.id)) throw new Error(BUSY);
		}
		// the files are already prepared (above), so the coordinator is handed them and does not read `attachments` itself
		// the caller learns the run's id before it starts (a queued start keeps this id when it begins)
		onRunId?.(runId, text);
		const r = await this.coordinator.start({ threadId: thread.id, projectId, text, focus, cause: { by: "user" }, files, runId });
		return { runId, queued: r.queued };
	}

	stop() {
		this.coordinator.stopAll();
	}

	/** Once at start-up, before the window opens: marks what the last process left in flight and holds the queue paused. Starts nothing. */
	restore(): void {
		this.coordinator.restore();
	}

	/** What the start-up found, until the user answers (resume or discard); the window asks for it with `queue.restored`. */
	queueRestored(): { interrupted: number; queued: number } | null {
		return this.coordinator.restoreFound();
	}

	resumeInterrupted(): void {
		this.coordinator.resumeInterrupted();
	}

	discardInterrupted(): void {
		this.coordinator.discardInterrupted();
	}

	/** Everything that waits for the user, of every project. */
	waiting(): WaitingItem[] {
		return this.coordinator.waiting();
	}

	/** App is quitting: abort the run and wait until it has closed its tool servers (the Revit MCP child and the tools child). */
	async shutdown(): Promise<void> {
		await this.coordinator.shutdown();
	}

	confirm(id: string, allow: boolean) {
		this.coordinator.confirm(id, allow);
	}

	/** The chosen model, or null when it cannot be looked up (the run itself reports why). */
	private async modelOf(s: Settings): Promise<Model<Api> | null> {
		try {
			return lookupPiModel(await this.d.runtime(), s.provider, s.model);
		} catch {
			return null;
		}
	}

	/** Forgets the in-memory conversation (new topic, or the model changed). The transcript stays. */
	reset(projectId: string | null) {
		this.runner.reset(this.leadOf(projectId).id);
	}

	/** What the next request carries, where the limits are, and what the message being typed would add. */
	context(projectId: string | null, draft?: { text: string; focus: FocusItem[] }): Promise<ContextInfo> {
		return this.runner.context(this.leadOf(projectId), draft);
	}

	/** What one attached file adds to the context; throws when it could not be sent (a scanned PDF, an unknown format). */
	measureFile(a: ChatAttachment): Promise<FileCost> {
		return measureAttachment(a);
	}

	/** The user's own "saspiest": the same summary as at the limit, now. Refused while a run is going. */
	async compactNow(projectId: string | null): Promise<{ before: number; after: number }> {
		const thread = this.leadOf(projectId);
		return this.coordinator.exclusive((signal) => this.runner.compactNow(thread, signal));
	}
}
