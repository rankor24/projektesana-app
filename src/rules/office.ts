// Office rules: from the BŪVDIZAINS project folder standard. The standard is company-internal, so its text is never
// shipped in this (public) repository: Boris sets the path of the PDF in Iestatījumi, the app reads it at run time, and
// each rule finds its verbatim quote in that text by a start and an end phrase. Without the file, no office requirement
// is created and the checks say so; nothing is quoted from memory.
import type { Requirement } from "../core/model.js";

export interface OfficeRule {
	id: string;
	text: string;
	/** the quote is the text from the first occurrence of `start` through the next `end` (whitespace normalised) */
	start: RegExp;
	end: RegExp;
	deliveries?: string[];
	checkId: string;
}

export const OFFICE_RULES: OfficeRule[] = [
	{ id: "office:delivery-date", text: "Nodevuma mape nosaukta ar datumu formātā gads-mēnesis-diena (YYMMDD)", start: /Pie\s+nodevuma\s+jābūt\s+datumam/i, end: /\./, checkId: "filenames" },
	{ id: "office:sheet-filenames", text: "Nodevuma failu nosaukums: rasējuma numurs_nosaukums", start: /Katrā\s+mapē\s+failu\s+nosaukumus\s+veidojam/i, end: /\(Rasējuma\s+numurs_nosaukums\)/i, checkId: "filenames" },
	{ id: "office:no-diacritics", text: "Mapju un failu nosaukumos nelieto garumzīmes un mīkstinājuma zīmes", start: /VEIDOJOT\s+MAPJU\s+UN\s+FAILU\s+NOSAUKUMUS/i, end: /MĪKSTINĀJUMA\s+ZĪMES/i, checkId: "filenames" },
];

/** Finds a rule's quote in the standard's pages: page number and the verbatim text (whitespace normalised). */
export function findOfficeQuote(pages: string[], rule: Pick<OfficeRule, "start" | "end">): { page: number; quote: string } | null {
	for (let i = 0; i < pages.length; i++) {
		const t = pages[i].replace(/\s+/g, " ");
		const s = rule.start.exec(t);
		if (!s) continue;
		const rest = t.slice(s.index + s[0].length);
		const e = rule.end.exec(rest);
		if (!e) continue;
		return { page: i + 1, quote: t.slice(s.index, s.index + s[0].length + e.index + e[0].length).trim() };
	}
	return null;
}

export function officeRequirements(file: string, pages: string[], now = new Date()): { rows: Requirement[]; missing: string[] } {
	const rows: Requirement[] = [];
	const missing: string[] = [];
	for (const r of OFFICE_RULES) {
		const q = findOfficeQuote(pages, r);
		if (!q) {
			missing.push(r.id);
			continue;
		}
		rows.push({ id: r.id, origin: "office", citation: { kind: "office", file, page: q.page, quote: q.quote }, text: r.text, appliesTo: { deliveries: r.deliveries }, checkId: r.checkId, status: "open", evidence: [], state: "confirmed", by: "app", at: now.toISOString() });
	}
	return { rows, missing };
}
