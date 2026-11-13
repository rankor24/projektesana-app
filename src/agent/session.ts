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
import type { ConfirmRequest, Level } from "./tools/levels.js";
import type { AgentSpec } from "../shared/agent-types.js";
import type { Thread } from "../shared/thread-types.js";
import { ThreadStore, threadsDir } from "../core/threads.js";
import { LockRegistry } from "./locks.js";
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

export class AgentSession {
	private running: { id: string; abort: AbortController } | null = null;
	private runDone: Promise<unknown> | null = null;
	private confirms = new Map<string, (ok: boolean) => void>();
	private n = 0;
	private runner: ThreadRunner;
	private stores = new Map<string, ThreadStore>();

	constructor(private d: SessionDeps) {
		this.runner = new ThreadRunner({ ...d, threads: (projectId) => this.threads(projectId), locks: new LockRegistry() });
	}

	private threads(projectId: string | null): ThreadStore {
		const id = projectId ?? "_";
		let s = this.stores.get(id);
		if (!s) this.stores.set(id, (s = new ThreadStore(threadsDir(this.d.ctx.appDir, this.d.ctx.projectsDir, projectId))));
		return s;
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

	/** Starts a run; events arrive through `emit`. Refuses while another run is going. Attachments are read and checked
	 *  first, so a file the model cannot take is refused here (the window keeps it in the strip) and no run starts. */
	async send(projectId: string | null, text: string, focus: FocusItem[], attachments: ChatAttachment[] = []): Promise<{ runId: string }> {
		if (this.running) throw new Error("Aģents jau strādā. Aptur vai pagaidi.");
		if (!text.trim() && !attachments.length) throw new Error("Tukšs ziņojums.");
		const runId = `r${Date.now().toString(36)}${++this.n}`;
		const thread = this.leadOf(projectId);
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
			if (this.running) throw new Error("Aģents jau strādā. Aptur vai pagaidi.");
		}
		const abort = new AbortController();
		this.running = { id: runId, abort };
		const emit = (e: RunEvent) => this.d.emit(runId, e);
		const ask = (req: ConfirmRequest) =>
			new Promise<boolean>((resolve) => {
				this.confirms.set(req.id, resolve);
				emit({ type: "confirm", id: req.id, tool: req.batch.map((b) => b.tool).join(", "), batch: JSON.stringify(req.batch).slice(0, 4000) });
			});
		this.runDone = this.runner.run({ runId, thread, spec: null, text, focus, files, wave: runId, signal: abort.signal, emit, ask }).finally(() => {
			this.running = null;
			for (const [, r] of this.confirms) r(false);
			this.confirms.clear();
		});
		return { runId };
	}

	stop() {
		this.running?.abort.abort();
	}

	/** App is quitting: abort the run and wait until it has closed its tool servers (the Revit MCP child and the tools child). */
	async shutdown(): Promise<void> {
		this.stop();
		await this.runDone?.catch(() => undefined);
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
		if (this.running) throw new Error("Aģents strādā. Aptur vai pagaidi.");
		const thread = this.leadOf(projectId);
		const abort = new AbortController();
		this.running = { id: "compact", abort };
		try {
			return await this.runner.compactNow(thread, abort.signal);
		} finally {
			this.running = null;
		}
	}
}
