// Latvian public holidays for the working-day count (rules hol-list, hol-easter, hol-christmas, hol-move; likumi.lv id 72608, read 2026-11-03).
// Easter Sunday is computed (Gregorian computus); the law names Good Friday, Easter Sunday and Easter Monday.
//
// NOT covered (no date in the law text): the closing day of the General Latvian Song and Dance Festival, which falls on a Sunday every
// few years, so the Monday after it would also be a day off. Exposed as `uncoveredDays` so the screen can say so.

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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** One-off holidays the law names with a year. */
const ONE_OFF = ["2018-09-24", "2023-05-29"];

/** Days off for a year: the named holidays, plus the next Monday for 4 May and 18 November falling on a weekend. */
export function holidaysOf(year: number): Set<string> {
	const out = new Set<string>();
	const fixed = [`${year}-01-01`, `${year}-05-01`, `${year}-06-23`, `${year}-06-24`, `${year}-11-18`, `${year}-12-24`, `${year}-12-25`, `${year}-12-26`, `${year}-12-31`, `${year}-05-04`];
	for (const f of fixed) out.add(f);
	const easter = easterSunday(year);
	for (const d of [-2, 0, 1, 49]) out.add(iso(addDays(easter, d)));
	for (const f of [`${year}-05-04`, `${year}-11-18`]) {
		const dow = new Date(`${f}T00:00:00Z`).getUTCDay();
		if (dow === 6) out.add(iso(addDays(new Date(`${f}T00:00:00Z`), 2)));
		if (dow === 0) out.add(iso(addDays(new Date(`${f}T00:00:00Z`), 1)));
	}
	for (const o of ONE_OFF) if (o.startsWith(String(year))) out.add(o);
	return out;
}

export function isWorkingDay(d: Date): boolean {
	const dow = d.getUTCDay();
	return dow !== 0 && dow !== 6 && !holidaysOf(d.getUTCFullYear()).has(iso(d));
}
