// Property documents (Kadastrālā / Inventarizācijas lieta, zemesgrāmata, robežu plāns): kadastra apzīmējums, kadastra
// numurs, area, owner. Latvian designations: land unit 11 digits (0000 000 0000), building 14 (… 000), premises group 17.
import { lineAt, matches, num, type Candidate } from "./common.js";

const DESIGNATION = /kadastra\s+(apzīmējum\p{L}*|numur\p{L}*)\s*[:\-–]?\s*((?:\d{4}\s?\d{3}\s?\d{4})(?:\s?\d{3}){0,2})/giu;
const AREA = /(kopējā\s+platība|kopplatība|apbūves\s+laukums|zemes\s+vienības\s+platība|platība)\s*[:\-–]?\s*(\d[\d\s]*(?:[,.]\d+)?)\s*(m2|m²|kv\.\s*m|ha)/giu;
const OWNER = /(īpašnieks|īpašnieki|tiesiskais\s+valdītājs)\s*[:\-–]\s*([^\n]{3,120})/giu;

export function extractCadastral(pages: string[]): Candidate[] {
	const out: Candidate[] = [];
	const seen = new Set<string>();
	const add = (c: Candidate) => {
		const k = `${c.key}|${c.value}`;
		if (!seen.has(k)) (seen.add(k), out.push(c));
	};
	for (const { page, m } of matches(pages, DESIGNATION)) {
		const digits = m[2].replace(/\s/g, "");
		const kind = /numur/i.test(m[1]) ? "kadastra numurs" : digits.length === 11 ? "zemes vienība" : digits.length === 14 ? "būve" : digits.length === 17 ? "telpu grupa" : "apzīmējums";
		const formatted = digits.replace(/^(\d{4})(\d{3})(\d{4})(\d{3})?(\d{3})?$/, (_, a, b, c, d, e) => [a, b, c, d, e].filter(Boolean).join(" "));
		add({ key: digits.length === 14 ? "cadastral.building" : "profile.cadastralNo", value: formatted, page, quote: m[0].trim(), note: kind });
	}
	for (const { page, m } of matches(pages, AREA)) {
		const v = num(m[2]);
		if (v === null) continue;
		const which = m[1].toLowerCase().replace(/\s+/g, " ");
		const key = which.startsWith("apbūves") ? "cadastral.footprintM2" : which.startsWith("zemes") || m[3] === "ha" ? "cadastral.landArea" : "profile.totalAreaM2";
		add({ key, value: m[3] === "ha" ? `${v} ha` : String(v), page, quote: m[0].trim(), note: lineAt(pages[page - 1], m.index) });
	}
	for (const { page, m } of matches(pages, OWNER)) add({ key: "cadastral.owner", value: m[2].trim(), page, quote: m[0].trim() });
	return out;
}
