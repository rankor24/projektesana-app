// What the agent gathers for each group of panels, and the prompt that sends it to work.
// Panels 7–8, 5–6 and 1–4 are not forms: each one is filled by an agent run over the project folder, with every
// value tied to a quote that code checks. Boris confirms or corrects; he does not type the project in.
import { checklistFor } from "../rules/checklist.js";
import type { ScanResult } from "./scan.js";
import type { ProjectRef } from "./refs.js";

export type SectionId = "pu" | "data" | "tr" | "laws";
export const SECTION_ORDER: SectionId[] = ["pu", "data", "tr", "laws"];

/** Labels for the checklist ids and the rules-engine inputs, the way the panels show them. */
const ITEM_LABELS: Record<string, string> = Object.fromEntries(checklistFor({ work: "new_build", use: "public", publicFunded: true, floorsAbove: 7 }).map((i) => [i.id, i.label]));
export const FACT_LABELS: Record<string, string> = {
	...ITEM_LABELS,
	"engine.work": "Darba veids",
	"engine.use": "Ēkas lietojums",
	"engine.floorsAbove": "Stāvu skaits virs zemes",
	"engine.floorsBelow": "Stāvu skaits zem zemes",
	"engine.footprintM2": "Apbūves laukums, m²",
	"engine.totalAreaM2": "Kopējā platība, m²",
	"engine.fireLoadMJ": "Ugunsslodze, MJ/m²",
	"engine.seasonal": "Sezonas rakstura ēka",
	"engine.publicFunded": "Finansēts no publiskiem līdzekļiem",
	"engine.documentedGroup": "Grupa, ierakstīta dokumentos (esošai ēkai)",
};

export interface SectionDef {
	id: SectionId;
	label: string;
	tabs: string;
	/** fact ids the agent fills in this section */
	facts: string[];
	/** file roles that belong here */
	roles: string[];
	/** the job, in the agent's language */
	task: string[];
}

export const SECTIONS: Record<SectionId, SectionDef> = {
	pu: {
		id: "pu",
		label: "Projektēšanas uzdevums",
		tabs: "7",
		facts: ["engine.work", "engine.use", "engine.floorsAbove", "engine.floorsBelow", "engine.footprintM2", "engine.totalAreaM2", "engine.publicFunded", "engine.seasonal", "object", "client", "program", "rooms", "bip", "phases"],
		roles: ["PU", "BIP / BIM prasības"],
		task: [
			"Atrodi projektēšanas uzdevumu (PU) un BIP/BIM prasības. Izlasi tos pilnībā ar read_doc.",
			"engine.work vērtības: new_build, reconstruction, simple_reconstruction, renovation, simplified_renovation, use_change, demolition.",
			"engine.use vērtības: residential_1_2, residential_other, public, production, warehouse, auxiliary, agricultural, other.",
			"Skaitļus raksti kā skaitli (piem. 4 vai 1250,5), true/false — ar vārdiem true vai false. Katram — citāts no PU.",
			"Ja PU lieto citu vārdu (piem. „jaunbūve”, „pārbūve”), vērtību tomēr raksti iepriekš minētajā formā un citē PU vārdu.",
		],
	},
	data: {
		id: "data",
		label: "Izejas dati",
		tabs: "8",
		facts: ["land", "existing", "engine.documentedGroup", "engine.fireLoadMJ"],
		roles: ["Zemes dokumenti", "Topogrāfija", "Inventarizācijas lieta", "Punktu mākonis"],
		task: [
			"Atrodi zemes dokumentus, topogrāfiju un Inventarizācijas lietu (ja ēka ir).",
			"land: kadastra apzīmējums un zemes vienības platība. existing: katra esošā ēka ar kadastra apzīmējumu, stāviem un platību; ja ēku nav, ieraksti to tikai tad, ja dokumenti to tieši saka.",
			"engine.documentedGroup (1, 2 vai 3): tikai esošai ēkai, kuras grupa ir burtiski ierakstīta Inventarizācijas lietā. Citādi neraksti.",
			"engine.fireLoadMJ: tikai ražošanas vai noliktavas ēkai, ja dokumentos ir ugunsslodze.",
		],
	},
	tr: {
		id: "tr",
		label: "Tehniskie noteikumi",
		tabs: "5–6",
		facts: ["zone", "tr"],
		roles: ["Tehniskie noteikumi"],
		task: [
			"Atrodi visus failus, kas ir tehniskie noteikumi vai to pieprasījumi (vēstules, e-pasti, atbildes). Katram izsauc add_tr: who (kas izsniedz), issuer (state_municipal — pašvaldība vai būvvalde; network_owner — tīklu īpašnieks), status (pieprasīts vai saņemts), datumi no dokumenta (GGGG-MM-DD), fails un burtisks citāts.",
			"Statuss „saņemts” — fails ir pats tehnisko noteikumu dokuments. Statuss „pieprasīts” — fails ir pieprasījums vai atbilde, kas pierāda pieprasīšanu.",
			"zone: apbūves ierobežojumi un vietējie noteikumi (augstums, blīvums, atkāpes), ja kāds dokuments tos nosaka.",
			"tr: īss kopsavilkums, kuri tehniskie noteikumi ir un kuru trūkst, ar citātu no viena no dokumentiem.",
		],
	},
	laws: {
		id: "laws",
		label: "Piemērojamie noteikumi",
		tabs: "1–4",
		facts: [],
		roles: [],
		task: [
			"Šī projekta fakti ir brief. Izsauc rules_for_stage (stadija mbp), lai redzētu grupu, procedūru un obligāto saturu.",
			"Tad ar search_sources atrodi bibliotēkā pantus, kas šim projektam jāievēro (lietojums, grupa, ugunsdrošība, pieejamība, energoefektivitāte u.c.) un tos, ko min paši projekta dokumenti (saraksts zemāk). Katru atrasto pantu ieraksti ar cite_law: kategorija, avota id, burtisks panta citāts no search_sources rezultāta, un kāpēc tas attiecas uz šo projektu.",
			"Ja dokumenti min aktu, kura bibliotēkā nav — nosauc to beigās kā „nav bibliotēkā”. Neizdomā pantus.",
		],
	},
};

const RULES = [
	"Tu vāc datus no šī projekta mapes. Tu nejautā Borisam: šī nav saruna. Ko dokumentos nevar atrast, to nerakstī, bet nosauc beigās.",
	"Katru faktu ieraksti ar set_fact: id, vērtība un avots {kind:\"file\", path, quote}. Citāts ir burtisks teksts no faila (to redzi ar read_doc). Citātu pārbauda kods; izdomātu atteiks.",
	"Ja dokumentos ir pretruna (divi dažādi skaitļi), ieraksti vērtību no oficiālāka vai jaunāka dokumenta un nosauc pretrunu beigās.",
	"Tu neko neapstiprini un nenorādi „nezināms”: to dara tikai Boriss. Katrs tavs ieraksts ir priekšlikums, ko viņš pārbauda.",
	"Skenētus dokumentus bez teksta nevar nolasīt. Nosauc tos beigās, lai Boriss tos pārbauda ar aci.",
	"Beigās uzraksti latviski īsu atskaiti (līdz 12 rindām): ko ierakstīji, ko neatradi, kur ir pretrunas, kurus failus nevarēja nolasīt.",
];

export interface FactRow {
	id: string;
	label: string;
	state: "open" | "proposed" | "confirmed" | "unknown";
	value?: string;
	source?: { kind: string; path?: string; quote: string };
	by?: string;
}

export function buildGatherPrompt(p: {
	section: SectionDef;
	rows: FactRow[];
	files: { path: string; role: string | null; text: string; note?: string }[];
	refs: ProjectRef[];
	scan: ScanResult;
}): string {
	const parts: string[] = [];
	parts.push("# Noteikumi\n" + RULES.map((r) => `- ${r}`).join("\n"));
	parts.push(`# Uzdevums: ${p.section.label}\n` + p.section.task.map((t) => `- ${t}`).join("\n"));
	if (p.rows.length) {
		parts.push(
			"# Aizpildāmie punkti\n" +
				p.rows
					.map((r) => `- ${r.id}: ${r.label} — ${r.state === "open" ? "tukšs" : r.state === "proposed" ? `jau ir priekšlikums: ${r.value}` : r.state === "confirmed" ? `Boriss apstiprinājis: ${r.value} (nemaini)` : "Boriss norādījis, ka nezina (nemaini)"}`)
					.join("\n"),
		);
	}
	if (p.section.id === "laws") parts.push("# Projekta dokumenti min\n" + (p.refs.length ? p.refs.map((r) => `- ${r.ref} (${r.path})`).join("\n") : "nekas netika atrasts"));
	const unreadable = p.files.filter((f) => f.text !== "ok");
	parts.push(
		`# Projekta faili (${p.files.length}; pārskatīti ${p.scan.at.slice(0, 10)})\n` +
			p.files.map((f) => `- ${f.path} [${f.role ?? "bez lomas"}]${f.text === "ok" ? "" : ` — ${f.note ?? f.text}`}`).join("\n") +
			(unreadable.length ? `\n\nNenolasāmi: ${unreadable.length}.` : ""),
	);
	return parts.join("\n\n");
}
