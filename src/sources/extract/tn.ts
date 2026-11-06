// Technical conditions (tehniskie noteikumi) from a network holder or the municipality: issuer, number, date, validity,
// numbered conditions. The conditions become requirement candidates (origin tn) in task 2.2.
import { DATE_RE, firstDate, isoDate, matches, type Candidate } from "./common.js";

const ISSUER = /\b((?:SIA|AS|VAS|A\/S|PAS)\s+[„"“]?[^\n„"”“]{2,60}[”"]?|[\p{Lu}][\p{L}]+\s+(?:pilsētas|novada)\s+(?:dome|pašvaldība|būvvalde)\p{L}*|[\p{Lu}][\p{L}]+\s+(?:valstspilsētas|novada)\s+pašvaldība)/u;
const NUMBER = /tehnisk\p{L}*\s+noteikum\p{L}*[^\n]{0,40}?\bNr\.\s*([A-Za-z0-9][A-Za-z0-9\-\/.]*[A-Za-z0-9])/giu;
const VALID = new RegExp(`(derīg\\p{L}*|spēkā)[^\\n]{0,30}?(?:līdz\\s+)?(${DATE_RE.source}|\\d+\\s+(?:gad\\p{L}*|mēneš\\p{L}*))`, "giu");
const CONDITION = /(?:^|\n)\s*(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+([\p{Lu}][^\n]{10,400})/gu;

export function extractTn(pages: string[]): Candidate[] {
	const out: Candidate[] = [];
	const head = pages[0] ?? "";
	const issuer = ISSUER.exec(head);
	if (issuer) out.push({ key: "tn.issuer", value: issuer[1].trim(), page: 1, quote: issuer[0].trim() });
	for (const { page, m } of matches(pages, NUMBER)) {
		out.push({ key: "tn.number", value: m[1], page, quote: m[0].trim() });
		break;
	}
	const d = firstDate(head);
	if (d) out.push({ key: "tn.date", value: d.iso, page: 1, quote: d.raw });
	for (const { page, m } of matches(pages, VALID)) {
		const dm = new RegExp(DATE_RE.source, "u").exec(m[2]);
		out.push({ key: "tn.validUntil", value: dm ? (isoDate(dm) ?? m[2]) : m[2].trim(), page, quote: m[0].trim(), note: dm ? "datums" : "termiņš no izsniegšanas" });
		break;
	}
	for (const { page, m } of matches(pages, CONDITION)) out.push({ key: `tn.condition.${m[1]}`, value: m[2].trim(), page, quote: m[0].trim() });
	return out;
}
