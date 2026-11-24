// LBN 202-18 «Būvniecības ieceres dokumentācijas noformēšana» (MK noteikumi Nr. 545, https://likumi.lv/ta/id/301303): the marka list of its annex
// («Būvniecības ieceres dokumentācijas markas»), and where the app ties a marka to something: a specialist (the pill beside its name, the lines of its
// standing text), a delivery file or folder (Nodevumi). Node-free: the main process (standing text, saves) and the window (pill, dialog, Nodevumi) share it.
//
// The list is data copied from the law's own text, not guessed: test/20.0-markas.test.ts checks every row against data/law-snapshots/301303.txt (the likumi.lv
// text the app ships), so a new version of the snapshot that changes the annex shows up as a failing test, not as a quiet drift.
// Not real project data: the list is the same for every project.
import type { AgentSpec } from "./agent-types.js";
import { TEAM_IDS } from "./departments.js";

export interface Marka {
	code: string;
	name: string;
	/** true = in the annex of LBN 202-18; false = an own marka the office uses (point 17: «Ja nepieciešams, var veidot arī papildu markas») */
	official: boolean;
}

export const LBN_202_ACT_ID = "301303";
export const LBN_202_URL = "https://likumi.lv/ta/id/301303";

/** The annex of LBN 202-18, in its order (68 rows; the law prints «ESS- CI» and «ESS- PK» with a space, the code has none). */
const ANNEX: readonly (readonly [string, string])[] = [
	["AA", "Ainavas analīze"],
	["AAT", "Aukstumapgāde"],
	["AMI", "Arhitektoniski mākslinieciskā izpēte"],
	["AR", "Arhitektūras risinājumi"],
	["AS", "Apūdeņošanas sistēmas"],
	["AVK-A", "Apkure"],
	["AVK-K", "Klimata kontroles sistēma"],
	["AVK-V", "Ventilācija"],
	["BA", "Būvdarbu apjomu saraksts"],
	["BAA", "Būvakustika"],
	["BK", "Būvkonstrukcijas"],
	["DN", "Dūmu nosūce"],
	["DOP", "Darbu organizācijas projekts"],
	["DT", "Drenāžas inženiertīkli"],
	["DVP", "Darbu veikšanas projekts"],
	["DZK", "Dzelzsbetona konstrukcijas"],
	["EL", "Elektroapgāde (iekšējā)"],
	["ELT", "Elektroapgāde (ārējā)"],
	["ES-P", "Pagaidu energosertifikāts"],
	["ESS", "Elektronisko sakaru sistēmas"],
	["ESS-CI", "Centralizētā izziņošanas sistēma"],
	["ESS-DA", "Dūmu aizsardzība"],
	["ESS-PK", "Piekļuves kontrole"],
	["ESS-AS", "Apsardzes signalizācija"],
	["ESS-TK", "Elektronisko sakaru inženiertīkli"],
	["ESS-VAS", "Vadības un automatizācijas sistēmas"],
	["ESS-VN", "Videonovērošana"],
	["EST", "Elektronisko sakaru sistēmas (ārējās)"],
	["FF", "Fotofiksācija"],
	["GA", "Gāzes apgāde (iekšējā)"],
	["GAT", "Gāzes apgāde (ārējā)"],
	["GI", "Ģeotehniskā izpēte"],
	["GP", "Ģenerālplāns"],
	["HB", "Hidrotehniskās būves"],
	["HI", "Hidrometeoroloģiskā izpēte"],
	["IE", "Iekārtu izvietojums"],
	["IN", "Interjers"],
	["IS", "Iekārtu, konstrukciju un būvizstrādājumu kopsavilkums"],
	["KK", "Koka konstrukcijas"],
	["KT", "Dzelzceļa kontakttīkli"],
	["LKT", "Lietus ūdens kanalizācijas tīkli"],
	["MK", "Metāla konstrukcijas"],
	["MS", "Meliorācijas sistēmas"],
	["MUK", "Mūra konstrukcijas"],
	["PK", "Plastmasas konstrukcijas"],
	["SA", "Skaidrojošais apraksts"],
	["SAT", "Siltumapgāde (ārējā)"],
	["SC", "Dzelzceļa sliežu ceļi, zemes klātne, garenprofili un šķērsprofili, ūdensnovade"],
	["SCB", "Dzelzceļa signalizācijas sistēmas un vilcienu kustības vadības sistēmas tīkli"],
	["SK", "Stikla konstrukcijas"],
	["SM", "Siltummehānika"],
	["SP", "Sprinkleru sistēma"],
	["T", "Izmaksu aprēķins"],
	["TAA", "Tehniskās apsekošanas atzinums"],
	["TI", "Ģeodēziskā un topogrāfiskā izpēte"],
	["TN", "Tehnoloģiskā daļa"],
	["TS-CD", "Ceļa darbi"],
	["TS-L", "Labiekārtojums"],
	["UAS", "Ugunsdzēsības automātikas sistēmas"],
	["UATS", "Ugunsgrēka atklāšanas un trauksmes signalizācijas sistēmas"],
	["UK", "Ūdensapgāde un kanalizācija (iekšējā)"],
	["UKT", "Ūdensapgāde un kanalizācija (ārējā)"],
	["UN", "Ūdensnotekas"],
	["UPP", "Ugunsdrošības pasākumu pārskats"],
	["UR", "Uzmērījuma rasējumi"],
	["VAP", "Vides aizsardzības pasākumi"],
	["VI", "Vēsturiskā izpēte"],
	["ZP", "Zemes robežu plāns"],
];

export const MARKAS: readonly Marka[] = ANNEX.map(([code, name]) => ({ code, name, official: true }));

/** Own markas of the office's BD team that the annex does not list (the energy auditor's life cycle documents, docs/BD 00_README); point 17 allows them. */
export const EXTRA_MARKAS: readonly Marka[] = [
	{ code: "LCA", name: "Dzīves cikla novērtējums (LCA)", official: false },
	{ code: "LCC", name: "Dzīves cikla izmaksas (LCC)", official: false },
];

export const ALL_MARKAS: readonly Marka[] = [...MARKAS, ...EXTRA_MARKAS];
const BY_CODE = new Map(ALL_MARKAS.map((m) => [m.code, m]));

/** A marka as typed: upper case, no spaces, any dash as «-» («ess- ci» → «ESS-CI»). */
export const normMarka = (s: string): string => s.toUpperCase().replace(/[\s_]+/g, "").replace(/[‐-―−]/g, "-");

/** The marka of a code (any spelling `normMarka` fixes), or undefined when it is none. */
export const markaByCode = (code: string): Marka | undefined => BY_CODE.get(normMarka(code));

/** What a list typed in a field means: the known codes in order, once each, and the words that are none. Separators: comma, semicolon, space. */
export function parseMarkas(text: string): { codes: string[]; unknown: string[] } {
	const codes: string[] = [];
	const unknown: string[] = [];
	for (const raw of text.split(/[,;\n]+/)) {
		const t = raw.trim();
		if (!t) continue;
		const code = normMarka(t);
		if (BY_CODE.has(code)) {
			if (!codes.includes(code)) codes.push(code);
		} else unknown.push(t);
	}
	return { codes, unknown };
}

// ---- who owns which marka -------------------------------------------------------------------------------------------------------------------------

/** The markas of each BD role agent, from the user's team description (docs/BD 00_README, column «Sadaļas»), keyed by the agent's id like
 *  `DEFAULT_DEPARTMENT_OF`. A file of the person's own choice (`AgentSpec.markas`) wins; an agent with another id has none. The annex rows no agent is
 *  given (DVP, FF, GI, HB, HI, IS, KT, SC, SCB, SP, TAA, TI, UN, ZP) are named in the lead's text as «bez aģenta»: who takes them is the user's call. */
export const DEFAULT_MARKAS_OF: Readonly<Record<string, readonly string[]>> = {
	bpv: ["SA"],
	ar: ["UR", "VI", "AMI", "AA", "AR", "IN", "TN", "IE", "DOP", "VAP"],
	aa: ["GP", "TS-L"],
	cd: ["TS-CD"],
	ak: ["BAA"],
	ea: ["ES-P", "LCA", "LCC"],
	bk: ["BK", "DZK", "MK", "KK", "MUK", "SK", "PK"],
	uk: ["UK", "UKT", "LKT", "DT"],
	avk: ["AVK-A", "AVK-V", "AVK-K", "AAT", "DN", "SM", "SAT"],
	ga: ["GA", "GAT"],
	el: ["EL", "ELT"],
	ess: ["ESS", "ESS-CI", "ESS-DA", "ESS-PK", "ESS-AS", "ESS-TK", "ESS-VAS", "ESS-VN", "UATS", "UAS", "EST"],
	ud: ["UPP"],
	mel: ["AS", "MS"],
	tam: ["BA", "T"],
};

/** The markas of an agent: its own list when it has one (`[]` = none, the person took them away), else the default of its id. */
export function markasOf(spec: Pick<AgentSpec, "id" | "markas">): readonly string[] {
	return spec.markas ?? DEFAULT_MARKAS_OF[spec.id] ?? [];
}

/** The markas a skill group belongs to: the group is the role folder it was imported from («02-arhitekts»), the number says the role (`TEAM_IDS`), and the role's agent holds the markas.
 *  [] for the built-in group, the common skills (00-kopigie), a group with another name, or a role no agent of `specs` has. */
export function markasOfSkillGroup(group: string, specs: readonly Pick<AgentSpec, "id" | "markas">[]): readonly string[] {
	const id = TEAM_IDS[/^(\d{2})-/.exec(group)?.[1] ?? ""];
	const spec = id ? specs.find((s) => s.id === id) : undefined;
	return spec ? markasOf(spec) : [];
}

/** The agents that hold a marka (ids, in the order of `specs`). */
export function ownersOfMarka(code: string, specs: readonly Pick<AgentSpec, "id" | "markas">[]): string[] {
	const c = normMarka(code);
	return specs.filter((s) => markasOf(s).includes(c)).map((s) => s.id);
}

/** The pill beside an agent: one or two codes as they are («BAA», «GP · TS-L»), more as the first and a count («UK +3»); the tooltip lists every one with its name.
 *  null when the agent has none (no pill). */
export function markaPill(codes: readonly string[], extraLabel = "papildu marka"): { text: string; title: string } | null {
	if (!codes.length) return null;
	const text = codes.length <= 2 ? codes.join(" · ") : `${codes[0]} +${codes.length - 1}`;
	const title = codes.map((c) => `${c} — ${BY_CODE.get(c)?.name ?? c}${BY_CODE.get(c)?.official === false ? ` (${extraLabel})` : ""}`).join("\n");
	return { text, title: `LBN 202-18\n${title}` };
}

// ---- a marka read from a name -----------------------------------------------------------------------------------------------------------------------

const CODES_LONGEST_FIRST = [...BY_CODE.keys()].sort((a, b) => b.length - a.length);

/** The marka a name starts with after an optional number: «02_SA», «AR-01 Plāns», «AVK-A-03», «ESS_TK», «123_BK_00_Pamati.pdf» (the BIS form NUMURS_MARKA_REVĪZIJA_LAPAS).
 *  A code only counts as a whole word: «ARHITEKTŪRA» is not «AR», «T» is not the first letter of «Tāme». The longest code wins («AVK-A» before «AVK»). null when there is none. */
export function markaOfName(name: string): string | null {
	const stem = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
	// the BIS form: the second part is the marka (a number first, then the marka, then a revision)
	const bis = /^[^_\s-]+[_-]([^_\s]+?)[_-](?:[A-Za-z0-9]{1,4})[_-]/.exec(stem);
	if (bis) {
		const m = normMarka(bis[1]);
		if (BY_CODE.has(m)) return m;
	}
	const s = stem.replace(/^\d+(?:\.\d+)*[\s._-]*/, "").toUpperCase().replace(/[‐-―−]/g, "-");
	for (const code of CODES_LONGEST_FIRST) {
		if (!s.startsWith(code)) continue;
		const next = s[code.length];
		if (next === undefined || /[\s._-]/.test(next) || /\d/.test(next)) return code;
	}
	return null;
}

/** The marka of one delivery file: its sheet number, then its file name, then the folders it sits in, nearest first («1.4.3_BP\\02_SA\\apraksts.pdf» → SA). */
export function markaOfDeliveryFile(item: { sheetNo: string | null; file: string }): string | null {
	const parts = item.file.split(/[\\/]/).filter(Boolean);
	const fileName = parts.pop() ?? "";
	return (item.sheetNo ? markaOfName(item.sheetNo) : null) ?? markaOfName(fileName) ?? parts.reverse().map(markaOfName).find((m) => m !== null) ?? null;
}

/** The markas of a delivery's files, each with how many files, in the annex's order (files with none are counted apart). */
export function markasOfDelivery(items: readonly { sheetNo: string | null; file: string }[]): { counts: { code: string; files: number }[]; none: number } {
	const n = new Map<string, number>();
	let none = 0;
	for (const i of items) {
		const m = markaOfDeliveryFile(i);
		if (m) n.set(m, (n.get(m) ?? 0) + 1);
		else none++;
	}
	const order = new Map(ALL_MARKAS.map((m, k) => [m.code, k]));
	return { counts: [...n].map(([code, files]) => ({ code, files })).sort((a, b) => order.get(a.code)! - order.get(b.code)!), none };
}

// ---- what the agents are told ---------------------------------------------------------------------------------------------------------------------

const RULE_LINES =
	"LBN 202-18 (MK noteikumi Nr. 545, likumi.lv/ta/id/301303), būvniecības ieceres dokumentācijas noformēšana. Marka ir būvprojekta daļas saīsinājums: daļu, darbu un rasējumu nosaukumus saīsina ar marku (17. p.); " +
	"rakstlaukumā ir marka un kārtas numurs (15.4. p.); vienas daļas sastāvā var būt vairāku marku dokumenti, bet augšupielādējot BIS katra marka ir atsevišķa daļa (12. p.); papildu markas drīkst veidot, ja vajag (17. p.). " +
	"Markas nosaukumu un kodu ņem no pielikuma, neizdomā jaunu kodu; ja kods nav sarakstā, saki, ka tā ir papildu marka.";

/** One line per agent that holds markas: «ar: UR, VI, AR …». */
function ownerLines(specs: readonly Pick<AgentSpec, "id" | "markas">[], skip?: string): string {
	return specs
		.filter((s) => s.id !== skip && markasOf(s).length)
		.map((s) => `- ${s.id}: ${markasOf(s).join(", ")}`)
		.join("\n");
}

/** The annex rows no agent holds, for the lead: it asks the person who takes them. */
function unownedCodes(specs: readonly Pick<AgentSpec, "id" | "markas">[]): string[] {
	const held = new Set(specs.flatMap((s) => markasOf(s)));
	return MARKAS.filter((m) => !held.has(m.code)).map((m) => m.code);
}

/** The LBN 202-18 text of an agent's standing prompt. The lead (`spec` null) gets the whole annex with names and who holds each marka, so it can route a section to the right
 *  agent; a specialist gets the rule lines, its own markas with names, and who holds the others (codes only: the names of the others are in the law library, `search_law`).
 *  Same words every run, so it sits in the cached part of the prompt. */
export function markasText(spec: Pick<AgentSpec, "id" | "markas"> | null, specs: readonly Pick<AgentSpec, "id" | "markas">[]): string {
	if (!spec) {
		const rows = MARKAS.map((m) => `${m.code} ${m.name}`).join("; ");
		const un = unownedCodes(specs);
		return [
			RULE_LINES,
			`Pielikuma markas (kods nosaukums): ${rows}.`,
			`Kuram aģentam kura marka (aģents: markas):\n${ownerLines(specs)}`,
			un.length ? `Markas bez aģenta: ${un.join(", ")}: jautā cilvēkam, kas tās ņem.` : "",
		]
			.filter(Boolean)
			.join("\n");
	}
	const own = markasOf(spec);
	const others = ownerLines(specs, spec.id);
	return [
		RULE_LINES,
		own.length ? `Tavas markas: ${own.map((c) => `${c} ${BY_CODE.get(c)?.name ?? ""}`.trim()).join("; ")}.` : "Tev nav piešķirtu marku.",
		others ? `Citu aģentu markas (aģents: markas):\n${others}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
