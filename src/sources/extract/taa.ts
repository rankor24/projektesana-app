// Technical inspection opinion (TAA, tehniskās apsekošanas atzinums): one finding per building element with its condition.
// Latvian practice (LBN 405-21) grades conditions: labs / apmierinošs / neapmierinošs / avārijas (or 1–4 / I–IV);
// the extractor takes the words as written, never maps them.
import { matches, type Candidate } from "./common.js";

const ELEMENTS = "pamati|pamatne|cokols|ārsienas|sienas|nesošās\\s+sienas|starpsienas|pārsegum\\p{L}*|jumt\\p{L}*|jumta\\s+konstrukcija|jumta\\s+segums|kāpnes|logi|durvis|grīdas|fasāde|balkoni|skursteņi|dūmvadi|inženiertīkli|ūdensapgāde|kanalizācija|apkure|ventilācija|elektroapgāde|lietus\\s+ūdens\\s+sistēma|notekcaurules|bēniņi|pagrabs";
const ROW = new RegExp(`(?:^|\\n)\\s*(?:\\d+(?:\\.\\d+)*\\.?\\s+)?(${ELEMENTS})\\s*[:\\-–—]\\s*([^\\n]*?(?<![\\p{L}])(labs|laba|apmierinošs|apmierinošā|apmierinoša|neapmierinošs|neapmierinošā|neapmierinoša|avārijas|avārijā)(?![\\p{L}])[^\\n]*)`, "giu");
const TOTAL = /(?:ēkas|būves)\s+(?:kopējais\s+)?tehniskais\s+stāvoklis\s*[:\-–—]?\s*([^\n]{3,80})/giu;

export function extractTaa(pages: string[]): Candidate[] {
	const out: Candidate[] = [];
	for (const { page, m } of matches(pages, ROW)) {
		const element = m[1].trim();
		out.push({ key: `taa.element.${element.toLowerCase().replace(/\s+/g, "_")}`, value: m[3].toLowerCase(), page, quote: m[0].trim(), note: m[2].trim() });
	}
	for (const { page, m } of matches(pages, TOTAL)) out.push({ key: "taa.overall", value: m[1].trim().replace(/[.;]$/, ""), page, quote: m[0].trim() });
	return out;
}
