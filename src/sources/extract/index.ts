// Which extractor reads which role. A role without an extractor gives no candidates; the agent still reads the text.
import type { Candidate } from "./common.js";
import { extractCadastral } from "./cadastral.js";
import { extractPu } from "./pu.js";
import { extractTaa } from "./taa.js";
import { extractTn } from "./tn.js";
import { extractTopo } from "./topo.js";

export const EXTRACTORS: Record<string, (pages: string[]) => Candidate[]> = {
	PU: extractPu,
	Iepirkums: extractPu,
	"Īpašuma dokumenti": extractCadastral,
	Topogrāfija: extractTopo,
	TAA: extractTaa,
	"Tehniskie noteikumi": extractTn,
};

/** What the agent should look for in a source of this role (the extraction prompt per role). */
export const EXTRACTION_PROMPT: Record<string, string> = {
	PU: "Profila fakti (adrese, kadastra apzīmējums, būvniecības veids, lietošanas veids, ēkas grupa, līgumā ietvertās stadijas, sadaļas, finansējums, BIM prasības) un numurētās prasības.",
	Iepirkums: "Tehniskā specifikācija: tie paši profila fakti kā PU, BIM prasības (LOD pa stadijām, BIP), termiņi.",
	"Īpašuma dokumenti": "Kadastra apzīmējums (zeme 11 cipari, būve 14), kopējā platība, apbūves laukums, īpašnieks; inventarizācijas lietā — telpu tabula.",
	Topogrāfija: "Izpildītājs (mērnieks), uzmērīšanas datums, saskaņošanas / reģistrācijas datums.",
	TAA: "Atzinums par katru konstruktīvo elementu: elements, tehniskais stāvoklis, defekti; kopējais stāvoklis.",
	"Tehniskie noteikumi": "Izdevējs, numurs, datums, derīguma termiņš, numurētie nosacījumi.",
};

export function extractFor(role: string, pages: string[]): Candidate[] {
	return EXTRACTORS[role]?.(pages) ?? [];
}
