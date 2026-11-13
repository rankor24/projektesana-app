// Reading an expert review (task 8.14; ported from BIM Crew core/expert_review.py): the remarks of an ekspertīzes atzinums, each with
// its verbatim words, its page, the part (daļa) it is about and the responsible person when the text names one.
// Three layouts are read — the markdown checklist the reviewers of BIM Crew use ("- [ ] **A1** ⚠ — …"), numbered remarks under a
// heading that names a daļa, and a Check | Result | Comment table — and a remark the code cannot place stays out rather than guessed:
// the agent adds those with `expert_add`, whose quote is checked against the page like a fact's. Pure: pages in, remarks out.
import { DISCIPLINE_MARKAS } from "../../shared/rename.js";
import type { ParsedRemark, ParsedReview, ReviewMeta } from "../../shared/expert-types.js";

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

// ---- the part (daļa) ---------------------------------------------------------------------------------------------------------

/** Marks that are also ordinary words or abbreviations in a heading, so a bare token is not trusted. */
const AMBIGUOUS = new Set(["IN", "DA", "DN", "UR", "BA", "GA", "IE", "DT", "SM"]);

const STEMS: [RegExp, string][] = [
	[/arhitektūr/i, "AR"],
	[/būvkonstrukc|konstrukciju daļ|dzelzsbetona/i, "BK"],
	[/ventilācij|apkur|siltumapgād|gaisa kondicion|aukstumapgād/i, "AVK"],
	[/elektroapgād|elektroiek|apgaismoj|spēka strāv/i, "EL"],
	[/ūdensapgād|kanalizāc|ūdensvad|lietus ūden/i, "UK"],
	[/sakaru|vājstrāv|ugunsdrošības signalizāc|videonovēr/i, "ESS"],
	[/ģenerālplān|teritorijas labiekārt|vertikālā plānošan/i, "GP"],
];

/** The daļa a heading or a remark names: an office mark as a word of its own (AR, AVK-A, UK-K), else a word stem. */
export function daļaOf(text: string, opts: { stems?: boolean; tokens?: boolean } = { stems: true, tokens: true }): string | null {
	if (opts.tokens !== false) {
		for (const m of text.matchAll(/(?<![\p{L}\d-])((?:AVK|UK|TS|ESS|ARD)-[A-Z]{1,3}|[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,5})(?![\p{L}\d-])/gu)) {
			const t = m[1];
			if (DISCIPLINE_MARKAS.has(t) && !AMBIGUOUS.has(t)) return t;
		}
	}
	if (opts.stems !== false) for (const [re, d] of STEMS) if (re.test(text)) return d;
	return null;
}

// ---- cues --------------------------------------------------------------------------------------------------------------------

const NEGATIVE = /(?:\bnav\b|\bnenorād|netiek|trūkst|neatbilst|neizpild|nepietiek|jālabo|jāpievieno|jānovērš|jāprecizē|jāuzrāda|jāiesniedz|jānodrošina|jāatsaka|jāizstrādā|nepieciešam|nepareiz|kļūd|pretrun|nav pieļaujam|not\s+(?:checked|passed|confirmed|submitted|complete)|missing|rejected|\bneed\b|\bshould\b)/i;
const POSITIVE = /^(?:confirmed|approved|submitted|yes|ok|passed|jā|atbilst|apstiprināts|saskaņots|izpildīts)[.\s]*$/i;
const CRITICAL = /⚠|kritisk|būtisk[aiu]\w* (?:trūkum|pārkāpum|neatbilstīb)|nav pieļaujam|not passed|rejected|noraid/i;
const RESPONSIBLE = /(?:atbildīg\w+(?:\s+persona)?|izpildītājs|adresāts)\s*[:–-]\s*([^;.|\n]{3,60}?)(?=\s*(?:[;.|]|$|\n))/i;

const responsibleOf = (s: string) => RESPONSIBLE.exec(s)?.[1].trim() ?? null;

// ---- lines -------------------------------------------------------------------------------------------------------------------

const CHECKLIST = /^\s*[-*]\s+\[(?<st>[xX ])\]\s+(?:\*\*(?<code>[A-ZĀČĒĢĪĶĻŅŠŪŽ]?\d+(?:\.\d+)*)\*\*\s*)?(?<crit>⚠️?\s*)?(?:[—–:-]\s*)?(?<text>\S.*)$/;
const MD_HEADING = /^\s*#{1,4}\s+(?<t>.+?)\s*#*\s*$/;
const NUMBERED = /^\s*(?:(?:Piezīme|Komentārs|Pretenzija|Iebilde|Trūkums|Nr\.?)\s*)?(?<code>\d{1,3}(?:\.\d{1,3}){0,2}|[A-Z]\d{1,2}(?:\.\d{1,2})?)[.):]\s+(?<text>\S.*)$/;
const TOC_LINE = /\.{3,}\s*\d+\s*$/;

/** A line that opens a section: a markdown heading, or a short line without sentence punctuation that names a daļa. */
function headingOf(line: string): string | null {
	const md = MD_HEADING.exec(line);
	if (md) return md.groups!.t.replace(/^[A-Z]\.\s+/, "").trim();
	const t = squash(line);
	if (!t || t.length > 80 || /[.;,:]$/.test(t) || TOC_LINE.test(t)) return null;
	if (/\b(daļa|daļas|sadaļa|sadaļas|sekcija)\b/i.test(t)) return t;
	if (/^[A-ZĀČĒĢĪĶĻŅŠŪŽ0-9 .\-–/]{4,}$/.test(t) && /[A-ZĀČĒĢĪĶĻŅŠŪŽ]{3}/.test(t)) return t;
	const first = /^(?:\d+\.\s*)?((?:AVK|UK|TS|ESS|ARD)-[A-Z]{1,3}|[A-Z]{2,5})(?:\s*[-–:]\s*\S.*)?$/.exec(t);
	if (first && DISCIPLINE_MARKAS.has(first[1])) return t;
	return null;
}

// ---- tables ------------------------------------------------------------------------------------------------------------------

const cellsOf = (line: string): string[] | null => {
	if (line.includes("\t")) return line.split("\t").map(squash);
	if (line.includes("|")) return line.replace(/^\s*\||\|\s*$/g, "").split("|").map(squash);
	return null;
};
const isSeparator = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");

interface TableCols {
	check: number;
	result: number;
	comment: number | null;
}

function tableHeader(cells: string[]): TableCols | null {
	const idx = (re: RegExp) => cells.findIndex((c) => re.test(c));
	const check = idx(/check|pārbaude|sadaļa|jautājums|prasība|punkts/i);
	const result = idx(/result|rezultāt|statuss|atzinum|vērtējum/i);
	if (check < 0 || result < 0 || check === result) return null;
	const comment = idx(/comment|komentār|piezīm|atbilde|reply/i);
	return { check, result, comment: comment >= 0 && comment !== check && comment !== result ? comment : null };
}

// ---- the review --------------------------------------------------------------------------------------------------------------

function metaOf(pages: string[]): ReviewMeta {
	const meta: ReviewMeta = {};
	const head = (pages[0] ?? "").split(/\r?\n/).slice(0, 14).map((l) => l.replace(/\*\*/g, "").trim());
	for (const l of head) {
		const a = /^(?:Auditors|Auditori|Eksperts|Ekspertu komisija|Ekspertīzes veicējs)\s*[:\s]\s*(.+?)(?:\s*\||$)/i.exec(l);
		if (a && !meta.auditor) meta.auditor = a[1].trim();
		const p = /^Projekts\s*[:\s]\s*(.+)$/i.exec(l);
		if (p && !meta.project) meta.project = p[1].trim();
	}
	return meta;
}

export function parseExpertReview(pages: string[]): ParsedReview {
	const remarks: ParsedRemark[] = [];
	const seen = new Set<string>();
	let section: string | null = null;
	let sectionDaļa: string | null = null;
	let cols: TableCols | null = null;
	let open: { page: number; code: string | null; parts: string[]; section: string | null; daļa: string | null; done: boolean; critical: boolean } | null = null;

	const add = (r: Omit<ParsedRemark, "quote" | "critical" | "responsible"> & { quote: string; critical?: boolean }) => {
		const quote = squash(r.quote);
		if (quote.length < 8) return;
		const key = `${r.page}|${quote.toLowerCase()}`;
		if (seen.has(key)) return;
		seen.add(key);
		remarks.push({ ...r, quote, critical: r.critical ?? CRITICAL.test(quote), responsible: responsibleOf(quote) });
	};
	const flush = () => {
		if (!open) return;
		const quote = open.parts.join(" ");
		add({ page: open.page, code: open.code, daļa: open.daļa ?? daļaOf(quote, { stems: true, tokens: false }), section: open.section, quote, critical: open.critical || CRITICAL.test(quote), done: open.done, reply: null });
		open = null;
	};

	pages.forEach((text, pi) => {
		const page = pi + 1;
		for (const raw of text.split(/\r?\n/)) {
			const line = raw.replace(/\s+$/, "");
			if (!line.trim()) {
				flush();
				continue;
			}
			// table rows
			const cells = cellsOf(line);
			if (cells && cells.length >= 2) {
				flush();
				if (isSeparator(cells)) continue;
				const h = tableHeader(cells);
				if (h) {
					cols = h;
					continue;
				}
				if (cols) {
					const check = cells[cols.check] ?? "";
					const result = cells[cols.result] ?? "";
					if (!result || POSITIVE.test(result) || !NEGATIVE.test(result)) continue;
					const comment = cols.comment !== null ? cells[cols.comment] ?? "" : "";
					add({ page, code: null, daļa: daļaOf(check) ?? daļaOf(result) ?? sectionDaļa, section: check || section, quote: result, done: false, reply: comment || null });
					continue;
				}
			} else cols = null;

			const cl = CHECKLIST.exec(line);
			if (cl) {
				flush();
				const g = cl.groups!;
				add({ page, code: g.code ?? null, daļa: sectionDaļa ?? daļaOf(g.text, { stems: true, tokens: false }), section, quote: g.text, critical: !!g.crit || CRITICAL.test(g.text), done: g.st.toLowerCase() === "x", reply: null });
				continue;
			}
			const nm = NUMBERED.exec(line);
			if (nm && nm.groups!.text.length >= 25 && !/:$/.test(nm.groups!.text) && !TOC_LINE.test(line) && (sectionDaļa || NEGATIVE.test(nm.groups!.text))) {
				flush();
				open = { page, code: nm.groups!.code, parts: [squash(nm.groups!.text)], section, daļa: sectionDaļa, done: false, critical: CRITICAL.test(nm.groups!.text) };
				continue;
			}
			const head = headingOf(line);
			if (head) {
				flush();
				section = head;
				sectionDaļa = daļaOf(head);
				continue;
			}
			if (open && open.parts.join(" ").length < 800) open.parts.push(squash(line));
		}
		// a remark ends with its page: its quote must be found on the one page it is filed under
		flush();
	});
	flush();
	return { remarks, meta: metaOf(pages) };
}
