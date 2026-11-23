// A small cron reader for routines: five fields (minute hour day-of-month month day-of-week), checked without any network or library,
// the next run times of an expression in a time zone, a Latvian sentence for it, and a reader for timing written in plain words
// ("katru pirmdienu 9:00", "first of every month at 9") that turns the words into an expression the user then sees and confirms.
//
// Ported in idea from OpenMausBot (Apache-2.0): docs/routine-schedules.md ("Advanced cron" and "Dates, clock changes and downtime")
// and server/routine-cron-text.ts (a cron expression told back in words). OpenMausBot calculates dates with the Croner library; here
// the same rules are written out in about 250 lines so no dependency is added:
//   - lists, ranges, steps, month and weekday names; `L` (last day of the month) in day-of-month; `MON#2` (second Monday) and
//     `FRIL` (last Friday) in day-of-week;
//   - as in standard cron, restricting both day-of-month and day-of-week means EITHER may match; leave one as `*` for just the other;
//   - a date that does not exist (the 31st in a short month, 29 February) is skipped;
//   - a daylight-saving gap moves the wall-clock time forward; in a repeated hour a matching time runs once, at its first occurrence;
//   - no seconds, no year field, no `@macros`: the finest step is one minute.
// Dates are worked out on the calendar of the time zone (Intl), never by adding 24 hours, so a clock change never moves a routine.

export const DEFAULT_TZ = "Europe/Riga";

export interface Cron {
	minute: number[];
	hour: number[];
	/** days 1-31; `last` = the last day of the month */
	dom: number[];
	domLast: boolean;
	domAny: boolean;
	month: number[];
	/** 0 = Sunday … 6 = Saturday */
	dow: number[];
	/** weekday + which one in the month (1-5, or -1 = last): "MON#2", "FRIL" */
	dowNth: { day: number; nth: number }[];
	dowAny: boolean;
}

export type CronResult = { ok: true; cron: Cron } | { ok: false; error: string };

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const bad = (error: string): CronResult => ({ ok: false, error });

function value(raw: string, names: string[], base: number): number | null {
	const up = raw.toUpperCase();
	const at = names.indexOf(up);
	if (at >= 0) return at + base;
	return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** One field as a sorted list of numbers within [min, max]; `names` map JAN… or SUN… to numbers. */
function field(text: string, min: number, max: number, names: string[], nameBase: number, label: string): { ok: true; values: number[] } | { ok: false; error: string } {
	const out = new Set<number>();
	for (const part of text.split(",")) {
		if (!part) return { ok: false, error: `${label}: tukšs elements.` };
		const [range, stepText, extra] = part.split("/");
		if (extra !== undefined) return { ok: false, error: `${label}: «${part}» nav derīgs.` };
		let step = 1;
		if (stepText !== undefined) {
			if (!/^\d+$/.test(stepText) || Number(stepText) < 1) return { ok: false, error: `${label}: solim jābūt veselam skaitlim no 1.` };
			step = Number(stepText);
		}
		let lo: number;
		let hi: number;
		if (range === "*") {
			lo = min;
			hi = max;
		} else if (range.includes("-")) {
			const [a, b, c] = range.split("-");
			const x = value(a, names, nameBase);
			const y = value(b, names, nameBase);
			if (c !== undefined || x === null || y === null) return { ok: false, error: `${label}: «${range}» nav derīgs.` };
			lo = x;
			hi = y;
		} else {
			const x = value(range, names, nameBase);
			if (x === null) return { ok: false, error: `${label}: «${range}» nav derīgs.` };
			lo = x;
			// "5/15" = from 5 every 15
			hi = stepText !== undefined ? max : x;
		}
		if (lo < min || hi > max || lo > hi) return { ok: false, error: `${label}: ${lo}–${hi} ārpus ${min}–${max}.` };
		for (let v = lo; v <= hi; v += step) out.add(v);
	}
	return { ok: true, values: [...out].sort((a, b) => a - b) };
}

/** Reads a five-field expression. Every refusal is a Latvian sentence that says which field and why. */
export function parseCron(expression: string): CronResult {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) return bad(parts.length === 6 || parts.length === 7 ? "Sekundes un gada lauku šeit nelieto: vajag 5 laukus (minūte stunda diena mēnesis nedēļas-diena)." : "Vajag 5 laukus: minūte stunda diena mēnesis nedēļas-diena (piem. 0 9 1 * *).");
	if (/^@/.test(parts[0])) return bad("Saīsinājumi ar @ nav atļauti.");
	const [mi, ho, dm, mo, dw] = parts;
	const minute = field(mi, 0, 59, [], 0, "Minūte");
	if (!minute.ok) return bad(minute.error);
	const hour = field(ho, 0, 23, [], 0, "Stunda");
	if (!hour.ok) return bad(hour.error);
	const month = field(mo, 1, 12, MONTHS, 1, "Mēnesis");
	if (!month.ok) return bad(month.error);

	let domLast = false;
	let dom: number[] = [];
	const domAny = dm === "*";
	if (!domAny) {
		const items = dm.split(",");
		const rest = items.filter((x) => x.toUpperCase() !== "L");
		domLast = rest.length !== items.length;
		if (rest.length) {
			const f = field(rest.join(","), 1, 31, [], 0, "Diena");
			if (!f.ok) return bad(f.error);
			dom = f.values;
		}
	}

	let dow: number[] = [];
	const dowNth: Cron["dowNth"] = [];
	const dowAny = dw === "*";
	if (!dowAny) {
		const plain: string[] = [];
		for (const item of dw.split(",")) {
			const nth = /^([A-Za-z0-9]+)#([1-5])$/.exec(item);
			const last = /^([A-Za-z]{3})L$/i.exec(item);
			if (nth || last) {
				const d = value((nth ?? last)![1], DAYS, 0);
				if (d === null || d < 0 || d > 7) return bad(`Nedēļas diena: «${item}» nav derīga.`);
				dowNth.push({ day: d % 7, nth: nth ? Number(nth[2]) : -1 });
			} else plain.push(item);
		}
		if (plain.length) {
			const f = field(plain.join(","), 0, 7, DAYS, 0, "Nedēļas diena");
			if (!f.ok) return bad(f.error);
			// 7 is Sunday as well
			dow = [...new Set(f.values.map((v) => v % 7))].sort((a, b) => a - b);
		}
	}
	return { ok: true, cron: { minute: minute.values, hour: hour.values, dom, domLast, domAny, month: month.values, dow, dowNth, dowAny } };
}

// ---- time zones --------------------------------------------------------------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
	let f = formats.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
		formats.set(tz, f);
	}
	return f;
}

/** Is this an IANA zone the runtime knows? */
export function validTz(tz: string): boolean {
	try {
		format(tz);
		return true;
	} catch {
		return false;
	}
}

interface Wall {
	y: number;
	mo: number;
	d: number;
	h: number;
	mi: number;
}

/** The wall clock of an instant in a zone. */
export function wallOf(ms: number, tz: string): Wall {
	const p: Record<string, number> = {};
	for (const x of format(tz).formatToParts(new Date(ms))) if (x.type !== "literal") p[x.type] = Number(x.value);
	return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute };
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
const sameWall = (a: Wall, b: Wall) => wallMs(a) === wallMs(b);

/** The instant of a wall-clock time. A time inside a clock-change gap moves forward; a repeated time takes its first occurrence. */
export function instantOf(w: Wall, tz: string): number {
	const guess = wallMs(w);
	const DAY = 86_400_000;
	// the zone's offset a day before and a day after: the two that can apply around a change
	const offs = [...new Set([wallMs(wallOf(guess - DAY, tz)) - (guess - DAY), wallMs(wallOf(guess + DAY, tz)) - (guess + DAY)])];
	const hits = offs.map((o) => guess - o).filter((t) => sameWall(wallOf(t, tz), w)).sort((a, b) => a - b);
	if (hits.length) return hits[0];
	// a gap: the wall time does not exist; use the offset from before the gap, which lands after it
	return guess - offs[0];
}

const daysIn = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const dowOf = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

function dayMatches(c: Cron, y: number, mo: number, d: number): boolean {
	if (!c.month.includes(mo)) return false;
	const dayOk = c.dom.includes(d) || (c.domLast && d === daysIn(y, mo));
	const wd = dowOf(y, mo, d);
	const dowOk = c.dow.includes(wd) || c.dowNth.some((n) => n.day === wd && (n.nth === -1 ? d + 7 > daysIn(y, mo) : Math.ceil(d / 7) === n.nth));
	if (c.domAny && c.dowAny) return true;
	if (c.domAny) return dowOk;
	if (c.dowAny) return dayOk;
	// both restricted: either may match (standard cron)
	return dayOk || dowOk;
}

/** The next `count` instants after `after` (ms) that match, at most `horizonDays` ahead. */
export function nextRuns(c: Cron, tz: string, after: number, count = 3, horizonDays = 366 * 4): number[] {
	const out: number[] = [];
	const start = wallOf(after, tz);
	let day = Date.UTC(start.y, start.mo - 1, start.d);
	for (let i = 0; i <= horizonDays && out.length < count; i++, day += 86_400_000) {
		const dt = new Date(day);
		const y = dt.getUTCFullYear();
		const mo = dt.getUTCMonth() + 1;
		const d = dt.getUTCDate();
		if (!dayMatches(c, y, mo, d)) continue;
		for (const h of c.hour)
			for (const mi of c.minute) {
				const t = instantOf({ y, mo, d, h, mi }, tz);
				if (t > after && !out.includes(t)) out.push(t);
			}
		out.sort((a, b) => a - b);
		// the day's times are all in; later days can only be later
		if (out.length >= count) break;
	}
	return out.slice(0, count);
}

/** The first instant after `after`, or null when there is none inside the horizon (a date that never comes, such as 30 February). */
export function nextRun(c: Cron, tz: string, after: number): number | null {
	return nextRuns(c, tz, after, 1)[0] ?? null;
}

/** Every instant in (from, to], at most `cap`. */
export function runsBetween(c: Cron, tz: string, from: number, to: number, cap = 5000): number[] {
	const out: number[] = [];
	let at = from;
	while (out.length < cap) {
		const batch = nextRuns(c, tz, at, 50, Math.ceil((to - at) / 86_400_000) + 2);
		const inside = batch.filter((t) => t <= to);
		out.push(...inside);
		if (inside.length < batch.length || batch.length < 50) break;
		at = batch[batch.length - 1];
	}
	return out.slice(0, cap);
}

// ---- told back in words --------------------------------------------------------------------------------------------------------------

const WEEKDAY_ACC = ["svētdienu", "pirmdienu", "otrdienu", "trešdienu", "ceturtdienu", "piektdienu", "sestdienu"];
const MONTH_LOC = ["janvārī", "februārī", "martā", "aprīlī", "maijā", "jūnijā", "jūlijā", "augustā", "septembrī", "oktobrī", "novembrī", "decembrī"];
const NTH_LV: Record<number, string> = { 1: "pirmo", 2: "otro", 3: "trešo", 4: "ceturto", 5: "piekto", [-1]: "pēdējo" };

const hhmm = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;

/** A Latvian sentence for an expression; common shapes in words, anything else as the expression itself. */
export function describeCron(expression: string, tz = DEFAULT_TZ): string {
	const r = parseCron(expression);
	const zone = tz === DEFAULT_TZ ? "" : ` (${tz})`;
	if (!r.ok) return expression;
	const [mi, ho, dm, mo, dw] = expression.trim().split(/\s+/);
	const one = r.cron.minute.length === 1 && r.cron.hour.length === 1;
	const at = one ? `plkst. ${hhmm(r.cron.hour[0], r.cron.minute[0])}` : "";
	const step = /^\*\/(\d+)$/.exec(mi);
	if (step && ho === "*" && dm === "*" && mo === "*" && dw === "*") return `Ik pēc ${step[1]} minūtēm${zone}`;
	if (one || (r.cron.minute.length === 1 && ho === "*")) {
		if (ho === "*" && dm === "*" && mo === "*" && dw === "*") return `Katru stundu :${String(r.cron.minute[0]).padStart(2, "0")}${zone}`;
		if (one && dm === "*" && mo === "*" && dw === "*") return `Katru dienu ${at}${zone}`;
		if (one && dm === "*" && mo === "*" && dw === "1-5") return `Darba dienās ${at}${zone}`;
		if (one && dm === "*" && mo === "*" && r.cron.dow.length && !r.cron.dowNth.length) return `Katru ${r.cron.dow.map((d) => WEEKDAY_ACC[d]).join(", ")} ${at}${zone}`;
		if (one && dm === "*" && mo === "*" && r.cron.dowNth.length === 1 && !r.cron.dow.length) return `Katra mēneša ${NTH_LV[r.cron.dowNth[0].nth]} ${WEEKDAY_ACC[r.cron.dowNth[0].day]} ${at}${zone}`;
		if (one && mo === "*" && dw === "*" && /^L$/i.test(dm)) return `Katra mēneša pēdējā dienā ${at}${zone}`;
		if (one && mo === "*" && dw === "*" && r.cron.dom.length && !r.cron.domLast) return `Katra mēneša ${r.cron.dom.join(", ")}. datumā ${at}${zone}`;
		if (one && dw === "*" && r.cron.dom.length === 1 && r.cron.month.length === 1 && !r.cron.domLast) return `Katru gadu ${r.cron.dom[0]}. ${MONTH_LOC[r.cron.month[0] - 1]} ${at}${zone}`;
	}
	return `Pēc cron: ${expression}${zone}`;
}

// ---- timing in plain words -----------------------------------------------------------------------------------------------------------

const fold = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9:.@\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

// stems of the weekday names in Latvian and English, diacritics folded (pirmdienu, pirmdienas, pirmdien; monday, mon)
const WEEKDAY_STEMS: [string, number][] = [
	["pirmdien", 1], ["otrdien", 2], ["tresdien", 3], ["ceturtdien", 4], ["piektdien", 5], ["sestdien", 6], ["svetdien", 0],
	["monday", 1], ["tuesday", 2], ["wednesday", 3], ["thursday", 4], ["friday", 5], ["saturday", 6], ["sunday", 0],
];
const MONTH_STEMS: [string, number][] = [
	["janvar", 1], ["februar", 2], ["mart", 3], ["april", 4], ["maij", 5], ["junij", 6], ["julij", 7], ["august", 8], ["septemb", 9], ["oktobr", 10], ["novemb", 11], ["decemb", 12],
	["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6], ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
];
const ORDINALS: [RegExp, number][] = [
	[/\b(pirm\w*|first|1st)\b/, 1], [/\b(otr\w*|second|2nd)\b/, 2], [/\b(tres\w*|third|3rd)\b/, 3], [/\b(ceturt\w*|fourth|4th)\b/, 4], [/\b(piekt\w*|fifth|5th)\b/, 5],
];
const LAST = /\b(pedej\w*|last)\b/;

/** The time of day in a text: 9:00, 9.30, plkst. 9, at 9, 9am, 5 pm; null when there is none. */
function timeIn(t: string): { h: number; m: number; rest: string } | null {
	let m = /\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/.exec(t);
	if (!m) m = /\b(\d{1,2})()\s*(am|pm)\b/.exec(t);
	if (!m) m = /(?:plkst\.?|\bat\b|@)\s*(\d{1,2})()\b(?!\s*(?:st|nd|rd|th)\b)/.exec(t);
	if (!m) return null;
	let h = Number(m[1]);
	const min = m[2] ? Number(m[2]) : 0;
	if (m[3] === "pm" && h < 12) h += 12;
	if (m[3] === "am" && h === 12) h = 0;
	if (h > 23 || min > 59) return null;
	return { h, m: min, rest: (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim() };
}

export type WordsResult = { ok: true; cron: string } | { ok: false; error: string };

/** Timing in words (Latvian or English) as a cron expression. The user always sees the expression and the next dates before saving,
 *  so a reading that is wrong shows at once; what is not understood is refused, never guessed. A raw expression passes through. */
export function cronFromWords(text: string): WordsResult {
	const raw = text.trim();
	if (!raw) return { ok: false, error: "Ieraksti laiku vārdiem (piem. «katru pirmdienu 9:00») vai cron izteiksmi." };
	if (/^[\d*/,\-LlA-Za-z#]+(\s+[\d*/,\-LlA-Za-z#]+){4}$/.test(raw) && parseCron(raw).ok) return { ok: true, cron: raw.replace(/\s+/g, " ") };
	const t = fold(raw);

	const every = /(?:ik pec|every|katras|katru)\s+(\d+)\s*(minut\w*|min\b|stund\w*|hours?|h\b)/.exec(t);
	if (every) {
		const n = Number(every[1]);
		if (/^(minut|min)/.test(every[2])) return n >= 1 && n <= 59 ? { ok: true, cron: `*/${n} * * * *` } : { ok: false, error: "Minūšu solis: 1–59." };
		return n >= 1 && n <= 23 ? { ok: true, cron: `0 */${n} * * *` } : { ok: false, error: "Stundu solis: 1–23." };
	}
	if (/\b(katru stundu|katru stundas sakumu|every hour|hourly|ik stundu)\b/.test(t)) return { ok: true, cron: "0 * * * *" };

	const tm = timeIn(t);
	if (!tm) return { ok: false, error: "Trūkst laika (piem. «plkst. 9:00»). Vai ieraksti cron izteiksmi." };
	const rest = tm.rest;
	const hm = `${tm.m} ${tm.h}`;

	const days = [...new Set(WEEKDAY_STEMS.filter(([s]) => rest.includes(s)).map(([, d]) => d))].sort((a, b) => a - b);
	const monthly = /\b(menes\w*|month\w*|monthly)\b/.test(rest);
	// the ordinal is looked for with the weekday names taken out: "pirmdiena" is a weekday, not "pirmā"
	const bare = rest.split(" ").filter((w) => !WEEKDAY_STEMS.some(([s]) => w.startsWith(s))).join(" ");
	const nth = ORDINALS.find(([re]) => re.test(bare))?.[1];
	const last = LAST.test(bare);

	// "second Monday of every month", "otrā pirmdiena katrā mēnesī", "last Friday of the month"
	if (days.length === 1 && monthly && (nth || last)) return { ok: true, cron: `${hm} * * ${DAYS[days[0]]}${last ? "L" : `#${nth}`}` };
	// "last day of every month", "mēneša pēdējā dienā"
	if (monthly && last && /\b(dien\w*|day)\b/.test(rest)) return { ok: true, cron: `${hm} L * *` };
	// "yearly on March 1"
	const month = MONTH_STEMS.find(([s]) => new RegExp(`\\b${s}`).test(rest))?.[1];
	const dayNum = /\b(\d{1,2})\.?\s*(?:datum\w*|date\b|st\b|nd\b|rd\b|th\b|dien\w*)?/.exec(rest.replace(/\b\d{1,2}[:]\d{2}\b/g, ""));
	if (month && dayNum && Number(dayNum[1]) >= 1 && Number(dayNum[1]) <= 31) return { ok: true, cron: `${hm} ${Number(dayNum[1])} ${month} *` };
	// "first of every month", "katra mēneša 1. datumā", "mēneša pirmajā dienā"
	if (monthly) {
		const d = /\b(\d{1,2})\.?\s*(?:datum\w*|date\b|st\b|nd\b|rd\b|th\b|dien\w*|of\b)/.exec(rest);
		const dom = d ? Number(d[1]) : nth;
		if (dom && dom >= 1 && dom <= 31) return { ok: true, cron: `${hm} ${dom} * *` };
		if (!dom) return { ok: false, error: "Kuru mēneša dienu? (piem. «katra mēneša 1. datumā» vai «pēdējā dienā»)." };
	}
	if (/\b(darba dien\w*|weekdays?|working days?)\b/.test(rest)) return { ok: true, cron: `${hm} * * 1-5` };
	if (days.length) return { ok: true, cron: `${hm} * * ${days.join(",")}` };
	if (/\b(katru dien\w*|ikdien\w*|every day|daily|each day|katru rit\w*|katru vakar\w*)\b/.test(rest)) return { ok: true, cron: `${hm} * * *` };
	return { ok: false, error: "Nesapratu, kad. Piemēri: «katru pirmdienu 9:00», «darba dienās 8:30», «katra mēneša 1. datumā 9:00», «otrā pirmdiena katrā mēnesī 10:00». Vai ieraksti cron izteiksmi." };
}

/** An instant as "2026-12-01 09:00" on the wall clock of a zone. */
export function wallText(ms: number, tz: string): string {
	const w = wallOf(ms, tz);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${w.y}-${p(w.mo)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
}
