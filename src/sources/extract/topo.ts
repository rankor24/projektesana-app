// Topography (1.1.6): who made it, when it was surveyed, when it was approved / registered in the municipality.
// Validity is not computed here: the term comes from the permit's own conditions or the municipality, so it is a
// requirement with its own citation, not a guess.
import { DATE_RE, isoDate, matches, type Candidate } from "./common.js";

const AUTHOR = /(izpildītājs|izstrādāja|sagatavoja|mērnieks|uzmērīja|sertificēts\s+mērnieks)\s*[:\-–]\s*([^\n]{3,120})/giu;
const SURVEYED = new RegExp(`(uzmērīšanas\\s+datums|uzmērīts|uzmērījuma\\s+datums|mērījumi\\s+veikti)\\s*[:\\-–]?\\s*(${DATE_RE.source})`, "giu");
const APPROVED = new RegExp(`(saskaņots|reģistrēts|akceptēts|pieņemts)\\p{L}*[^\\n\\d]{0,60}?(${DATE_RE.source})`, "giu");

export function extractTopo(pages: string[]): Candidate[] {
	const out: Candidate[] = [];
	for (const { page, m } of matches(pages, AUTHOR)) out.push({ key: "topo.author", value: m[2].trim(), page, quote: m[0].trim() });
	for (const { page, m } of matches(pages, SURVEYED)) {
		const iso = isoDate(new RegExp(DATE_RE.source, "u").exec(m[2])!);
		if (iso) out.push({ key: "topo.surveyedOn", value: iso, page, quote: m[0].trim() });
	}
	for (const { page, m } of matches(pages, APPROVED)) {
		const iso = isoDate(new RegExp(DATE_RE.source, "u").exec(m[2])!);
		if (iso) out.push({ key: "topo.approvedOn", value: iso, page, quote: m[0].trim() });
	}
	return out;
}
