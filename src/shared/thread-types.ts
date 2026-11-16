// Shapes of a thread: one stored conversation of one agent. Shared with the renderer, so no node imports here.
import type { ChatAttachment, FocusItem } from "./api.js";

/** The id of the lead agent (the one the user talks to by default). */
export const LEAD_ID = "lead";

export type ThreadState = "idle" | "queued" | "running" | "waiting-confirm" | "waiting-reply" | "interrupted" | "closed";

export interface Thread {
	id: string;
	projectId: string | null;
	agent: string;
	title: string;
	topic: string | null;
	state: ThreadState;
	/** "user" or an agent id. */
	startedBy: string;
	wave: string | null;
	createdAt: string;
	lastAt: string;
	runs: number;
}

/** Who an event belongs to. The coordinator stamps it on every event of a run; the window uses it to route the event to a lane. */
export interface RunMeta {
	threadId: string;
	agent: string;
	projectId: string | null;
	wave: string;
}

/** What starts a run of a thread. `wave` is given when the run belongs to a wave that is already open; a user start opens a new one. */
export interface StartInput {
	threadId: string;
	projectId: string | null;
	text: string;
	focus: FocusItem[];
	attachments?: ChatAttachment[];
	wave?: string;
	cause: { by: "user" } | { by: "message"; ids: string[] };
}

export interface QueueItem {
	id: string;
	threadId: string;
	agent: string;
	projectId: string | null;
	wave: string;
	at: string;
	state: "queued" | "stopped";
	/** the start carried attachments; the saved queue does not (they were in memory), so a restored item starts without them and says so */
	hadFiles?: boolean;
	input: Omit<StartInput, "threadId" | "projectId" | "wave">;
}
export interface Running {
	runId: string;
	threadId: string;
	agent: string;
	projectId: string | null;
	wave: string;
	waitingConfirm: boolean;
}

/** The limits of agents talking to each other (Iestatījumi). Here, not in core/messages.ts, because `Settings` carries them and the window must not reach node:fs. */
export interface Limits { exchangesPerTopic: number; chainDepth: number; runsPerWave: number; waveCost: number | null; taskIterations: number }
export const DEFAULT_LIMITS: Limits = { exchangesPerTopic: 3, chainDepth: 6, runsPerWave: 20, waveCost: null, taskIterations: 3 };

/** A wave: everything one user action set off. Its id travels on every run and message it causes; the counts are the limits' input. */
export interface Wave {
	id: string;
	projectId: string | null;
	startedAt: string;
	runs: number;
	cost: number;
	paused: null | "runs" | "cost";
}

/** What the window sees of the run table and the queue; sent as `queue.changed` on every change. */
export interface QueueView {
	running: Running[];
	queued: QueueItem[];
	paused: boolean;
	waves: Wave[];
}

/** One thing that waits for the user (Gaida tevi). Items of every project, not only the open one. `wave-paused`, `question` and `gate` are filled by 12.4, 12.3 and 14.3. */
export type WaitingItem =
	| { kind: "confirm"; id: string; threadId: string; agent: string; projectId: string | null; tool: string; batch: string }
	| { kind: "interrupted"; interrupted: number; queued: number }
	| { kind: "wave-paused"; wave: string; projectId: string | null; reason: "runs" | "cost" }
	| { kind: "question"; noteId: string; projectId: string; from: string; title: string }
	| { kind: "gate"; gate: string; projectId: string; noteId: string }
	/** a stage the process has escalated to the user (iteration limit): no gate waits, the user decides (14.8) */
	| { kind: "escalated"; projectId: string; stage: string };

/** One line of the room (Telpa): who said what to whom, an agreement, a pass-up, a paused wave. `threadId` opens the thread, `noteId` names the Atmiņa note of a closed topic.
 *  A "state" line has no source yet: nothing records a thread's state changes with their time, so none is made. */
export interface RoomLine { at: string; kind: "message" | "state" | "agreed" | "passed-up" | "paused"; from?: string; to?: string; topic?: string; text: string; threadId?: string; noteId?: string }
