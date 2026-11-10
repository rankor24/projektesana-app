// Named Revit commands the app runs itself (task 6.1): list views, read a view's geometry, export a view or sheets to PDF,
// export IFC, save a working copy. Each is one short snippet, one action per call, through send_code_to_revit — which the
// agent may never call (levels.ts); these run only on the user's click or after a batch they confirmed.
//
// Found live on 2026-11-06: send_code_to_revit once answered with another snippet's result (the shared add-in port served
// a call from elsewhere). So every snippet here returns { nonce, value } with a nonce made for that call, and a reply with
// any other nonce is refused: a crossed reply is an error, never data.
import { randomBytes } from "node:crypto";
import type { RevitCaller } from "./client.js";
import { parseCodeResult, SNIPPETS } from "./commands.js";

export const newNonce = () => `pj-${randomBytes(6).toString("hex")}`;

/** The user code runs inside a lambda so its own `return` values become `value`; the nonce is the last parameter. */
export function wrap(code: string, paramCount: number): string {
	return `System.Func<object> __pj = () => {\n${code}\n};\nreturn new { nonce = (string)parameters[${paramCount}], value = __pj() };`;
}

export function parseNonced(text: string, nonce: string): unknown {
	const v = parseCodeResult(text) as { nonce?: unknown; value?: unknown } | null;
	if (!v || typeof v !== "object" || v.nonce !== nonce) throw new Error(`Revit atbilde nepieder šim izsaucienam (gaidīts ${nonce}, saņemts ${JSON.stringify((v as { nonce?: unknown } | null)?.nonce ?? v).slice(0, 80)}). Nekas netiek pieņemts; mēģini vēlreiz.`);
	return v.value ?? null;
}

export async function runSnippet(r: RevitCaller, code: string, parameters: string[] = [], transactionMode: "auto" | "none" = "none"): Promise<unknown> {
	const nonce = newNonce();
	const text = await r.call("send_code_to_revit", { code: wrap(code, parameters.length), parameters: [...parameters, nonce], transactionMode });
	return parseNonced(text, nonce);
}

export const EXPORT_SNIPPETS = {
	docInfo: `var v = document.ActiveView;
return new { title = document.Title, path = document.PathName, version = document.Application.VersionNumber, view = v.Name, viewId = v.Id.ToString() };`,
	listViews: `return new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
  .Where(v => !v.IsTemplate && (v.ViewType == ViewType.FloorPlan || v.ViewType == ViewType.DrawingSheet || v.ViewType == ViewType.ThreeD || v.ViewType == ViewType.Section || v.ViewType == ViewType.Elevation))
  .Select(v => new { id = v.Id.ToString(), name = v.Name, type = v.ViewType.ToString() }).ToList();`,
	// parameters: [viewId]
	viewGeometry: `var v = (View)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
var vp = v as ViewPlan; double ft = 304.8; var cb = v.CropBox; var t = cb.Transform;
return new { id = v.Id.ToString(), name = v.Name, type = v.ViewType.ToString(), scale = v.Scale, cropActive = v.CropBoxActive, level = (vp != null && vp.GenLevel != null) ? vp.GenLevel.Name : null, elevMm = (vp != null && vp.GenLevel != null) ? (double?)(vp.GenLevel.Elevation * ft) : null, min = new[] { cb.Min.X * ft, cb.Min.Y * ft }, max = new[] { cb.Max.X * ft, cb.Max.Y * ft }, origin = new[] { t.Origin.X * ft, t.Origin.Y * ft, t.Origin.Z * ft }, right = new[] { t.BasisX.X, t.BasisX.Y, t.BasisX.Z }, up = new[] { t.BasisY.X, t.BasisY.Y, t.BasisY.Z } };`,
	// the model's sheets (7.3): number, name, current revision; placeholders left out
	listSheets: `return new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
  .Where(s => !s.IsPlaceholder && !s.IsTemplate)
  .Select(s => { var p = s.get_Parameter(BuiltInParameter.SHEET_CURRENT_REVISION); return new { id = s.Id.ToString(), number = s.SheetNumber, name = s.Name, revision = p != null ? p.AsString() : null }; })
  .OrderBy(x => x.number).ToList();`,
	// parameters: [folder, fileName, viewId[,viewId…] comma-separated]; crop boundaries stay visible (the overlay measures them)
	exportPdf: `var o = new PDFExportOptions { FileName = (string)parameters[1], Combine = true, HideCropBoundaries = false };
var ids = ((string)parameters[2]).Split(',').Select(s => new ElementId(long.Parse(s))).ToList();
return document.Export((string)parameters[0], ids, o);`,
	// parameters: [folder, fileName, "IFC4" | "IFC2x3"]
	exportIfc: `var o = new IFCExportOptions();
o.FileVersion = (string)parameters[2] == "IFC2x3" ? IFCVersion.IFC2x3CV2 : IFCVersion.IFC4;
return document.Export((string)parameters[0], (string)parameters[1], o);`,
	// parameters: [full path of the working copy]; SaveAs re-points the open document to the copy: the original file is not
	// written again by anything the agent does afterwards
	saveAsWork: `document.SaveAs((string)parameters[0], new SaveAsOptions { OverwriteExistingFile = false });
return document.PathName;`,
} as const;

export interface ViewRow {
	id: string;
	name: string;
	type: string;
}

export interface SheetInfo {
	id: string;
	number: string;
	name: string;
	revision: string | null;
}

export interface ViewGeometry {
	id: string;
	name: string;
	type: string;
	scale: number;
	cropActive: boolean;
	level: string | null;
	elevMm: number | null;
	min: [number, number];
	max: [number, number];
	origin: [number, number, number];
	right: [number, number, number];
	up: [number, number, number];
}

export const revitExport = {
	docInfo: async (r: RevitCaller) => (await runSnippet(r, EXPORT_SNIPPETS.docInfo)) as { title: string; path: string; version: string; view: string; viewId: string },
	listViews: async (r: RevitCaller) => (await runSnippet(r, EXPORT_SNIPPETS.listViews)) as ViewRow[],
	listSheets: async (r: RevitCaller) => {
		const v = await runSnippet(r, EXPORT_SNIPPETS.listSheets);
		if (!Array.isArray(v)) throw new Error("Revit lapu saraksts nav saraksts.");
		return v.map((s: { id?: unknown; number?: unknown; name?: unknown; revision?: unknown }) => ({ id: String(s.id ?? ""), number: String(s.number ?? ""), name: String(s.name ?? ""), revision: s.revision == null || s.revision === "" ? null : String(s.revision) })) as SheetInfo[];
	},
	viewGeometry: async (r: RevitCaller, viewId: string) => (await runSnippet(r, EXPORT_SNIPPETS.viewGeometry, [viewId])) as ViewGeometry,
	/** transactionMode none: an export does not change the model */
	exportPdf: async (r: RevitCaller, folder: string, fileName: string, viewIds: string[]) => (await runSnippet(r, EXPORT_SNIPPETS.exportPdf, [folder, fileName, viewIds.join(",")])) as boolean,
	exportIfc: async (r: RevitCaller, folder: string, fileName: string, version: "IFC4" | "IFC2x3" = "IFC4") => (await runSnippet(r, EXPORT_SNIPPETS.exportIfc, [folder, fileName, version], "auto")) as boolean,
	saveAsWork: async (r: RevitCaller, path: string) => (await runSnippet(r, EXPORT_SNIPPETS.saveAsWork, [path])) as string,
};

/** "Model.rvt" → "Model_WORK.rvt"; a name that already ends in _WORK stays. */
export function workName(title: string): string {
	const base = title.replace(/\.rvt$/i, "");
	return /_WORK$/i.test(base) ? `${base}.rvt` : `${base}_WORK.rvt`;
}

export interface InvAreaItem {
	elementId: number;
	number: string;
	name: string;
	areaM2: number;
}

/** Writes INV Area on each room, one call per room, in order; stops at the first error and says which room. */
export async function writeInvArea(r: RevitCaller, items: InvAreaItem[], onProgress?: (done: number, total: number) => void): Promise<{ written: number; noParam: string[] }> {
	let written = 0;
	const noParam: string[] = [];
	for (const it of items) {
		if (!Number.isInteger(it.elementId) || !Number.isFinite(it.areaM2)) throw new Error(`Nederīga rinda: telpa ${it.number}`);
		let res: unknown;
		try {
			res = await runSnippet(r, SNIPPETS.setInvArea, [String(it.elementId), it.areaM2.toFixed(2)], "auto");
		} catch (e) {
			throw new Error(`Telpa ${it.number}: ${(e as Error).message} (ierakstītas ${written} no ${items.length})`);
		}
		if (res === "no-param") noParam.push(it.number);
		else written++;
		onProgress?.(written + noParam.length, items.length);
	}
	return { written, noParam };
}
