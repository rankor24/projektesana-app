// The Versijas page (task 9.9): the changes between two dates filtered by kind, and how a picked change opens in the viewer —
// two models side by side with the camera linked, BimCraft's own compare as one tab (overlay, only the changes), or a sheet
// pair in the sheet compare. Pure and node-free: the page and the tests use the same functions.
import type { VersionRow } from "./api.js";
import type { ViewTarget } from "./viewer.js";

export type ChangeKind = VersionRow["kind"];
export const KINDS: ChangeKind[] = ["source", "delivery", "revision", "data"];
export const KIND_LABEL: Record<ChangeKind, string> = { source: "avots", delivery: "nodevums", revision: "revīzija", data: "dati" };

/** Kinds filter the list; none chosen = every kind. */
export function filterRows(rows: VersionRow[], kinds: ReadonlySet<ChangeKind>): VersionRow[] {
	return kinds.size === 0 ? rows : rows.filter((r) => kinds.has(r.kind));
}
export function kindCounts(rows: VersionRow[]): Record<ChangeKind, number> {
	const out: Record<ChangeKind, number> = { source: 0, delivery: 0, revision: 0, data: 0 };
	for (const r of rows) out[r.kind]++;
	return out;
}
/** The id of a change as a comment points at it: the day and what it is. */
export const changeId = (r: Pick<VersionRow, "at" | "label">): string => `${r.at.slice(0, 10)} ${r.label}`.slice(0, 120);

/** side = two panes (models) · overlay = BimCraft's compare / the sheet overlay · changes = only what differs */
export type CompareMode = "side" | "overlay" | "changes";

export type OpenPlan =
	| { how: "open"; target: ViewTarget; label: string }
	| { how: "compare"; target: Extract<ViewTarget, { kind: "compare" }>; label: string }
	| { how: "split"; a: { target: ViewTarget; label: string }; b: { target: ViewTarget; label: string }; dir: "h" | "v"; linkedCamera: boolean }
	| { how: "none"; why: string };

/**
 * How a picked change opens. A change with a compare: two models go side by side (camera linked) in "side", BimCraft's own
 * compare in the other modes; a sheet pair is always the sheet compare (it shows both issues itself), "changes" listing only the
 * sheets that differ. A change with no compare opens its file; one with nothing to open says so.
 */
export function planFor(row: VersionRow, mode: CompareMode, dir: "h" | "v" = "h"): OpenPlan {
	const c = row.compare;
	if (c) {
		if (c.mode === "ifc" && mode === "side") return { how: "split", a: { target: { kind: "ifc", path: c.a, label: c.aLabel }, label: c.aLabel }, b: { target: { kind: "ifc", path: c.b, label: c.bLabel }, label: c.bLabel }, dir, linkedCamera: true };
		const target: Extract<ViewTarget, { kind: "compare" }> = { kind: "compare", a: c.a, b: c.b, aLabel: c.aLabel, bLabel: c.bLabel, mode: c.mode, ...(c.mode === "sheet" && mode === "changes" ? { only: true } : {}) };
		return { how: "compare", target, label: `${c.aLabel} ↔ ${c.bLabel}` };
	}
	if (row.open?.ifc) return { how: "open", target: { kind: "ifc", path: row.open.ifc, label: row.label }, label: row.label };
	if (row.open?.sourceId) return { how: "open", target: { kind: "source", sourceId: row.open.sourceId }, label: row.label };
	return { how: "none", why: "Šai izmaiņai nav, ko atvērt." };
}

/** What the mode buttons offer for a row: a model pair has all three, a sheet pair two, a lone file none. */
export function modesFor(row: VersionRow | null): CompareMode[] {
	if (!row?.compare) return [];
	return row.compare.mode === "ifc" ? ["side", "overlay", "changes"] : ["overlay", "changes"];
}
