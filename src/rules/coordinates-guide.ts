// The shared-coordinates guide (task 8.10): the steps for setting a Revit model's shared coordinates so that it meets the
// project's coordination reference (8.9), worded for this project: the base point and storey heights from the reference, the
// topography the coordinates come from (its author and dates when those facts are confirmed), the IFC export setting, and — at
// the end — what the coordination audit currently finds, so the person knows where to start. Ported from BIM Crew
// core/coordinates_guide.py (the same sections: data, Revit steps, IFC export, common problems), with the reference as input
// instead of a hand-written YAML, and the Global-Z mechanism of the revit-shared-coordinates-z skill written in.
import { formatCoordinate, schemeFor } from "../core/coordination.js";
import type { CoordReference } from "../core/coordination-types.js";
import type { ProjectStore } from "../core/store.js";

export interface GuideInput {
	project: { id: string; name: string };
	reference: CoordReference;
	/** the topography the coordinates come from: the sources with that role, and the confirmed facts about the survey */
	topo: { sources: string[]; author?: string; surveyedOn?: string; approvedOn?: string };
	/** the open remarks of the coordination check about placement (its findings' messages), to say where to start; null = the check has not run */
	remarks: string[] | null;
	date: string;
}

export interface GuideStep {
	id: string;
	title: string;
	lines: string[];
}

const mm = (v: string) => (v.trim() ? `${formatCoordinate(v, " ")} mm` : "nav norādīts");

/** The steps, in the order they are done. */
export function guideSteps(i: GuideInput): GuideStep[] {
	const r = i.reference;
	const bp = r.basePoint;
	const known = !!(bp.x && bp.y && bp.z);
	const levels = schemeFor(r, "").storeys;
	const topo = i.topo;
	const survey = [topo.author ? `uzmērīja ${topo.author}` : "", topo.surveyedOn ? `uzmērīts ${topo.surveyedOn}` : "", topo.approvedOn ? `saskaņots ${topo.approvedOn}` : ""].filter(Boolean).join(", ");
	return [
		{
			id: "units",
			title: "Vienību pārbaude",
			lines: ["Manage → Project Units: Length = Millimeters, Angle = Decimal degrees.", "Koordinātes zemāk ir milimetros, tādas, kādas tās ir IFC failā."],
		},
		{
			id: "topo",
			title: "Topogrāfija kā koordinātu avots",
			lines: topo.sources.length
				? [`Koordinātes jāņem no: ${topo.sources.join("; ")}${survey ? ` (${survey})` : ""}.`, "Ja topogrāfija ir ielinkota (DWG vai RVT): Manage → Coordinates → Acquire Coordinates un norādi to.", "Ja nav ielinkota: lieto nākamo soli un ieraksti vērtības rokām."]
				: ["Projektā nav avota ar lomu «Topogrāfija» (1.1.6), tāpēc nav ko pārbaudīt pret uzmērījumu: koordinātes ņemtas no atsauces zemāk. Pievieno topogrāfiju vai pārliecinies par vērtībām pie pasūtītāja."],
		},
		{
			id: "point",
			title: "Koordinātes uz bāzes punkta",
			lines: known
				? ["Manage → Coordinates → Specify Coordinates at Point, norādi Survey Point un ieraksti:", `E/W = ${mm(bp.x)}`, `N/S = ${mm(bp.y)}`, `Elevation = ${mm(bp.z)}`, "Project Base Point pozīciju tieši nemaini (tā kniede neko neatrisina): koordinātes iestata caur Shared Coordinates."]
				: ["Atsaucei pamatpunkts nav norādīts (Prasības → Koordinācija). Vispirms vienojies par to, tad turpini."],
		},
		{
			id: "z",
			title: "Augstums: kāpēc IFC Global Z var būt 0",
			lines: [
				"IFC Global Z nāk no kopīgā augstuma (shared elevation) modeļa iekšējā sākumpunktā, nevis no tā, kur atrodas Project Base Point.",
				`Mērķa stāvoklis: iekšējais sākumpunkts = Project Base Point = 1. stāvs; shared Elev tur = ${bp.z ? mm(bp.z) : "H"}; stāvu atzīmes rāda to pašu, ko agrāk (acceptance: stāvu vērtības nemainās).`,
				"Ja Global Z eksportā ir 0, bet citu daļu modeļi ir pareizi, modeli nepārvieto ar roku: lieto prasmi revit-shared-coordinates-z (vispirms read_coordinates, rezerves kopija, viens izsaukums — viena izmaiņa).",
			],
		},
		{
			id: "north",
			title: "True North",
			lines: ["Ja topogrāfijā ir ziemeļu leņķis, Manage → Position → Rotate True North un ieraksti to; ja nav, True North sakrīt ar Project North.", "Leņķis atsaucē nav glabāts: ņem to no topogrāfijas."],
		},
		{
			id: "levels",
			title: "Stāvi",
			lines: levels.length ? ["Stāvu nosaukumiem un augstumiem jāsakrīt ar atsauci (Prasības → Koordinācija):", ...levels.map((n) => `${n}${r.storeySchemes[0].elevations?.[n] ? `: ${mm(r.storeySchemes[0].elevations![n])}` : ""}`)] : ["Stāvu saraksts atsaucē ir tukšs."],
		},
		{
			id: "cube",
			title: "Koordinācijas kubs",
			lines: [`Novieto ${r.cubeNames[0] ?? "kubu"} uz bāzes punkta${known ? ` (${mm(bp.x)}, ${mm(bp.y)}, ${mm(bp.z)})` : ""}. Pielaide ${r.tolerance} mm; vienam modelim viens kubs.`],
		},
		{
			id: "ifc",
			title: "IFC eksports",
			lines: ["File → Export → IFC: Site Placement = Shared Coordinates; Project Address aizpildīta.", `Nosaukumi: IfcProject «${r.hierarchy.project || "—"}», IfcSite «${r.hierarchy.site || "—"}», IfcBuilding «${r.hierarchy.building || "—"}»${r.hierarchy.schema ? `, shēma ${r.hierarchy.schema}` : ""}.`, "Pārējie eksporta iestatījumi pēc biroja standarta (prasme revit-ifc-export-classes)."],
		},
		{
			id: "check",
			title: "Pārbaude",
			lines: ["Eksportē IFC un atver Prasības → Koordinācija: kubam, IfcSite un IfcBuilding jāsakrīt ar atsauci, un pie modeļa nedrīkst būt rindu grupā «Novietne»."],
		},
	];
}

const PROBLEMS: [string, string][] = [
	["Modelis ir tālu no centra", "Pārbaudi, vai Base Point nav nejauši pārvietots ar izslēgtu kniedi."],
	["Koordinātes nesakrīt ar citām daļām", "Visām daļām jālieto Shared Coordinates, nevis Internal Origin."],
	["IFC eksportā modelis ir nobīdīts", "Pārbaudi eksporta iestatījumu Site Placement: jābūt Shared Coordinates."],
	["Linkotais modelis ir citā vietā", "Linkojot lieto Shared Coordinates novietojumu, nevis Origin to Origin."],
	["IFC Global Z = 0", "Skaties soli «Augstums»: tas ir shared elevation iekšējā sākumpunktā."],
];

export function coordinatesGuide(i: GuideInput): string {
	const out: string[] = [`# Koplietotās koordinātes — ${i.project.id} ${i.project.name}`, "", `Datums: ${i.date}. Atsauce: ${i.reference.seededFrom ?? "ievadīta rokām"}${i.reference.updatedAt ? ` (${i.reference.updatedAt.slice(0, 10)})` : ""}. Pielaide ${i.reference.tolerance} mm.`, ""];
	const bp = i.reference.basePoint;
	out.push("## Dati", "", "| Parametrs | Vērtība |", "|---|---|", `| E/W | ${mm(bp.x)} |`, `| N/S | ${mm(bp.y)} |`, `| Augstums (Z) | ${mm(bp.z)} |`, "");
	out.push("## Soļi", "");
	guideSteps(i).forEach((s, k) => out.push(`### ${k + 1}. ${s.title}`, "", ...s.lines.map((l) => `- ${l}`), ""));
	out.push("## Kur sākt", "");
	if (i.remarks === null) out.push("Koordinācijas pārbaude vēl nav palaista: Prasības → Koordinācija.");
	else if (!i.remarks.length) out.push("Nevienam modelim nav atvērtu piezīmju par novietojumu.");
	else out.push(...i.remarks.map((r) => `- ${r}`));
	out.push("", "## Bieži sastopamas problēmas", "", "| Problēma | Risinājums |", "|---|---|", ...PROBLEMS.map(([a, b]) => `| ${a} | ${b} |`), "", "*Koordinātes pārbaudāmas pret topogrāfisko uzmērījumu.*");
	return out.join("\n");
}

/** The guide's input from a project's own data: the reference, the topography sources and confirmed survey facts, the open remarks. */
export function guideInput(store: ProjectStore, date: string): GuideInput | null {
	const reference = store.readMeta<CoordReference | null>("coordination", null);
	if (!reference) return null;
	const confirmed = (k: string) => store.read("facts").find((f) => f.key === k && f.state === "confirmed")?.value;
	const findings = store.read("findings").filter((f) => f.checkId === "coordination");
	const ran = findings.length > 0 || store.events().some((e) => e.kind === "checks.ran" && (e.data?.ran as string[] | undefined)?.includes("coordination"));
	return {
		project: { id: store.project.id, name: store.project.name },
		reference,
		topo: { sources: store.read("sources").filter((s) => s.role === "Topogrāfija").map((s) => s.title), author: confirmed("topo.author"), surveyedOn: confirmed("topo.surveyedOn"), approvedOn: confirmed("topo.approvedOn") },
		remarks: ran ? findings.filter((f) => f.state === "open" && f.message.includes("(Novietne)")).map((f) => f.message) : null,
		date,
	};
}
