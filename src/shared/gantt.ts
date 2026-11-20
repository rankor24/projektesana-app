// The Gantt of the Grafiks page: the maths of its date axis, a stage's span, a task's bar and what a drag does to it. Pure and
// node-free: the page and the tests use the same code. Dates are ISO strings (YYYY-MM-DD) counted in UTC days, so a daylight-
// saving change never moves a bar. The stage timeline of Pārskats (shared/dashboard.ts stageTimeline) gives the deliveries and
// the clocks; this file adds what that strip never had: where a stage starts and ends, and a bar for a task that lasts.
import type { BimStage } from "../core/model.js";

const DAY = 86_400_000;
export const dayNo = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
export const isoOfDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => isoOfDay(dayNo(iso) + n);

/** Where each stage starts and ends, as the user set it (Projektesana keeps no dates of its own for a stage). */
export type StageDates = Partial<Record<BimStage, { start: string; end: string }>>;

export interface Axis {
	from: string;
	to: string;
	days: number;
}

/**
 * The date axis: from the earliest to the latest date (today always inside), a margin on each side, whole weeks (Monday
 * first), and never narrower than `min` days, so one delivery does not make a page-wide bar.
 */
export function ganttAxis(dates: (string | null | undefined)[], today: string, pad = 14, min = 84): Axis {
	const ns = [today, ...dates.filter((d): d is string => !!d)].map(dayNo);
	let lo = Math.min(...ns) - pad;
	let hi = Math.max(...ns) + pad;
	lo -= (new Date(lo * DAY).getUTCDay() + 6) % 7;
	hi += 6 - ((new Date(hi * DAY).getUTCDay() + 6) % 7);
	while (hi - lo + 1 < min) hi += 7;
	return { from: isoOfDay(lo), to: isoOfDay(hi), days: hi - lo + 1 };
}
export const dayIndex = (a: Axis, iso: string): number => dayNo(iso) - dayNo(a.from);
export const dateAtIndex = (a: Axis, i: number): string => isoOfDay(dayNo(a.from) + i);

/** Pixels per day at each zoom: the whole year, a quarter, a month, a week across a screen. */
export const ZOOMS = { year: 3, quarter: 7, month: 16, week: 34 } as const;
export type Zoom = keyof typeof ZOOMS;

export interface MonthTick {
	/** the first day shown of this month (the axis' first day for the first one) */
	date: string;
	index: number;
	/** days of the month that are on the axis */
	days: number;
	year: number;
	month: number;
}
/** The months on the axis, each with the days of it that show, for the header. */
export function monthTicks(a: Axis): MonthTick[] {
	const out: MonthTick[] = [];
	for (let i = 0; i < a.days; ) {
		const date = dateAtIndex(a, i);
		const y = Number(date.slice(0, 4));
		const m = Number(date.slice(5, 7));
		const left = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(date.slice(8)) + 1;
		const days = Math.min(left, a.days - i);
		out.push({ date, index: i, days, year: y, month: m });
		i += days;
	}
	return out;
}
/** The Mondays on the axis (index and date), for the week lines. */
export function weekLines(a: Axis): { index: number; date: string }[] {
	const out: { index: number; date: string }[] = [];
	for (let i = 0; i < a.days; i += 7) out.push({ index: i, date: dateAtIndex(a, i) });
	return out;
}

export interface Span {
	start: string;
	end: string;
}
/**
 * A stage's bar: the dates the user set, else the stretch its own deliveries and clocks cover (nothing is invented: a stage with
 * no date at all has no bar, and the row says so). `stored` is false for a derived span, which the row draws lighter.
 */
export function stageSpan(stored: { start: string; end: string } | undefined, marks: { date: string }[], bars: { from: string; to: string }[]): (Span & { stored: boolean }) | null {
	if (stored) return { ...stored, stored: true };
	const days = [...marks.map((m) => m.date), ...bars.flatMap((b) => [b.from, b.to])].filter(Boolean).sort();
	if (days.length === 0) return null;
	return { start: days[0], end: days[days.length - 1], stored: false };
}

/** A task's bar: first day to last day; a task with a date and no start is one day; an undated task has no place on the axis. */
export function taskSpan(t: { start?: string | null; due: string | null }): Span | null {
	const end = t.due ?? t.start ?? null;
	if (!end) return null;
	const start = t.start && t.start <= end ? t.start : end;
	return { start, end };
}

export type DragEdge = "move" | "start" | "end";
/**
 * What a drag of `delta` days does to a bar: the whole bar moves, or one edge does (never past the other: a bar is at least
 * one day).
 */
export function dragSpan(span: Span, delta: number, edge: DragEdge): Span {
	if (edge === "move") return { start: addDays(span.start, delta), end: addDays(span.end, delta) };
	if (edge === "start") {
		const s = addDays(span.start, delta);
		return { start: s > span.end ? span.end : s, end: span.end };
	}
	const e = addDays(span.end, delta);
	return { start: span.start, end: e < span.start ? span.start : e };
}
/** The patch a span makes on a task: a one-day span has no start. */
export function spanPatch(s: Span): { start: string | null; due: string } {
	return { start: s.start === s.end ? null : s.start, due: s.end };
}
