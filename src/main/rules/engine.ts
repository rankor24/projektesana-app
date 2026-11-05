// Rules engine: building facts in, group / procedure / required content out — each answer with the rules it rests on.
import type { Rule, Section, Stage } from "./types.js";
import { HOLIDAY_CAVEAT, isWorkingDay } from "./holidays.js";

export type Work = "new_build" | "reconstruction" | "simple_reconstruction" | "renovation" | "simplified_renovation" | "use_change" | "demolition";
export type Use = "residential_1_2" | "residential_other" | "public" | "production" | "warehouse" | "auxiliary" | "agricultural" | "other";

export interface Facts {
	work: Work;
	use: Use;
	floorsAbove?: number;
	floorsBelow?: number;
	/** apbūves laukums, m2 */
	footprintM2?: number;
	/** kopējā platība, m2 */
	totalAreaM2?: number;
	/** ugunsslodze, MJ/m2 (production and warehouse) */
	fireLoadMJ?: number;
	seasonal?: boolean;
	publicFunded?: boolean;
	/** boiler house > 100 MW, power supply building > 2 MW, substation >= 110 kV */
	specialGroup3?: boolean;
	/** existing buildings: the group written in the documents (Inventarizācijas lieta); overrides computation */
	documentedGroup?: 1 | 2 | 3;
}

export interface Answer<T> {
	value: T;
	/** ids of the rules this answer rests on */
	because: string[];
	/** what the code could not decide; non-empty means Boris must check */
	check: string[];
}

export function groupOf(f: Facts): Answer<1 | 2 | 3> {
	if (f.documentedGroup) return { value: f.documentedGroup, because: [], check: ["Grupa ņemta no dokumentiem (Inventarizācijas lieta), nav aprēķināta."] };
	const because: string[] = [];
	const check: string[] = [];
	const floors = f.floorsAbove ?? 0;
	if (floors > 6) because.push("grp3-floors-above");
	if ((f.floorsBelow ?? 0) > 1) because.push("grp3-floors-below");
	if (f.use === "public" && (f.totalAreaM2 ?? 0) > 1000) because.push("grp3-public-area");
	if (f.use === "production") {
		if ((f.fireLoadMJ ?? 0) > 600) because.push("grp3-prod-fire");
		if ((f.totalAreaM2 ?? 0) > 2000) because.push("grp3-prod-area");
	}
	if (f.use === "warehouse") {
		if ((f.fireLoadMJ ?? 0) > 600) because.push("grp3-wh-fire");
		if ((f.totalAreaM2 ?? 0) > 2000) because.push("grp3-wh-area");
	}
	if (f.specialGroup3) check.push("Īpašās 3. grupas ēkas (katlumāja, elektroapgāde, apakšstacija) — pārbaudi 1. pielikuma 2.2.8.–2.2.10.");
	if (f.use === "public" && f.totalAreaM2 === undefined) check.push("Publiskai ēkai nav norādīta kopējā platība (robeža 1000 m2).");
	if ((f.use === "production" || f.use === "warehouse") && (f.totalAreaM2 === undefined || f.fireLoadMJ === undefined)) check.push("Ražošanas/noliktavas ēkai trūkst platība vai ugunsslodze (2000 m2; 600 MJ/m2).");
	if (because.length) return { value: 3, because, check };
	if (f.floorsAbove !== undefined && f.floorsAbove <= 1 && (f.floorsBelow ?? 0) === 0 && f.footprintM2 !== undefined && f.footprintM2 <= 60) return { value: 1, because: ["grp1-single-storey"], check };
	return { value: 2, because: ["grp2-rest"], check };
}

export type Procedure = "pazinojums" | "paskaidrojuma_raksts" | "mbp_buvatlauja";

/**
 * Which MK 529 §7 route applies. Only the cases whose conditions are unambiguous in the text are decided;
 * everything else falls to 7.3 and carries a `check` telling Boris which sub-point to look at.
 */
export function procedureOf(f: Facts): Answer<Procedure> {
	const g = groupOf(f).value;
	const check: string[] = [];
	const done = (value: Procedure, rule: string, extra: string[] = []): Answer<Procedure> => ({ value, because: [rule], check: [...check, ...extra] });
	switch (f.work) {
		case "new_build": {
			const lowRes = f.use === "residential_1_2" || f.use === "auxiliary" || f.use === "agricultural";
			if (g === 1 && lowRes) return done("pazinojums", "proc-notice-new-g1", ["7. punkta izņēmumus (bez dokumentiem) pārbaudi."]);
			if (g === 2 && f.use === "residential_1_2" && (f.totalAreaM2 ?? Infinity) <= 200) return done("paskaidrojuma_raksts", "proc-expl-new-small", ["7.2 1.: attiecas uz viena dzīvokļa ēku; divu dzīvokļu ēkai pārbaudi."]);
			if (f.seasonal) return done("paskaidrojuma_raksts", "proc-expl-seasonal");
			if (g === 2 && f.use === "residential_1_2" && f.totalAreaM2 === undefined) check.push("Nav norādīta kopējā platība (200 m2 robeža 7.2 1.).");
			return done("mbp_buvatlauja", "proc-mbp");
		}
		case "reconstruction": {
			if (g === 2 && f.use === "residential_1_2") return done("pazinojums", "proc-notice-reconstr-g2", ["7.1 6.: tikai ja nemainās būvapjoms un lietošanas veids."]);
			if (g === 1) return done("paskaidrojuma_raksts", "proc-expl-g1-reconstr", ["7.2 4.: tikai ja netiek pārsniegti 1. grupas apjoma rādītāji."]);
			return done("mbp_buvatlauja", "proc-mbp");
		}
		case "simple_reconstruction":
			return done("paskaidrojuma_raksts", "proc-expl-simple-reconstr");
		case "simplified_renovation":
			return done("pazinojums", "proc-notice-simplified-renov");
		case "renovation":
			return done("paskaidrojuma_raksts", "proc-expl-renov");
		case "use_change":
			return done("paskaidrojuma_raksts", "proc-expl-use-change", ["7.2 7.: tikai lietošanas veida maiņa bez pārbūves."]);
		case "demolition":
			if (g === 1) return done("pazinojums", "proc-notice-demolish");
			return done("paskaidrojuma_raksts", "proc-expl-demolish", ["7.1 3.: 2. grupas palīgēkai/lauksaimniecības ēkai ir paziņojums."]);
	}
}

export interface Requirement {
	ruleId: string;
	section: Section;
	item: string;
	article: string;
	quote: string;
}

function matches(r: Rule, w: Record<string, string | number | boolean>): boolean {
	return Object.entries(r.applies_when).every(([k, v]) => !(k in w) || w[k] === v);
}

/** Required content for AR and GP at a stage. Skice has no prescribed content (LBN 202-18 point 2): MBP content is shown as the nearest list. */
export function requiredContent(rules: Rule[], f: Facts, stage: Stage): { items: Requirement[]; notes: string[] } {
	const notes: string[] = [];
	const g = groupOf(f).value;
	let eff: "mbp" | "bp" = stage === "bp" ? "bp" : "mbp";
	if (stage === "skice" || stage === "koncepcija") notes.push("Skiču projektam / koncepcijai likums nenosaka satura sarakstu (LBN 202-18 2. p. uz tiem neattiecas). Rādīts tuvākais saraksts — MBP saturs (MK 529 26. p.).");
	if (stage === "bp" && g === 1) notes.push("1. grupas ēkai MK 529 71.–72. punkts nav piemērojams; BP sastāvu pārbaudi atsevišķi.");
	const w: Record<string, string | number | boolean> = { stage: eff, work: f.work };
	if (eff === "bp") w.group = g === 3 ? 3 : 2;
	const items: Requirement[] = [];
	for (const r of rules) {
		if (!r.section || (r.section !== "AR" && r.section !== "GP")) continue;
		if (r.applies_when.stage !== eff) continue;
		if (!matches(r, w)) continue;
		for (const it of r.requires) items.push({ ruleId: r.id, section: r.section, item: it, article: `${r.act} ${r.article}`, quote: r.quote });
	}
	return { items, notes };
}

export const bimModelRequired = (f: Facts): boolean => groupOf(f).value === 3 && f.work === "new_build" && f.publicFunded === true;

export interface Deadline {
	due: string;
	rule: string;
	/** Weekends and the public holidays of the holidays act are skipped. */
	holidaysExcluded: true;
	/** what the count cannot know */
	caveat: string;
}

/** Technical rules: 11 working days after the request (MK 500 27.1, 27.2); weekends and public holidays skipped. */
export function technicalRulesDeadline(requestedOn: string, issuer: "state_municipal" | "network_owner"): Deadline {
	const d = new Date(`${requestedOn}T00:00:00Z`);
	let left = 11;
	while (left > 0) {
		d.setUTCDate(d.getUTCDate() + 1);
		if (isWorkingDay(d)) left--;
	}
	return { due: d.toISOString().slice(0, 10), rule: issuer === "state_municipal" ? "tr-deadline-state" : "tr-deadline-network", holidaysExcluded: true, caveat: HOLIDAY_CAVEAT };
}
