// Routines: an agent, an instruction and a schedule. The user (or an agent, through the routine tools) describes the timing, it becomes a
// cron expression that is validated here, and the scheduler in the main process (main/routines-scheduler.ts) starts the agent's run at
// the time, only while the app runs. This file is the part with no Electron and no model: the files, the rules and the date maths, so the
// tests can run all of it.
//
// Ported in idea from OpenMausBot (Apache-2.0), docs/routine-schedules.md and docs/proactive-routines.md; server/routine-catch-up.ts
// (what to do with occurrences that came due while nothing could start them) and server/routine-ledger.ts (an occurrence starts once):
//   - catching up after downtime: of the occurrences that came due meanwhile the NEWEST runs late when it is no more than 12 hours past
//     its time; the ones before it, and all of them when even the newest is older, close on one "missed" row that counts them;
//   - an occurrence starts once: the cursor (the last occurrence dealt with) is saved BEFORE the run starts, so a crash, a second tick or a
//     restart never starts the same occurrence twice;
//   - a run that cannot start (the agent is busy, no sign-in) is tried again each minute for an hour, then it is closed as failed.
// Left out: the interval and one-time schedules, webhooks, checks that run before a turn, the lease and restore-from-backup marks of the
// ledger (one process writes these files here), cloud runners.
//
// Where a routine lives: <project data folder>\routines.json, or <app data>\routines.json for one with no project. Writes go through
// a temp file and a rename (core/safe-file.ts), so a crash leaves the old file.
import { join } from "node:path";
import type { GrafikItem } from "../shared/calendar.js";
import type { RoutineOccurrence, RoutineRow, RoutineRunRow, RoutineTaskMode } from "../shared/routine-types.js";
import { DEFAULT_TZ, cronFromWords, describeCron, nextRuns, parseCron, runsBetween, validTz, wallOf, wallText } from "./cron.js";
import { newId } from "./model.js";
import { readJson, writeAtomic } from "./safe-file.js";

export const ROUTINES_MAX = 60;
export const RUNS_KEPT = 30;
/** the newest occurrence found late still runs when it is no more than this late; older ones are only counted as missed */
export const CATCH_UP_MS = 12 * 60 * 60_000;
/** a start that does not work is tried again each minute for an hour */
export const RETRY_MS = 60_000;
export const RETRY_MAX = 60;
/** an occurrence found later than this after its time counts as a late start */
export const LATE_MS = 2 * 60_000;

export interface Routine extends Omit<RoutineRow, "text" | "next" | "projectId"> {
	/** the last occurrence dealt with (an ISO instant); occurrences after it are due when they pass */
	cursor: string;
}

export interface RoutineScope {
	appDir: string;
	projectsDir: string;
	projectId: string | null;
}

export const routinesFile = (s: RoutineScope): string => (s.projectId ? join(s.projectsDir, s.projectId, "routines.json") : join(s.appDir, "routines.json"));

export function readRoutines(file: string): Routine[] {
	const v = readJson<Routine[]>(file, Array.isArray);
	return (v ?? []).filter((r) => r && typeof r.id === "string" && typeof r.cron === "string" && typeof r.agent === "string");
}

export function writeRoutines(file: string, list: Routine[]): void {
	writeAtomic(file, JSON.stringify(list, null, 1));
}

/** Read, change, write; returns what `fn` returned. One process at a time in practice (the tools server writes only from a user's or agent's call). */
export function updateRoutines<T>(file: string, fn: (list: Routine[]) => T): T {
	const list = readRoutines(file);
	const out = fn(list);
	writeRoutines(file, list);
	return out;
}

export interface RoutineDraft {
	name: string;
	agent: string;
	instruction: string;
	when: string;
	tz?: string;
	taskMode?: RoutineTaskMode;
}

const MODES: readonly RoutineTaskMode[] = ["none", "task", "task-result"];

/** The timing as words or a cron expression → a checked expression, its zone and its sentence; a refusal is a Latvian sentence. */
export function readTiming(when: string, tzIn?: string): { cron: string; tz: string; text: string; next: number[]; words?: string } {
	const tz = tzIn?.trim() || DEFAULT_TZ;
	if (!validTz(tz)) throw new Error(`Laika josla nav pazīstama: ${tz} (piem. Europe/Riga).`);
	const w = cronFromWords(when);
	if (!w.ok) throw new Error(w.error);
	const p = parseCron(w.cron);
	if (!p.ok) throw new Error(p.error);
	const next = nextRuns(p.cron, tz, Date.now(), 3);
	if (!next.length) throw new Error("Šī izteiksme nekad neiestājas (piem. 30. februāris).");
	const typed = when.trim().replace(/\s+/g, " ");
	return { cron: w.cron, tz, text: describeCron(w.cron, tz), next, ...(typed !== w.cron ? { words: typed.slice(0, 200) } : {}) };
}

/** A new routine. `by`: "user" or the agent that made it (its routine waits for the user to start it). `known`: the agent ids that exist. */
export function newRoutine(d: RoutineDraft, by: string, known: readonly string[], now = Date.now()): Routine {
	const name = d.name.trim();
	if (name.length < 2 || name.length > 80) throw new Error("Rutīnas nosaukums: 2–80 zīmes.");
	if (!known.includes(d.agent)) throw new Error(`Nav aģenta ${d.agent}.`);
	const instruction = d.instruction.trim();
	if (instruction.length < 5 || instruction.length > 4000) throw new Error("Norādījums: 5–4000 zīmes.");
	const t = readTiming(d.when, d.tz);
	const taskMode = d.taskMode ?? "none";
	if (!MODES.includes(taskMode)) throw new Error("Uzdevuma režīms: none, task vai task-result.");
	const agentMade = by !== "user";
	return {
		id: newId("r"),
		name,
		agent: d.agent,
		instruction,
		cron: t.cron,
		tz: t.tz,
		...(t.words ? { words: t.words } : {}),
		paused: false,
		proposed: agentMade,
		taskMode,
		createdBy: by,
		createdAt: new Date(now).toISOString(),
		cursor: new Date(now).toISOString(),
		runs: [],
	};
}

/** Applies an edit of the user to a routine: the same checks as a new one, the cursor moved to now when the timing changed (the old time is not caught up). */
export function editRoutine(r: Routine, d: RoutineDraft, known: readonly string[], now = Date.now()): Routine {
	const fresh = newRoutine(d, "user", known, now);
	const timingChanged = fresh.cron !== r.cron || fresh.tz !== r.tz;
	return { ...r, name: fresh.name, agent: fresh.agent, instruction: fresh.instruction, cron: fresh.cron, tz: fresh.tz, words: fresh.words, taskMode: fresh.taskMode, proposed: false, cursor: timingChanged ? new Date(now).toISOString() : r.cursor };
}

/** A routine runs unless it is paused or still waiting for the user to start it. */
export const isActive = (r: Routine): boolean => !r.paused && !r.proposed;

/** Pause or resume. A resumed routine does not catch up what it missed while paused: its cursor moves to now. */
export function setPaused(r: Routine, paused: boolean, now = Date.now()): Routine {
	return paused ? { ...r, paused: true } : { ...r, paused: false, proposed: false, cursor: new Date(now).toISOString() };
}

export interface DuePlan {
	/** the occurrence to start now, if any */
	fire: { at: number; late: boolean } | null;
	/** occurrences that came due and will not run (counted, one row) */
	missed: number;
	/** the new cursor: the newest occurrence dealt with */
	cursor: number;
	/** why the missed ones were missed, in words */
	why?: string;
}

/** What is due at `now`: nothing (null), or the newest occurrence to run and a count of those skipped before it. */
export function planDue(r: Routine, now: number): DuePlan | null {
	if (!isActive(r)) return null;
	const p = parseCron(r.cron);
	if (!p.ok) return null;
	const cursor = Date.parse(r.cursor) || now;
	const due = runsBetween(p.cron, r.tz, cursor, now);
	if (!due.length) return null;
	const at = due[due.length - 1];
	const age = now - at;
	if (age > CATCH_UP_MS) return { fire: null, missed: due.length, cursor: at, why: "lietotne nebija atvērta" };
	return { fire: { at, late: age > LATE_MS }, missed: due.length - 1, cursor: at, ...(due.length > 1 ? { why: "lietotne nebija atvērta" } : {}) };
}

/** Adds a run row, keeping the newest RUNS_KEPT. */
export function addRun(r: Routine, row: RoutineRunRow): void {
	r.runs = [row, ...r.runs].slice(0, RUNS_KEPT);
}

export function newRun(scheduledFor: number, extra: Partial<RoutineRunRow> = {}): RoutineRunRow {
	return { id: newId("rr"), scheduledFor: new Date(scheduledFor).toISOString(), state: "pending", ...extra };
}

/** The window's row for a routine. */
export function toRow(r: Routine, projectId: string | null, now = Date.now()): RoutineRow {
	const { cursor: _cursor, ...rest } = r;
	void _cursor;
	const p = parseCron(r.cron);
	return { ...rest, projectId, text: describeCron(r.cron, r.tz), next: p.ok && isActive(r) ? nextRuns(p.cron, r.tz, now, 3).map((t) => wallText(t, r.tz)) : [] };
}

/** Occurrences with a date from `from` to `to` (ISO days, on the routine's own clock), for the calendar. At most `cap` each. */
export function occurrencesIn(r: Routine, projectId: string | null, from: string, to: string, cap = 400): RoutineOccurrence[] {
	const p = parseCron(r.cron);
	if (!p.ok) return [];
	const start = Date.parse(`${from}T00:00:00Z`) - 86_400_000;
	const end = Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000;
	const out: RoutineOccurrence[] = [];
	for (const t of runsBetween(p.cron, r.tz, start, end, cap + 50)) {
		const w = wallText(t, r.tz);
		const date = w.slice(0, 10);
		if (date >= from && date <= to) out.push({ routineId: r.id, name: r.name, projectId, date, time: w.slice(11), paused: r.paused, proposed: r.proposed });
		if (out.length >= cap) break;
	}
	return out;
}

/** The routines of one project (or app-wide) as items of the Grafiks calendar, "⟳ name 09:00" on each day. */
export function routineGrafikItems(file: string, projectId: string | null, from: string, to: string): GrafikItem[] {
	return readRoutines(file).flatMap((r) =>
		occurrencesIn(r, projectId, from, to).map((o) => ({
			id: `r:${r.id}:${o.date}`,
			date: o.date,
			kind: "routine" as const,
			title: `⟳ ${r.name} ${o.time}`,
			projectId: projectId ?? "",
			routineId: r.id,
			open: { panel: "grafiks" as const },
			...(r.paused || r.proposed ? { proposed: true } : {}),
		})),
	);
}

/** Today on a routine's clock, as an ISO day (a routine's task gets this due date). */
export function todayIn(tz: string, now = Date.now()): string {
	const w = wallOf(now, tz);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${w.y}-${p(w.mo)}-${p(w.d)}`;
}
