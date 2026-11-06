// Design brief (PU, projektēšanas uzdevums): profile facts (address, cadastral number, work type, use, group, stages,
// sections) and its numbered requirement rows (used by task 2.2 as requirements with origin pu).
// Word boundaries next to Latvian letters are Unicode lookarounds: JavaScript's \b is ASCII-only even with the u flag,
// so it never matches next to ā, č, Ū — "ŪK" and "…sastāvā." would be missed.
import { matches, type Candidate } from "./common.js";
import { extractCadastral } from "./cadastral.js";

const ADDRESS = /(objekta\s+adrese|būvobjekta\s+adrese|adrese)\s*[:\-–]\s*([^\n]{5,120})/giu;
const WORK: [RegExp, string][] = [
	[/\bjaun(?:as|a)?\s+būvniecīb\p{L}*|\bjaunbūv\p{L}*/iu, "new_build"],
	[/\bpārbūv\p{L}*/iu, "reconstruction"],
	[/\bvienkāršot\p{L}*\s+atjaunošan\p{L}*/iu, "simplified_renovation"],
	[/\batjaunošan\p{L}*/iu, "renovation"],
	[/\bnojaukšan\p{L}*/iu, "demolition"],
	[/\blietošanas\s+veida\s+maiņ\p{L}*/iu, "use_change"],
];
const GROUP = /\b([123])\.\s*grup\p{L}*/giu;
const STAGES = /(?<![\p{L}\d])(skiču\s+projekt\p{L}*|skice|minimāl\p{L}*\s+(?:sastāv\p{L}*\s+)?būvprojekt\p{L}*|būvprojekt\p{L}*\s+minimālā\s+sastāvā|MBP|būvprojekt\p{L}*\s+pilnā\s+sastāvā|tehnisk\p{L}*\s+projekt\p{L}*|BP|darba\s+(?:rasējum\p{L}*|projekt\p{L}*)|autoruzraudzīb\p{L}*)(?![\p{L}\d])/giu;
const SECTIONS = /(?<![\p{L}\d])(AR|BK|ŪK|ŪKT|AVK|EL|ELT|VS|VAS|ESS|UAS|GP|DOP|TS|TP|TA|BIM)(?![\p{L}\d])/gu;
const REQ = /(?:^|\n)\s*(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([\p{Lu}][^\n]{8,600})/gu;

export function extractPu(pages: string[]): Candidate[] {
	const out: Candidate[] = [];
	for (const { page, m } of matches(pages, ADDRESS)) out.push({ key: "profile.address", value: m[2].trim().replace(/[.;]$/, ""), page, quote: m[0].trim() });
	for (const c of extractCadastral(pages)) if (c.key === "profile.cadastralNo" || c.key === "cadastral.building") out.push(c);
	for (let i = 0; i < pages.length; i++) {
		for (const [re, v] of WORK) {
			const m = re.exec(pages[i]);
			if (m) out.push({ key: "profile.workType", value: v, page: i + 1, quote: m[0] });
		}
	}
	for (const { page, m } of matches(pages, GROUP)) out.push({ key: "profile.group", value: m[1], page, quote: m[0].trim() });
	const stages = new Map<string, { page: number; quote: string }>();
	for (const { page, m } of matches(pages, STAGES)) {
		const s = m[1].toLowerCase();
		const v = /skic|skič/.test(s) ? "SKICE" : /minimāl|mbp/.test(s) ? "MBP" : /darba/.test(s) ? "DT" : /autoruzraudz/.test(s) ? "AUTORUZRAUDZĪBA" : "BP";
		if (!stages.has(v)) stages.set(v, { page, quote: m[0] });
	}
	for (const [v, { page, quote }] of stages) out.push({ key: "profile.stagesInContract", value: v, page, quote });
	const sections = new Map<string, { page: number; quote: string }>();
	for (const { page, m } of matches(pages, SECTIONS)) if (!sections.has(m[1])) sections.set(m[1], { page, quote: m[1] });
	for (const [v, { page, quote }] of sections) out.push({ key: "profile.sections", value: v, page, quote, note: "sadaļas saīsinājums tekstā" });
	return out;
}

export interface NumberedRow {
	no: string;
	text: string;
	page: number;
	quote: string;
}

/** Numbered paragraphs ("2.1. Projektētājs …"), as written; the requirement rows of a PU, BIP or permit. */
export function numberedRows(pages: string[]): NumberedRow[] {
	const out: NumberedRow[] = [];
	for (const { page, m } of matches(pages, REQ)) out.push({ no: m[1], text: m[2].trim(), page, quote: m[0].trim() });
	return out;
}
