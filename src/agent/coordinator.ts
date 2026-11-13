// Who is running, the queue behind the cap, the batch confirmations, Stop and pause. Runs are a table by run id; the cap is settings().maxParallelAgents.
// Every event of a run leaves with its envelope (thread, agent, project, wave) and the thread's state follows the run.
// No Electron imports: the runner, the stores and the sink are injected.
import type { Thread, RunMeta, StartInput, QueueView } from "../shared/thread-types.js";
import type { RunEvent, Settings } from "../shared/types.js";
import type { ThreadStore } from "../core/threads.js";
import { pickNext, saveQueue, type QueueItem, type Running } from "../core/queue.js";
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
	/** the run table or the queue changed */
	onQueue?: (v: QueueView) => void;
	/** where the queue is saved on every change (task 11.3 loads it at start-up) */
	queueFile: string;
	now?: () => string;
}

/** A start as the coordinator takes it: the caller (AgentSession) has already read the attachments, so `StartInput.attachments`
 *  is not looked at here; `files` is what the run carries. `runId` lets the caller name the run before it starts (the files are saved under it). */
export type StartRequest = StartInput & { files?: PreparedAttachments; runId?: string };

interface Live {
	runId: string;
	thread: Thread;
	wave: string;
	abort: AbortController;
	done: Promise<unknown>;
}

const BUSY = "Aģents jau strādā. Aptur vai pagaidi.";

export class Coordinator {
	private live = new Map<string, Live>();
	private queue: QueueItem[] = [];
	private paused = false;
	private closing = false;
	/** prepared files (and the run id the caller named) wait here beside the queued item; the saved queue never holds them */
	private prepared = new Map<string, { files?: PreparedAttachments; runId?: string }>();
	/** a job that is not a run but holds the slot (the user's own "saspiest") */
	private held: AbortController | null = null;
	private confirms = new Map<string, { resolve: (ok: boolean) => void; live: Live; waiting: () => void; resume: () => void }>();
	private n = 0;
	private waves = 0;

	constructor(private d: CoordinatorDeps) {}

	private now(): string {
		return (this.d.now ?? (() => new Date().toISOString()))();
	}

	/** True while a non-run job (compaction) holds the coordinator. A run does not make it busy: runs are per thread. */
	busy(): boolean {
		return this.held !== null;
	}

	/** Is this thread running or waiting in the queue? */
	threadBusy(threadId: string): boolean {
		return [...this.live.values()].some((l) => l.thread.id === threadId) || this.queue.some((q) => q.threadId === threadId && q.state === "queued");
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

	private running(): Running[] {
		const waiting = new Set([...this.confirms.values()].map((c) => c.live));
		return [...this.live.values()].map((l) => ({ runId: l.runId, threadId: l.thread.id, agent: l.thread.agent, projectId: l.thread.projectId, wave: l.wave, waitingConfirm: waiting.has(l) }));
	}

	view(): QueueView {
		return { running: this.running(), queued: [...this.queue], paused: this.paused, waves: [] };
	}

	/** Every change of the view: save the queue, tell the window. Neither may break a run. */
	private changed(): void {
		try {
			saveQueue(this.d.queueFile, { items: this.queue, paused: this.paused });
		} catch {
			// a locked file: the next change saves again
		}
		try {
			this.d.onQueue?.(this.view());
		} catch {
			// a window already gone
		}
	}

	/** Starts queued items while `pickNext` allows. The cap is read at every pick; a value that is not a number counts as 1. */
	private pump(): Map<string, string> {
		const started = new Map<string, string>();
		while (!this.closing) {
			const cap = this.d.settings().maxParallelAgents;
			const item = pickNext(this.queue, this.running(), Number.isFinite(cap) ? cap : 1, this.paused);
			if (!item) break;
			this.queue = this.queue.filter((q) => q !== item);
			const files = this.prepared.get(item.id);
			this.prepared.delete(item.id);
			try {
				started.set(item.id, this.begin(item, files));
			} catch {
				// the thread is gone: the item cannot run
				this.queue.push({ ...item, state: "stopped" });
			}
		}
		this.changed();
		return started;
	}

	async start(i: StartRequest): Promise<{ runId: string | null; queued: boolean }> {
		if (this.held) throw new Error(BUSY);
		const found = this.d.threads(i.projectId).get(i.threadId);
		if (!found) throw new Error(`Saruna ${i.threadId} nav atrasta.`);
		// the user's own messages never pile up unseen; a message from another agent may wait behind the run
		if (i.cause.by === "user" && this.threadBusy(i.threadId)) throw new Error(BUSY);
		const id = `q${Date.now().toString(36)}${++this.n}`;
		this.queue.push({
			id, threadId: i.threadId, agent: found.agent, projectId: i.projectId, wave: i.wave ?? this.newWave(), at: this.now(), state: "queued",
			input: { text: i.text, focus: i.focus, cause: i.cause },
		});
		this.prepared.set(id, { files: i.files, runId: i.runId });
		const runId = this.pump().get(id);
		if (runId) return { runId, queued: false };
		this.mark(found, { state: "queued" });
		return { runId: null, queued: true };
	}

	/** Takes an item out of the queue into the run table and starts its run. */
	private begin(item: QueueItem, extra?: { files?: PreparedAttachments; runId?: string }): string {
		const found = this.d.threads(item.projectId).get(item.threadId);
		if (!found) throw new Error(`Saruna ${item.threadId} nav atrasta.`);
		const runId = extra?.runId ?? this.newRunId();
		const wave = item.wave;
		const thread = this.setState(found, { state: "running", lastAt: this.now(), runs: found.runs + 1, wave });
		const meta: RunMeta = { threadId: thread.id, agent: thread.agent, projectId: thread.projectId, wave };
		const abort = new AbortController();
		const emit = (e: RunEvent) => this.d.emit(runId, e, meta);
		const live: Live = { runId, thread, wave, abort, done: Promise.resolve() };
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
				// a run parked on a confirmation frees its slot
				this.pump();
			});
		this.live.set(runId, live);
		live.done = this.d.runner
			.run({ runId, thread, spec: null, text: item.input.text, focus: item.input.focus, files: extra?.files ?? { images: [], text: "", refs: [] }, wave, signal: abort.signal, emit, ask })
			.finally(() => {
				this.denyConfirms((c) => c.live === live, false);
				this.live.delete(runId);
				this.mark(thread, { state: "idle" });
				this.pump();
			});
		return runId;
	}

	/** Answers the open confirmations that match with no (or the given answer) and returns their runs to `running`. */
	private denyConfirms(match: (c: { live: Live }) => boolean, resume: boolean): void {
		for (const [id, c] of [...this.confirms]) {
			if (!match(c)) continue;
			this.confirms.delete(id);
			c.resolve(false);
			if (resume) c.resume();
		}
	}

	/** Holds the slot for a job that is not a run; Stop aborts it too. Refused while anything runs. */
	async exclusive<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
		if (this.held || this.live.size > 0) throw new Error("Aģents strādā. Aptur vai pagaidi.");
		const abort = new AbortController();
		this.held = abort;
		try {
			return await job(abort.signal);
		} finally {
			this.held = null;
		}
	}

	/** Aborts the runs that match, marks their queued items stopped (kept in the saved queue) and answers their confirmations with no. */
	private stopWhere(match: (x: { wave: string; threadId: string }) => boolean): void {
		const lives = [...this.live.values()].filter((l) => match({ wave: l.wave, threadId: l.thread.id }));
		for (const l of lives) l.abort.abort();
		this.denyConfirms((c) => lives.includes(c.live), true);
		this.queue = this.queue.map((q) => {
			if (q.state !== "queued" || !match({ wave: q.wave, threadId: q.threadId })) return q;
			this.prepared.delete(q.id);
			// a thread that also has a run keeps the run's state
			const t = [...this.live.values()].some((l) => l.thread.id === q.threadId) ? null : this.d.threads(q.projectId).get(q.threadId);
			if (t) this.mark(t, { state: "idle" });
			return { ...q, state: "stopped" as const };
		});
		this.changed();
	}

	/** Without a wave: everything. With one: only that wave's runs and queued items. */
	stopAll(wave?: string): void {
		if (!wave) this.held?.abort();
		this.stopWhere((x) => !wave || x.wave === wave);
	}

	stopThread(threadId: string): void {
		this.stopWhere((x) => x.threadId === threadId);
	}

	pause(): void {
		this.paused = true;
		this.changed();
	}

	resume(): void {
		this.paused = false;
		this.pump();
	}

	confirm(id: string, allow: boolean): void {
		const c = this.confirms.get(id);
		if (!c) throw new Error("Šis apstiprinājums vairs negaida.");
		this.confirms.delete(id);
		c.resolve(allow);
		c.resume();
		this.pump();
	}

	/** App is quitting: abort the runs (queued items stay queued for the next start) and wait until they have closed their tool servers (the Revit MCP child and the tools child). */
	async shutdown(): Promise<void> {
		this.closing = true;
		this.held?.abort();
		for (const l of this.live.values()) l.abort.abort();
		this.denyConfirms(() => true, true);
		await Promise.all([...this.live.values()].map((l) => l.done.catch(() => undefined)));
		this.closing = false;
	}
}
