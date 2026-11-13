// Ekspertīze (task 8.14): the remarks of an expert review kept per project (`expertise.json`, versioned like the other small files).
// Code reads a review into remarks (sources/extract/expert.ts) and the agent adds the ones free text hides, each with a quote that is
// checked against the page like a fact's. Only the user closes a remark. A remark that is still open is a finding (checks/expert.ts),
// so the existing findings machinery, BCF export and delivery view carry it; closing the remark closes the finding.
import { createHash } from "node:crypto";
import { quoteOnPage } from "../sources/extract/common.js";
import { parseExpertReview } from "../sources/extract/expert.js";
import type { ExpertRemark, ExpertSummary, GroupRow, RemarkState, ReviewMeta, ImportResult } from "../shared/expert-types.js";
import type { ProjectStore } from "./store.js";
import type { Who } from "./model.js";

export const EXPERT_META = "expertise";

export const readRemarks = (store: ProjectStore): ExpertRemark[] => store.readMeta<ExpertRemark[]>(EXPERT_META, []);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
export const remarkId = (sourceId: string, page: number, quote: string) => `${sourceId}:${page}:${createHash("sha1").update(norm(quote).toLowerCase()).digest("hex").slice(0, 8)}`;

function pagesOf(store: ProjectStore, sourceId: string): { title: string; pages: string[] } {
	const s = store.read("sources").find((x) => x.id === sourceId);
	if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const v = s.versions[s.versions.length - 1];
	if (!v?.sha256) throw new Error(`Avotam ${s.title} nav nolasīta teksta.`);
	const t = store.readText(v.sha256);
	if (!t || !t.pages.length) throw new Error(`Avota ${s.title} teksts nav nolasīts (stāvoklis: ${v.textState}).`);
	return { title: s.title, pages: t.pages };
}

const write = (store: ProjectStore, all: ExpertRemark[], kind: string, by: Who | string, data?: Record<string, unknown>) => store.writeMeta(EXPERT_META, all, { kind, by, data });

/** Reads one source as an expert review and adds the remarks it finds. Reading it again adds only what is new. */
export function importReview(store: ProjectStore, sourceId: string, by: Who = "user", now = new Date()): ImportResult {
	const { pages } = pagesOf(store, sourceId);
	const parsed = parseExpertReview(pages);
	const all = readRemarks(store);
	const have = new Set(all.map((r) => r.id));
	const fresh: ExpertRemark[] = [];
	for (const p of parsed.remarks) {
		const id = remarkId(sourceId, p.page, p.quote);
		if (have.has(id) || fresh.some((r) => r.id === id)) continue;
		fresh.push({
			id,
			sourceId,
			page: p.page,
			code: p.code,
			daļa: p.daļa,
			section: p.section,
			quote: p.quote,
			critical: p.critical,
			responsible: p.responsible,
			reply: p.reply,
			// the reviewer's own [x] is the review's word, not the user's: it is shown as done with that reason
			state: p.done ? "done" : "open",
			note: p.done ? "atzīmēts atzinumā kā izpildīts" : null,
			by: "app",
			at: now.toISOString(),
			decidedAt: p.done ? now.toISOString() : null,
		});
	}
	if (fresh.length) write(store, [...all, ...fresh], "expert.imported", by, { sourceId, added: fresh.length });
	return { found: parsed.remarks.length, added: fresh.length, kept: parsed.remarks.length - fresh.length, meta: parsed.meta };
}

export interface AddInput {
	sourceId: string;
	page: number;
	quote: string;
	daļa?: string | null;
	code?: string | null;
	section?: string | null;
	critical?: boolean;
	responsible?: string | null;
}

/** A remark the agent (or the user) found by reading: the quote must be on that page of that source. */
export function addRemark(store: ProjectStore, a: AddInput, by: Who, now = new Date()): ExpertRemark {
	const { title, pages } = pagesOf(store, a.sourceId);
	const page = pages[a.page - 1];
	if (page === undefined) throw new Error(`Avotam ${title} nav lapas ${a.page} (lapas: ${pages.length}).`);
	if (!quoteOnPage(page, a.quote)) {
		const elsewhere = pages.findIndex((p) => quoteOnPage(p, a.quote));
		throw new Error(elsewhere >= 0 ? `Citāts nav ${a.page}. lapā; tas ir ${elsewhere + 1}. lapā.` : `Citāts nav atrodams avotā ${title} (burtiski, atstarpes neskaitot).`);
	}
	const quote = norm(a.quote);
	const id = remarkId(a.sourceId, a.page, quote);
	const all = readRemarks(store);
	const same = all.find((r) => r.id === id);
	if (same) return same;
	const r: ExpertRemark = { id, sourceId: a.sourceId, page: a.page, code: a.code ?? null, daļa: a.daļa?.trim().toUpperCase() || null, section: a.section ?? null, quote, critical: !!a.critical, responsible: a.responsible?.trim() || null, reply: null, state: "open", note: null, by: by === "user" ? "user" : by === "agent" ? "agent" : "app", at: now.toISOString(), decidedAt: null };
	write(store, [...all, r], "expert.added", by, { id });
	return r;
}

/** The user closes a remark (done, not applicable with a reason) or reopens it. */
export function setRemarkState(store: ProjectStore, id: string, state: RemarkState, note: string | null, now = new Date()): ExpertRemark {
	const all = readRemarks(store);
	const r = all.find((x) => x.id === id);
	if (!r) throw new Error(`Atzinuma piezīme ${id} nav atrasta.`);
	if (state === "na" && !(note ?? "").trim()) throw new Error("Lai atzītu par neaktuālu, jānorāda pamatojums.");
	const next: ExpertRemark = { ...r, state, note: state === "open" ? null : (note ?? "").trim() || null, decidedAt: state === "open" ? null : now.toISOString() };
	write(store, all.map((x) => (x.id === id ? next : x)), "expert.state", "user", { id, state });
	return next;
}

/** Who answers it and which daļa it belongs to: the user's to set, since the text does not always say. */
export function editRemark(store: ProjectStore, id: string, patch: { responsible?: string | null; daļa?: string | null }): ExpertRemark {
	const all = readRemarks(store);
	const r = all.find((x) => x.id === id);
	if (!r) throw new Error(`Atzinuma piezīme ${id} nav atrasta.`);
	const next: ExpertRemark = { ...r, ...("responsible" in patch ? { responsible: patch.responsible?.trim() || null } : {}), ...("daļa" in patch ? { daļa: patch.daļa?.trim().toUpperCase() || null } : {}) };
	write(store, all.map((x) => (x.id === id ? next : x)), "expert.edited", "user", { id });
	return next;
}

// ---- views -------------------------------------------------------------------------------------------------------------------

const group = (rs: ExpertRemark[], key: (r: ExpertRemark) => string): GroupRow[] => {
	const m = new Map<string, GroupRow>();
	for (const r of rs) {
		const k = key(r);
		const g = m.get(k) ?? { key: k, total: 0, open: 0, critical: 0 };
		g.total++;
		if (r.state === "open") {
			g.open++;
			if (r.critical) g.critical++;
		}
		m.set(k, g);
	}
	return [...m.values()].sort((a, b) => b.open - a.open || a.key.localeCompare(b.key, "lv"));
};

export function summarize(rs: ExpertRemark[]): ExpertSummary {
	return {
		total: rs.length,
		open: rs.filter((r) => r.state === "open").length,
		done: rs.filter((r) => r.state === "done").length,
		na: rs.filter((r) => r.state === "na").length,
		critical: rs.filter((r) => r.critical).length,
		openCritical: rs.filter((r) => r.critical && r.state === "open").length,
		byDaļa: group(rs, (r) => r.daļa ?? "nenoteikta"),
		byResponsible: group(rs, (r) => r.responsible ?? "nenorādīts"),
	};
}

/** The open remarks of one daļa (null = those with no daļa) as a fix list: ported from BIM Crew generate_discipline_instructions. */
export function fixList(rs: ExpertRemark[], daļa: string | null, opts: { project?: string; date?: string; titleOf?: (sourceId: string) => string } = {}): string {
	const mine = rs.filter((r) => r.state === "open" && (r.daļa ?? null) === daļa).sort((a, b) => Number(b.critical) - Number(a.critical) || a.page - b.page);
	const lines = [`# Labojumu saraksts — ${daļa ?? "daļa nav norādīta"}`, "", ...(opts.project ? [`**Projekts:** ${opts.project}`] : []), `**Sagatavots:** ${opts.date ?? new Date().toISOString().slice(0, 10)}`, "", `## Veicamie labojumi (${mine.length})`, ""];
	if (!mine.length) lines.push("Atvērtu piezīmju nav.");
	mine.forEach((r, i) => {
		lines.push(`### ${i + 1}.${r.code ? ` ${r.code}` : ""}${r.critical ? " — KRITISKS" : ""}`, "");
		lines.push(`**Atzinumā (${opts.titleOf?.(r.sourceId) ?? r.sourceId}, ${r.page}. lpp.):** ${r.quote}`, "");
		if (r.section) lines.push(`**Sadaļa:** ${r.section}`, "");
		if (r.responsible) lines.push(`**Atbildīgais:** ${r.responsible}`, "");
		if (r.reply) lines.push(`**Atbilde dokumentā:** ${r.reply}`, "");
		lines.push("**Statuss:** [ ] neizpildīts", "", "---", "");
	});
	return lines.join("\n");
}
