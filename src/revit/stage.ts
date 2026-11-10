// Revit → the staging folder of a draft (work plan 7.3, 7.4). Sheets: one PDF per sheet, one Revit call per sheet, named
// "<number>_<name>" (sheet-names.ts); the file is checked on disk after each call and a failed sheet stops the run and says
// which. IFC: one file named <BD code>_<daļa>_<YYMMDD>.ifc. Exports do not change the model. Writes only into staging.
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkWrite } from "../core/guard.js";
import type { ProjectStore } from "../core/store.js";
import type { Who } from "../core/model.js";
import { draftOf, refreshDraft } from "../sources/staging.js";
import type { RevitCaller } from "./client.js";
import { revitExport, type SheetInfo } from "./exports.js";
import { ifcFileName, sheetFileNames } from "./sheet-names.js";
import type { StageSheetsResult } from "../shared/nodevums.js";

export type { StageSheetsResult } from "../shared/nodevums.js";

const openDraft = (store: ProjectStore, deliveryId: string) => {
	const d = draftOf(store, deliveryId);
	if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4 — staging vairs nemaina.`);
	const g = checkWrite(store.guard, d.draft.stagingDir);
	if (!g.ok) throw new Error(g.reason);
	mkdirSync(d.draft.stagingDir, { recursive: true });
	return d;
};

const normNo = (s: string) => s.trim().toUpperCase().replace(/[\s_]+/g, "-");

/** Picks the sheets to export: all, or those whose number is listed (in the model's order). */
export function pickSheets(all: SheetInfo[], numbers?: string[]): { sheets: SheetInfo[]; unknown: string[] } {
	if (!numbers?.length) return { sheets: all, unknown: [] };
	const want = new Set(numbers.map(normNo));
	const sheets = all.filter((s) => want.has(normNo(s.number)));
	const have = new Set(sheets.map((s) => normNo(s.number)));
	return { sheets, unknown: numbers.filter((n) => !have.has(normNo(n))) };
}

export async function stageRevitSheets(
	store: ProjectStore,
	revit: RevitCaller,
	deliveryId: string,
	opts: { numbers?: string[]; replace?: boolean; onProgress?: (done: number, total: number, current: string) => void },
	by: Who,
): Promise<StageSheetsResult> {
	const d = openDraft(store, deliveryId);
	const { sheets, unknown } = pickSheets(await revitExport.listSheets(revit), opts.numbers);
	if (!sheets.length) throw new Error(opts.numbers?.length ? `Modelī nav lapu ${opts.numbers.join(", ")}.` : "Atvērtajā modelī nav lapu.");
	const names = sheetFileNames(sheets);
	const out: StageSheetsResult = { exported: [], kept: [], unknown, total: sheets.length };
	try {
		for (let i = 0; i < sheets.length; i++) {
			const file = `${names[i]}.pdf`;
			const target = join(d.draft.stagingDir, file);
			opts.onProgress?.(i, sheets.length, file);
			if (existsSync(target)) {
				if (!opts.replace) {
					out.kept.push(file);
					continue;
				}
				rmSync(target, { force: true });
			}
			try {
				await revitExport.exportPdf(revit, d.draft.stagingDir, names[i], [sheets[i].id]);
			} catch (e) {
				throw new Error(`Lapa ${sheets[i].number} “${sheets[i].name}”: ${(e as Error).message} (eksportētas ${out.exported.length} no ${sheets.length})`);
			}
			if (!existsSync(target)) {
				const near = readdirSync(d.draft.stagingDir).filter((n) => n.toLowerCase().startsWith(names[i].toLowerCase().slice(0, 6)));
				throw new Error(`Revit neizveidoja ${file}${near.length ? ` (mapē ir: ${near.slice(0, 3).join(", ")})` : ""}. Eksportētas ${out.exported.length} no ${sheets.length}.`);
			}
			out.exported.push(file);
		}
		opts.onProgress?.(sheets.length, sheets.length, "");
	} finally {
		refreshDraft(store, deliveryId, by);
		store.log({ kind: "delivery.sheets", by, data: { id: deliveryId, exported: out.exported.length, kept: out.kept.length } });
	}
	return out;
}

export async function stageRevitIfc(store: ProjectStore, revit: RevitCaller, deliveryId: string, opts: { part?: string; replace?: boolean }, by: Who): Promise<{ file: string }> {
	const d = openDraft(store, deliveryId);
	const file = ifcFileName(store.project.id, opts.part ?? "AR", d.draft.date);
	const other = readdirSync(d.draft.stagingDir).filter((n) => /\.ifc$/i.test(n));
	if (other.length && !opts.replace) throw new Error(`Nodevumā jau ir IFC: ${other.join(", ")}. Aizstāt var ar replace.`);
	if (opts.replace) for (const n of other.filter((n) => n.toLowerCase() === file.toLowerCase())) rmSync(join(d.draft.stagingDir, n), { force: true });
	try {
		await revitExport.exportIfc(revit, d.draft.stagingDir, file);
		if (!existsSync(join(d.draft.stagingDir, file))) throw new Error(`Revit neizveidoja ${file}`);
	} finally {
		refreshDraft(store, deliveryId, by);
	}
	store.log({ kind: "delivery.ifc", by, data: { id: deliveryId, file } });
	return { file: join(d.draft.stagingDir, file) };
}
