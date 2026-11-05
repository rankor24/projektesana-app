// Setup checklist (spec §7): the setup is complete when every item is filled with a source or marked unknown by Boris.
import type { Facts } from "./engine.js";
import { bimModelRequired, procedureOf } from "./engine.js";

export interface ChecklistItem {
	id: string;
	label: string;
	/** where the answer normally comes from */
	hint: string;
	required: boolean;
}

export function checklistFor(f: Partial<Facts> & Pick<Facts, "work" | "use">): ChecklistItem[] {
	const full = f as Facts;
	const proc = procedureOf(full).value;
	const items: ChecklistItem[] = [
		{ id: "object", label: "Objekta nosaukums un adrese", hint: "PU", required: true },
		{ id: "client", label: "Pasūtītājs / būvniecības ierosinātājs", hint: "PU", required: true },
		{ id: "land", label: "Zemes vienība: kadastra numurs un platība", hint: "zemes dokumenti", required: true },
		{ id: "existing", label: "Esošās ēkas uz zemes vienības", hint: "Inventarizācijas lieta, topogrāfija", required: true },
		{ id: "group", label: "Būves grupa", hint: "jaunbūvei — no plānotās ēkas; esošai — Inventarizācijas lieta", required: true },
		{ id: "procedure", label: "Procedūra un stadija", hint: "MK 529 7. punkts; PU (MK 500 18.3)", required: true },
		{ id: "sections", label: "Nepieciešamās sadaļas (markas)", hint: "noteikumu modulis", required: true },
		{ id: "program", label: "Planētais lietojums, stāvi un platība", hint: "PU", required: true },
		{ id: "zone", label: "Apbūves ierobežojumi un vietējie noteikumi (augstums, blīvums, atkāpes)", hint: "teritorijas plānojums, TIAN", required: true },
		{ id: "tr", label: "Tehniskie noteikumi: pieprasīti / saņemti", hint: "tīklu īpašnieki, pašvaldība (MK 500 27. p.)", required: true },
		{ id: "rooms", label: "Telpu programma", hint: "PU vai Boriss (aģents piedāvā, Boriss labo)", required: f.work === "new_build" },
		{ id: "bip", label: "BIP / BIM prasības un mapju struktūra", hint: "pasūtītāja BIP", required: true },
		{ id: "revit", label: "Revit veidne un versija", hint: "Boriss", required: true },
	];
	if (proc === "mbp_buvatlauja") items.push({ id: "phases", label: "Sadalījums būves kārtās (ja paredzēts)", hint: "MK 529 26.3.", required: false });
	if (bimModelRequired(full)) items.push({ id: "bim", label: "Būves informācijas modelis BIS atvērtā formātā", hint: "MK 529 74.1", required: true });
	return items;
}
