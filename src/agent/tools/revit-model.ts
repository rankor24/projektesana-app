// The Revit work the agent used to do with a shell (2026-11-24): open a view, read and change a schedule's filters, read parameters (also from the other open model), write one
// parameter on many elements. The Revit MCP server has no tool for these (and send_code_to_revit is never the agent's, levels.ts), so the agent fell back on run_command
// with Windows UI automation to click through Revit's project browser — which is now refused outright (levels.ts revitShellBlock). These are the named commands instead: each is
// one short snippet through the app's own Revit client (like revit-commands.ts), with a nonce on every reply (exports.ts).
//
// Levels: the reads and "open a view" are `run` (auto): `run`, not `read`, so a lane or a specialist does not get them unless its spec lists them — a lane never uses Revit
// (subagents.ts). A change to the model (a schedule's filters, a parameter's value) is `confirm`: the user clicks per batch, and only on the project's working copy
// (thread-runner.ts: every `revit_*` batch). The C# runs in the add-in's Revit session, in the active document; reading from another open model is read-only.
import { z } from "zod";
import { runSnippet } from "../../revit/exports.js";
import { revit } from "./revit-commands.js";
import { tool, type ToolDef } from "./tool.js";

/** Picks one schedule by id or exact name into `vs` / `def`; says which ones match when the name is not enough. Parameters: [idIndex, nameIndex]. */
const pickSchedule = (idAt: number, nameAt: number) => `var sid = (string)parameters[${idAt}]; var snm = (string)parameters[${nameAt}];
ViewSchedule vs = null;
if (sid.Length > 0) vs = document.GetElement(new ElementId(long.Parse(sid))) as ViewSchedule;
else {
  var found = new FilteredElementCollector(document).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>().Where(x => !x.IsTitleblockRevisionSchedule && x.Name == snm).ToList();
  if (found.Count > 1) throw new System.Exception("Vairākas specifikācijas ar šo nosaukumu; dod viewId: " + string.Join(", ", found.Select(x => x.Id.ToString())));
  if (found.Count == 1) vs = found[0];
}
if (vs == null) throw new System.Exception("Specifikācija nav atrasta (revit_list_views kind=schedule).");
var def = vs.Definition;`;

/** The filters of a schedule definition as rows: index, field name, type, value. C# text, used inside the snippets below. */
const FILTER_ROWS = `Func<List<object>> rows = () => {
  var res = new List<object>(); var fl = def.GetFilters();
  for (int i = 0; i < fl.Count; i++) {
    var f = fl[i]; string val = null;
    if (f.IsStringValue) val = f.GetStringValue();
    else if (f.IsDoubleValue) val = f.GetDoubleValue().ToString(System.Globalization.CultureInfo.InvariantCulture);
    else if (f.IsIntegerValue) val = f.GetIntegerValue().ToString();
    else if (f.IsElementIdValue) val = f.GetElementIdValue().ToString();
    res.Add(new { index = i, field = def.GetField(f.FieldId).GetName(), type = f.FilterType.ToString(), value = val });
  }
  return res;
};`;

export const MODEL_SNIPPETS = {
	// parameters: [kind, nameContains]; kind: all | plan | schedule | sheet | 3d | section | elevation
	listViews: `var kind = (string)parameters[0]; var q = ((string)parameters[1]).ToLowerInvariant();
var res = new List<object>(); int total = 0;
foreach (View v in new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()) {
  if (v.IsTemplate) continue;
  var sch = v as ViewSchedule;
  if (sch != null && (sch.IsTitleblockRevisionSchedule || sch.IsInternalKeynoteSchedule)) continue;
  string type = sch != null ? "Schedule" : v.ViewType.ToString();
  if (type == "ProjectBrowser" || type == "SystemBrowser" || type == "Internal" || type == "Undefined") continue;
  string k = sch != null ? "schedule" : v.ViewType == ViewType.DrawingSheet ? "sheet" : v.ViewType == ViewType.ThreeD ? "3d" : v.ViewType == ViewType.Section ? "section" : v.ViewType == ViewType.Elevation ? "elevation" : (v.ViewType == ViewType.FloorPlan || v.ViewType == ViewType.CeilingPlan || v.ViewType == ViewType.AreaPlan || v.ViewType == ViewType.EngineeringPlan) ? "plan" : "other";
  if (kind != "all" && k != kind) continue;
  if (q.Length > 0 && v.Name.ToLowerInvariant().IndexOf(q) < 0) continue;
  total++;
  if (res.Count >= 300) continue;
  var vp = v as ViewPlan;
  res.Add(new { id = v.Id.ToString(), name = v.Name, type = type, level = (vp != null && vp.GenLevel != null) ? vp.GenLevel.Name : null });
}
return new { total = total, shown = res.Count, views = res };`,
	// parameters: [viewId or "", exact name or ""]; the view is asked for, Revit switches to it when the call returns
	openView: `var sid = (string)parameters[0]; var nm = (string)parameters[1];
View v = null;
if (sid.Length > 0) v = document.GetElement(new ElementId(long.Parse(sid))) as View;
else {
  var all = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(x => !x.IsTemplate && x.Name == nm).ToList();
  if (all.Count > 1) throw new System.Exception("Vairāki skati ar šo nosaukumu; dod viewId: " + string.Join(", ", all.Select(x => x.Id.ToString() + " (" + x.ViewType + ")")));
  if (all.Count == 1) v = all[0];
}
if (v == null) throw new System.Exception("Skats nav atrasts (revit_list_views).");
new UIDocument(document).RequestViewChange(v);
return new { requested = v.Name, id = v.Id.ToString(), type = v.ViewType.ToString() };`,
	// parameters: [viewId or "", exact name or ""]
	getSchedule: `${pickSchedule(0, 1)}
${FILTER_ROWS}
var fields = new List<object>();
for (int i = 0; i < def.GetFieldCount(); i++) { var f = def.GetField(i); fields.Add(new { index = i, name = f.GetName(), hidden = f.IsHidden, type = f.FieldType.ToString() }); }
var sorts = new List<object>();
foreach (var s in def.GetSortGroupFields()) sorts.Add(new { field = def.GetField(s.FieldId).GetName(), order = s.SortOrder.ToString() });
var cat = Category.GetCategory(document, def.CategoryId);
return new { id = vs.Id.ToString(), name = vs.Name, category = cat != null ? cat.Name : null, itemized = def.IsItemized, rows = vs.GetTableData().GetSectionData(SectionType.Body).NumberOfRows, fields = fields, filters = rows(), sorting = sorts };`,
	// parameters: [viewId, name, op (add | set | remove | clear), field name, filter type, value, value kind (text | number | integer | elementId), filter index or "-1"]
	setScheduleFilter: `${pickSchedule(0, 1)}
${FILTER_ROWS}
var op = (string)parameters[2];
if (op == "clear") { for (int i = def.GetFilterCount() - 1; i >= 0; i--) def.RemoveFilter(i); return new { op = op, filters = rows() }; }
var fieldName = (string)parameters[3];
ScheduleField fld = null;
for (int i = 0; i < def.GetFieldCount(); i++) { var f = def.GetField(i); if (f.GetName() == fieldName) { fld = f; break; } }
if (fld == null) throw new System.Exception("Specifikācijā nav lauka \\"" + fieldName + "\\". Lauki: " + string.Join(", ", Enumerable.Range(0, def.GetFieldCount()).Select(i => def.GetField(i).GetName())));
int at = int.Parse((string)parameters[7]);
var existing = def.GetFilters();
if (at < 0) { for (int i = 0; i < existing.Count; i++) if (existing[i].FieldId.Equals(fld.FieldId)) { at = i; break; } }
if (op == "remove") {
  if (at < 0 || at >= existing.Count) throw new System.Exception("Šim laukam nav filtra.");
  def.RemoveFilter(at);
  return new { op = op, filters = rows() };
}
var ft = (ScheduleFilterType)System.Enum.Parse(typeof(ScheduleFilterType), (string)parameters[4], true);
var tn = ft.ToString(); var val = (string)parameters[5]; var kind = (string)parameters[6];
ScheduleFilter nf;
if (tn == "HasValue" || tn == "HasNoValue" || tn == "HasParameter" || tn == "HasNoParameter") nf = new ScheduleFilter(fld.FieldId, ft);
else if (kind == "number") nf = new ScheduleFilter(fld.FieldId, ft, double.Parse(val, System.Globalization.CultureInfo.InvariantCulture));
else if (kind == "integer") nf = new ScheduleFilter(fld.FieldId, ft, int.Parse(val));
else if (kind == "elementId") nf = new ScheduleFilter(fld.FieldId, ft, new ElementId(long.Parse(val)));
else nf = new ScheduleFilter(fld.FieldId, ft, val);
if (op == "set" && at >= 0 && at < existing.Count) def.SetFilter(at, nf); else def.AddFilter(nf);
return new { op = op, filters = rows() };`,
	// parameters: [model (part of an open model's name or path, "" = the active one), category (Rooms, Walls, … = OST_<name>), element ids (comma separated, "" = the category), parameter names joined by "|", limit]
	readParameters: `var mm = (string)parameters[0]; var catName = (string)parameters[1]; var idsCsv = (string)parameters[2];
var names = ((string)parameters[3]).Split(new[] { '|' }, System.StringSplitOptions.RemoveEmptyEntries); int limit = int.Parse((string)parameters[4]);
Document d = document;
if (mm.Length > 0) {
  var hits = new List<Document>();
  foreach (var pass in new[] { false, true }) {
    foreach (Document x in document.Application.Documents) { if (x.IsLinked != pass) continue; if (x.Title.IndexOf(mm, System.StringComparison.OrdinalIgnoreCase) >= 0 || x.PathName.IndexOf(mm, System.StringComparison.OrdinalIgnoreCase) >= 0) hits.Add(x); }
    if (hits.Count > 0) break;
  }
  if (hits.Count != 1) throw new System.Exception(hits.Count == 0 ? "Nav atvērta vai piesaistīta modeļa: " + mm + " (revit_list_models)" : "Vairāki modeļi atbilst \\"" + mm + "\\": " + string.Join(", ", hits.Select(x => x.Title)));
  d = hits[0];
}
List<Element> els;
if (idsCsv.Length > 0) els = idsCsv.Split(',').Select(s => d.GetElement(new ElementId(long.Parse(s.Trim())))).Where(e => e != null).ToList();
else {
  BuiltInCategory bic;
  if (!System.Enum.TryParse("OST_" + catName, true, out bic)) throw new System.Exception("Nezināma kategorija: " + catName + " (piem. Rooms, Walls, Doors, Windows, Floors, Areas).");
  els = new FilteredElementCollector(d).OfCategory(bic).WhereElementIsNotElementType().ToList();
}
Func<Parameter, object> show = p => {
  if (p == null) return null;
  if (!p.HasValue) return "";
  if (p.StorageType == StorageType.String) return p.AsString();
  if (p.StorageType == StorageType.Integer) return p.AsInteger();
  return p.AsValueString();
};
var res = new List<object>();
foreach (var e in els.Take(limit)) {
  var vals = new Dictionary<string, object>();
  foreach (var n in names) {
    var p = e.LookupParameter(n);
    if (p == null) { var t = d.GetElement(e.GetTypeId()); if (t != null) p = t.LookupParameter(n); }
    vals[n] = show(p);
  }
  var num = e.get_Parameter(BuiltInParameter.ROOM_NUMBER);
  var lv = d.GetElement(e.LevelId);
  var room = e as Autodesk.Revit.DB.Architecture.Room;
  res.Add(new { id = e.Id.ToString(), name = e.Name, number = num != null ? num.AsString() : null, level = lv != null ? lv.Name : null, placed = room != null ? (bool?)(room.Location != null) : null, areaM2 = room != null ? (double?)System.Math.Round(room.Area * 0.09290304, 2) : null, values = vals });
}
return new { model = d.Title, total = els.Count, shown = res.Count, elements = res };`,
	// parameters: [parameter name, records "id<US>value" joined by <RS>] (US = \\u001f, RS = \\u001e). Strings and whole numbers are set as given; a number with units is set the way Revit
	// reads it typed in (SetValueString, in the project's units), never as a raw internal value.
	setParameter: `var pname = (string)parameters[0];
int written = 0; var skipped = new List<object>();
foreach (var rec in ((string)parameters[1]).Split('\\u001e')) {
  var kv = rec.Split(new[] { '\\u001f' }, 2);
  var e = document.GetElement(new ElementId(long.Parse(kv[0])));
  if (e == null) { skipped.Add(new { id = kv[0], why = "elements nav atrasts" }); continue; }
  var p = e.LookupParameter(pname);
  if (p == null) { skipped.Add(new { id = kv[0], why = "elementam nav šāda parametra" }); continue; }
  if (p.IsReadOnly) { skipped.Add(new { id = kv[0], why = "parametrs ir tikai lasāms" }); continue; }
  bool done = false;
  if (p.StorageType == StorageType.String) done = p.Set(kv[1]);
  else if (p.StorageType == StorageType.Integer) { int n; done = int.TryParse(kv[1], out n) ? p.Set(n) : p.SetValueString(kv[1]); }
  else if (p.StorageType == StorageType.Double) done = p.SetValueString(kv[1]);
  if (done) written++; else skipped.Add(new { id = kv[0], why = "vērtību \\"" + kv[1] + "\\" parametrs nepieņem" });
}
return new { parameter = pname, written = written, skippedCount = skipped.Count, skipped = skipped.Take(50).ToList() };`,
	// no parameters: the open models, and the links of the active one
	listModels: `var active = document.Title;
var open = new List<object>();
foreach (Document x in document.Application.Documents) open.Add(new { title = x.Title, path = x.PathName, linked = x.IsLinked, active = x.Title == active && !x.IsLinked, modified = x.IsModified });
var links = new List<object>();
foreach (RevitLinkInstance li in new FilteredElementCollector(document).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>()) { var ld = li.GetLinkDocument(); links.Add(new { instance = li.Name, loaded = ld != null, title = ld != null ? ld.Title : null }); }
return new { active = active, models = open, links = links };`,
	// parameters: [viewId or "" , exact name or "" (both empty = the active view), categories joined by "|" (names after OST_, e.g. Rooms|RoomTags)]
	getViewSettings: `var sid = (string)parameters[0]; var nm = (string)parameters[1];
View v = null;
if (sid.Length > 0) v = document.GetElement(new ElementId(long.Parse(sid))) as View;
else if (nm.Length > 0) {
  var all = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(x => !x.IsTemplate && x.Name == nm).ToList();
  if (all.Count > 1) throw new System.Exception("Vairāki skati ar šo nosaukumu; dod viewId: " + string.Join(", ", all.Select(x => x.Id.ToString())));
  if (all.Count == 1) v = all[0];
} else v = document.ActiveView;
if (v == null) throw new System.Exception("Skats nav atrasts (revit_list_views).");
var tpl = document.GetElement(v.ViewTemplateId) as View;
var vp = v as ViewPlan;
object range = null;
if (vp != null) {
  var vr = vp.GetViewRange();
  Func<PlanViewPlane, object> plane = pv => { var lid = vr.GetLevelId(pv); var lv = document.GetElement(lid) as Level; return new { levelId = lid.ToString(), level = lv != null ? lv.Name : "(speciāls: negatīvs id = Unlimited / līmenis virs / zem)", offsetMm = System.Math.Round(vr.GetOffset(pv) * 304.8, 1) }; };
  range = new { top = plane(PlanViewPlane.TopClipPlane), cut = plane(PlanViewPlane.CutPlane), bottom = plane(PlanViewPlane.BottomClipPlane), viewDepth = plane(PlanViewPlane.ViewDepthPlane) };
}
var cats = new List<object>();
foreach (var cn in ((string)parameters[2]).Split(new[] { '|' }, System.StringSplitOptions.RemoveEmptyEntries)) {
  BuiltInCategory bic;
  if (!System.Enum.TryParse("OST_" + cn, true, out bic)) { cats.Add(new { category = cn, error = "nezināma kategorija" }); continue; }
  var cid = new ElementId(bic);
  cats.Add(new { category = cn, canHide = v.CanCategoryBeHidden(cid), hidden = v.CanCategoryBeHidden(cid) ? (bool?)v.GetCategoryHidden(cid) : null });
}
var ph = v.get_Parameter(BuiltInParameter.VIEW_PHASE); var pf = v.get_Parameter(BuiltInParameter.VIEW_PHASE_FILTER);
return new { id = v.Id.ToString(), name = v.Name, type = v.ViewType.ToString(), scale = v.Scale, template = tpl != null ? tpl.Name : null, cropActive = v.CropBoxActive, cropVisible = v.CropBoxVisible, phase = ph != null ? ph.AsValueString() : null, phaseFilter = pf != null ? pf.AsValueString() : null, viewRange = range, categories = cats };`,
	// parameters: [viewId, name, cropActive ("" | true | false), cropVisible, categories "Rooms=true|RoomTags=true", removeTemplate ("" | true), viewRange "top=2300;cut=1200;bottom=0;depth=0" (mm offsets from the plane's own level)]
	setViewSettings: `var sid = (string)parameters[0]; var nm = (string)parameters[1];
View v = null;
if (sid.Length > 0) v = document.GetElement(new ElementId(long.Parse(sid))) as View;
else if (nm.Length > 0) {
  var all = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>().Where(x => !x.IsTemplate && x.Name == nm).ToList();
  if (all.Count > 1) throw new System.Exception("Vairāki skati ar šo nosaukumu; dod viewId: " + string.Join(", ", all.Select(x => x.Id.ToString())));
  if (all.Count == 1) v = all[0];
}
if (v == null) throw new System.Exception("Skats nav atrasts (revit_list_views).");
var done = new List<string>(); var skipped = new List<string>();
if ((string)parameters[5] == "true") { v.ViewTemplateId = ElementId.InvalidElementId; done.Add("skata veidne noņemta"); }
if (((string)parameters[2]).Length > 0) { v.CropBoxActive = (string)parameters[2] == "true"; done.Add("cropActive=" + v.CropBoxActive); }
if (((string)parameters[3]).Length > 0) { v.CropBoxVisible = (string)parameters[3] == "true"; done.Add("cropVisible=" + v.CropBoxVisible); }
foreach (var pair in ((string)parameters[4]).Split(new[] { '|' }, System.StringSplitOptions.RemoveEmptyEntries)) {
  var kv = pair.Split('=');
  BuiltInCategory bic;
  if (kv.Length != 2 || !System.Enum.TryParse("OST_" + kv[0], true, out bic)) { skipped.Add(pair + ": nezināma kategorija"); continue; }
  var cid = new ElementId(bic);
  if (!v.CanCategoryBeHidden(cid)) { skipped.Add(kv[0] + ": šajā skatā nevar paslēpt/rādīt"); continue; }
  v.SetCategoryHidden(cid, kv[1] != "true"); done.Add(kv[0] + (kv[1] == "true" ? " redzams" : " paslēpts"));
}
if (((string)parameters[6]).Length > 0) {
  var vp = v as ViewPlan;
  if (vp == null) throw new System.Exception("Skata diapazons ir tikai plāniem.");
  var r = vp.GetViewRange();
  foreach (var part in ((string)parameters[6]).Split(new[] { ';' }, System.StringSplitOptions.RemoveEmptyEntries)) {
    var kv = part.Split('=');
    double ft = double.Parse(kv[1], System.Globalization.CultureInfo.InvariantCulture) / 304.8;
    if (kv[0] == "top") r.SetOffset(PlanViewPlane.TopClipPlane, ft);
    else if (kv[0] == "cut") r.SetOffset(PlanViewPlane.CutPlane, ft);
    else if (kv[0] == "bottom") r.SetOffset(PlanViewPlane.BottomClipPlane, ft);
    else if (kv[0] == "depth") r.SetOffset(PlanViewPlane.ViewDepthPlane, ft);
    else throw new System.Exception("Nezināma diapazona daļa: " + kv[0]);
  }
  vp.SetViewRange(r); done.Add("skata diapazons: " + (string)parameters[6]);
}
return new { view = v.Name, id = v.Id.ToString(), done = done, skipped = skipped };`,
} as const;

const RS = "\u001e";
const US = "\u001f";

const VIEW_KINDS = ["all", "plan", "schedule", "sheet", "3d", "section", "elevation"] as const;
const pickOne = (a: { viewId?: string; name?: string }, what: string) => {
	if (!a.viewId && !a.name) throw new Error(`Dod ${what}: viewId (no revit_list_views) vai precīzu nosaukumu name.`);
};

export const revitModelTools: ToolDef[] = [
	tool({
		name: "revit_list_views",
		level: "run",
		description: "The open Revit model's views with their ids: floor plans, schedules, sheets, 3D, sections, elevations (kind, default all; nameContains narrows). Use it to find the id of a view or schedule before revit_open_view, revit_get_schedule or revit_set_schedule_filter. Never use a shell for this.",
		input: { kind: z.enum(VIEW_KINDS).default("all"), nameContains: z.string().default("") },
		run: async (_ctx, { kind, nameContains }) => runSnippet(revit(), MODEL_SNIPPETS.listViews, [kind, nameContains]),
	}),
	tool({
		name: "revit_open_view",
		level: "run",
		description: "Open a view in Revit (a floor plan, schedule, sheet or 3D view) by viewId or by exact name — the same as double-clicking it in the project browser. It changes what Revit shows, not the model. This is the way to open a view: never click through Revit's windows with a script. Check with get_current_view_info after.",
		input: { viewId: z.string().optional(), name: z.string().optional() },
		run: async (_ctx, a) => {
			pickOne(a, "skatu");
			return runSnippet(revit(), MODEL_SNIPPETS.openView, [a.viewId ?? "", a.viewId ? "" : (a.name ?? "")]);
		},
	}),
	tool({
		name: "revit_get_schedule",
		level: "run",
		description: "A schedule's definition: category, fields (name, hidden), filters (index, field, type, value), sorting, itemized, row count. Read it before changing its filters.",
		input: { viewId: z.string().optional(), name: z.string().optional() },
		run: async (_ctx, a) => {
			pickOne(a, "specifikāciju");
			return runSnippet(revit(), MODEL_SNIPPETS.getSchedule, [a.viewId ?? "", a.viewId ? "" : (a.name ?? "")]);
		},
	}),
	tool({
		name: "revit_set_schedule_filter",
		level: "confirm",
		description:
			"Change a schedule's filters: op add | set (replace the filter on that field, or the one at `index`) | remove | clear (all). `field` is a field of the schedule by name (revit_get_schedule lists them, hidden ones too). `filterType`: Equal, NotEqual, GreaterThan, GreaterThanOrEqual, LessThan, LessThanOrEqual, Contains, NotContains, BeginsWith, NotBeginsWith, EndsWith, NotEndsWith, HasValue, HasNoValue, HasParameter. `valueKind`: text (default), number (length and area in Revit's internal units: feet, square feet), integer, elementId. The user confirms the batch; only on the working copy.",
		input: {
			viewId: z.string().optional(),
			name: z.string().optional(),
			op: z.enum(["add", "set", "remove", "clear"]),
			field: z.string().optional(),
			filterType: z.string().default("Equal"),
			value: z.string().default(""),
			valueKind: z.enum(["text", "number", "integer", "elementId"]).default("text"),
			index: z.number().int().min(0).optional(),
		},
		run: async (_ctx, a) => {
			pickOne(a, "specifikāciju");
			if (a.op !== "clear" && !a.field) throw new Error("Dod lauku field (revit_get_schedule parāda laukus).");
			return runSnippet(revit(), MODEL_SNIPPETS.setScheduleFilter, [a.viewId ?? "", a.viewId ? "" : (a.name ?? ""), a.op, a.field ?? "", a.filterType, a.value, a.valueKind, String(a.index ?? -1)], "auto");
		},
	}),
	tool({
		name: "revit_read_parameters",
		level: "run",
		description:
			"Read parameter values of elements: by `category` (Rooms, Walls, Doors, Windows, Floors, Areas, …) or by `elementIds`; `parameters` are the names as Revit shows them. Every row has id, name, number, level, placed and areaM2 (rooms) and the values (numbers with units as Revit writes them; null = the element has no such parameter). `model` reads from another open or linked model (a part of its name, e.g. the UR model; revit_list_models shows them) — read only, to compare or copy values into the working model with revit_set_parameter. Max 500 rows per call.",
		input: {
			category: z.string().optional(),
			elementIds: z.array(z.string()).max(500).optional(),
			parameters: z.array(z.string().min(1)).min(1).max(20),
			model: z.string().optional(),
			limit: z.number().int().min(1).max(500).default(500),
		},
		run: async (_ctx, a) => {
			if (!a.category && !a.elementIds?.length) throw new Error("Dod category (piem. Rooms) vai elementIds.");
			return runSnippet(revit(), MODEL_SNIPPETS.readParameters, [a.model ?? "", a.elementIds?.length ? "" : (a.category ?? ""), (a.elementIds ?? []).join(","), a.parameters.join("|"), String(a.limit)]);
		},
	}),
	tool({
		name: "revit_list_models",
		level: "run",
		description: "The Revit models that are open (title, path, which one is active) and the links of the active model. Use it before reading across models (revit_read_parameters model=…). Only the active model can be changed.",
		input: {},
		run: async () => runSnippet(revit(), MODEL_SNIPPETS.listModels),
	}),
	tool({
		name: "revit_get_view_settings",
		level: "run",
		description:
			"Why does something not show in a view? A view's settings: view template, crop box (active / visible), phase and phase filter, for a plan the view range (top, cut, bottom, view depth: level and offset in mm), and whether categories are hidden (`categories`, names as OST_ without the prefix: Rooms, RoomTags, Walls, Areas, …). No viewId and no name = the active view. A room that is placed but not drawn is usually a hidden Rooms category, a view template that controls it, a phase filter or the view range; a room with placed=false (revit_read_parameters) is not on any plan.",
		input: { viewId: z.string().optional(), name: z.string().optional(), categories: z.array(z.string()).default(["Rooms", "RoomTags"]) },
		run: async (_ctx, a) => runSnippet(revit(), MODEL_SNIPPETS.getViewSettings, [a.viewId ?? "", a.viewId ? "" : (a.name ?? ""), a.categories.join("|")]),
	}),
	tool({
		name: "revit_set_view_settings",
		level: "confirm",
		description:
			"Change a view's settings: `categories` [{ category: \"Rooms\", visible: true }], `cropActive`, `cropVisible`, `viewRange` { topMm, cutMm, bottomMm, viewDepthMm } (offsets from each plane's own level), `removeTemplate` (true detaches the view template: do that only when revit_get_view_settings shows the template controls what you need, and say so). A category that the view template controls is refused — read the template first. The user confirms the batch; only on the working copy.",
		input: {
			viewId: z.string().optional(),
			name: z.string().optional(),
			categories: z.array(z.object({ category: z.string().min(1), visible: z.boolean() })).optional(),
			cropActive: z.boolean().optional(),
			cropVisible: z.boolean().optional(),
			viewRange: z.object({ topMm: z.number().optional(), cutMm: z.number().optional(), bottomMm: z.number().optional(), viewDepthMm: z.number().optional() }).optional(),
			removeTemplate: z.boolean().optional(),
		},
		run: async (_ctx, a) => {
			pickOne(a, "skatu");
			const vr = a.viewRange;
			const range = vr ? [["top", vr.topMm], ["cut", vr.cutMm], ["bottom", vr.bottomMm], ["depth", vr.viewDepthMm]].filter(([, v]) => typeof v === "number").map(([k, v]) => `${k}=${v}`).join(";") : "";
			const flag = (b: boolean | undefined) => (b === undefined ? "" : String(b));
			return runSnippet(revit(), MODEL_SNIPPETS.setViewSettings, [a.viewId ?? "", a.viewId ? "" : (a.name ?? ""), flag(a.cropActive), flag(a.cropVisible), (a.categories ?? []).map((c) => `${c.category}=${c.visible}`).join("|"), a.removeTemplate ? "true" : "", range], "auto");
		},
	}),
	tool({
		name: "revit_set_parameter",
		level: "confirm",
		description:
			"Set one parameter on many elements of the working model: `parameter` (name as Revit shows it) and `items` [{ elementId, value }]. Text and whole numbers are set as given; a number with units as you would type it in Revit (project units, e.g. \"12,5\"). Skips what has no such parameter, is read-only or is refused, and says which. Max 500 items per call. The user confirms the batch; only on the working copy. To copy values from another open model, read them there with revit_read_parameters (model) first.",
		input: { parameter: z.string().min(1), items: z.array(z.object({ elementId: z.string().regex(/^\d+$/), value: z.string() })).min(1).max(500) },
		run: async (_ctx, a) => runSnippet(revit(), MODEL_SNIPPETS.setParameter, [a.parameter, a.items.map((i) => `${i.elementId}${US}${i.value}`).join(RS)], "auto"),
	}),
];
