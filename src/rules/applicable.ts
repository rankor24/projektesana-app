// Which acts and standards apply to a project ("Piemērojamie normatīvi" in Avoti).
//
// The mapping is data (data/applicable-acts.json), written by hand from each act's own scope paragraph, never guessed by
// the model. Only CONFIRMED profile facts decide: a proposed fact counts as unknown, so a row is "nav zināms" until the
// user confirms it in the profile. A row whose condition a confirmed fact rules out is kept as "neattiecas" with the
// reason, never dropped silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fact } from "../core/model.js";
import type { ApplicableRow, LibraryCategory, LibraryRow } from "../shared/api.js";

export type Condition = "work" | "use" | "group" | "stages";

export interface ActRow {
	id: string;
	title: string;
	category: LibraryCategory;
	source: { kind: "likumi"; actId: string } | { kind: "paid"; ref: string; catalogue: string };
	/** every listed condition must hold; a condition's list holds when any confirmed value is in it. Empty = all buildings */
	when: Partial<Record<Condition, string[]>>;
	why: { act: string; actId: string; point: string; url: string; quote: string };
	caveat?: string;
}

export interface ActMap {
	about: string;
	readOn: string;
	notRead: string;
	rows: ActRow[];
}

const FACT_KEY: Record<Condition, string> = { work: "profile.workType", use: "profile.use", group: "profile.group", stages: "profile.stagesInContract" };
const LABEL: Record<Condition, string> = { work: "būvniecības veids", use: "lietošanas veids", group: "ēkas grupa", stages: "stadijas līgumā" };
const VALUE: Record<string, string> = {
	new_build: "jaunbūve",
	reconstruction: "pārbūve",
	simple_reconstruction: "vienkāršota pārbūve",
	renovation: "atjaunošana",
	simplified_renovation: "vienkāršota atjaunošana",
	use_change: "lietošanas veida maiņa",
	demolition: "nojaukšana",
	residential_1_2: "viena vai divu dzīvokļu dzīvojamā ēka",
	residential_other: "daudzdzīvokļu dzīvojamā ēka",
	public: "publiska ēka",
	production: "ražošanas ēka",
	warehouse: "noliktava",
	auxiliary: "palīgēka",
	agricultural: "lauksaimniecības ēka",
	other: "cita",
};
const valueLabel = (k: Condition, v: string) => (k === "group" ? `${v}. grupa` : VALUE[v] ?? v);

export function loadActMap(dataDir: string): ActMap {
	return JSON.parse(readFileSync(join(dataDir, "applicable-acts.json"), "utf8")) as ActMap;
}

/** The likumi.lv act id of a library entry (built-in or added by link), or null. */
export function actIdOf(s: Pick<LibraryRow, "url">): string | null {
	return /likumi\.lv\/(?:ta\/id\/|doc\.php\?id=)(\d+)/i.exec(s.url ?? "")?.[1] ?? null;
}

/** "LVS EN ISO 6946" is held by a library file whose title or name has "EN ISO 6946" in it (with or without LVS, year,
 * punctuation), but not by "EN ISO 69460": a number never continues into more digits. */
export function holdsStandard(s: Pick<LibraryRow, "title" | "file">, ref: string): boolean {
	const tokens = ref.replace(/^LVS\s+/i, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
	const re = new RegExp(`(?<![A-Za-z0-9])${tokens.join("[^A-Za-z0-9]*")}(?![0-9])`, "i");
	return re.test(`${s.title} ${s.file ?? ""}`);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function applicableActs(map: ActMap, facts: Fact[], library: { list(): LibraryRow[]; paragraphs(id: string): string[] }): ApplicableRow[] {
	const lib = library.list();
	const byAct = new Map<string, LibraryRow>();
	for (const s of lib) {
		const a = actIdOf(s);
		if (a && !byAct.has(a)) byAct.set(a, s);
	}
	const texts = new Map<string, string>();
	const textOf = (s: LibraryRow) => {
		if (!texts.has(s.id)) texts.set(s.id, norm(library.paragraphs(s.id).join(" ")));
		return texts.get(s.id)!;
	};

	return map.rows.map((r): ApplicableRow => {
		const because: string[] = [];
		const missing: string[] = [];
		const notMatched: string[] = [];
		for (const [k, allowed] of Object.entries(r.when) as [Condition, string[]][]) {
			const confirmed = facts.filter((f) => f.key === FACT_KEY[k] && f.state === "confirmed").map((f) => f.value);
			if (!confirmed.length) {
				const proposed = facts.some((f) => f.key === FACT_KEY[k] && f.state === "proposed");
				missing.push(`${LABEL[k]} — ${proposed ? "tikai piedāvāts, apstiprini profilā" : "profilā nav"}`);
				continue;
			}
			const hit = confirmed.filter((v) => allowed.includes(v));
			if (hit.length) because.push(`${LABEL[k]}: ${hit.map((v) => valueLabel(k, v)).join(", ")}`);
			else notMatched.push(`${LABEL[k]}: ${confirmed.map((v) => valueLabel(k, v)).join(", ")}`);
		}
		if (!Object.keys(r.when).length) because.push("visām ēkām");

		const held = r.source.kind === "likumi" ? byAct.get(r.source.actId) : lib.find((s) => (s.category === "lvs" || s.category === "es") && holdsStandard(s, (r.source as { ref: string }).ref));
		const citing = byAct.get(r.why.actId);
		return {
			id: r.id,
			title: r.title,
			category: r.category,
			kind: r.source.kind,
			url: r.source.kind === "likumi" ? `https://likumi.lv/ta/id/${r.source.actId}` : null,
			actId: r.source.kind === "likumi" ? r.source.actId : null,
			ref: r.source.kind === "paid" ? r.source.ref : null,
			catalogue: r.source.kind === "paid" ? r.source.catalogue : null,
			state: notMatched.length ? "neattiecas" : missing.length ? "nav zināms" : "attiecas",
			because,
			missing,
			notMatched,
			why: r.why,
			caveat: r.caveat ?? null,
			inLibrary: held ? { id: held.id, readOn: held.readOn, changedOn: held.changedOn ?? null } : null,
			quoteFound: citing ? textOf(citing).includes(norm(r.why.quote)) : null,
		};
	});
}
