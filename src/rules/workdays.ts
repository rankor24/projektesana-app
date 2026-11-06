// Latvian public holidays and working-day counts (likumi.lv id 72608, read 2026-11-03).
// Carried from v1 src/main/rules/holidays.ts plus the deadline count from v1 engine.ts, generalised to any number of days
// (MK 500 27: technical conditions 11 / 20 working days; approvals 15 / 20 working days).
//
// NOT covered (no date in the law text): the closing day of the General Latvian Song and Dance Festival, which falls on a Sunday
// every few years, so the Monday after it would also be a day off. Every result carries that caveat.

export const HOLIDAY_CAVEAT = "Vispārējo latviešu Dziesmu un deju svētku noslēguma dienas datums likuma tekstā nav norādīts un aprēķinā nav iekļauts.";

/** Easter Sunday of a Gregorian year (Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, month - 1, day));
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** One-off holidays the law names with a year. */
const ONE_OFF = ["2018-09-24", "2023-05-29"];

const cache = new Map<number, Set<string>>();

/** Days off for a year: the named holidays, plus the next Monday for 4 May and 18 November falling on a weekend. */
export function holidaysOf(year: number): Set<string> {
	const hit = cache.get(year);
	if (hit) return hit;
	const out = new Set<string>();
	for (const f of [`${year}-01-01`, `${year}-05-01`, `${year}-05-04`, `${year}-06-23`, `${year}-06-24`, `${year}-11-18`, `${year}-12-24`, `${year}-12-25`, `${year}-12-26`, `${year}-12-31`]) out.add(f);
	const easter = easterSunday(year);
	// Good Friday, Easter Sunday, Easter Monday, Whit Sunday
	for (const d of [-2, 0, 1, 49]) out.add(isoDay(addDays(easter, d)));
	for (const f of [`${year}-05-04`, `${year}-11-18`]) {
		const day = new Date(`${f}T00:00:00Z`);
		const dow = day.getUTCDay();
		if (dow === 6) out.add(isoDay(addDays(day, 2)));
		if (dow === 0) out.add(isoDay(addDays(day, 1)));
	}
	for (const o of ONE_OFF) if (o.startsWith(String(year))) out.add(o);
	cache.set(year, out);
	return out;
}

export function isWorkingDay(d: Date): boolean {
	const dow = d.getUTCDay();
	return dow !== 0 && dow !== 6 && !holidaysOf(d.getUTCFullYear()).has(isoDay(d));
}

/** The date `n` working days after `from` (the day itself does not count). */
export function addWorkingDays(from: string, n: number): string {
	const d = new Date(`${from}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) throw new Error(`Nederīgs datums: ${from}`);
	let left = n;
	while (left > 0) {
		d.setUTCDate(d.getUTCDate() + 1);
		if (isWorkingDay(d)) left--;
	}
	return isoDay(d);
}

/** Working days from `from` (exclusive) to `to` (inclusive); negative when `to` is before `from`. */
export function workingDaysBetween(from: string, to: string): number {
	const a = new Date(`${from}T00:00:00Z`);
	const b = new Date(`${to}T00:00:00Z`);
	const sign = b >= a ? 1 : -1;
	const [lo, hi] = sign > 0 ? [a, b] : [b, a];
	let n = 0;
	const d = new Date(lo);
	while (d < hi) {
		d.setUTCDate(d.getUTCDate() + 1);
		if (isWorkingDay(d)) n++;
	}
	return n * sign;
}
