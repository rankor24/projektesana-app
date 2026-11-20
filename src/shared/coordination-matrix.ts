// The coordination matrix (task 9.8): models down, the three groups of the audit across — Novietne (base point), Hierarhija
// (project / site / building / schema), Stāvi (storeys) — a count of remarks or a tick in each cell, a dash where the model has
// no IFC to measure. Built from the audit the Koordinācija page already has, never a second measurement. Pure and node-free.
import type { AuditReport, ModelReport, ReportGroupName, ReportLine } from "../core/coordination-types.js";

export const GROUPS: ReportGroupName[] = ["Novietne", "Hierarhija", "Stāvi"];

export interface MatrixCell {
	group: ReportGroupName;
	/** ok = measured and agrees (a tick); fix = n remarks; none = nothing to measure (no IFC) */
	state: "ok" | "fix" | "none";
	count: number;
	lines: ReportLine[];
}
export interface MatrixRow {
	/** the discipline code ("AR") or the file name for a model that could not be read */
	code: string;
	file: string;
	source: "ifc" | "revit" | "unreadable";
	/** why a cell is a dash */
	note?: string;
	cells: MatrixCell[];
	total: number;
}
export interface CoordMatrix {
	groups: ReportGroupName[];
	rows: MatrixRow[];
	/** every remark in every cell */
	total: number;
}

const cellOf = (group: ReportGroupName, m: ModelReport | null, measured: boolean): MatrixCell => {
	if (!m || !measured) return { group, state: "none", count: 0, lines: [] };
	const lines = m.groups.find((g) => g.g === group)?.lines ?? [];
	return { group, state: lines.length ? "fix" : "ok", count: lines.length, lines };
};

/**
 * Rows in the order of the audit (the models as they were read), then the IFC files that could not be read (all dashes, the
 * reason as the note); the open Revit document is measured on its storeys only, so its other cells are dashes.
 */
export function coordMatrix(audit: AuditReport | null, errors: { file: string; message: string }[] = []): CoordMatrix {
	const rows: MatrixRow[] = [];
	for (const m of audit?.models ?? []) {
		const revit = m.source === "revit";
		const cells = GROUPS.map((g) => cellOf(g, m, !revit || g === "Stāvi"));
		rows.push({ code: m.code, file: m.file, source: m.source, ...(revit ? { note: "atvērtais Revit dokuments: tikai stāvi" } : {}), cells, total: cells.reduce((n, c) => n + c.count, 0) });
	}
	const have = new Set(rows.map((r) => r.file));
	for (const e of errors) {
		if (have.has(e.file)) continue;
		rows.push({ code: e.file, file: e.file, source: "unreadable", note: e.message, cells: GROUPS.map((g) => cellOf(g, null, false)), total: 0 });
	}
	return { groups: GROUPS, rows, total: rows.reduce((n, r) => n + r.total, 0) };
}

/** A cell's remarks as the lines the right-hand window prints: "action: now → to", with the question when there is one. */
export function cellLines(matrix: CoordMatrix, file: string, group: ReportGroupName): { text: string; ask?: string }[] {
	const cell = matrix.rows.find((r) => r.file === file)?.cells.find((c) => c.group === group);
	return (cell?.lines ?? []).map((l) => ({ text: `${l.w}: ${l.now} → ${l.to}`, ...(l.ask ? { ask: l.ask } : {}) }));
}

/** The questions still to decide on a model's row (K4): its remarks that carry an "ask", every group together. */
export const rowQuestions = (r: MatrixRow): string[] => r.cells.flatMap((c) => c.lines.filter((l) => l.ask).map((l) => `${c.group}: ${l.ask}`));

/** What a cell shows: a tick, the count, or a dash. */
export const cellText = (c: MatrixCell): string => (c.state === "ok" ? "✓" : c.state === "fix" ? String(c.count) : "—");

/** The model a click isolates in the scene (null = show every model again). */
export const sceneTarget = (matrix: CoordMatrix, file: string | null): string | null => (file && matrix.rows.some((r) => r.file === file && r.source !== "revit" && r.source !== "unreadable") ? file : null);
