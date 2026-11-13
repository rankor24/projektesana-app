// Shapes of a thread: one stored conversation of one agent. Shared with the renderer, so no node imports here.

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
