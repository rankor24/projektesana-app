// Calendar maths and the shape of a grafiks item (task 8.5). Pure and node-free: the renderer and the tests use it.
// Dates are ISO strings (YYYY-MM-DD) and are computed in UTC, so a daylight-saving change never moves a day.
import type { Task } from "../core/model.js";

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => isoOf(ms(d) + n * DAY);

/** The Monday of the week a date is in (the week starts on Monday in Latvia). */
export function mondayOf(d: string): string {
	const dow = new Date(ms(d)).getUTCDay(); // 0 = Sunday
	return addDays(d, -((dow + 6) % 7));
}

export const weekDays = (d: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(d), i));

/** The weeks that show a month, Monday first: every week that holds a day of the month, whole weeks. */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
	const first = `${year}-${String(month).padStart(2, "0")}-01`;
	const last = isoOf(Date.UTC(year, month, 0));
	const weeks: { date: string; inMonth: boolean }[][] = [];
	for (let w = mondayOf(first); w <= last; w = addDays(w, 7)) weeks.push(weekDays(w).map((date) => ({ date, inMonth: date.slice(0, 7) === first.slice(0, 7) })));
	return weeks;
}

/** What the grafiks shows on a day. */
export interface GrafikItem {
	/** unique inside one answer */
	id: string;
	date: string;
	kind: "planned" | "sent" | "clock" | "task";
	title: string;
	projectId: string;
	/** where a click goes */
	open?: { panel: "nodevumi" | "grafiks"; filter?: string };
	taskId?: string;
	level?: "bad" | "warn";
	done?: boolean;
	proposed?: boolean;
}

/** Proposed first (they wait for an answer), then open by due date (undated last), then done, newest first. */
export function taskOrder(tasks: Task[]): Task[] {
	const rank = (t: Task) => (t.state === "proposed" ? 0 : t.state === "open" ? 1 : 2);
	return [...tasks].sort((a, b) => rank(a) - rank(b) || (a.state === "done" ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.at.localeCompare(b.at)));
}
