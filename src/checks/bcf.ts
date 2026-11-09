// BCF (task 5.3): findings out as BCF 2.1 topics, BCF topics in (from Solibri, Navisworks, BimCraft) as findings.
// The format is BimCraft's own bcf.js (getcadcraft/bimcraft app/bcf.js: writeBcf / readBcf, validated by BimCraft against the
// buildingSMART schemas), loaded at run time from the synced copy. On top, BIM Crew's discipline sorting
// (core/bcf_parser.py DISCIPLINE_CODES / _extract_disciplines, ported): every topic gets a discipline pair label.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { USER_LABEL, type Finding, type Requirement } from "../core/model.js";

export interface BcfTopic {
	guid: string;
	title: string;
	status: string;
	type: string;
	author: string;
	created: string;
	modified?: string;
	description: string;
	comments: { guid: string; date: string; author: string; text: string; viewpoint?: string }[];
	viewpoints: { guid: string; camera: unknown; selection: string[]; visibility: { defaultVisible: boolean; exceptions: string[] }; clipping: unknown[]; snapshot: Uint8Array | null }[];
}

type BcfModule = { writeBcf(o: { topics: BcfTopic[]; file?: { name: string; date?: string } | null }): Promise<Uint8Array>; readBcf(b: Uint8Array): Promise<{ topics: BcfTopic[]; notes: string[] }> };

const mods = new Map<string, Promise<BcfModule>>();
const bcfOf = (appDir: string) => {
	let m = mods.get(appDir);
	if (!m) {
		m = import(pathToFileURL(join(appDir, "bcf.js")).href) as Promise<BcfModule>;
		mods.set(appDir, m);
	}
	return m;
};

/** BIM Crew core/bcf_parser.py DISCIPLINE_CODES. */
export const DISCIPLINE_CODES: Record<string, string> = { ARC: "AR", AR: "AR", STR: "BK", BK: "BK", CON: "BK", MEP: "MEP", AVK: "AVK", HVAC: "AVK", EL: "EL", ELE: "EL", PLU: "UK", UK: "UK", ESS: "ESS", OUT: "AR", INT: "IN", IN: "IN" };

/** BIM Crew _extract_disciplines: "ARC vs BK" in the title, "(CON ARC)" tags, codes in IFC file names → a pair label. */
export function disciplinesOf(title: string, description: string, ifcFiles: string[] = []): { all: string[]; pair: string[]; label: string } {
	const found = new Set<string>();
	let pair: string[] = [];
	for (const f of ifcFiles)
		for (const [code, d] of Object.entries(DISCIPLINE_CODES)) {
			const low = f.toLowerCase();
			if (low.split(/[\s_\-.]+/).includes(code.toLowerCase()) || low.startsWith(code.toLowerCase())) found.add(d);
		}
	const vs = /(\w+)\s+VS\s+(\w+)/.exec(title.toUpperCase());
	if (vs) pair = [DISCIPLINE_CODES[vs[1]], DISCIPLINE_CODES[vs[2]]].filter(Boolean);
	for (const m of `${title} ${description}`.toUpperCase().matchAll(/\((\w+)\s+\w+\)/g)) if (DISCIPLINE_CODES[m[1]]) found.add(DISCIPLINE_CODES[m[1]]);
	if (!pair.length && found.size >= 2) pair = [...found].sort().slice(0, 2);
	else if (!pair.length && found.size === 1) pair = [...found, ...found];
	return { all: [...found].sort(), pair, label: pair.length ? pair.join(" vs ") : "unknown" };
}

/** A UUID derived from an id, so the same finding is the same topic in every export (Solibri updates it, no duplicates). */
export function stableGuid(id: string): string {
	const h = createHash("sha1").update(`projektesana:${id}`).digest("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

const STATUS: Record<Finding["state"], string> = { open: "Open", overridden: "Closed", closed: "Resolved" };

export function topicOf(f: Finding, req: Requirement | undefined, author = "Projektesana App"): BcfTopic {
	const cite = req ? (req.citation.kind === "law" ? `${req.citation.act} ${req.citation.point} (${req.citation.url})` : req.citation.kind === "office" ? `biroja standarts, lpp. ${req.citation.page}` : `avots ${req.citation.sourceId}, lpp. ${req.citation.page}`) : "";
	const description = [f.message, req ? `Prasība: ${req.text}` : "", cite ? `Avots: ${cite}` : "", f.where.roomNo ? `Telpa: ${f.where.roomNo}` : "", f.decision ? `${f.decision.name || USER_LABEL} (${f.decision.at.slice(0, 10)}): ${f.decision.reason}` : ""].filter(Boolean).join("\n");
	const g = stableGuid(f.id);
	return {
		guid: g,
		title: `[${f.checkId}] ${f.message.slice(0, 120)}`,
		status: STATUS[f.state],
		type: f.severity === "error" ? "Error" : f.severity === "warning" ? "Warning" : "Info",
		author,
		created: f.firstSeen,
		modified: f.lastSeen,
		description,
		comments: f.decision ? [{ guid: stableGuid(`${f.id}:decision`), date: f.decision.at, author: f.decision.name || USER_LABEL, text: f.decision.reason }] : [],
		viewpoints: f.where.elementGuid ? [{ guid: stableGuid(`${f.id}:vp`), camera: null, selection: [f.where.elementGuid], visibility: { defaultVisible: true, exceptions: [] }, clipping: [], snapshot: null }] : [],
	};
}

export async function findingsToBcf(appDir: string, findings: Finding[], reqs: Requirement[], file: { name: string } | null = null): Promise<Uint8Array> {
	const m = await bcfOf(appDir);
	const byId = new Map(reqs.map((r) => [r.id, r]));
	return m.writeBcf({ topics: findings.map((f) => topicOf(f, f.requirementId ? byId.get(f.requirementId) : undefined)), file });
}

export interface ImportedTopic extends BcfTopic {
	discipline: string;
}

export async function readBcfFile(appDir: string, bytes: Uint8Array, ifcFiles: string[] = []): Promise<{ topics: ImportedTopic[]; notes: string[]; byDiscipline: Record<string, number> }> {
	const m = await bcfOf(appDir);
	const r = await m.readBcf(bytes);
	const topics = r.topics.map((t) => ({ ...t, discipline: disciplinesOf(t.title ?? "", t.description ?? "", ifcFiles).label }));
	const byDiscipline: Record<string, number> = {};
	for (const t of topics) byDiscipline[t.discipline] = (byDiscipline[t.discipline] ?? 0) + 1;
	return { topics, notes: r.notes, byDiscipline };
}

/** A BCF topic as a finding of the "bcf" check (no code check re-runs it, so it stays until the user decides). */
export function findingOfTopic(t: ImportedTopic, now = new Date().toISOString()): Finding {
	const closed = /closed|resolved|done/i.test(t.status ?? "");
	return {
		id: `x_bcf_${t.guid.replace(/-/g, "").slice(0, 16)}`,
		checkId: "bcf",
		requirementId: null,
		severity: /error|critical|high/i.test(t.type ?? "") ? "error" : "warning",
		where: { elementGuid: t.viewpoints[0]?.selection[0] },
		message: `${t.discipline !== "unknown" ? `${t.discipline}: ` : ""}${t.title}`,
		key: `bcf:${t.guid}`,
		state: closed ? "closed" : "open",
		firstSeen: t.created || now,
		lastSeen: now,
	};
}
