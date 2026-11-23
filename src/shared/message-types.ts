// Shapes of the mail between agents. Shared with the window (the room feed), so no node imports here; the rules and the mailbox are in core/messages.ts.

export type MessageKind = "task" | "reply" | "ask";

/** The office's UZDEVUMS (process 7.1) as data. */
export interface TaskEnvelope { id: string; stage?: string; goal: string; context: string[]; expects: string; iteration: number; limits?: string }
/** The office's ATBILDE (process 7.2) as data. */
export interface ReplyEnvelope { id: string; status: "izpildīts" | "daļēji" | "bloķēts"; results: string[]; questions: string[]; decisions: string[]; risks?: string }

export interface Message {
	id: string;
	at: string;
	wave: string;
	topic: string;
	from: string;
	to: string;
	kind: MessageKind;
	text: string;
	refs: string[];
	fromThread: string;
	toThread: string;
	depth: number;
	state: "queued" | "delivered" | "failed" | "stopped";
	task?: TaskEnvelope;
	reply?: ReplyEnvelope;
	/** the tool ceiling of the conversation that handed this out (chief-level.ts: it flows down): the receiving run never goes above it. Absent = the receiver's own. */
	level?: "run" | "confirm";
}

export interface Topic {
	id: string;
	title: string;
	parties: [string, string];
	parent: string | null;
	state: "open" | "agreed" | "passed-up";
	openedAt: string;
	closedAt?: string;
	noteId?: string;
	/** a "Nodots:" system notice to the lead: only the lead may close it */
	notice?: true;
}
