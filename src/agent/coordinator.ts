// Who is running, the queue behind the cap, the batch confirmations, Stop and pause. Runs are a table by run id; the cap is settings().maxParallelAgents.
// Every event of a run leaves with its envelope (thread, agent, project, wave) and the thread's state follows the run.
// No Electron imports: the runner, the stores and the sink are injected.
import type { AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID, type Thread, type RunMeta, type StartInput, type QueueView, type WaitingItem, type Wave } from "../shared/thread-types.js";
import { waitingItems } from "../shared/waiting.js";
import type { RunEvent, Settings } from "../shared/types.js";
import { answered, inboxOf, limitsOf, pendingOf, runDepth, shouldWake, deliveryText, type Mailbox, type Message } from "../core/messages.js";
import type { ThreadStore } from "../core/threads.js";
import { loadQueue, pickNext, saveQueue, waveCheck, type QueueItem, type Running } from "../core/queue.js";
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
	/** what waits for the user changed: a confirmation opened or was answered, the restart question was answered */
	onWaiting?: (items: WaitingItem[]) => void;
	/** a run's tool changed a project's data in the tools server's process (the process file): the window reloads it */
	onData?: (projectId: string | null, what: string[]) => void;
	/** where the queue is saved on every change and loaded from by `restore()` */
	queueFile: string;
	/** the specialists that exist now, read at every start: a thread of any other agent than the lead runs only while its specialist is in the list.
	 *  Without it every thread runs as the lead (the coordinator's own tests). */
	specs?: () => readonly AgentSpec[];
	/** every project that has threads on disk (`knownProjects`), for `restore()`; without it restore finds no thread to mark */
	projects?: () => (string | null)[];
	/** the open questions for the user, of every project (Atmiņa); without it none are listed */
	questions?: () => Extract<WaitingItem, { kind: "question" }>[];
	/** the gates that wait for the user, of every project (process mode); without it none are listed */
	gates?: () => Extract<WaitingItem, { kind: "gate" }>[];
	/** a project's mailbox; without it nothing is delivered and nobody is woken (the coordinator's own tests) */
	mail?: (projectId: string | null) => Mailbox;
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
	/** stopped by Stop (all or a wave): the sender of the message that started this run gets no "bloķēts" reply that would wake it */
	silent?: boolean;
}

const BUSY = "Aģents jau strādā. Aptur vai pagaidi.";
const NO_FILES = "[pielikumi pēc restartēšanas netika saglabāti]";

export class Coordinator {
	private live = new Map<string, Live>();
	private queue: QueueItem[] = [];
	private paused = false;
	/** threads `restore()` found in flight; they stay `interrupted` until the user resumes or discards */
	private interrupted: { threadId: string; projectId: string | null }[] = [];
	private closing = false;
	/** prepared files (and the run id the caller named) wait here beside the queued item; the saved queue never holds them */
	private prepared = new Map<string, { files?: PreparedAttachments; runId?: string }>();
	/** a job that is not a run but holds the slot (the user's own "saspiest") */
	private held: AbortController | null = null;
	private confirms = new Map<string, { resolve: (ok: boolean) => void; live: Live; waiting: () => void; resume: () => void; item: Extract<WaitingItem, { kind: "confirm" }> }>();
	/** what `restore()` found, until the user answers it; the same lifetime as the window's `queue.restored` */
	private restoreNotice: { interrupted: number; queued: number } | null = null;
	private n = 0;
	private waveN = 0;
	/** every wave this process has seen, by id: counts live here only (a restored item's wave starts again from zero) */
	private waves = new Map<string, Wave>();
	/** set by `waveBlocked` when a wave was just paused, so `pump` tells the window once */
	private wavePaused = false;
	/** projects whose mail is to be looked at again; `waking` keeps a wake that comes from inside a wake from nesting */
	private rewake = new Set<string | null>();
	private waking = false;

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
		return `w${Date.now().toString(36)}${++this.waveN}`;
	}

	/** The wave of this id, made on first sight (a user start opens one; an item restored from disk or a message of an old wave finds it missing). */
	private waveOf(id: string, projectId: string | null): Wave {
		let w = this.waves.get(id);
		if (!w) {
			w = { id, projectId, startedAt: this.now(), runs: 0, cost: 0, paused: null };
			this.waves.set(id, w);
		}
		return w;
	}

	/** Is this queued item held back by its wave? Asked only of items that could start now: the first time the wave is at a limit it is paused and Gaida tevi hears of it. */
	private waveBlocked(q: QueueItem): boolean {
		const w = this.waveOf(q.wave, q.projectId);
		if (!w.paused) {
			const hit = waveCheck(w, limitsOf(this.d.settings()));
			if (hit) {
				w.paused = hit;
				this.wavePaused = true;
			}
		}
		return w.paused !== null;
	}

	/** The live waves: those with a run going or an item queued, and any paused one (it waits for the user). */
	private liveWaves(): Wave[] {
		const busy = (w: Wave) => [...this.live.values()].some((l) => l.wave === w.id) || this.queue.some((q) => q.state === "queued" && q.wave === w.id);
		return [...this.waves.values()].filter((w) => w.paused || busy(w)).map((w) => ({ ...w }));
	}

	/** A paused wave with nothing queued has nothing to resume (Stop took its items): it is no longer paused. True when one changed. */
	private settleWaves(): boolean {
		let any = false;
		for (const w of this.waves.values()) {
			if (w.paused && !this.queue.some((q) => q.state === "queued" && q.wave === w.id)) {
				w.paused = null;
				any = true;
			}
		}
		return any;
	}

	/** The user chose to go on with a paused wave: its counts start again from zero and what it held back starts. */
	resumeWave(wave: string): void {
		const w = this.waves.get(wave);
		if (!w) return;
		w.runs = 0;
		w.cost = 0;
		w.paused = null;
		this.waitingChanged();
		this.pump();
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
		return { running: this.running(), queued: [...this.queue], paused: this.paused, waves: this.liveWaves() };
	}

	/** Everything that waits for the user, of every project: open confirmations first, then the gates of process mode, then the questions in Atmiņa, then the unanswered restart. */
	waiting(): WaitingItem[] {
		let questions: Extract<WaitingItem, { kind: "question" }>[] = [];
		try {
			questions = this.d.questions?.() ?? [];
		} catch {
			// unreadable notes: the list shows the rest
		}
		let gates: Extract<WaitingItem, { kind: "gate" }>[] = [];
		try {
			gates = this.d.gates?.() ?? [];
		} catch {
			// unreadable process files: the list shows the rest
		}
		const paused = [...this.waves.values()].filter((w) => w.paused).map((w) => ({ kind: "wave-paused" as const, wave: w.id, projectId: w.projectId, reason: w.paused! }));
		return waitingItems({ confirms: [...this.confirms.values()].map((c) => c.item), restore: this.restoreNotice, paused, questions, gates });
	}

	/** A question for the user was written, closed or answered (by an agent's tool or the user's button): the window gets the list again. */
	notesChanged(): void {
		this.waitingChanged();
	}

	/** Tells the window the list changed. Never breaks a run (a window already gone). */
	private waitingChanged(): void {
		try {
			this.d.onWaiting?.(this.waiting());
		} catch {
			// a window already gone
		}
	}

	/** The restart question is answered: it leaves the list. */
	private answerRestore(): void {
		this.restoreNotice = null;
		this.waitingChanged();
	}

	/** Every change of the view: save the queue, tell the window. Neither may break a run. */
	private changed(): void {
		if (this.settleWaves()) this.waitingChanged();
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
	private pump(own?: string): { started: Map<string, string>; failed: Map<string, Error> } {
		const started = new Map<string, string>();
		const failed = new Map<string, Error>();
		// nothing starts while the app closes or a compaction holds the coordinator
		while (!this.closing && !this.held) {
			const cap = this.d.settings().maxParallelAgents;
			const item = pickNext(this.queue, this.running(), Number.isFinite(cap) ? cap : 1, this.paused, (q) => this.waveBlocked(q));
			if (!item) break;
			this.queue = this.queue.filter((q) => q !== item);
			const files = this.prepared.get(item.id);
			this.prepared.delete(item.id);
			try {
				started.set(item.id, this.begin(item, files));
			} catch (e) {
				// the item cannot run (its thread is gone, a state write failed): it stays in the queue as stopped
				const err = e instanceof Error ? e : new Error(String(e));
				this.queue.push({ ...item, state: "stopped" });
				if (item.id === own) failed.set(item.id, err);
				else this.surface(item, files?.runId, err);
				// a run that a message should have started: its senders hear that it cannot happen
				if (item.input.cause.by === "message") this.blockMessages(item.projectId, item.input.cause.ids, `Aģents «${item.agent}» nevar sākt darbu: ${err.message}`, "queued");
			}
		}
		this.changed();
		if (this.wavePaused) {
			this.wavePaused = false;
			this.waitingChanged();
		}
		return { started, failed };
	}

	/** A delayed item failed to start: the window gets an error on the run it was told about, and the thread is not left "queued". */
	private surface(item: QueueItem, runId: string | undefined, err: Error): void {
		const meta: RunMeta = { threadId: item.threadId, agent: item.agent, projectId: item.projectId, wave: item.wave };
		try {
			this.d.emit(runId ?? this.newRunId(), { type: "error", engine: "pi", message: err.message }, meta);
		} catch {
			// a window already gone
		}
		const t = this.d.threads(item.projectId).get(item.threadId);
		if (t) this.mark(t, { state: "idle" });
	}

	async start(i: StartRequest): Promise<{ runId: string | null; queued: boolean }> {
		if (this.held) throw new Error(BUSY);
		return this.submit(i);
	}

	/** `start` without the compaction guard: a run a message starts may wait in the queue behind a compaction. */
	private submit(i: StartRequest): { runId: string | null; queued: boolean } {
		const found = this.d.threads(i.projectId).get(i.threadId);
		if (!found) throw new Error(`Saruna ${i.threadId} nav atrasta.`);
		// the user's own messages never pile up unseen; a message from another agent may wait behind the run
		if (i.cause.by === "user" && this.threadBusy(i.threadId)) throw new Error(BUSY);
		const id = `q${Date.now().toString(36)}${++this.n}`;
		const wave = i.wave ?? this.newWave();
		this.waveOf(wave, i.projectId);
		this.queue.push({
			id, threadId: i.threadId, agent: found.agent, projectId: i.projectId, wave, at: this.now(), state: "queued",
			...(i.files && (i.files.images.length || i.files.text || i.files.refs.length) ? { hadFiles: true } : {}),
			input: { text: i.text, focus: i.focus, cause: i.cause },
		});
		this.prepared.set(id, { files: i.files, runId: i.runId });
		const { started, failed } = this.pump(id);
		const error = failed.get(id);
		if (error) {
			// the caller's own start failed: it hears about it, nothing is left behind in the queue
			this.queue = this.queue.filter((q) => q.id !== id);
			this.changed();
			throw error;
		}
		const runId = started.get(id);
		if (runId) return { runId, queued: false };
		this.mark(found, { state: "queued" });
		return { runId: null, queued: true };
	}

	/** Takes an item out of the queue into the run table and starts its run. */
	private begin(item: QueueItem, extra?: { files?: PreparedAttachments; runId?: string }): string {
		const found = this.d.threads(item.projectId).get(item.threadId);
		if (!found) throw new Error(`Saruna ${item.threadId} nav atrasta.`);
		// the specialist is looked up before anything is written: one that was removed in the settings stops this item, the thread stays as it was
		let spec: AgentSpec | null = null;
		if (this.d.specs && found.agent !== LEAD_ID) {
			spec = this.d.specs().find((s) => s.id === found.agent) ?? null;
			if (!spec) throw new Error(`Nav speciālista: ${found.agent}.`);
		}
		const runId = extra?.runId ?? this.newRunId();
		const wave = item.wave;
		const ids = item.input.cause.by === "message" ? item.input.cause.ids : [];
		// 0 for a run the user started; else the hops of the messages that started it
		const mail = this.d.mail?.(item.projectId);
		const depth = mail && ids.length ? runDepth(ids, mail.messages()) : 0;
		let thread: Thread;
		try {
			thread = this.setState(found, { state: "running", lastAt: this.now(), runs: found.runs + 1, wave });
		} catch (e) {
			// the store may have taken the write before the notice failed: do not leave a "running" thread without a run
			this.mark(found, { state: "idle" });
			throw e;
		}
		// the run is going: the messages it reads are delivered
		this.setMail(item.projectId, ids, "delivered");
		// the run is counted when it starts, whatever started it
		this.waveOf(wave, thread.projectId).runs++;
		const meta: RunMeta = { threadId: thread.id, agent: thread.agent, projectId: thread.projectId, wave };
		// a restored item lost its prepared files with the old process: it starts without them and says so
		const text = item.hadFiles && !extra?.files ? `${item.input.text}\n${NO_FILES}` : item.input.text;
		const abort = new AbortController();
		let ok = false;
		let answer = "";
		let lastError: string | null = null;
		const emit = (e: RunEvent) => {
			if (e.type === "error") lastError = e.message;
			// what the provider charged adds to the wave; none given adds nothing
			if (e.type === "usage" && e.cost !== null) {
				this.waveOf(wave, thread.projectId).cost += e.cost;
				try {
					this.d.onQueue?.(this.view());
				} catch {
					// a window already gone
				}
			}
			this.d.emit(runId, e, meta);
		};
		const live: Live = { runId, thread, wave, abort, done: Promise.resolve() };
		const ask = (req: ConfirmRequest) =>
			new Promise<boolean>((resolve) => {
				// the gate numbers its confirmations per run (c1, c2…), so two runs both ask "c1": the id the window sees names the run too
				const id = `${runId}:${req.id}`;
				// the list shows the same text the `confirm` event carries
				const item: Extract<WaitingItem, { kind: "confirm" }> = { kind: "confirm", id, threadId: thread.id, agent: thread.agent, projectId: thread.projectId, tool: req.batch.map((b) => b.tool).join(", "), batch: JSON.stringify(req.batch).slice(0, 4000) };
				this.confirms.set(id, {
					resolve,
					live,
					waiting: () => this.mark(thread, { state: "waiting-confirm" }),
					resume: () => this.mark(thread, { state: "running" }),
					item,
				});
				this.confirms.get(id)!.waiting();
				emit({ type: "confirm", id, tool: item.tool, batch: item.batch });
				this.waitingChanged();
				// a run parked on a confirmation frees its slot
				this.pump();
			});
		this.live.set(runId, live);
		live.done = this.d.runner
			.run({ runId, thread, spec, text, focus: item.input.focus, files: extra?.files ?? { images: [], text: "", refs: [] }, wave, signal: abort.signal, emit, ask, depth, wake: () => this.wake(thread.projectId), notesChanged: () => this.waitingChanged(), dataChanged: (what) => this.d.onData?.(thread.projectId, what) })
			.then(
				(r) => {
					ok = r.ok;
					answer = r.answer;
					return r;
				},
				(e: unknown) => {
					lastError = e instanceof Error ? e.message : String(e);
					throw e;
				},
			)
			.finally(() => {
				this.denyConfirms((c) => c.live === live, false);
				this.live.delete(runId);
				// a run a message started that did not finish its work: the senders are told, so none waits for ever (a closing app keeps it all for the next start)
				if (!this.closing && ids.length && (abort.signal.aborted || !ok)) {
					const why = abort.signal.aborted ? "darbs tika apturēts." : `gājiens beidzās ar kļūdu: ${lastError ?? "nezināma kļūda"}`;
					this.blockMessages(thread.projectId, ids, `Aģents «${thread.agent}» nevarēja izpildīt: ${why}`, live.silent ? "stopped" : "queued");
				}
				// a run a message started that ended well but sent nothing back: its final answer goes to the sender, so the sender does not wait for ever
				else if (!this.closing && ids.length) this.autoReply(thread.projectId, ids, answer);
				this.settle(thread.projectId, thread.id);
				if (!this.closing) this.wake(thread.projectId);
				this.pump();
			});
		return runId;
	}

	/** Answers the open confirmations that match with no (or the given answer) and returns their runs to `running`. */
	private denyConfirms(match: (c: { live: Live }) => boolean, resume: boolean): void {
		let any = false;
		for (const [id, c] of [...this.confirms]) {
			if (!match(c)) continue;
			any = true;
			this.confirms.delete(id);
			c.resolve(false);
			if (resume) c.resume();
		}
		if (any) this.waitingChanged();
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
			this.pump();
		}
	}

	/** Aborts the runs that match, marks their queued items stopped (kept in the saved queue) and answers their confirmations with no.
	 *  The messages those items were to deliver are stopped with them. `silent`: Stop for everything or a wave, where no sender is to be woken. */
	private stopWhere(match: (x: { wave: string; threadId: string }) => boolean, silent: boolean): void {
		const lives = [...this.live.values()].filter((l) => match({ wave: l.wave, threadId: l.thread.id }));
		for (const l of lives) {
			l.silent = silent;
			l.abort.abort();
		}
		this.denyConfirms((c) => lives.includes(c.live), true);
		const dropped: QueueItem[] = [];
		this.queue = this.queue.map((q) => {
			if (q.state !== "queued" || !match({ wave: q.wave, threadId: q.threadId })) return q;
			this.prepared.delete(q.id);
			dropped.push(q);
			return { ...q, state: "stopped" as const };
		});
		for (const q of dropped) {
			// Stop for everything or a wave: its messages are stopped and wake nobody. Stopping one thread: its senders are told, like for a run that was stopped
			if (q.input.cause.by === "message") {
				if (silent) this.setMail(q.projectId, q.input.cause.ids, "stopped");
				else this.blockMessages(q.projectId, q.input.cause.ids, `Aģents «${q.agent}» nevarēja izpildīt: darbs tika apturēts.`, "queued");
			}
			// a thread that also has a run keeps the run's state
			if (![...this.live.values()].some((l) => l.thread.id === q.threadId)) this.settle(q.projectId, q.threadId);
		}
		this.changed();
	}

	/** Without a wave: everything. With one: only that wave's runs and queued items; the messages of that wave still waiting are stopped and wake nobody. */
	stopAll(wave?: string): void {
		if (!wave) this.held?.abort();
		this.stopWhere((x) => !wave || x.wave === wave, true);
		for (const p of this.projectsInPlay()) {
			const mb = this.d.mail?.(p);
			if (!mb) continue;
			this.setMail(p, mb.messages().filter((m) => !wave || m.wave === wave).map((m) => m.id), "stopped");
			// a thread that waited for an answer that will not come is no longer waiting
			for (const t of this.d.threads(p).list()) if (t.state === "waiting-reply") this.settle(p, t.id);
		}
	}

	stopThread(threadId: string): void {
		this.stopWhere((x) => x.threadId === threadId, false);
	}

	// ---- mail: delivery and waking --------------------------------------------------------------------------------------------------

	/** Every project that has a run or a queued item, and every known one: where messages can be waiting. */
	private projectsInPlay(): Set<string | null> {
		return new Set<string | null>([...(this.d.projects?.() ?? []), ...[...this.live.values()].map((l) => l.thread.projectId), ...this.queue.map((q) => q.projectId)]);
	}

	/** Sets the state of those of `ids` that are still waiting (`queued`); a message already delivered, failed or stopped is left as it is. Never throws. */
	private setMail(projectId: string | null, ids: readonly string[], state: Message["state"]): void {
		const mb = this.d.mail?.(projectId);
		if (!mb || !ids.length) return;
		try {
			for (const m of mb.messages()) if (ids.includes(m.id) && m.state === "queued") mb.setState(m.id, state);
		} catch {
			// a locked file: the message stays queued and the next wake looks at it again
		}
	}

	/** The thread's state after its run ended or its wait was cut: waiting for answers it asked for, or idle. A thread with a run or a queued item keeps that state. */
	private settle(projectId: string | null, threadId: string): void {
		const t = this.d.threads(projectId).get(threadId);
		if (!t || t.state === "closed" || this.threadBusy(threadId)) return;
		const mb = this.d.mail?.(projectId);
		let pending = 0;
		try {
			pending = mb ? pendingOf(threadId, mb.messages()).length : 0;
		} catch {
			// an unreadable mailbox: the thread is idle
		}
		const next = pending ? "waiting-reply" : "idle";
		if (t.state !== next) this.mark(t, { state: next });
	}

	/** Tells the senders of these messages (tasks and asks only) that the work will not happen: a `reply` from the recipient with status "bloķēts" and the reason,
	 *  written straight into the mailbox (no send rules, not an exchange), so each sender wakes. `stopped` writes them already stopped: the sender is told in
	 *  the books but not woken. Messages of these ids that were never delivered are closed as failed. */
	private blockMessages(projectId: string | null, ids: readonly string[], reason: string, state: "queued" | "stopped"): void {
		const mb = this.d.mail?.(projectId);
		if (!mb) return;
		let written = true;
		try {
			const all = mb.messages();
			for (const m of all) {
				if (!ids.includes(m.id)) continue;
				// one the recipient already answered for real needs no "bloķēts" on top of it, but it still leaves the inbox below:
				// left queued it would be found again by every wake (a closed thread: for ever)
				if (m.kind !== "reply" && !answered(m, all)) {
					const r = mb.add({
						wave: m.wave, topic: m.topic, from: m.to, to: m.from, kind: "reply", text: reason, refs: [], fromThread: m.toThread, toThread: m.fromThread, depth: m.depth + 1,
						reply: { id: `a${m.id}`, status: "bloķēts", results: [], questions: [], decisions: [], risks: reason },
					});
					if (state === "stopped") mb.setState(r.id, "stopped");
				}
				if (m.state === "queued") mb.setState(m.id, state === "stopped" ? "stopped" : "failed");
			}
		} catch {
			// a locked file: nothing more can be done here
			written = false;
		}
		for (const t of this.d.threads(projectId).list()) if (t.state === "waiting-reply") this.settle(projectId, t.id);
		// not at once: this may be called from inside `pump`, which must not be started again from within itself.
		// Not after a failed write either: the messages are still queued, so the wake would come straight back here, every microtask, while the file stays locked.
		// The next run end or message wakes the project again.
		if (state === "queued" && written) queueMicrotask(() => this.wake(projectId));
	}

	/** The tasks and asks that started a run which ended without answering them: a `reply` "daļēji" from the recipient, its text the run's final answer (cut at 2000),
	 *  written straight into the mailbox like `blockMessages` (no send rules, not an exchange), so each sender wakes. */
	private autoReply(projectId: string | null, ids: readonly string[], answer: string): void {
		const mb = this.d.mail?.(projectId);
		if (!mb) return;
		try {
			const all = mb.messages();
			const text = answer.trim().slice(0, 2000) || "(aģents neko neatbildēja)";
			for (const m of all) {
				if (!ids.includes(m.id) || m.kind === "reply" || answered(m, all)) continue;
				mb.add({
					wave: m.wave, topic: m.topic, from: m.to, to: m.from, kind: "reply", text, refs: [], fromThread: m.toThread, toThread: m.fromThread, depth: m.depth + 1,
					reply: { id: `a${m.id}`, status: "daļēji", results: [text], questions: [], decisions: [], risks: "Atbilde ir aģenta gājiena beigu teksts: ziņu viņš neatsūtīja." },
				});
			}
		} catch {
			// a locked file: the sender can be told by the next run
		}
	}

	/** Starts a run for every thread of the project that has mail to read and no answer it still waits for (`shouldWake`), unless it is running or queued.
	 *  Called after every run ends and after every message is added. A wake from inside a wake only marks the project to be looked at again. */
	wake(projectId: string | null): void {
		this.rewake.add(projectId);
		if (this.waking) return;
		this.waking = true;
		try {
			for (let guard = 0; this.rewake.size && guard < 200; guard++) {
				const p = [...this.rewake][0];
				this.rewake.delete(p);
				this.wakeProject(p);
			}
		} finally {
			this.rewake.clear();
			this.waking = false;
		}
	}

	private wakeProject(projectId: string | null): void {
		const mb = this.d.mail?.(projectId);
		if (!mb || this.closing) return;
		let ms: Message[];
		try {
			ms = mb.messages();
		} catch {
			return;
		}
		const topics = mb.topics();
		for (const t of this.d.threads(projectId).list()) {
			// a conversation the user closed before its mail came: the senders hear it, they do not wait
			if (t.state === "closed") {
				if (inboxOf(t.id, ms).length) this.blockMessages(projectId, inboxOf(t.id, ms).map((m) => m.id), `Aģenta «${t.agent}» saruna «${t.title}» ir slēgta.`, "queued");
				continue;
			}
			if (!shouldWake(t.id, ms) || this.threadBusy(t.id)) continue;
			const inbox = inboxOf(t.id, ms);
			// a specialist removed from the settings before its mail came: the senders hear it now, they do not wait
			if (this.d.specs && t.agent !== LEAD_ID && !this.d.specs().some((s) => s.id === t.agent)) {
				this.blockMessages(projectId, inbox.map((m) => m.id), `Aģents «${t.agent}» nav atrasts: viņš ir noņemts iestatījumos.`, "queued");
				continue;
			}
			try {
				this.submit({ threadId: t.id, projectId, text: deliveryText(inbox, topics, limitsOf(this.d.settings()).taskIterations), focus: [], cause: { by: "message", ids: inbox.map((m) => m.id) }, wave: inbox[0].wave });
			} catch {
				// the thread is gone or its state could not be written: the messages stay queued for the next wake
			}
		}
	}

	/** What `restore()` found, until the user answers with `resumeInterrupted` or `discardInterrupted`; null when nothing waits for an answer. */
	restoreFound(): { interrupted: number; queued: number } | null {
		return this.restoreNotice;
	}

	/** Called once at start-up, before anything can start. Marks the threads a dead process left in flight as `interrupted`, loads the saved queue
	 *  (every item kept, stopped ones too) and holds it paused until the user answers with `resumeInterrupted` or `discardInterrupted`.
	 *  A clean start (nothing in flight, nothing queued, a file that was not paused) stays unpaused. Never throws, never starts a run. */
	restore(): { interrupted: number; queued: number } {
		this.interrupted = [];
		const inFlight = new Set<Thread["state"]>(["running", "queued", "waiting-confirm", "interrupted"]);
		for (const projectId of this.d.projects?.() ?? []) {
			let list: Thread[];
			try {
				list = this.d.threads(projectId).list();
			} catch {
				continue; // a project whose thread folder cannot be read is skipped
			}
			for (const t of list) {
				if (!inFlight.has(t.state)) continue;
				// "interrupted" from an earlier start the user never answered counts too: resume / discard must reach it
				if (t.state !== "interrupted") {
					try {
						this.setState(t, { state: "interrupted" });
					} catch {
						continue;
					}
				}
				this.interrupted.push({ threadId: t.id, projectId: t.projectId });
			}
		}
		const loaded = loadQueue(this.d.queueFile);
		this.queue = loaded.items;
		this.prepared.clear();
		const queued = this.queue.filter((q) => q.state === "queued").length;
		this.paused = loaded.paused || this.interrupted.length > 0 || queued > 0;
		const found = { interrupted: this.interrupted.length, queued };
		// a clean start is not paused and has nothing to ask
		this.restoreNotice = this.paused ? found : null;
		this.waitingChanged();
		return found;
	}

	/** The thread is still `interrupted` (the user may have sent it a message while the queue was paused): give it its next state. */
	private settleInterrupted(next: (r: { threadId: string; projectId: string | null }) => Thread["state"]): void {
		for (const r of this.interrupted) {
			const t = this.d.threads(r.projectId).get(r.threadId);
			if (t?.state === "interrupted") this.mark(t, { state: next(r) });
		}
		this.interrupted = [];
	}

	/** The user chose to go on: threads with a queued item wait for their turn, the others are idle, and the queue starts. */
	resumeInterrupted(): void {
		this.answerRestore();
		this.settleInterrupted((r) => (this.queue.some((q) => q.state === "queued" && q.threadId === r.threadId) ? "queued" : "idle"));
		this.paused = false;
		this.pump();
		// mail that arrived while the app was down or the queue was held
		for (const p of this.projectsInPlay()) this.wake(p);
	}

	/** The user chose to drop it: queued items stay in the queue as `stopped`, the threads are idle, nothing starts. */
	discardInterrupted(): void {
		this.answerRestore();
		this.queue = this.queue.map((q) => {
			if (q.state !== "queued") return q;
			this.prepared.delete(q.id);
			return { ...q, state: "stopped" as const };
		});
		this.settleInterrupted(() => "idle");
		// a thread the user messaged while paused was marked queued for an item that is stopped now
		for (const q of this.queue) {
			const t = [...this.live.values()].some((l) => l.thread.id === q.threadId) ? null : this.d.threads(q.projectId).get(q.threadId);
			if (t?.state === "queued") this.mark(t, { state: "idle" });
		}
		this.paused = false;
		this.changed();
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
		this.waitingChanged();
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
