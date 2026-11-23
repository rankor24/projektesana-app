// Routines as the window sees them (Rutīnas tab of Grafiks): a routine = an agent + an instruction + a schedule. Node-free types only;
// the schedule maths is core/cron.ts and the files are core/routines.ts. A routine is kept per project (in the project's data folder) or,
// with no project, app-wide.

/** What a run of a routine leaves in the project besides the agent's own thread. */
export type RoutineTaskMode = "none" | "task" | "task-result";

export type RoutineRunState = "pending" | "running" | "ran" | "failed" | "missed";

export interface RoutineRunRow {
	id: string;
	/** the occurrence this run is for (ISO instant) */
	scheduledFor: string;
	startedAt?: string;
	state: RoutineRunState;
	/** started later than its time (the app was closed or busy) */
	late?: boolean;
	/** a missed row counts the occurrences it stands for */
	count?: number;
	thread?: string;
	taskId?: string;
	/** why it failed or was missed; for a run that ran, a short line of the answer */
	note?: string;
	/** starts that did not work (the agent was busy, no sign-in); each is tried again a minute later, up to an hour */
	tries?: number;
	retryAt?: string;
}

export interface RoutineRow {
	id: string;
	projectId: string | null;
	name: string;
	/** an agent id, or "lead" */
	agent: string;
	instruction: string;
	cron: string;
	tz: string;
	/** how the user wrote the timing, when it was words */
	words?: string;
	/** the cron in a Latvian sentence */
	text: string;
	paused: boolean;
	/** made by an agent: it waits for the user to start it */
	proposed: boolean;
	taskMode: RoutineTaskMode;
	createdBy: string;
	createdAt: string;
	/** the next three runs as "2026-12-01 09:00" on the routine's own clock; empty while it is paused or proposed */
	next: string[];
	runs: RoutineRunRow[];
}

export interface RoutineInput {
	/** present = change this routine */
	id?: string;
	name: string;
	agent: string;
	instruction: string;
	/** the timing as the user wrote it: words or a cron expression */
	when: string;
	tz?: string;
	taskMode?: RoutineTaskMode;
}

export interface RoutinePreview {
	ok: boolean;
	error?: string;
	cron?: string;
	text?: string;
	/** the next three runs "2026-12-01 09:00" */
	next?: string[];
	tz: string;
}

/** One dated occurrence for the calendar. */
export interface RoutineOccurrence {
	routineId: string;
	name: string;
	projectId: string | null;
	date: string;
	time: string;
	paused: boolean;
	proposed: boolean;
}
