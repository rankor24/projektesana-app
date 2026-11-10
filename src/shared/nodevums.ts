// Shapes of "Nodot projektu" (work plan 7.2–7.6) that the renderer and main share. No I/O here: the renderer imports it.

export type ChecklistGroup = "Lapas" | "Modelis" | "Likums" | "Saskaņojumi";
/** trūkst = still to make; gatavs = in the staged set; pamatots = the user accepted a reason; pārbaudi = a person must look;
 *  neobligāts = not required for this kind */
export type RowStatus = "trūkst" | "gatavs" | "pamatots" | "pārbaudi" | "neobligāts";
/** what makes the row done: the page offers the matching button, the agent the matching tool */
export type RowAction = "revit_sheets" | "revit_ifc" | "file" | "justify" | "clock" | "requirements";

export interface ChecklistRow {
	id: string;
	group: ChecklistGroup;
	label: string;
	status: RowStatus;
	action: RowAction;
	/** law act and point, e.g. "MK 529 26.3" */
	citation?: string;
	requirementId?: string;
	/** staged files that meet the row (names) */
	files: string[];
	detail?: string;
}

export interface SheetRow {
	id: string;
	number: string;
	name: string;
}

export interface StageSheetsResult {
	exported: string[];
	/** already in staging and not replaced */
	kept: string[];
	/** asked for by number but not in the model */
	unknown: string[];
	total: number;
}

/** Where "Kopēt uz 1.4_Nodevumi" will write, shown to the user before the click (7.6). */
export interface CopyPlan {
	/** absolute target folder (…\1.4_Nodevumi\<kind folder>\<YYMMDD>) */
	target: string;
	files: number;
	bytes: number;
	/** why the copy cannot run now; empty = it can */
	blockers: string[];
}
