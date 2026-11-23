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
	/** pinned by the user: listed first in its agent's threads */
	pinned?: boolean;
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
	/** what the user paused (agents, departments, everything): these start nothing new until resumed */
	held: HeldView;
}

/** Pause state as the window sees it. `all`: a full stop is on. Agent and department ids; a department's agents are held with it. */
export interface HeldView {
	agents: string[];
	departments: string[];
	all: boolean;
}

export const NOTHING_HELD: HeldView = { agents: [], departments: [], all: false };

/** What the pause switches are aimed at. */
export type PauseTarget = { kind: "agent" | "department"; id: string } | { kind: "all" };

/** A run that did not finish, for the Incidenti list (core/incidents.ts). */
export interface IncidentView {
	id: string;
	at: string;
	projectId: string | null;
	threadId: string;
	agent: string;
	what: "failed" | "stalled" | "not-started";
	/** what the run said when it stopped */
	detail: string;
	/** the request the run was working on */
	request: string;
	/** how many times the user has retried this thread's incidents; the third is refused */
	retries: number;
	mayRetry: boolean;
	/** who retried this thread's earlier incident when it was an agent (BPV, a department's lead), by name: the card says "BPV atkārtoja"; absent when the user did */
	retriedBy?: string;
}

/** One thing that waits for the user (Gaida tevi). Items of every project, not only the open one. `wave-paused`, `question` and `gate` are filled by 12.4, 12.3 and 14.3. */
export type WaitingItem =
	| { kind: "confirm"; id: string; threadId: string; agent: string; projectId: string | null; tool: string; batch: string }
	| { kind: "interrupted"; interrupted: number; queued: number }
	| { kind: "wave-paused"; wave: string; projectId: string | null; reason: "runs" | "cost" }
	| { kind: "question"; noteId: string; projectId: string; from: string; title: string }
	| { kind: "gate"; gate: string; projectId: string; noteId: string }
	/** a stage the process has escalated to the user (iteration limit): no gate waits, the user decides (14.8) */
	| { kind: "escalated"; projectId: string; stage: string }
	/** S5 is on and nobody has started the expert since the stage began: only the user opens eks's thread, so this line is the cue (R48) */
	| { kind: "start-eks"; projectId: string }
	/** a run failed, stalled or could not start (core/incidents.ts): Retry or Dismiss */
	| ({ kind: "incident" } & IncidentView);

