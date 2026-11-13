// The shapes of the sheet-to-element trace (task 8.11), shared by the trace core, the handler and the sheet compare view.
// Types only, no node imports. The computing is in sources/sheets/trace.ts.

/** One change on a sheet that has a label to look for: a room's area, a door mark, a text. */
export interface TraceItem {
	id: string;
	kind: "area" | "text";
	old?: string;
	new?: string;
	/** the labels round the change on the sheet, joined with " · " ("1-7 · Virtuve") */
	context?: string;
}

export interface ShapeChange {
	change: "moved" | "resized" | "moved and resized";
	dxMm: number;
	dyMm: number;
	dzMm: number;
	dsizeMm: [number, number, number];
}

export interface CauseElement {
	guid: string;
	cls: string;
	name: string | null;
	change: "added" | ShapeChange["change"];
	dxMm?: number;
	dyMm?: number;
	dzMm?: number;
	dsizeMm?: [number, number, number];
}

export interface TraceMatch {
	guid: string;
	cls: string;
	name: string | null;
	longName: string | null;
	/** is the element in the old model (null = no old model given) */
	inOld: boolean | null;
	area?: { old: number | null; new: number | null };
	/** the sheet's new area is the model's, within the sheet's rounding */
	sheetAgreesWithModel?: boolean;
	modelAreaChanged?: boolean;
	/** elements round a space that changed between the models: its boundaries when it has them, else what is nearby */
	causes?: { via: "space-boundary" | "nearby"; elements: CauseElement[] };
	shapeChange?: ShapeChange;
}

export interface TraceResult {
	itemId: string;
	tokens: string[];
	matches: TraceMatch[];
}

export interface TraceRow {
	sheetNo: string | null;
	page: number;
	item: TraceItem;
	tokens: string[];
	/** each match with its sentences for the list */
	matches: (TraceMatch & { lines: string[] })[];
}

export interface TraceView {
	rows: TraceRow[];
	/** changes with no label to look for: a moved line, a bare dimension */
	untraceable: { sheetNo: string | null; text: string; why: string }[];
	/** how many labelled changes there were in all (the list is cut) */
	total: number;
}
