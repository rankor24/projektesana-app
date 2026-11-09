// Shared pieces of the code extractors. An extractor reads the cached text pages of one source and returns candidates:
// key, value, page and the verbatim quote it was read from. Candidates are proposals; set_fact verifies the quote again.

export interface Candidate {
	key: string;
	value: string;
	page: number;
	/** verbatim text of the page (whitespace as in the source) */
	quote: string;
	/** what the value means, for the agent and the user */
	note?: string;
}

export const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Is the quote on the page? Whitespace is normalised on both sides (PDF line breaks fall anywhere); nothing else is. */
export function quoteOnPage(pageText: string, quote: string): boolean {
	const q = norm(quote);
	return q.length >= 3 && norm(pageText).includes(q);
}

/** Runs a regex over every page; for each match returns the page, the match and the exact text matched. */
export function* matches(pages: string[], re: RegExp): Generator<{ page: number; m: RegExpExecArray }> {
	const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
	for (let i = 0; i < pages.length; i++) {
		g.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = g.exec(pages[i]))) {
			yield { page: i + 1, m };
			if (m[0].length === 0) g.lastIndex++;
		}
	}
}

/** Latvian dates in documents: 01.10.2026., 2026-10-01, 2026. gada 1. oktobrī. Returns ISO or null. */
const MONTHS = ["janvār", "februār", "mart", "aprīl", "maij", "jūnij", "jūlij", "august", "septembr", "oktobr", "novembr", "decembr"];
export const DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\.?|\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{4})\.\s*gada\s+(\d{1,2})\.\s*(janvār|februār|mart|aprīl|maij|jūnij|jūlij|august|septembr|oktobr|novembr|decembr)\p{L}*/u;

export function isoDate(m: RegExpExecArray | RegExpMatchArray): string | null {
	let y: string, mo: string, d: string;
	if (m[1]) [d, mo, y] = [m[1], m[2], m[3]];
	else if (m[4]) [y, mo, d] = [m[4], m[5], m[6]];
	else if (m[7]) [y, d, mo] = [m[7], m[8], String(MONTHS.indexOf(m[9]) + 1)];
	else return null;
	const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
	const t = Date.parse(`${iso}T00:00:00Z`);
	return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}

export function firstDate(text: string): { iso: string; raw: string } | null {
	const m = new RegExp(DATE_RE.source, "u").exec(text);
	if (!m) return null;
	const iso = isoDate(m);
	return iso ? { iso, raw: m[0] } : null;
}

/** The whole line of a page that contains an index (for quotes that show the context). */
export function lineAt(page: string, index: number): string {
	const start = page.lastIndexOf("\n", index) + 1;
	const end = page.indexOf("\n", index);
	return page.slice(start, end < 0 ? undefined : end).trim();
}

/** Area numbers: "1 234,5", "1234.5" → 1234.5 */
export function num(s: string): number | null {
	const v = Number(s.replace(/\s/g, "").replace(",", "."));
	return Number.isFinite(v) ? v : null;
}
