// Law citations with their version dates (task 2.1).
//
// Every law requirement cites: the act and its likumi.lv id, the point, the verbatim quote, the day the text was read
// (readOn), the act's version in force on that day (actVersionDate) and the day the point itself takes effect when that is
// later (validFrom). likumi.lv shows the consolidated date in a page widget that the snapshot text does not contain, so
// actVersionDate is read from the act's own amendment notes ("…redakcijā, kas stājas spēkā 01.01.2026.", "(Punkts stājas
// spēkā 01.03.2027. …)"): the latest such date on or before readOn. Dates after readOn are amendments not yet in force.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTS, type ActId, type Rule } from "./rules.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const DATE = /stājas\s+spēkā\s+(\d{2})\.(\d{2})\.(\d{4})/g;

/** All "stājas spēkā dd.mm.yyyy" dates in an act's text, ISO, sorted, unique. */
export function amendmentDates(text: string): string[] {
	const out = new Set<string>();
	for (const m of text.matchAll(DATE)) out.add(`${m[3]}-${m[2]}-${m[1]}`);
	return [...out].sort();
}

/** The act's version in force on `readOn`: the latest amendment date not after it. */
export function actVersionDate(text: string, readOn: string): string | null {
	const d = amendmentDates(text).filter((x) => x <= readOn);
	return d.length ? d[d.length - 1] : null;
}

/** "26. punkts" → "p26", "9.1 panta trešā daļa" → "p9.1", "1. pielikums 2.2.1. apakšpunkts" → "piel1". */
export function anchorOf(article: string): string | null {
	const annex = /^(\d+)\.\s*pielikum/.exec(article);
	if (annex) return `piel${annex[1]}`;
	const m = /^(\d+(?:\.\d+)*)\.?\s*(?:pant|punkt|apakšpunkt)/.exec(article);
	return m ? `p${m[1]}` : null;
}

export function pointUrl(r: Pick<Rule, "actId" | "article">): string {
	const a = anchorOf(r.article);
	return `https://likumi.lv/ta/id/${r.actId}${a ? `#${a}` : ""}`;
}

/** The point takes effect later than the act's version: the note right after the quote says so. */
export function validFromOf(text: string, quote: string, readOn: string): string | null {
	const t = norm(text);
	const i = t.indexOf(norm(quote));
	if (i < 0) return null;
	const after = t.slice(i + norm(quote).length, i + norm(quote).length + 300);
	const before = t.slice(Math.max(0, i - 200), i);
	const m = /\((?:[^()]*?)stājas\s+spēkā\s+(\d{2})\.(\d{2})\.(\d{4})/.exec(after) ?? /\((?:Punkts|Apakšpunkts|Pants|Daļa)[^()]*?stājas\s+spēkā\s+(\d{2})\.(\d{2})\.(\d{4})[^()]*\)\s*$/.exec(before);
	if (!m) return null;
	const iso = `${m[3]}-${m[2]}-${m[1]}`;
	return iso > readOn ? iso : null;
}

export type CitationStatus = "spēkā" | "vēl nav spēkā" | "teksts mainījies" | "nav pārbaudīts";

export interface LawCitation {
	ruleId: string;
	act: string;
	actId: ActId;
	point: string;
	url: string;
	quote: string;
	readOn: string;
	actVersionDate: string | null;
	validFrom: string | null;
	status: CitationStatus;
}

export function citationOf(rule: Rule, snapshotText: string | null, today: string): LawCitation {
	const base = { ruleId: rule.id, act: ACTS[rule.actId]?.short ?? rule.act, actId: rule.actId, point: rule.article, url: pointUrl(rule), quote: rule.quote, readOn: rule.read_on };
	if (snapshotText === null) return { ...base, actVersionDate: null, validFrom: rule.valid_from, status: "nav pārbaudīts" };
	const inText = norm(snapshotText).includes(norm(rule.quote));
	const validFrom = rule.valid_from ?? validFromOf(snapshotText, rule.quote, rule.read_on);
	return {
		...base,
		actVersionDate: actVersionDate(snapshotText, rule.read_on),
		validFrom,
		status: !inText ? "teksts mainījies" : validFrom && validFrom > today ? "vēl nav spēkā" : "spēkā",
	};
}

export function snapshotOf(dataDir: string, actId: string): string | null {
	const f = join(dataDir, "law-snapshots", `${actId}.txt`);
	return existsSync(f) ? readFileSync(f, "utf8") : null;
}

/** Amendments of an act not in force on `today`: date and the text of the note, for the "upcoming" list. */
export function upcoming(text: string, today: string): { from: string; note: string }[] {
	const t = norm(text);
	const out: { from: string; note: string }[] = [];
	for (const m of t.matchAll(/\(([^()]{0,200}?stājas\s+spēkā\s+(\d{2})\.(\d{2})\.(\d{4})[^()]{0,200})\)/g)) {
		const iso = `${m[4]}-${m[3]}-${m[2]}`;
		if (iso > today) out.push({ from: iso, note: m[1].trim() });
	}
	return out;
}
