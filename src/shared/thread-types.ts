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
