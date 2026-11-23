// Markdown memory, the agents' own changes and the app problem log as the window sees them (Atmiņa → Aģentu atmiņa).
// Node-free types only; the files and rules are agent/memory-md.ts, agent/self-changes.ts and agent/app-issues.ts.

export type MemoryKind = "agent" | "department" | "office";

export interface MemoryFileInfo {
	kind: MemoryKind;
	/** an agent id (or "lead"), a department id, or "office" */
	id: string;
	label: string;
	/** the only agent that writes this file (the user may always edit it) */
	keeper: string;
	exists: boolean;
	bytes: number;
	lines: number;
	/** how many characters of it go into a run's start, of the characters it has */
	loaded: number;
	chars: number;
}

export interface MemoryFileText {
	kind: MemoryKind;
	id: string;
	text: string;
	/** hash of the text, sent back with a save so a save never covers a write the user has not seen */
	hash: string;
	keeper: string;
}

export type SelfChangeKind = "memory" | "role" | "skill";

export interface SelfChange {
	id: string;
	at: string;
	by: "agent" | "user";
	agent: string;
	kind: SelfChangeKind;
	/** the file or skill that changed, as the app names it */
	target: string;
	reason: string;
	before: string | null;
	after: string;
	undone: boolean;
	/** what the undo did, when it was undone */
	undoneAt?: string;
}

export type AppIssueStatus = "open" | "fixed";

export interface AppIssue {
	id: string;
	at: string;
	agent: string;
	title: string;
	details: string;
	where: string;
	status: AppIssueStatus;
	statusAt?: string;
}
