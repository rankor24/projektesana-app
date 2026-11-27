// Who is running, the queue behind the cap, the batch confirmations, Stop and pause. Runs are a table by run id; the cap is settings().maxParallelAgents.
// Every event of a run leaves with its envelope (thread, agent, project, wave) and the thread's state follows the run.
// Phase C adds three things, each ported from OpenMausBot (Apache-2.0) and fitted to this queue:
//   - pause: an agent, a department or everything (a full stop) takes no new work until resumed (core/holds.ts, docs/pausing-bots.md). Pausing stops the runs of the
//     agents it holds and the work they handed out; a held agent's queued items and its mail wait (they start on Resume); a message to it is refused with the reason.
//   - incidents: a run that failed, stalled (no event for 20 minutes) or could not start is recorded with its request and listed in "Gaida tevi" with Retry and Dismiss
//     (core/incidents.ts, docs/team-incidents.md); a run the user stopped, or the app closing, is not one.
//   - the Chief's ceiling: the tool level a message carries (`Message.level`) caps the run it starts (core/chief.ts `minLevel`; docs/approval-levels.md).
// No Electron imports: the runner, the stores and the sink are injected.
import type { AgentSpec } from "../shared/agent-types.js";
import type { FocusItem } from "../shared/api.js";
import { LEAD_ID, type IncidentView, type SteerView, type PauseTarget, type Thread, type RunMeta, type StartInput, type QueueView, type WaitingItem, type Wave } from "../shared/thread-types.js";
import { waitingItems } from "../shared/waiting.js";
import type { RunEvent, Settings } from "../shared/types.js";
import { answered, inboxOf, limitsOf, pendingOf, runDepth, shouldWake, deliveryText, type Mailbox, type Message } from "../core/messages.js";
import { EKS } from "../core/process-def.js";
import { Holds, handoffText, refusalText, type HeldBy } from "../core/holds.js";
import { IncidentStore, STALL_MS, isStalled } from "../core/incidents.js";
import { levelOfMessages, mayHandleIncidentOf, type Level } from "../core/chief.js";
import { BPV_ID, departmentOf, DEFAULT_DEPARTMENTS, type Department } from "../shared/departments.js";
import type { ThreadStore } from "../core/threads.js";
import { loadQueue, pickNext, saveQueue, waitReason, waveCheck, type QueueItem, type Running, type WaitReason } from "../core/queue.js";
import type { PreparedAttachments } from "./attachments.js";
import { autoMayApprove, type ConfirmRequest } from "./tools/levels.js";
import type { RunSteer, ThreadRunner } from "./thread-runner.js";

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
	/** the stages escalated to the user, of every project (process mode); without it none are listed */
	escalations?: () => Extract<WaitingItem, { kind: "escalated" }>[];
	/** the projects at S5 where the user has yet to start eks (process mode); without it none are listed */
	eksStarts?: () => Extract<WaitingItem, { kind: "start-eks" }>[];
	/** a project's mailbox; without it nothing is delivered and nobody is woken (the coordinator's own tests) */
	mail?: (projectId: string | null) => Mailbox;
	/** an answer was written for eks without eks being able to hear a real one (a run that ended, a recipient that could not run): its open question note on the topic closes (14.6) */
	eksAnswered?: (projectId: string | null, topic: string) => void;
	/** what the user paused; without it a memory-only state (the coordinator's own tests) */
	holds?: Holds;
	/** the incidents list; without it none is kept */
	incidents?: IncidentStore;
	/** the departments, for the name in a pause refusal; the shipped ones when absent */
	departments?: () => readonly Department[];
	/** a run is about to start for a message the user wrote while the chat's agent was answering: the activity log titles it with the text; the returned function takes the title back when the start fails */
	titleRun?: (projectId: string | null, text: string, runId: string) => () => void;
	now?: () => string;
}

/** A start as the coordinator takes it: the caller (AgentSession) has already read the attachments, so `StartInput.attachments`
 *  is not looked at here; `files` is what the run carries. `runId` lets the caller name the run before it starts (the files are saved under it). */
export type StartRequest = StartInput & { files?: PreparedAttachments; runId?: string; /** the run delivers a held message: its first event is `steered`, so the chat shows the message as a line of its own */ steered?: boolean };

interface Live {
	runId: string;
	thread: Thread;
	wave: string;
	abort: AbortController;
	done: Promise<unknown>;
	/** stopped by Stop (all or a wave) or by a pause: the sender of the message that started this run gets no "bloķēts" reply that would wake it */
	silent?: boolean;
	/** when the run last did anything (an event, epoch ms): 20 minutes without one is a stall */
	lastActive: number;
	/** the watchdog stopped it for being silent: its end is an incident, not a Stop */
	stalled?: boolean;
	/** the agents whose messages started it: pausing one of them stops the work it handed out */
	askedBy: string[];
	/** what it was asked, for the incident's "request" line */
	request: string;
	/** the way into the agent while an attempt of the engine is going (steering); null when the engine has none or the attempt is over */
	steer: RunSteer | null;
	/** Stop was pressed: the run is no longer shown as running and holds no slot, though its engine may still be winding down (closing a tool server, a provider that answers a cancel late) */
	stopped?: boolean;
	/** the run's bookkeeping is done (it left `live`): what its engine still says is dropped, except what the provider charged */
	over?: boolean;
	/** says an event as the run (the engine's own channel) */
	say?: (e: RunEvent) => void;
	/** ends the run's bookkeeping now, whether or not the engine has finished */
	wrapUp?: () => void;
}

/** How long a stopped run's engine gets to wind down by itself before the run is ended without it (ms). */
const STOP_GRACE_MS = 1500;

/** A message the user wrote while a chat's agent was answering. One per thread. */
interface HeldMsg {
	threadId: string;
	projectId: string | null;
	text: string;
	focus: FocusItem[];
	files: PreparedAttachments;
	at: string;
	/** the handle it was queued in: the agent has it and will read it after its current step */
	armed: RunSteer | null;
	/** it will not be sent by itself (see SteerView) */
	kept?: SteerView["kept"];
	detail?: string;
}

const NO_FILES_PREPARED: PreparedAttachments = { images: [], text: "", refs: [] };

/** A message the app itself sends between two agents (`Coordinator.postSystem`). */
export interface SystemPost {
	from: string;
	to: string;
	kind: "task" | "ask" | "reply";
	/** the thread of `to` that gets it when it is open and is that agent's (the user's answer to a question goes to the thread that asked); else the agent's thread is made */
	toThread?: string;
	/** no `toThread` named: the newest open thread of `to` in the project gets it, and one is made only when there is none (a decision tell must not open a thread each time) */
	toOpen?: boolean;
	/** the topic's title */
	title: string;
	text: string;
	refs?: string[];
}

const BUSY = "Aģents jau strādā. Aptur vai pagaidi.";
const NO_FILES = "[pielikumi pēc restartēšanas netika saglabāti]";

const steerView = (m: HeldMsg): SteerView => ({ threadId: m.threadId, projectId: m.projectId, text: m.text, attachments: m.files.refs, at: m.at, ...(m.kept ? { kept: m.kept } : {}), ...(m.detail ? { detail: m.detail } : {}) });

export class Coordinator {
	private live = new Map<string, Live>();
	/** engines of stopped runs that are still winding down (the run itself is already out of `live`, or on its way out) */
	private winding = new Set<Promise<unknown>>();
	private queue: QueueItem[] = [];
	private paused = false;
	/** threads `restore()` found in flight; they stay `interrupted` until the user resumes or discards */
	private interrupted: { threadId: string; projectId: string | null }[] = [];
	private closing = false;
	/** what `restore()` found in the mailboxes: tasks and asks a cut run had been delivered and nobody answered, and queued messages no queue item holds.
	 *  The user's answer settles them (`resumeInterrupted` tells the senders, `discardInterrupted` stops them). */
	private cutMail: { projectId: string | null; ids: string[] }[] = [];
	private orphanMail: { projectId: string | null; ids: string[] }[] = [];
	/** prepared files (and the run id the caller named) wait here beside the queued item; the saved queue never holds them */
	private prepared = new Map<string, { files?: PreparedAttachments; runId?: string; steered?: boolean }>();
	/** the message each thread's user wrote while its agent was answering; it is read by the agent after the current step, else it starts a run when this one ends */
	private steering = new Map<string, HeldMsg>();
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
	/** what the user paused; saved by the holds object itself */
	private readonly holds: Holds;
	private watchTimer: ReturnType<typeof setInterval> | null = null;

	constructor(private d: CoordinatorDeps) {
		this.holds = d.holds ?? new Holds();
	}

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
		return [...this.live.values()].filter((l) => !l.stopped).map((l) => ({ runId: l.runId, threadId: l.thread.id, agent: l.thread.agent, projectId: l.thread.projectId, wave: l.wave, waitingConfirm: waiting.has(l) }));
	}

	view(): QueueView {
		const running = this.running();
		const cap = this.d.settings().maxParallelAgents;
		// read only: asking the reason must not pause a wave (`waveBlocked` does that when a start is tried)
		const blocked = (q: QueueItem): "held" | "wave" | null => (this.heldNow(q.agent) !== null ? "held" : this.waves.get(q.wave)?.paused ? "wave" : null);
		const why: Record<string, WaitReason> = {};
		for (const q of this.queue) {
			if (q.state !== "queued") continue;
			const r = waitReason(q, running, Number.isFinite(cap) ? cap : 1, this.paused, blocked);
			if (r) why[q.id] = r;
		}
		return { running, queued: [...this.queue], why, paused: this.paused, waves: this.liveWaves(), held: this.holds.view(), steering: [...this.steering.values()].map(steerView) };
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
		let escalated: Extract<WaitingItem, { kind: "escalated" }>[] = [];
		try {
			escalated = this.d.escalations?.() ?? [];
		} catch {
			// unreadable process files: the list shows the rest
		}
		let eksStarts: Extract<WaitingItem, { kind: "start-eks" }>[] = [];
		try {
			eksStarts = this.d.eksStarts?.() ?? [];
		} catch {
			// unreadable process files or threads: the list shows the rest
		}
		const paused = [...this.waves.values()].filter((w) => w.paused).map((w) => ({ kind: "wave-paused" as const, wave: w.id, projectId: w.projectId, reason: w.paused! }));
		const incidents = (this.d.incidents?.list() ?? []).map((i) => ({ kind: "incident" as const, ...i }));
		return waitingItems({ confirms: [...this.confirms.values()].map((c) => c.item), restore: this.restoreNotice, paused, questions, gates, escalated, eksStarts, incidents });
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
			// a paused agent's item waits where it is (it starts on Resume); asked first, so a held item does not trip its wave's limit
				const item = pickNext(this.queue, this.running(), Number.isFinite(cap) ? cap : 1, this.paused, (q) => this.heldNow(q.agent) !== null || this.waveBlocked(q));
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
				this.keepHold(item.threadId, "stopped");
				if (item.id === own) failed.set(item.id, err);
				else {
					// nobody was looking at this start (a woken thread, a restored item): it goes into the incidents list
					this.noteIncident(item.projectId, item.threadId, item.agent, "not-started", err.message, item.input.text);
					this.surface(item, files?.runId, err);
				}
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
		// a paused agent takes no new work from the user either: the refusal says who is paused and how to resume
		if (i.cause.by === "user") {
			const by = this.heldNow(found.agent);
			if (by) throw new Error(this.refusal(found.agent, by));
		}
		const id = `q${Date.now().toString(36)}${++this.n}`;
		const wave = i.wave ?? this.newWave();
		this.waveOf(wave, i.projectId);
		this.queue.push({
			id, threadId: i.threadId, agent: found.agent, projectId: i.projectId, wave, at: this.now(), state: "queued",
			...(i.files && (i.files.images.length || i.files.text || i.files.refs.length) ? { hadFiles: true } : {}),
			input: { text: i.text, focus: i.focus, cause: i.cause },
		});
		this.prepared.set(id, { files: i.files, runId: i.runId, ...(i.steered ? { steered: true } : {}) });
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
	private begin(item: QueueItem, extra?: { files?: PreparedAttachments; runId?: string; steered?: boolean }): string {
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
		// the ceiling the work came with (the Chief's level flows down) and who handed it out (pausing them stops it)
		let levelCap: Level | undefined;
		let askedBy: string[] = [];
		if (mail && ids.length) {
			try {
				const ms = mail.messages();
				levelCap = levelOfMessages(ids, ms);
				askedBy = [...new Set(ms.filter((m) => ids.includes(m.id)).map((m) => m.from))];
			} catch {
				// an unreadable mailbox: the run goes on at its agent's own ceiling
			}
		}
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
		// eks has begun: the "start eks" card of Gaida tevi (R48) is out of date now, not at the next unrelated change
		if (thread.agent === EKS) this.waitingChanged();
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
			// a run ended without its engine (Stop): the engine's late words are not shown, only what the provider charged
			if (live.over && e.type !== "usage") return;
			// any event is a sign of life: the stall watchdog counts from the last one
			live.lastActive = Date.now();
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
		const live: Live = { runId, thread, wave, abort, done: Promise.resolve(), lastActive: Date.now(), askedBy, request: item.input.text, steer: null };
		const ask = (req: ConfirmRequest) =>
			new Promise<boolean>((resolve) => {
				// Auto mode (Settings.autoApprove, the button in the chat): the card is not shown. This is asked only after every refusal that no click lifts has been made
				// (the gate's `never` and office-folder `deny`, the working-copy check), and the batch the user keeps (tools/levels.ts autoMayApprove) still asks.
				if (this.d.settings().autoApprove === true && autoMayApprove(req.batch)) return resolve(true);
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
		// a run that delivers a held message says so first: the chat shows the message as a line of its own, before the card
		if (extra?.steered) emit({ type: "steered", text: item.input.text, starts: true, ...(extra.files?.refs.length ? { attachments: extra.files.refs } : {}) });
		// steering: while an attempt of the engine goes, a held message is handed to the agent; when the attempt ends, what it has not read stays held here
		const onSteer = (h: RunSteer | null) => {
			const prev = live.steer;
			live.steer = h;
			if (h) this.arm(thread.id, live);
			else for (const m of this.steering.values()) if (m.armed && m.armed === prev) m.armed = null;
		};
		const wrapUp = () => {
			if (live.over) return;
			live.over = true;
			this.denyConfirms((c) => c.live === live, false);
			this.live.delete(runId);
			// a run a message started that did not finish its work: the senders are told, so none waits for ever (a closing app keeps it all for the next start)
			if (!this.closing && ids.length && (abort.signal.aborted || !ok)) {
				const why = live.stalled ? "darbs 20 minūtes nerādīja nekādu aktivitāti un tika apturēts." : abort.signal.aborted ? "darbs tika apturēts." : `gājiens beidzās ar kļūdu: ${lastError ?? "nezināma kļūda"}`;
				this.blockMessages(thread.projectId, ids, `Aģents «${thread.agent}» nevarēja izpildīt: ${why}`, live.silent ? "stopped" : "queued");
			}
			// a run a message started that ended well but sent nothing back: its final answer goes to the sender, so the sender does not wait for ever
			else if (!this.closing && ids.length) this.autoReply(thread.projectId, ids, answer);
			// a run cut by the app closing is not finished: its thread stays `interrupted`, so the next start asks the user and tells the senders (I1)
			if (this.closing && abort.signal.aborted && !ok && !live.silent) this.mark(thread, { state: "interrupted" });
			else this.settle(thread.projectId, thread.id);
			// a message the user wrote while this run went on and the agent did not read: sent as a new run now, or kept for the user when this run was stopped or failed
			this.afterRun(thread, { ok, aborted: abort.signal.aborted });
			// what the user must be able to see and retry: a run that failed or stalled; a run the user stopped (or a pause did) is not one, and a run that worked clears the thread's
			if (!this.closing) {
				// a stall was recorded by the watchdog the moment it stopped the run (an engine that ignores its signal never gets here)
				if (!live.stalled && !ok && !abort.signal.aborted) this.noteIncident(thread.projectId, thread.id, thread.agent, "failed", lastError ?? "gājiens beidzās bez rezultāta", item.input.text);
				else if (ok && this.d.incidents?.settled(thread.id)) this.waitingChanged();
			}
			if (!this.closing) this.wake(thread.projectId);
			this.pump();
		};
		live.say = emit;
		live.wrapUp = wrapUp;
		live.done = this.d.runner
			.run({ runId, thread, spec, text, focus: item.input.focus, files: extra?.files ?? { images: [], text: "", refs: [] }, wave, signal: abort.signal, emit, ask, depth, peer: ids.length > 0, ...(levelCap ? { levelCap } : {}), wake: () => this.wake(thread.projectId), notesChanged: () => this.waitingChanged(), dataChanged: (what) => this.d.onData?.(thread.projectId, what), onSteer })
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
			.finally(wrapUp);
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

	// ---- steering: a message written while the agent answers ------------------------------------------------------------------------

	/** Holds a message for the thread whose agent is answering (or waiting in the queue). It is handed to the agent when the engine can take it (it reads it after its current step);
	 *  else, or when the run ends before the agent read it, it starts a new run of the thread (`afterRun`). A second message while one is held is added to it (same text box, nothing is lost):
	 *  the texts one under the other, the newer Fokuss, all the files. Refused like a normal send: a closed thread, a paused agent, a compaction going. A thread that is not busy is refused too:
	 *  the caller sends the message the normal way (`AgentSession.holdTo` does). */
	hold(i: { threadId: string; projectId: string | null; text: string; focus: FocusItem[]; files?: PreparedAttachments }): SteerView {
		if (this.held) throw new Error(BUSY);
		const t = this.d.threads(i.projectId).get(i.threadId);
		if (!t) throw new Error(`Saruna ${i.threadId} nav atrasta.`);
		if (t.state === "closed") throw new Error("Saruna ir slēgta.");
		const by = this.heldNow(t.agent);
		if (by) throw new Error(this.refusal(t.agent, by));
		if (!this.threadBusy(i.threadId)) throw new Error("Aģents šajā sarunā nestrādā: ziņu sūta parastā veidā.");
		const files = i.files ?? NO_FILES_PREPARED;
		const cur = this.steering.get(i.threadId);
		let m: HeldMsg;
		if (cur && this.unarm(cur)) {
			m = {
				...cur,
				text: [cur.text, i.text].filter((x) => x.trim()).join("\n\n"),
				focus: i.focus.length ? i.focus : cur.focus,
				files: { images: [...cur.files.images, ...files.images], text: [cur.files.text, files.text].filter(Boolean).join("\n\n"), refs: [...cur.files.refs, ...files.refs] },
				kept: undefined,
				detail: undefined,
			};
		} else m = { threadId: i.threadId, projectId: i.projectId, text: i.text, focus: i.focus, files, at: this.now(), armed: null };
		this.steering.set(i.threadId, m);
		this.arm(i.threadId);
		this.changed();
		return steerView(m);
	}

	/** Takes the held message of this thread back (Labot moves it to the text box, Atcelt drops it). Null when nothing is held, or the agent is reading it right now (it can no longer be taken back). */
	unhold(threadId: string): SteerView | null {
		const m = this.steering.get(threadId);
		if (!m || !this.unarm(m)) return null;
		this.steering.delete(threadId);
		this.changed();
		return steerView(m);
	}

	/** Changes the text of the held message (the files stay). Null when nothing is held or the agent is reading it right now. A kept message (stopped, failed, refused) stays kept after an edit: `release` sends it.
	 *  Refused for an empty text when no file is attached. */
	edit(threadId: string, text: string): SteerView | null {
		const m = this.steering.get(threadId);
		if (!m) return null;
		if (!text.trim() && !m.files.refs.length) throw new Error("Tukšs ziņojums.");
		if (!this.unarm(m)) return null;
		// a kept message stays kept (the user sends it with Sūtīt); only a message that still waits for a run is armed again
		const next: HeldMsg = { ...m, text };
		this.steering.set(threadId, next);
		this.arm(threadId);
		this.changed();
		return steerView(next);
	}

	/** Sends a kept message now, as a normal message of the user (the thread must be free). Refused when the agent works again or the message is not kept. */
	release(threadId: string): { runId: string | null; queued: boolean } {
		const m = this.steering.get(threadId);
		if (!m) throw new Error("Nav aizturētas ziņas.");
		if (!m.kept) throw new Error("Ziņa jau gaida aģentu.");
		if (this.threadBusy(threadId)) throw new Error(BUSY);
		const runId = this.newRunId();
		const untitle = this.d.titleRun?.(m.projectId, m.text, runId);
		try {
			const r = this.submit({ threadId: m.threadId, projectId: m.projectId, text: m.text, focus: m.focus, cause: { by: "user" }, files: m.files, runId, steered: true });
			this.steering.delete(threadId);
			this.changed();
			return { runId, queued: r.queued };
		} catch (e) {
			untitle?.();
			throw e;
		}
	}

	/** Is a message held for this thread (waiting for the agent or kept for the user)? */
	hasHold(threadId: string): boolean {
		return this.steering.has(threadId);
	}

	/** Hands the held message of the thread to the agent of its live run when that run has a way in. */
	private arm(threadId: string, from?: Live): void {
		const m = this.steering.get(threadId);
		if (!m || m.armed || m.kept) return;
		const live = from ?? [...this.live.values()].find((l) => l.thread.id === threadId);
		const h = live?.steer;
		if (!live || !h || live.abort.signal.aborted) return;
		m.armed = h;
		try {
			h.push({ text: m.text, focus: m.focus, files: m.files }, () => {
				// the agent has read it: it is a line of the chat now, not a held message
				if (this.steering.get(threadId) === m) {
					this.steering.delete(threadId);
					this.changed();
				}
			});
		} catch {
			m.armed = null;
		}
	}

	/** Takes a held message back out of the agent's queue. False when the agent is reading it now. */
	private unarm(m: HeldMsg): boolean {
		if (!m.armed) return true;
		let back = false;
		try {
			back = m.armed.withdraw();
		} catch {
			back = false;
		}
		if (back) m.armed = null;
		return back;
	}

	/** The thread's held message will not be sent by itself: no run is left whose end would decide it. */
	private keepHold(threadId: string, why: NonNullable<SteerView["kept"]>, detail?: string): void {
		const m = this.steering.get(threadId);
		if (!m || [...this.live.values()].some((l) => l.thread.id === threadId)) return;
		m.armed = null;
		m.kept = why;
		if (detail) m.detail = detail;
	}

	/** A run of the thread ended. Its held message, if the agent did not read it: after a good end it starts a new run of the thread; a run that was stopped or failed keeps it for the user. */
	private afterRun(thread: Thread, o: { ok: boolean; aborted: boolean }): void {
		const m = this.steering.get(thread.id);
		if (!m || this.closing || this.threadBusy(thread.id)) return;
		m.armed = null;
		if (o.aborted || !o.ok) {
			m.kept = o.aborted ? "stopped" : "failed";
			this.changed();
			return;
		}
		this.steering.delete(thread.id);
		const runId = this.newRunId();
		let untitle: (() => void) | undefined;
		try {
			untitle = this.d.titleRun?.(m.projectId, m.text, runId);
			this.submit({ threadId: m.threadId, projectId: m.projectId, text: m.text, focus: m.focus, cause: { by: "user" }, files: m.files, runId, steered: true });
		} catch (e) {
			untitle?.();
			this.steering.set(thread.id, { ...m, kept: "refused", detail: e instanceof Error ? e.message : String(e) });
		}
		this.changed();
	}

	// ---- pause ----------------------------------------------------------------------------------------------------------------------

	/** Why this agent takes no new work now, or null. */
	private heldNow(agentId: string) {
		return this.holds.reason(agentId, this.d.specs?.() ?? []);
	}

	private nameOf(agentId: string): string {
		return agentId === LEAD_ID ? "galvenais aģents" : (this.d.specs?.().find((s) => s.id === agentId)?.name ?? agentId);
	}

	private refusal(agentId: string, by: HeldBy): string {
		const spec = this.d.specs?.().find((s) => s.id === agentId);
		const dept = spec ? departmentOf(spec) : undefined;
		const dname = dept ? (this.d.departments?.() ?? DEFAULT_DEPARTMENTS).find((x) => x.id === dept)?.name : undefined;
		return refusalText(by, this.nameOf(agentId), dname);
	}

	/** The words another agent is told when it tries to hand this one work while it is paused; null when it may work. The mail tools ask this before they send. */
	handoffRefusal(agentId: string): string | null {
		const by = this.heldNow(agentId);
		return by ? handoffText(by, this.nameOf(agentId)) : null;
	}

	/** What is paused now. */
	heldView() {
		return this.holds.view();
	}

	/** Pauses or resumes an agent, a department or everything (a full stop). Pausing stops what the held agents are doing now, and the work they handed out; a full stop also drops the queue
	 *  and every lane and helper (they live in their run, and the run's signal reaches them). Nothing paused starts anything new until it is resumed. Returns how many runs were stopped. */
	setHold(target: PauseTarget, paused: boolean): { stopped: number } {
		const specs = this.d.specs?.() ?? [];
		if (target.kind === "agent" && target.id !== LEAD_ID && !specs.some((s) => s.id === target.id)) throw new Error(`Nav aģenta ${target.id}.`);
		if (target.kind === "department" && !(this.d.departments?.() ?? DEFAULT_DEPARTMENTS).some((x) => x.id === target.id)) throw new Error(`Nav nodaļas ${target.id}.`);
		const { newlyHeld } = this.holds.set(target, paused, [LEAD_ID, ...specs.map((s) => s.id)], specs);
		let stopped = 0;
		if (paused) {
			if (target.kind === "all") {
				stopped = this.live.size;
				this.stopAll();
			} else stopped = this.stopHeldRuns(new Set(newlyHeld));
		}
		this.changed();
		if (!paused) {
			// Resume: what waited in the queue and in the mail starts
			this.pump();
			for (const p of this.projectsInPlay()) this.wake(p);
		}
		return { stopped };
	}

	/** The runs of these agents stop, and the runs and queued items that messages from them started (the work they handed out). Their own queued items stay: they start on Resume. */
	private stopHeldRuns(agents: ReadonlySet<string>): number {
		if (!agents.size) return 0;
		const lives = [...this.live.values()].filter((l) => agents.has(l.thread.agent) || l.askedBy.some((a) => agents.has(a)));
		for (const l of lives) {
			l.silent = true;
			this.abortRun(l);
		}
		this.denyConfirms((c) => lives.includes(c.live), true);
		// handed-out work that has not begun: stopped with the one who handed it out (kept in the saved queue as stopped)
		const dropped: QueueItem[] = [];
		this.queue = this.queue.map((q) => {
			if (q.state !== "queued" || agents.has(q.agent) || q.input.cause.by !== "message") return q;
			const ids = q.input.cause.ids;
			const from = this.d.mail?.(q.projectId)?.messages().filter((m) => ids.includes(m.id)).map((m) => m.from) ?? [];
			if (!from.some((a) => agents.has(a))) return q;
			this.prepared.delete(q.id);
			dropped.push(q);
			return { ...q, state: "stopped" as const };
		});
		for (const q of dropped) {
			this.keepHold(q.threadId, "stopped");
			if (q.input.cause.by === "message") this.setMail(q.projectId, q.input.cause.ids, "stopped");
			if (![...this.live.values()].some((l) => l.thread.id === q.threadId)) this.settle(q.projectId, q.threadId);
		}
		return lives.length;
	}

	// ---- incidents ------------------------------------------------------------------------------------------------------------------

	private noteIncident(projectId: string | null, threadId: string, agent: string, kind: "failed" | "stalled" | "not-started", detail: string, request: string): void {
		try {
			if (this.d.incidents?.add({ projectId, threadId, agent, what: kind, detail, request }, this.now())) this.waitingChanged();
		} catch {
			// the list is a help to the user; it never gets in the way of the run's own end
		}
	}

	/** The watchdog: a run that has shown no sign of life for 20 minutes (and is not parked on the user's confirmation) is stopped and recorded as stalled. Called by the timer; a test passes the clock. */
	sweep(nowMs: number = Date.now(), limitMs: number = STALL_MS): number {
		const parked = new Set([...this.confirms.values()].map((c) => c.live));
		let n = 0;
		for (const l of this.live.values()) {
			if (l.stalled || l.abort.signal.aborted || !isStalled(l.lastActive, nowMs, parked.has(l), limitMs)) continue;
			l.stalled = true;
			l.abort.abort();
			this.noteIncident(l.thread.projectId, l.thread.id, l.thread.agent, "stalled", `Nav aktivitātes ${Math.round(limitMs / 60_000)} minūtes; darbs apturēts.`, l.request);
			n++;
		}
		return n;
	}

	/** Starts the watchdog's timer (once). It never keeps the process alive. */
	watch(everyMs = 60_000): void {
		if (this.watchTimer) return;
		this.watchTimer = setInterval(() => this.sweep(), everyMs);
		this.watchTimer.unref?.();
	}

	/** The open incidents, newest first: all of them, or those of one project (an agent sees only its own project's). */
	listIncidents(projectId?: string | null): IncidentView[] {
		return (this.d.incidents?.list() ?? []).filter((i) => projectId === undefined || i.projectId === projectId);
	}

	/** Retry: the incident leaves the list and its thread carries on where it stopped (a start by the user, so it keeps the user's rights). Refused when the thread has failed more than twice in the hour.
	 *  `by` is an agent doing it (BPV, a department's lead: OpenMausBot's `retry_thread`): the same function with the same limits, plus what the agent may reach (core/chief.ts `mayHandleIncidentOf`),
	 *  its own project, and a pause refused first with its own words; the thread's text and its next incident say who retried. The retried thread keeps its own approval level. */
	retryIncident(id: string, by?: { agent: string; projectId: string | null }): { runId: string | null; queued: boolean } {
		const inc = this.d.incidents?.get(id);
		if (!inc) throw new Error("Šis incidents vairs nav sarakstā.");
		let who = "";
		if (by) {
			const specs = this.d.specs?.() ?? [];
			const may = mayHandleIncidentOf(by.agent, inc.agent, specs, this.d.departments?.() ?? DEFAULT_DEPARTMENTS);
			if (!may.ok) throw new Error(may.reason);
			if (inc.projectId !== by.projectId) throw new Error("Šis incidents ir citā projektā: to atkārto tur.");
			const held = this.heldNow(inc.agent);
			if (held) throw new Error(this.refusal(inc.agent, held));
			who = by.agent === BPV_ID ? "BPV" : this.nameOf(by.agent);
		}
		if (this.d.threads(inc.projectId).get(inc.threadId)?.state === "closed") throw new Error("Saruna ir slēgta (arhivēta): atjauno to, tad atkārto.");
		if (!inc.mayRetry) throw new Error("Šī saruna jau ir atkārtota divreiz: nolasi kļūdu un izlabo cēloni, nevis mēģini vēlreiz.");
		const what = inc.what === "stalled" ? "pārstāja darboties" : inc.what === "not-started" ? "nevarēja sākties" : "beidzās ar kļūdu";
		const text = `[lietotne · atkārtošana${who ? ` · ${who} atkārtoja` : ""} · tikai informācija] Iepriekšējais gājiens šajā sarunā neizdevās (${what}): ${inc.detail}\nTurpini no vietas, kur apstājies; to, kas jau izdarīts, nedari vēlreiz.`;
		const r = this.submit({ threadId: inc.threadId, projectId: inc.projectId, text, focus: [], cause: { by: "user" } });
		// only once it has started (or queued): a start that is refused leaves the incident where it was
		this.d.incidents?.remove(id);
		this.d.incidents?.retried(inc.threadId, who || undefined);
		this.waitingChanged();
		return r;
	}

	dismissIncident(id: string): void {
		if (!this.d.incidents?.remove(id)) throw new Error("Šis incidents vairs nav sarakstā.");
		this.waitingChanged();
	}

	/** Stop for a run, at once: its signal fires (the provider request and the tool calls are cancelled), the window is told the run ended and the list stops showing it,
	 *  and its slot is free. The engine may still be winding down (a provider that answers a cancel late, a tool server that is slow to close): it gets `STOP_GRACE_MS`,
	 *  then the run's bookkeeping is ended without it. `shutdown` still waits for the engine itself. */
	private abortRun(l: Live): void {
		if (l.stopped) return;
		l.stopped = true;
		l.abort.abort();
		try {
			l.say?.({ type: "error", engine: "pi", message: "aborted" });
		} catch {
			// a window already gone
		}
		const timer = setTimeout(() => l.wrapUp?.(), STOP_GRACE_MS);
		timer.unref?.();
		this.winding.add(l.done);
		void l.done.catch(() => undefined).finally(() => {
			clearTimeout(timer);
			this.winding.delete(l.done);
		});
	}

	/** Aborts the runs that match, marks their queued items stopped (kept in the saved queue) and answers their confirmations with no.
	 *  The messages those items were to deliver are stopped with them. `silent`: Stop for everything or a wave, where no sender is to be woken. */
	private stopWhere(match: (x: { wave: string; threadId: string }) => boolean, silent: boolean): void {
		const lives = [...this.live.values()].filter((l) => match({ wave: l.wave, threadId: l.thread.id }));
		for (const l of lives) {
			l.silent = silent;
			this.abortRun(l);
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
			// a thread that was only waiting in the queue has no run whose end would decide its held message: it is kept for the user
			this.keepHold(q.threadId, "stopped");
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
					if (m.from === EKS) this.d.eksAnswered?.(projectId, m.topic);
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
				if (m.from === EKS) this.d.eksAnswered?.(projectId, m.topic);
			}
		} catch {
			// a locked file: the sender can be told by the next run
		}
	}

	/** System messages (14.7: a client change for bpv, the learning round): written straight into the project's mailbox, each on a topic of its own between the two parties,
	 *  with no send rules and no part in any exchange count, like the "Nodots" notice. All of one call share a wave. The recipient gets a thread on the topic and is woken as for any mail.
	 *  `once`: an item whose title is already open between the same two (a task or ask nobody has answered, not failed or stopped) is left out, so a double click asks once.
	 *  Returns the messages written. */
	postSystem(projectId: string | null, items: readonly SystemPost[], o: { once?: boolean } = {}): Message[] {
		const mb = this.d.mail?.(projectId);
		if (!mb) throw new Error("Pasta kaste nav pieejama.");
		const threads = this.d.threads(projectId);
		const wave = this.newWave();
		const out: Message[] = [];
		// the sender's side: the lead's open thread, else the agent's newest open one, else one made for it
		const senderThread = (agent: string, title: string): Thread => (agent === LEAD_ID ? threads.lead(projectId, "") : (threads.list({ agent, open: true })[0] ?? threads.create({ projectId, agent, title, startedBy: "app" })));
		try {
			for (const it of items) {
				if (o.once) {
					const all = mb.messages();
					const live = all.some((m) => m.from === it.from && m.to === it.to && (m.kind === "task" || m.kind === "ask") && m.state !== "failed" && m.state !== "stopped" && mb.topics().some((t) => t.id === m.topic && t.title === it.title) && !answered(m, all));
					if (live) continue;
				}
				const topic = mb.openTopic({ title: it.title, parties: [it.from, it.to], parent: null });
				const from = senderThread(it.from, it.title);
				const named = it.toThread ? threads.get(it.toThread) : it.toOpen ? threads.list({ agent: it.to, open: true })[0] : undefined;
				const to = named && named.agent === it.to && named.state !== "closed" ? named : threads.create({ projectId, agent: it.to, title: it.title, topic: topic.id, startedBy: it.from });
				this.d.onThread?.(to);
				out.push(mb.add({ wave, topic: topic.id, from: it.from, to: it.to, kind: it.kind, text: it.text, refs: it.refs ?? [], fromThread: from.id, toThread: to.id, depth: 1 }));
			}
		} finally {
			// what was written is woken for, also when a later item failed
			if (out.length) this.wake(projectId);
		}
		return out;
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
			// a paused agent's mail waits in the mailbox until it is resumed
			if (this.heldNow(t.agent)) continue;
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
		const items = this.queue.filter((q) => q.state === "queued");
		this.scanMail(new Set(items.flatMap((q) => (q.input.cause.by === "message" ? q.input.cause.ids : []))));
		// a queued message no item holds (its addressee was running when the process died) is work the restart question is about too
		const queued = items.length + this.orphanMail.reduce((n, o) => n + o.ids.length, 0);
		this.paused = loaded.paused || this.interrupted.length > 0 || queued > 0;
		const found = { interrupted: this.interrupted.length, queued };
		// a clean start is not paused and has nothing to ask
		this.restoreNotice = this.paused ? found : null;
		this.waitingChanged();
		return found;
	}

	/** The mail a restart has to settle: delivered tasks and asks whose recipient thread was interrupted and that nobody answered, and queued messages that no queue item
	 *  (`held`: the ids of the queued items' messages) carries. Never throws. */
	private scanMail(held: ReadonlySet<string>): void {
		this.cutMail = [];
		this.orphanMail = [];
		for (const projectId of this.d.projects?.() ?? []) {
			try {
				const mb = this.d.mail?.(projectId);
				if (!mb) continue;
				const cutThreads = new Set(this.interrupted.filter((r) => r.projectId === projectId).map((r) => r.threadId));
				const ms = mb.messages();
				const cut = ms.filter((m) => (m.kind === "task" || m.kind === "ask") && m.state === "delivered" && cutThreads.has(m.toThread) && !answered(m, ms)).map((m) => m.id);
				const orphans = ms.filter((m) => m.state === "queued" && !held.has(m.id)).map((m) => m.id);
				if (cut.length) this.cutMail.push({ projectId, ids: cut });
				if (orphans.length) this.orphanMail.push({ projectId, ids: orphans });
			} catch {
				// an unreadable mailbox: nothing of it is reconciled
			}
		}
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
		// the senders of work a cut run never finished hear it (the reply wakes them); the cut run itself is not started again
		const cut = this.cutMail;
		this.cutMail = [];
		this.orphanMail = [];
		for (const c of cut) this.tellCut(c.projectId, c.ids, "queued");
		// mail that arrived while the app was down or the queue was held
		for (const p of this.projectsInPlay()) this.wake(p);
	}

	/** The user chose to drop it: queued items stay in the queue as `stopped`, the threads are idle, nothing starts. */
	discardInterrupted(): void {
		this.answerRestore();
		const dropped: QueueItem[] = [];
		this.queue = this.queue.map((q) => {
			if (q.state !== "queued") return q;
			this.prepared.delete(q.id);
			dropped.push(q);
			return { ...q, state: "stopped" as const };
		});
		// the messages of the dropped items go with them, and so do the queued ones no item held: left queued, the next run end in the project would wake them (C1)
		for (const q of dropped) if (q.input.cause.by === "message") this.setMail(q.projectId, q.input.cause.ids, "stopped");
		for (const o of this.orphanMail) this.setMail(o.projectId, o.ids, "stopped");
		// the senders of what a cut run never finished are told in the books, not woken
		for (const c of this.cutMail) this.tellCut(c.projectId, c.ids, "stopped");
		this.cutMail = [];
		this.orphanMail = [];
		this.settleInterrupted(() => "idle");
		// a thread the user messaged while paused was marked queued for an item that is stopped now
		for (const q of this.queue) {
			const t = [...this.live.values()].some((l) => l.thread.id === q.threadId) ? null : this.d.threads(q.projectId).get(q.threadId);
			if (t?.state === "queued") this.mark(t, { state: "idle" });
		}
		// a thread that waited for an answer that will not come is no longer waiting
		for (const p of this.projectsInPlay()) {
			try {
				for (const t of this.d.threads(p).list()) if (t.state === "waiting-reply") this.settle(p, t.id);
			} catch {
				// a project whose thread folder cannot be read is skipped, as in restore
			}
		}
		this.paused = false;
		this.changed();
	}

	/** The cut run's senders are told: one "bloķēts" reply per message, from its recipient (`blockMessages`). */
	private tellCut(projectId: string | null, ids: readonly string[], state: "queued" | "stopped"): void {
		const mb = this.d.mail?.(projectId);
		if (!mb) return;
		let ms: Message[] = [];
		try {
			ms = mb.messages();
		} catch {
			return;
		}
		for (const id of ids) {
			const m = ms.find((x) => x.id === id);
			if (m) this.blockMessages(projectId, [id], `Aģents «${m.to}» nevarēja izpildīt: darbs tika pārtraukts (lietotne aizvērta).`, state);
		}
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

	/** Auto mode was just switched on: the cards already waiting that Auto mode may answer are answered yes (the checks that no click lifts were made before each card was shown). */
	approveWaiting(): void {
		for (const [id, c] of [...this.confirms]) {
			let batch: { tool: string; args: unknown }[] = [];
			try {
				batch = JSON.parse(c.item.batch) as { tool: string; args: unknown }[];
			} catch {
				continue; // a batch cut for display (4000 characters) cannot be judged: it stays with the user
			}
			if (Array.isArray(batch) && batch.length > 0 && autoMayApprove(batch)) this.confirm(id, true);
		}
	}

	/** App is quitting: abort the runs (queued items stay queued for the next start) and wait until they have closed their tool servers (the Revit MCP child and the tools child). */
	async shutdown(): Promise<void> {
		this.closing = true;
		if (this.watchTimer) clearInterval(this.watchTimer);
		this.watchTimer = null;
		this.held?.abort();
		for (const l of this.live.values()) l.abort.abort();
		this.denyConfirms(() => true, true);
		await Promise.all([...[...this.live.values()].map((l) => l.done), ...this.winding].map((d) => d.catch(() => undefined)));
		this.closing = false;
	}
}
