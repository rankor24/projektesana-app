// The app's named Revit commands as agent tools (work plan "Agent tools": run level — exports, working copy, view geometry,
// the room table; confirm level — the named commands of phase 6 that create views and sheets). They run in the tools
// server with its own Revit client; every call carries a nonce (exports.ts). Files land in the project's data folder only.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { checkWrite } from "../../core/guard.js";
import { RevitClient, resolveRevitLaunch } from "../../revit/client.js";
import { revitExport, runSnippet } from "../../revit/exports.js";
import { makeWorkCopy } from "../../revit/revision.js";
import { inventoryTables } from "../../sources/room-table.js";
import { writeXlsx } from "../../sources/export/xlsx.js";
import { storeOf, type ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

let client: RevitClient | null = null;
function revit(): RevitClient {
	const serverJs = process.env.PROJEKTESANA_REVIT_JS || null;
	const node = process.env.PROJEKTESANA_REVIT_NODE || null;
	client ??= new RevitClient(() => resolveRevitLaunch({ revitServerJs: serverJs, revitNode: node }), process.execPath);
	if (!client.configured()) throw new Error("nav konfigurēts: Revit MCP serveris nav atrasts.");
	return client;
}

const exportsDir = (ctx: ToolCtx) => {
	const store = storeOf(ctx);
	const dir = join(store.dir, "exports");
	const g = checkWrite(store.guard, dir);
	if (!g.ok) throw new Error(g.reason);
	mkdirSync(dir, { recursive: true });
	return { store, dir };
};
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const safe = (s: string) => s.replace(/[^\p{L}\d._ -]+/gu, "_").slice(0, 60) || "skats";

/** Short named snippets that create views and sheets (from v1 src/main/revit/commands.ts, each one action). */
export const CREATE_SNIPPETS = {
	createMissingPlans: `var vft = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.FloorPlan);
var have = new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().Where(v => !v.IsTemplate && v.ViewType == ViewType.FloorPlan && v.GenLevel != null).Select(v => v.GenLevel.Id.ToString()).ToList();
var made = new List<string>();
foreach (Level l in new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()) if (!have.Contains(l.Id.ToString())) made.Add(ViewPlan.Create(document, vft.Id, l.Id).Name);
return made;`,
	setViewScale: `var v = (View)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
v.Scale = int.Parse((string)parameters[1]);
return v.Scale;`,
	createElevations: `var vft = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(t => t.ViewFamily == ViewFamily.Elevation);
var plan = (ViewPlan)document.GetElement(new ElementId(long.Parse((string)parameters[0])));
var c = (plan.CropBox.Min + plan.CropBox.Max) / 2;
var m = ElevationMarker.CreateElevationMarker(document, vft.Id, new XYZ(c.X, c.Y, 0), plan.Scale);
var names = new List<string>();
for (int i = 0; i < 4; i++) names.Add(m.CreateElevation(document, plan.Id, i).Name);
return names;`,
	createSheet: `var tb = new FilteredElementCollector(document).OfCategory(BuiltInCategory.OST_TitleBlocks).OfClass(typeof(FamilySymbol)).FirstElementId();
var sheet = ViewSheet.Create(document, tb);
sheet.SheetNumber = (string)parameters[0];
sheet.Name = (string)parameters[1];
if (((string)parameters[2]).Length > 0) Viewport.Create(document, sheet.Id, new ElementId(long.Parse((string)parameters[2])), new XYZ(1, 0.7, 0));
return sheet.Id.ToString();`,
} as const;

export const revitCommandTools: ToolDef[] = [
	tool({
		name: "export_room_table",
		level: "run",
		description: "Write the inventory room table(s) to an Excel file in the project's data folder (exports).",
		input: {},
		run: async (ctx) => {
			const { store, dir } = exportsDir(ctx);
			const t = await inventoryTables(store);
			if (!t.length) return "no data: telpu tabula nav atrasta.";
			const file = join(dir, `${store.project.id}_telpas_${stamp()}.xlsx`);
			writeFileSync(file, writeXlsx(t.map((x) => ({ name: x.title.slice(0, 31), rows: [["Stāvs", "Telpas Nr.", "Nosaukums", "Platība, m²", "Lapa"], ...x.table.rows.map((r) => [r.floor, r.no, r.name, r.area, r.page])] }))));
			return { ok: true, file };
		},
	}),
	tool({
		name: "revit_view_geometry",
		level: "run",
		description: "A view's crop box, scale, level and transform in the model (mm) — to trace a sheet back to the model.",
		input: { viewId: z.string() },
		run: async (_ctx, { viewId }) => revitExport.viewGeometry(revit(), viewId),
	}),
	tool({
		name: "revit_export_pdf",
		level: "run",
		description: "Export one or more views or sheets of the open model to one PDF in the project's data folder (exports).",
		input: { viewIds: z.array(z.string()).min(1).max(200), name: z.string().min(1) },
		run: async (ctx, { viewIds, name }) => {
			const { dir } = exportsDir(ctx);
			const file = `${safe(name)}_${stamp()}`;
			await revitExport.exportPdf(revit(), dir, file, viewIds);
			const out = join(dir, `${file}.pdf`);
			if (!existsSync(out)) throw new Error(`Revit neizveidoja ${out}`);
			return { ok: true, file: out };
		},
	}),
	tool({
		name: "revit_export_ifc",
		level: "run",
		description: "Export the open model to IFC (IFC4) in the project's data folder (exports).",
		input: {},
		run: async (ctx) => {
			const { store, dir } = exportsDir(ctx);
			const file = `${store.project.id}_${stamp()}.ifc`;
			await revitExport.exportIfc(revit(), dir, file);
			if (!existsSync(join(dir, file))) throw new Error(`Revit neizveidoja ${file}`);
			return { ok: true, file: join(dir, file) };
		},
	}),
	tool({
		name: "revit_save_copy",
		level: "run",
		description: "Save the open model as this project's working copy (<name>_WORK.rvt in the data folder) and continue in it. The office file is not written.",
		input: {},
		run: async (ctx) => ({ ok: true, workCopy: await makeWorkCopy(storeOf(ctx), revit()) }),
	}),
	tool({
		name: "revit_create_plans",
		level: "confirm",
		description: "Create a floor plan view for every level that has none (one call). Boris confirms the batch.",
		input: {},
		run: async () => ({ ok: true, created: await runSnippet(revit(), CREATE_SNIPPETS.createMissingPlans, [], "auto") }),
	}),
	tool({
		name: "revit_set_view_scale",
		level: "confirm",
		description: "Set a view's scale (e.g. 100 for 1:100). Boris confirms the batch.",
		input: { viewId: z.string(), scale: z.number().int().min(1).max(5000) },
		run: async (_ctx, { viewId, scale }) => ({ ok: true, scale: await runSnippet(revit(), CREATE_SNIPPETS.setViewScale, [viewId, String(scale)], "auto") }),
	}),
	tool({
		name: "revit_create_elevations",
		level: "confirm",
		description: "Create the four elevations around a floor plan's crop box (one marker). Boris confirms the batch.",
		input: { planViewId: z.string() },
		run: async (_ctx, { planViewId }) => ({ ok: true, created: await runSnippet(revit(), CREATE_SNIPPETS.createElevations, [planViewId], "auto") }),
	}),
	tool({
		name: "revit_create_sheet",
		level: "confirm",
		description: "Create a sheet with a number and name (first title block), optionally placing one view on it. Boris confirms the batch.",
		input: { number: z.string().min(1), name: z.string().min(1), viewId: z.string().optional() },
		run: async (_ctx, { number, name, viewId }) => ({ ok: true, sheetId: await runSnippet(revit(), CREATE_SNIPPETS.createSheet, [number, name, viewId ?? ""], "auto") }),
	}),
];
