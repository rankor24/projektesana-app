// Requirements (task 2.2): law rows from the profile, document rows from the PU, BIP, TN and permit.
//
// Law: each rule of data/rules.json whose conditions hold for the profile becomes one row per required item, citing the
// point with its version dates (citations.ts). A condition the profile does not know yet is NOT treated as met or unmet:
// the row is kept with "attiecas, ja …" so the user sees it (v1 silently matched unknown keys).
// Documents: numbered paragraphs of the PU / BIP / permit and the numbered conditions of each TN become proposed rows with
// page and quote. Ids are stable, so a refresh keeps the user's decisions, status and evidence.
import { groupOf, type Facts, type Use, type Work } from "./engine.js";
import { citationOf, snapshotOf } from "./citations.js";
import type { DocStage, Rule } from "./rules.js";
import { profileOf, type BimStage, type Fact, type Requirement, type RequirementOrigin, type Source } from "../core/model.js";
import { numberedRows } from "../sources/extract/pu.js";
import { extractTn } from "../sources/extract/tn.js";

export const DOC_STAGE_BIM: Record<"mbp" | "bp", BimStage[]> = { mbp: ["Skice"], bp: ["Tehniskais", "Detalizācijas"] };
const DELIVERY_OF: Record<"mbp" | "bp", string> = { mbp: "MBP", bp: "BP" };

const CONDITION_LABEL: Record<string, string> = {
	work: "būvniecības veids",
	group: "ēkas grupa",
	publicFunded: "finansējums no publiskiem / ES līdzekļiem",
	production: "ražošanas vai noliktavas ēka",
	phased: "būvniecība pa kārtām",
	inUse: "pārbūve, nepārtraucot ēkas pamatfunkcijas",
};

export interface ProfileConditions {
	values: Record<string, string | number | boolean | undefined>;
	/** every profile fact used, to tell whether the rows rest on confirmed facts only */
	used: Fact[];
	stages: ("mbp" | "bp" | "skice")[];
	notes: string[];
}

/** The profile as rule conditions. Values not in the profile stay undefined (unknown). */
export function conditionsOf(facts: Fact[]): ProfileConditions {
	const p = profileOf(facts);
	const used: Fact[] = [];
	const take = <T>(f: Fact | undefined, v: T) => (f ? (used.push(f), v) : undefined);
	const work = take(p.workType, p.workType?.value as Work | undefined);
	const use = take(p.use, p.use?.value as Use | undefined);
	const area = p.totalAreaM2 ? take(p.totalAreaM2, Number(p.totalAreaM2.value)) : undefined;
	const floors = p.floorsAbove ? take(p.floorsAbove, Number(p.floorsAbove.value)) : undefined;
	let group: number | undefined = p.group ? take(p.group, Number(p.group.value)) : undefined;
	const notes: string[] = [];
	if (group === undefined && work && use) {
		const g = groupOf({ work, use, totalAreaM2: area, floorsAbove: floors } as Facts);
		if (!g.check.length) group = g.value;
		else notes.push(`Grupa nav nosakāma: ${g.check.join(" ")}`);
	}
	const funding = p.funding?.value.toLowerCase();
	const publicFunded = funding === undefined ? undefined : (take(p.funding, 0), /pašvaldīb|valsts|publisk|\bes\b|eiropas|eraf|kf\b|atveseļ/.test(funding) ? true : /privāt/.test(funding) ? false : undefined);
	const stages = facts
		.filter((f) => f.key === "profile.stagesInContract" && f.state !== "rejected")
		.map((f) => (used.push(f), f.value))
		.flatMap((v) => (v === "MBP" ? ["mbp" as const] : v === "BP" || v === "DT" ? ["bp" as const] : v === "SKICE" ? ["skice" as const] : []));
	if (!stages.length) notes.push("Profilā nav līgumā ietverto stadiju: likuma prasības pa stadijām nav atlasītas.");
	if (stages.includes("skice")) notes.push("Skiču projektam likums nenosaka satura sarakstu (LBN 202-18 2. p.).");
	return { values: { work, use, group, publicFunded, production: use ? use === "production" || use === "warehouse" : undefined, phased: undefined, inUse: undefined }, used, stages: [...new Set(stages)], notes };
}

export function lawRequirements(rules: Rule[], facts: Fact[], dataDir: string, today: string, now = new Date()): { rows: Requirement[]; notes: string[] } {
	const c = conditionsOf(facts);
	const state = c.used.length && c.used.every((f) => f.state === "confirmed") ? "confirmed" : "proposed";
	const rows: Requirement[] = [];
	const snapshots = new Map<string, string | null>();
	for (const stage of c.stages) {
		if (stage === "skice") continue;
		for (const r of rules) {
			if (r.applies_when.stage !== stage || !r.requires.length) continue;
			const unknown: string[] = [];
			let applies = true;
			for (const [k, v] of Object.entries(r.applies_when)) {
				if (k === "stage") continue;
				const have = c.values[k];
				if (have === undefined) unknown.push(k === "work" ? `${CONDITION_LABEL[k]} = ${v}` : k === "group" ? `${v}. grupa` : CONDITION_LABEL[k] ?? k);
				else if (have !== v) applies = false;
			}
			if (!applies) continue;
			if (!snapshots.has(r.actId)) snapshots.set(r.actId, snapshotOf(dataDir, r.actId));
			const cit = citationOf(r, snapshots.get(r.actId)!, today);
			r.requires.forEach((item, i) => {
				rows.push({
					id: `law:${r.id}:${i}`,
					origin: "law",
					citation: { kind: "law", act: cit.act, actId: r.actId, actVersionDate: cit.actVersionDate, readOn: r.read_on, point: r.article, url: cit.url, quote: r.quote },
					text: unknown.length ? `${item} (attiecas, ja: ${unknown.join("; ")} — profilā nav zināms)` : item,
					appliesTo: { stages: DOC_STAGE_BIM[stage as "mbp" | "bp"], deliveries: [DELIVERY_OF[stage as "mbp" | "bp"]], sections: r.section && r.section !== "PROCESS" && r.section !== "VISPARIGA" ? [r.section] : undefined },
					checkId: "completeness",
					status: cit.status === "vēl nav spēkā" ? "justified" : "open",
					evidence: cit.status === "vēl nav spēkā" ? [`stājas spēkā ${cit.validFrom}`] : [],
					state,
					by: "app",
					at: now.toISOString(),
				});
			});
		}
	}
	return { rows, notes: c.notes };
}

const ORIGIN_OF_ROLE: Record<string, RequirementOrigin> = { PU: "pu", Iepirkums: "pu", "BIP / BIM prasības": "bip", "Tehniskie noteikumi": "tn", "Būvatļauja / nosacījumi": "permit" };

/** Numbered rows of the documents that state requirements. Headings (one level, short) are left out. */
export function documentRequirements(sources: Source[], textOf: (s: Source) => { pages: string[] } | null, now = new Date()): Requirement[] {
	const out: Requirement[] = [];
	for (const s of sources) {
		const origin = ORIGIN_OF_ROLE[s.role];
		const v = s.versions[s.versions.length - 1];
		if (!origin || s.kind !== "document" || !v?.sha256) continue;
		const t = textOf(s);
		if (!t) continue;
		const rows =
			origin === "tn"
				? extractTn(t.pages)
						.filter((c) => c.key.startsWith("tn.condition."))
						.map((c) => ({ no: c.key.slice("tn.condition.".length), text: c.value, page: c.page, quote: c.quote }))
				: numberedRows(t.pages).filter((r) => r.no.includes(".") || r.text.length > 60);
		for (const r of rows) {
			out.push({
				id: `doc:${s.id}:${r.no}`,
				origin,
				citation: { kind: "document", sourceId: s.id, sha: v.sha256, page: r.page, quote: r.quote },
				text: `${r.no}. ${r.text}`,
				appliesTo: {},
				checkId: null,
				status: "open",
				evidence: [],
				state: "proposed",
				by: "app",
				at: now.toISOString(),
			});
		}
	}
	return out;
}

/** Merge a fresh derivation into the stored rows: decisions, status and evidence of known ids stay; agent and user rows stay. */
export function mergeRequirements(prev: Requirement[], fresh: Requirement[]): Requirement[] {
	const byId = new Map(prev.map((r) => [r.id, r]));
	const derived = new Set(fresh.map((r) => r.id));
	const out: Requirement[] = [];
	for (const f of fresh) {
		const p = byId.get(f.id);
		if (!p) out.push(f);
		else
			out.push({
				...f,
				status: p.status === "justified" || p.status === "met" || p.status === "failed" ? p.status : f.status,
				evidence: p.evidence.length ? p.evidence : f.evidence,
				// The user's decision on a document row stays; a law row follows the profile's state
				state: f.origin === "law" ? f.state : p.state,
				at: p.at,
			});
	}
	// rows not derived by code (agent / user) are kept as they are; derived rows that no longer apply are dropped
	for (const p of prev) if (!derived.has(p.id) && !p.id.startsWith("law:") && !p.id.startsWith("doc:")) out.push(p);
	return out;
}

export type { DocStage };
