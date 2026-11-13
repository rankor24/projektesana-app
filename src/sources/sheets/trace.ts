// Sheet change → IFC element (task 8.11). A sheet compare (5.4) says what changed on a drawing: a room's area, a door mark, a
// text. This finds the element in the model that the label names, checks the area against the model, and — when the old model is
// given — lists the elements round it that moved or were resized between the two models (2 mm) as the likely cause. Ported from
// BIM Crew core/sheet_ifc_trace.py. The honest limit is kept: a PDF has no link to the model, so the match is by the sheet's own
// labels (room number, name, door mark); a change with no label, a moved line or a dimension, cannot be traced and says so.
// The core is pure over a TraceModel; reading it out of an IFC is sources/ifc-trace-model.ts.
import type { CauseElement, ShapeChange, TraceItem, TraceMatch, TraceResult } from "../../shared/trace-types.js";
import type { PageDiff, PageText, SheetPage } from "./vector-diff.js";

export type { CauseElement, ShapeChange, TraceItem, TraceMatch, TraceResult } from "../../shared/trace-types.js";

export type Box = [number, number, number, number, number, number];

/** One element of a model, as the trace needs it. Boxes are metres, computed only when asked for. */
export interface TraceElement {
	guid: string;
	cls: string;
	name: string | null;
	longName: string | null;
	/** the normalised strings a sheet label can match: name, long name, tag, object type, and the number / mark properties */
	keys: string[];
	area: number | null;
	/** the elements bounding it (spaces only), by GlobalId */
	boundedBy: string[];
	/** plan position, metres */
	origin: [number, number] | null;
	box(): Box | null;
}

export interface TraceModel {
	/** the elements a label can name: spaces, doors, windows, and the solids by their names */
	elements: TraceElement[];
	/** any element or space of the model by its GlobalId */
	find(guid: string): TraceElement | undefined;
	/** walls, columns and curtain walls with a plan position: where to look when a space has no boundaries */
	solids: TraceElement[];
}

export const AREA_TOL = 0.06; // m², the sheet shows one decimal
export const BOX_TOL = 0.002; // m
const NEARBY_M = 15;
const NEARBY_MAX = 30;
const CAUSES_MAX = 40;
const CONTEXT_MM = 45;

/** Comparison key: single-spaced and case-folded. */
export const norm = (s: string | null | undefined): string => String(s ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("lv-LV");

/** How an element's box differs between two models; null when it differs by no more than the tolerance. */
export function boxChange(a: Box | null, b: Box | null): ShapeChange | null {
	if (!a || !b) return null;
	const d = a.map((_, i) => b[i] - a[i]);
	if (Math.max(...d.map(Math.abs)) <= BOX_TOL) return null;
	const sa = [a[3] - a[0], a[4] - a[1], a[5] - a[2]];
	const sb = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
	const ds = sb.map((v, i) => v - sa[i]);
	const c = [0, 1, 2].map((i) => (b[i] + b[i + 3] - (a[i] + a[i + 3])) / 2);
	const resized = Math.max(...ds.map(Math.abs)) > BOX_TOL;
	const moved = Math.max(...c.map(Math.abs)) > BOX_TOL;
	return { change: moved && resized ? "moved and resized" : resized ? "resized" : "moved", dxMm: Math.round(c[0] * 1000), dyMm: Math.round(c[1] * 1000), dzMm: Math.round(c[2] * 1000), dsizeMm: ds.map((v) => Math.round(v * 1000)) as [number, number, number] };
}

export function numberIn(text: string | undefined): number | null {
	const m = /[-+]?\d+(?:[.,]\d+)?/.exec(text ?? "");
	return m ? Number(m[0].replace(",", ".")) : null;
}

export function tokensOf(item: TraceItem): string[] {
	const toks = (item.context ?? "").split(/\s*·\s*/).map(norm).filter(Boolean);
	if (item.kind === "text") for (const v of [item.old, item.new]) if (v) toks.push(norm(v));
	return [...new Set(toks)].filter((t) => t.length >= 2);
}

const WORD = "[\\p{L}\\p{N}_]";
/** 3 = the label is the whole key; 2 = it stands as a word inside a key; 0 = no match. A short token (1–2 characters) matches only whole. */
export function matchScore(token: string, keys: string[]): number {
	let best = 0;
	const word = token.length >= 3 ? new RegExp(`(?<!${WORD})${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!${WORD})`, "u") : null;
	for (const k of keys) {
		if (k === token) best = Math.max(best, 3);
		else if (word?.test(k)) best = Math.max(best, 2);
	}
	return best;
}

const isSpace = (e: TraceElement) => /^ifcspace$/i.test(e.cls);

function causesOf(space: TraceElement, nw: TraceModel, old: TraceModel | null): TraceMatch["causes"] | undefined {
	if (!old) return undefined;
	let cands = space.boundedBy.map((g) => nw.find(g)).filter((e): e is TraceElement => !!e);
	let via: "space-boundary" | "nearby" = "space-boundary";
	if (!cands.length) {
		via = "nearby";
		const b = space.box();
		const c: [number, number] | null = b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2] : space.origin;
		if (!c) return undefined;
		cands = nw.solids
			.filter((e) => e.origin)
			.map((e) => ({ e, d: Math.hypot(e.origin![0] - c[0], e.origin![1] - c[1]) }))
			.sort((x, y) => x.d - y.d)
			.slice(0, NEARBY_MAX)
			.filter((x) => x.d <= NEARBY_M)
			.map((x) => x.e);
	}
	const elements: CauseElement[] = [];
	for (const el of cands.slice(0, CAUSES_MAX)) {
		const was = old.find(el.guid);
		if (!was) {
			elements.push({ guid: el.guid, cls: el.cls, name: el.name, change: "added" });
			continue;
		}
		const ch = boxChange(was.box(), el.box());
		if (ch) elements.push({ guid: el.guid, cls: el.cls, name: el.name, change: ch.change, dxMm: ch.dxMm, dyMm: ch.dyMm, dzMm: ch.dzMm, dsizeMm: ch.dsizeMm });
	}
	return { via, elements };
}

/** The elements of the new model that the item's labels name, the area check, and the likely causes. */
export function traceItem(item: TraceItem, nw: TraceModel, old: TraceModel | null): TraceResult {
	const tokens = tokensOf(item);
	const found = new Map<string, { score: [number, number]; el: TraceElement }>();
	for (const el of nw.elements) {
		const sc = Math.max(0, ...tokens.map((t) => matchScore(t, el.keys)));
		if (sc < 2) continue;
		const score: [number, number] = [sc, isSpace(el) && item.kind === "area" ? 1 : 0];
		const prev = found.get(el.guid);
		if (!prev || score[0] > prev.score[0] || (score[0] === prev.score[0] && score[1] > prev.score[1])) found.set(el.guid, { score, el });
	}
	const ranked = [...found.values()].sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1]).slice(0, 6);
	const sheetNew = numberIn(item.new);
	const matches = ranked.map(({ el }): TraceMatch => {
		const was = old?.find(el.guid);
		const m: TraceMatch = { guid: el.guid, cls: el.cls, name: el.name, longName: el.longName, inOld: old ? !!was : null };
		if (isSpace(el)) {
			const aNew = el.area;
			const aOld = was?.area ?? null;
			m.area = { old: aOld, new: aNew };
			if (item.kind === "area" && aNew !== null && sheetNew !== null) m.sheetAgreesWithModel = Math.abs(aNew - sheetNew) <= Math.max(AREA_TOL, 0.005 * sheetNew);
			if (item.kind === "area" && aOld !== null && aNew !== null && Math.abs(aNew - aOld) > AREA_TOL) m.modelAreaChanged = true;
			const c = causesOf(el, nw, old);
			if (c) m.causes = c;
		} else if (was) {
			const ch = boxChange(was.box(), el.box());
			if (ch) m.shapeChange = ch;
		}
		return m;
	});
	return { itemId: item.id, tokens, matches };
}

// ---- from the sheet compare to items --------------------------------------------------------------------------------------

const AREA_TEXT = /^\d{1,4}[.,]\d{1,2}(?:\s*(?:m2|m²))?$/i;
const label = (s: string) => /[\p{L}]|\d[-./]\d/u.test(s) && !/^\d{2,6}(?:[.,]\d{1,2})?$/.test(s);

/** The labels round a text on the sheet: texts within CONTEXT_MM that are labels rather than dimension numbers, nearest first. */
export function contextOf(at: PageText, page: SheetPage): string {
	return page.texts
		.filter((t) => t !== at && t.str !== at.str && Math.hypot(t.x - at.x, t.y - at.y) <= CONTEXT_MM && label(t.str.trim()))
		.sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y))
		.slice(0, 4)
		.map((t) => t.str.trim())
		.join(" · ");
}

export interface Untraceable {
	text: string;
	why: string;
}

/** What a page's changes give to trace, and what cannot be traced (a line or a bare dimension has no label to find). */
export function itemsFromPage(diff: PageDiff, a: SheetPage, b: SheetPage, prefix = ""): { items: TraceItem[]; untraceable: Untraceable[] } {
	const items: TraceItem[] = [];
	const untraceable: Untraceable[] = [];
	let n = 0;
	const next = () => `${prefix}${a.page}.${++n}`;
	for (const c of diff.changes) {
		if (c.kind === "dimension-changed") {
			if (AREA_TEXT.test(c.to.str.trim()) && AREA_TEXT.test(c.from.str.trim())) items.push({ id: next(), kind: "area", old: c.from.str, new: c.to.str, context: contextOf(c.to, b) });
			else untraceable.push({ text: `izmērs ${c.from.str} → ${c.to.str}`, why: "izmēram nav iezīmes lapā: modelī to var atrast tikai pēc līnijām, bet PDF ar modeli nav saistīts" });
		} else if (c.kind === "text-added") items.push({ id: next(), kind: "text", new: c.text.str, context: contextOf(c.text, b) });
		else if (c.kind === "text-removed") items.push({ id: next(), kind: "text", old: c.text.str, context: contextOf(c.text, a) });
		else if (c.kind === "text-moved") items.push({ id: next(), kind: "text", old: c.from.str, new: c.to.str, context: contextOf(c.to, b) });
		else untraceable.push({ text: c.kind.startsWith("line-added") ? "jauna līnija" : c.kind === "line-removed" ? "noņemta līnija" : "pārvietota līnija", why: "līnijai nav iezīmes: izsekot nevar (to var darīt tikai cilvēks, skatoties modeli)" });
	}
	return { items, untraceable };
}

// ---- in words ------------------------------------------------------------------------------------------------------------

const m2 = (v: number | null) => (v === null ? "nav" : `${v.toFixed(2).replace(".", ",")} m²`);

/** One match as sentences for the list and the agent. */
export function describeMatch(item: TraceItem, m: TraceMatch): string[] {
	const out = [`${m.cls.replace(/^Ifc/, "")} ${[m.name, m.longName].filter(Boolean).join(" ")}`.trim()];
	if (m.inOld === false) out.push("šī elementa vecajā modelī nebija");
	if (m.area) {
		out.push(`modeļa platība ${m2(m.area.new)}${m.area.old !== null ? ` (agrāk ${m2(m.area.old)})` : ""}`);
		if (m.sheetAgreesWithModel === true) out.push(`lapas ${item.new} sakrīt ar modeli`);
		if (m.sheetAgreesWithModel === false) out.push(`lapas ${item.new} NESAKRĪT ar modeli: lapa un modelis nav no vienas versijas, vai platība lapā nav atjaunota`);
		if (m.modelAreaChanged) out.push("platība modelī ir mainījusies starp versijām");
	}
	if (m.shapeChange) out.push(`${m.shapeChange.change === "moved" ? "pārvietots" : m.shapeChange.change === "resized" ? "mainīts izmērs" : "pārvietots un mainīts izmērs"} par ${m.shapeChange.dxMm}; ${m.shapeChange.dyMm}; ${m.shapeChange.dzMm} mm`);
	if (m.causes) {
		out.push(m.causes.elements.length ? `iespējamie cēloņi (${m.causes.via === "space-boundary" ? "telpas robežas" : "tuvumā"}):` : `${m.causes.via === "space-boundary" ? "telpas robežu" : "tuvumā esošo"} elementu izmaiņu nav`);
		for (const e of m.causes.elements) out.push(`  ${e.cls.replace(/^Ifc/, "")} ${e.name ?? ""}: ${e.change === "added" ? "jauns" : `${e.change === "moved" ? "pārvietots" : e.change === "resized" ? "mainīts izmērs" : "pārvietots un mainīts izmērs"} (${e.dxMm}; ${e.dyMm}; ${e.dzMm} mm)`}`.trimEnd());
	}
	return out;
}
