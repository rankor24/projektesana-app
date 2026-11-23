// Incidents: a run that failed (the engine ended before a result), stalled (no activity for 20 minutes) or could not start, kept in one list with
// Retry and Dismiss, so nothing dies silently inside a thread.
//
// Ported from OpenMausBot (Apache-2.0): docs/team-incidents.md (what counts as an incident and what does not) and server/incidents.ts (`IncidentLedger`:
// a thread may be retried twice, the third incident says stop, after five in an hour the thread is muted until the hour passes; `INCIDENT_*` limits;
// the report names the failed run's own words and the request it was working on). Adapted to this app:
//   - OpenMausBot hands the report to a Chief of Staff's turn. Here the user is the one who decides (a design office, one project at a time), so the
//     report is a row in "Gaida tevi" and in the "Incidenti" section of the conversations panel, with Retry and Dismiss. BPV, the Chief, hears of a
//     failed task through the "bloķēts" reply its sender gets (coordinator.blockMessages), the same way OpenMausBot lets a requester handle the
//     failure of work it handed out: a run started by a message therefore raises no incident of its own.
//   - A run the user stopped is not an incident (OpenMausBot: "A run the person stopped is not an incident"), nor is a run cut by the app closing.
//   - The list is kept in <app data>\incidents.json so a restart does not lose it.
//   - OpenMausBot's `retry_thread` (the Chief resumes a teammate's broken thread, server/drivers/agents-call.ts, docs/team-incidents.md) is here the agent's way into the very
//     Retry the user has (coordinator.retryIncident): the store remembers who retried a thread, so when the retry fails again the new incident says "BPV atkārtoja".
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncidentView } from "../shared/thread-types.js";
import { newId } from "./model.js";

/** No activity for this long and a run counts as stalled (docs/team-incidents.md: "stall (no activity for twenty minutes)"). */
export const STALL_MS = 20 * 60_000;
export const INCIDENT_RETRY_LIMIT = 2;
export const INCIDENT_HARD_LIMIT = 5;
export const INCIDENT_WINDOW_MS = 60 * 60_000;

/** Has this run gone quiet for too long? A run parked on a confirmation waits for the user, not for the machine: it never stalls. */
export function isStalled(lastActivityMs: number, nowMs: number, waitingForUser: boolean, limitMs: number = STALL_MS): boolean {
	return !waitingForUser && nowMs - lastActivityMs >= limitMs;
}

export interface IncidentCount {
	count: number;
	mayRetry: boolean;
	muted: boolean;
}

/** The incidents of each thread within the last hour (OpenMausBot `IncidentLedger`): how many there have been decides whether Retry is still offered and whether a crash loop is muted. */
export class IncidentLedger {
	private readonly at = new Map<string, number[]>();

	constructor(private readonly o: { now?: () => number; windowMs?: number; retryLimit?: number; hardLimit?: number } = {}) {}

	note(threadId: string): IncidentCount {
		const now = this.o.now?.() ?? Date.now();
		const windowMs = this.o.windowMs ?? INCIDENT_WINDOW_MS;
		const recent = (this.at.get(threadId) ?? []).filter((t) => now - t < windowMs);
		recent.push(now);
		this.at.set(threadId, recent);
		const count = recent.length;
		return { count, mayRetry: count <= (this.o.retryLimit ?? INCIDENT_RETRY_LIMIT), muted: count > (this.o.hardLimit ?? INCIDENT_HARD_LIMIT) };
	}

	/** The thread did its work: what was counted against it is forgotten. */
	forget(threadId: string): void {
		this.at.delete(threadId);
	}
}

const fold = (text: string, max: number): string => {
	const line = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

export interface NewIncident {
	projectId: string | null;
	threadId: string;
	agent: string;
	what: IncidentView["what"];
	detail: string;
	request: string;
}

/** The list of open incidents, in memory and on disk. Newest first. Never throws on a file that cannot be read or written: an incident list is not worth breaking a run. */
export class IncidentStore {
	private items: IncidentView[];
	private readonly ledger: IncidentLedger;
	/** the agent that retried each thread last (by name), until the thread works again: the thread's next incident carries it */
	private readonly retriedBy = new Map<string, string>();

	constructor(private readonly file?: string, ledger?: IncidentLedger) {
		this.ledger = ledger ?? new IncidentLedger();
		this.items = file ? readIncidents(file) : [];
	}

	list(): IncidentView[] {
		return this.items.map((i) => ({ ...i }));
	}

	get(id: string): IncidentView | undefined {
		return this.items.find((i) => i.id === id);
	}

	/** Records an incident; null when the thread is muted (five in an hour: a crash loop is one incident, not a storm). A newer incident of the same thread replaces the older one. */
	add(n: NewIncident, at: string = new Date().toISOString()): IncidentView | null {
		const c = this.ledger.note(n.threadId);
		if (c.muted) return null;
		const view: IncidentView = { id: newId("i"), at, projectId: n.projectId, threadId: n.threadId, agent: n.agent, what: n.what, detail: fold(n.detail, 400), request: fold(n.request, 300), retries: c.count - 1, mayRetry: c.mayRetry, ...(this.retriedBy.has(n.threadId) ? { retriedBy: this.retriedBy.get(n.threadId) } : {}) };
		this.items = [view, ...this.items.filter((i) => i.threadId !== n.threadId)];
		this.save();
		return view;
	}

	/** Removes it (Dismiss, or a Retry that is starting). The thread's count stays: a retry that fails again is the second incident. */
	remove(id: string): IncidentView | undefined {
		const found = this.get(id);
		if (!found) return undefined;
		this.items = this.items.filter((i) => i.id !== id);
		this.save();
		return found;
	}

	/** An agent (BPV, a department's lead) retried this thread, by name; or the user did (no name). Remembered for the thread's next incident. */
	retried(threadId: string, by?: string): void {
		if (by) this.retriedBy.set(threadId, by);
		else this.retriedBy.delete(threadId);
	}

	/** The thread finished a run well: its incidents are over, its count forgotten. True when the list changed. */
	settled(threadId: string): boolean {
		this.ledger.forget(threadId);
		this.retriedBy.delete(threadId);
		const had = this.items.some((i) => i.threadId === threadId);
		if (had) {
			this.items = this.items.filter((i) => i.threadId !== threadId);
			this.save();
		}
		return had;
	}

	private save(): void {
		if (!this.file) return;
		try {
			mkdirSync(dirname(this.file), { recursive: true });
			const tmp = `${this.file}.${process.pid}.tmp`;
			writeFileSync(tmp, JSON.stringify(this.items, null, 1));
			renameSync(tmp, this.file);
		} catch {
			// the list stays in memory; the next change writes again
		}
	}
}

/** The incidents a file holds; a file that is not a list of them is an empty list. */
export function readIncidents(file: string): IncidentView[] {
	try {
		if (!existsSync(file)) return [];
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!Array.isArray(raw)) return [];
		return raw.filter((i): i is IncidentView => !!i && typeof i.id === "string" && typeof i.threadId === "string" && typeof i.agent === "string" && (i.what === "failed" || i.what === "stalled" || i.what === "not-started"));
	} catch {
		return [];
	}
}
