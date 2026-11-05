// Revit commands the APP calls itself (spec §6, §9): export PDF/IFC, save work copy, read view geometry, summary.
// Each is one short, single-purpose snippet for send_code_to_revit (Boris's rule: small code, one read or write per call).
// The code body runs inside `Execute(Document document, object[] parameters)` of the add-in's template.
// STATUS: written from the add-in source and the Revit API; NOT run against a live Revit (none was connected). See spike/README.md.
import type { ViewGeometry } from "../../kernel/pins.js";
import type { RoomRow } from "../../kernel/diff.js";

/** Whatever carries a tool call to the Revit MCP server. */
export interface RevitCaller {
	call(tool: string, args: Record<string, unknown>): Promise<string>;
}

export const SNIPPETS = {
	docInfo: `var v = document.ActiveView;
return new { title = document.Title, path = document.PathName, version = document.Application.VersionNumber, isFamily = document.IsFamilyDocument, view = v.Name, viewId = v.Id.ToString() };`,

	// parameters: [folder, fileName, viewId]. Crop boundaries stay visible so the app can measure where the view sits on the page.
	exportPdf: `var o = new PDFExportOptions { FileName = (string)parameters[1], Combine = true, HideCropBoundaries = false };
var ids = new List<ElementId> { new ElementId(long.Parse((string)parameters[2])) };
return document.Export((string)parameters[0], ids, o);`,

	listViews: `return new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
  .Where(v => !v.IsTemplate && (v.ViewType == ViewType.FloorPlan || v.ViewType == ViewType.Elevation || v.ViewType == ViewType.Section || v.ViewType == ViewType.CeilingPlan || v.ViewType == ViewType.ThreeD))
  .Select(v => new { id = v.Id.ToString(), name = v.Name, type = v.ViewType.ToString() }).ToList();`,

	// parameters: [folder, fileName]. IFC export is done inside a transaction (transactionMode "auto").
	exportIfc: `var o = new IFCExportOptions();
o.FileVersion = IFCVersion.IFC4;
return document.Export((string)parameters[0], (string)parameters[1], o);`,

	// parameters: [fullPathOfWorkCopy]. SaveAs re-points the open document to the copy: the original file is never touched again.
	saveAsWork: `document.SaveAs((string)parameters[0], new SaveAsOptions { OverwriteExistingFile = false });
return document.PathName;`,

	save: `document.Save();
return document.PathName;`,

	// transactionMode "auto". Creates a floor plan for every level that has none; returns the created view names.
	createMissingPlans: `var vft = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
var have = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().Where(v => !v.IsTemplate && v.ViewType == ViewType.FloorPlan && v.GenLevel != null).Select(v => v.GenLevel.Id.ToString()).ToList();
var made = new List<string>();
foreach (Level l in new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>())
  if (!have.Contains(l.Id.ToString())) made.Add(ViewPlan.Create(document, vft.Id, l.Id).Name);
return made;`,

	// parameters: [viewId, scale] ; transactionMode "auto"
	setViewScale: `var v = (View)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
v.Scale = int.Parse((string)parameters[1]);
return v.Scale;`,

	// parameters: [planViewId] ; transactionMode "auto". Four elevation views around the middle of the plan's crop box.
	createElevations: `var vft = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.Elevation);
var plan = (ViewPlan)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
var c = (plan.CropBox.Min + plan.CropBox.Max) / 2;
var m = ElevationMarker.CreateElevationMarker(document, vft.Id, new XYZ(c.X, c.Y, 0), plan.Scale);
var names = new List<string>();
for (int i = 0; i < 4; i++) names.Add(m.CreateElevation(document, plan.Id, i).Name);
return names;`,

	// parameters: [sheetNumber, sheetName, viewId] ; transactionMode "auto". First title block family found; the view goes near the sheet origin.
	createSheet: `var tb = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks).OfClass(typeof(FamilySymbol)).FirstElementId();
var sheet = ViewSheet.Create(document, tb);
sheet.SheetNumber = (string)parameters[0];
sheet.Name = (string)parameters[1];
Viewport.Create(document, sheet.Id, new ElementId(long.Parse((string)parameters[2])), new XYZ(1, 0.7, 0));
return sheet.Id.ToString();`,

	// parameters: [viewId]
	viewGeometry: `var v = (View)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
var vp = v as ViewPlan;
double ft = 304.8;
var cb = v.CropBox;
var t = cb.Transform;
return new {
  id = v.Id.ToString(), name = v.Name, type = v.ViewType.ToString(), scale = v.Scale, cropActive = v.CropBoxActive,
  level = (vp != null && vp.GenLevel != null) ? vp.GenLevel.Name : null,
  elevMm = (vp != null && vp.GenLevel != null) ? (double?)(vp.GenLevel.Elevation * ft) : null,
  min = new[] { cb.Min.X * ft, cb.Min.Y * ft }, max = new[] { cb.Max.X * ft, cb.Max.Y * ft },
  origin = new[] { t.Origin.X * ft, t.Origin.Y * ft, t.Origin.Z * ft },
  right = new[] { t.BasisX.X, t.BasisX.Y, t.BasisX.Z }, up = new[] { t.BasisY.X, t.BasisY.Y, t.BasisY.Z }
};`,

	summary: `var rooms = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
  .Cast<Autodesk.Revit.DB.Architecture.Room>().Where(r => r.Area > 0)
  .Select(r => new { id = r.UniqueId, name = r.Name, level = r.Level != null ? r.Level.Name : "", areaM2 = Math.Round(r.Area * 0.09290304, 3) }).ToList();
var levels = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>().Select(l => new { name = l.Name, elevMm = Math.Round(l.Elevation * 304.8, 1) }).ToList();
int walls = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Walls).WhereElementIsNotElementType().GetElementCount();
int floors = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_Floors).WhereElementIsNotElementType().GetElementCount();
return new { rooms, levels, walls, floors };`,
} as const;

/** The server answers "Code execution successful!\nResult: {...}"; the add-in puts the returned object in as a JSON string. */
export function parseCodeResult(text: string): unknown {
	if (/^Code execution failed/i.test(text.trim())) throw new Error(text.trim());
	const i = text.indexOf("Result:");
	const body = (i >= 0 ? text.slice(i + 7) : text).trim();
	let v: unknown = JSON.parse(body);
	// outer envelope {Success, Result, ErrorMessage}
	if (v && typeof v === "object" && "Success" in v) {
		const env = v as { Success: boolean; Result?: string; ErrorMessage?: string };
		if (!env.Success) throw new Error(env.ErrorMessage ?? "Revit kļūda");
		v = env.Result === undefined ? null : env.Result;
	}
	// the add-in serialises the returned object once more
	if (typeof v === "string") {
		try {
			return JSON.parse(v);
		} catch {
			return v;
		}
	}
	return v;
}

async function snippet(r: RevitCaller, code: keyof typeof SNIPPETS, parameters: string[] = [], transactionMode: "auto" | "none" = "none"): Promise<unknown> {
	return parseCodeResult(await r.call("send_code_to_revit", { code: SNIPPETS[code], parameters, transactionMode }));
}

export type RevitStatus = { state: "not connected"; reason: string } | { state: "connected"; instances: { pid: number }[]; selectedPid: number | null };

export async function revitStatus(r: RevitCaller): Promise<RevitStatus> {
	try {
		const j = JSON.parse(await r.call("list_revit_instances", {})) as { count: number; selectedPid: number | null; instances: { pid: number }[]; note?: string };
		return j.count > 0 ? { state: "connected", instances: j.instances, selectedPid: j.selectedPid } : { state: "not connected", reason: j.note ?? "Nav Revit instances." };
	} catch (e) {
		return { state: "not connected", reason: (e as Error).message };
	}
}

export interface DocInfo {
	title: string;
	path: string;
	version: string;
	isFamily: boolean;
	view: string;
	viewId: string;
}
export const docInfo = (r: RevitCaller) => snippet(r, "docInfo") as Promise<DocInfo>;

/** The active document must be the expected working copy; anything else stops the run (spec §6 item 0). */
export async function ensureActiveDocument(r: RevitCaller, expectedPath: string): Promise<DocInfo> {
	const d = await docInfo(r);
	if (d.path.toLowerCase() !== expectedPath.toLowerCase()) throw new Error(`Revit aktīvais dokuments ir ${d.path || "(nesaglabāts)"}, nevis ${expectedPath}. Atver darba kopiju.`);
	return d;
}

export const exportPdf = (r: RevitCaller, folder: string, fileName: string, viewId: string) => snippet(r, "exportPdf", [folder, fileName, viewId]) as Promise<boolean>;

export interface ViewRef {
	id: string;
	name: string;
	type: string;
}
export const listViews = (r: RevitCaller) => snippet(r, "listViews") as Promise<ViewRef[]>;
export const exportIfc = (r: RevitCaller, folder: string, fileName: string) => snippet(r, "exportIfc", [folder, fileName], "auto") as Promise<boolean>;
export const saveAsWorkCopy = (r: RevitCaller, fullPath: string) => snippet(r, "saveAsWork", [fullPath]) as Promise<string>;
export const saveWork = (r: RevitCaller) => snippet(r, "save") as Promise<string>;

export const createMissingPlans = (r: RevitCaller) => snippet(r, "createMissingPlans", [], "auto") as Promise<string[]>;
export const setViewScale = (r: RevitCaller, viewId: string, scale: number) => snippet(r, "setViewScale", [viewId, String(scale)], "auto") as Promise<number>;
export const createElevations = (r: RevitCaller, planViewId: string) => snippet(r, "createElevations", [planViewId], "auto") as Promise<string[]>;
export const createSheet = (r: RevitCaller, number: string, name: string, viewId: string) => snippet(r, "createSheet", [number, name, viewId], "auto") as Promise<string>;

interface RawGeometry {
	id: string;
	name: string;
	scale: number;
	level: string | null;
	elevMm: number | null;
	min: [number, number];
	max: [number, number];
	origin: [number, number, number];
	right: [number, number, number];
	up: [number, number, number];
}

/** pageRect says where the cropped view sits on the exported page; it comes from the PDF (measured by the app), not from Revit. */
export async function viewGeometry(r: RevitCaller, viewId: string, pageRect: ViewGeometry["pageRect"]): Promise<ViewGeometry> {
	const g = (await snippet(r, "viewGeometry", [viewId])) as RawGeometry;
	return { viewId: Number(g.id), viewName: g.name, levelName: g.level, elevationMm: g.elevMm, scale: g.scale, cropMin: g.min, cropMax: g.max, origin: g.origin, right: g.right, up: g.up, pageRect };
}

export interface ModelSummary {
	rooms: RoomRow[];
	levels: { name: string; elevMm: number }[];
	walls: number;
	floors: number;
}
export const modelSummary = (r: RevitCaller) => snippet(r, "summary") as Promise<ModelSummary>;
