// Who is running, the batch confirmations and Stop. Phase 10: a cap of one run; phase 11 lifts it (the table is already a map by run).
// Every event of a run leaves with its envelope (thread, agent, project, wave) and the thread's state follows the run.
// No Electron imports: the runner, the stores and the sink are injected.
import type { Thread, RunMeta, StartInput } from "../shared/thread-types.js";
import type { RunEvent, Settings } from "../shared/types.js";
import type { ThreadStore } from "../core/threads.js";
import type { PreparedAttachments } from "./attachments.js";
import type { ConfirmRequest } from "./tools/levels.js";
import type { ThreadRunner } from "./thread-runner.js";

export interface CoordinatorDeps {
	runner: ThreadRunner;
	threads: (projectId: string | null) => ThreadStore;
	settings: () => Settings;
	emit: (runId: string, event: RunEvent, meta: RunMeta) => void;
	/** a thread's stored state changed */
	onThread?: (t: Thread) => void;
	now?: () => string;
}

/** A start as the coordinator takes it: the caller (AgentSession) has already read the attachments, so `StartInput.attachments`
 *  is not looked at here; `files` is what the run carries. `runId` lets the caller name the run before it starts (the files are saved under it). */
export type StartRequest = StartInput & { files?: PreparedAttachments; runId?: string };

interface Live {
	runId: string;
	thread: Thread;
	abort: AbortController;
	done: Promise<unknown>;
}

const BUSY = "Aģents jau strādā. Aptur vai pagaidi.";

export class Coordinator {
	private live = new Map<string, Live>();
	/** a job that is not a run but holds the slot (the user's own "saspiest") */
	private held: AbortController | null = null;
	private confirms = new Map<string, { resolve: (ok: boolean) => void; live: Live; waiting: () => void; resume: () => void }>();
	private n = 0;
	private waves = 0;

	constructor(private d: CoordinatorDeps) {}

	private now(): string {
		return (this.d.now ?? (() => new Date().toISOString()))();
	}

	/** Phase 10 allows one run; 11.1 replaces this with the per-thread and the global cap. */
	busy(): boolean {
		return this.live.size > 0 || this.held !== null;
	}

	newRunId(): string {
		return `r${Date.now().toString(36)}${++this.n}`;
	}

	private newWave(): string {
		return `w${Date.now().toString(36)}${++this.waves}`;
	}

	private setState(t: Thread, p: Parameters<ThreadStore["patch"]>[1]): Thread {
		const next = this.d.threads(t.projectId).patch(t.id, p);
		this.d.onThread?.(next);
		return next;
	}

	/** A state write that must never get in the way of an answer, a stop or the end of a run (a locked file, a window already gone). */
	private mark(t: Thread, p: Parameters<ThreadStore["patch"]>[1]): void {
		try {
			this.setState(t, p);
		} catch {
			// the state is a display; the run's own flow does not depend on it
		}
	}

	async start(i: StartRequest): Promise<{ runId: string }> {
		if (this.busy()) throw new Error(BUSY);
		const store = this.d.threads(i.projectId);
		const found = store.get(i.threadId);
		if (!found) throw new Error(`Saruna ${i.threadId} nav atrasta.`);
		const runId = i.runId ?? this.newRunId();
		const wave = i.wave ?? this.newWave();
		const thread = this.setState(found, { state: "running", lastAt: this.now(), runs: found.runs + 1, wave });
		const meta: RunMeta = { threadId: thread.id, agent: thread.agent, projectId: thread.projectId, wave };
		const abort = new AbortController();
		const emit = (e: RunEvent) => this.d.emit(runId, e, meta);
		const live: Live = { runId, thread, abort, done: Promise.resolve() };
		const ask = (req: ConfirmRequest) =>
			new Promise<boolean>((resolve) => {
				this.confirms.set(req.id, {
					resolve,
					live,
					waiting: () => this.mark(thread, { state: "waiting-confirm" }),
					resume: () => this.mark(thread, { state: "running" }),
				});
				this.confirms.get(req.id)!.waiting();
				emit({ type: "confirm", id: req.id, tool: req.batch.map((b) => b.tool).join(", "), batch: JSON.stringify(req.batch).slice(0, 4000) });
			});
		this.live.set(runId, live);
		live.done = this.d.runner
			.run({ runId, thread, spec: null, text: i.text, focus: i.focus, files: i.files ?? { images: [], text: "", refs: [] }, wave, signal: abort.signal, emit, ask })
			.finally(() => {
				for (const [id, c] of this.confirms) {
					if (c.live !== live) continue;
					this.confirms.delete(id);
					c.resolve(false);
				}
				this.live.delete(runId);
				this.mark(thread, { state: "idle" });
			});
		return { runId };
	}

	/** Holds the slot for a job that is not a run; Stop aborts it too. Refused while anything runs. */
	async exclusive<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.busy()) throw new Error("Aģents strādā. Aptur vai pagaidi.");
		const abort = new AbortController();
		this.held = abort;
		try {
			return await job(abort.signal);
		} finally {
			this.held = null;
		}
	}

	/** Aborts every run and answers every open confirmation with no. */
	stopAll(): void {
		this.held?.abort();
		for (const l of this.live.values()) l.abort.abort();
		for (const [id, c] of [...this.confirms]) {
			this.confirms.delete(id);
			c.resolve(false);
			c.resume();
		}
	}

	confirm(id: string, allow: boolean): void {
		const c = this.confirms.get(id);
		if (!c) throw new Error("Šis apstiprinājums vairs negaida.");
		this.confirms.delete(id);
		c.resolve(allow);
		c.resume();
	}

	/** App is quitting: stop everything and wait until the runs have closed their tool servers (the Revit MCP child and the tools child). */
	async shutdown(): Promise<void> {
		this.stopAll();
		await Promise.all([...this.live.values()].map((l) => l.done.catch(() => undefined)));
	}
}
