// 8.10 the shared-coordinates guide: steps worded with this project's reference, the topography it comes from (confirmed facts
// only), where to start from the open placement remarks, the note the panel keeps, the agent's read tool, and the delivery
// checklist's rows that depend on it. Invented projects.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { checklistOf } from "../src/checks/checklist.ts";
import { EMPTY_REFERENCE } from "../src/core/coordination.ts";
import type { CoordReference } from "../src/core/coordination-types.ts";
import type { Fact, Finding, Source } from "../src/core/model.ts";
import { Registry } from "../src/core/registry.ts";
import { ProjectStore } from "../src/core/store.ts";
import { coordinationHandlers } from "../src/main/handlers/coordination.ts";
import { coordinatesGuide, guideInput, guideSteps } from "../src/rules/coordinates-guide.ts";
import { refreshDraft, startDraft } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

const REF: CoordReference = { ...EMPTY_REFERENCE, basePoint: { x: "503298282", y: "312292339", z: "9450" }, hierarchy: { project: "Projekts", site: "Zeme", building: "Eka", schema: "IFC4" }, storeySchemes: [{ id: "default", label: "Pamatshēma", storeys: ["1.stavs", "2.stavs"], elevations: { "1.stavs": "9450", "2.stavs": "12600" }, disciplines: [] }], seededFrom: "modeļi", updatedAt: "2026-11-13T09:00:00.000Z" };
const TOPO = { sources: ["Topografija_2026.pdf"], author: "Mērnieks Ozols", surveyedOn: "2026-09-12", approvedOn: "2026-10-01" };
const input = (o: Partial<Parameters<typeof coordinatesGuide>[0]> = {}) => ({ project: { id: "BD900", name: "Testa iela 1" }, reference: REF, topo: TOPO, remarks: null, date: "2026-11-13", ...o });

test("the steps come in the order they are done, with the project's own numbers", () => {
	const steps = guideSteps(input());
	assert.deepEqual(steps.map((s) => s.id), ["units", "topo", "point", "z", "north", "levels", "cube", "ifc", "check"]);
	const by = (id: string) => steps.find((s) => s.id === id)!.lines.join("\n");
	assert.match(by("point"), /E\/W = 503 298 282,00 mm/);
	assert.match(by("point"), /N\/S = 312 292 339,00 mm/);
	assert.match(by("point"), /Elevation = 9 450,00 mm/);
	assert.match(by("levels"), /1\.stavs: 9 450,00 mm/);
	assert.match(by("levels"), /2\.stavs: 12 600,00 mm/);
	assert.match(by("cube"), /GVB_KUBS uz bāzes punkta \(503 298 282,00 mm, 312 292 339,00 mm, 9 450,00 mm\)/);
	assert.match(by("ifc"), /IfcProject «Projekts», IfcSite «Zeme», IfcBuilding «Eka», shēma IFC4/);
});

test("the topography step names the source and who surveyed it and when; with no source it says nothing can be checked", () => {
	const text = guideSteps(input()).find((s) => s.id === "topo")!.lines.join(" ");
	assert.match(text, /Topografija_2026\.pdf \(uzmērīja Mērnieks Ozols, uzmērīts 2026-09-12, saskaņots 2026-10-01\)/);
	const none = guideSteps(input({ topo: { sources: [] } })).find((s) => s.id === "topo")!.lines.join(" ");
	assert.match(none, /nav avota ar lomu «Topogrāfija»/);
	const partial = guideSteps(input({ topo: { sources: ["T.pdf"], surveyedOn: "2026-09-12" } })).find((s) => s.id === "topo")!.lines.join(" ");
	assert.match(partial, /T\.pdf \(uzmērīts 2026-09-12\)/);
});

test("a reference with no base point says to agree on one first, instead of writing dashes into a Revit instruction", () => {
	const empty = guideSteps(input({ reference: { ...REF, basePoint: { x: "", y: "", z: "" } } }));
	assert.match(empty.find((s) => s.id === "point")!.lines.join(" "), /pamatpunkts nav norādīts/);
	assert.doesNotMatch(empty.find((s) => s.id === "cube")!.lines.join(" "), /\(nav norādīts/);
});

test("the Global Z step carries the mechanism and points at the skill instead of moving a model by hand", () => {
	const z = guideSteps(input()).find((s) => s.id === "z")!.lines.join(" ");
	assert.match(z, /Global Z nāk no kopīgā augstuma \(shared elevation\) modeļa iekšējā sākumpunktā/);
	assert.match(z, /revit-shared-coordinates-z/);
	assert.match(z, /nepārvieto ar roku/);
});

test("the guide: data table, numbered steps, where to start, the common problems", () => {
	const md = coordinatesGuide(input({ remarks: ["BD900_AR_261112.ifc (Novietne): Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta"] }));
	assert.match(md, /^# Koplietotās koordinātes — BD900 Testa iela 1\n/);
	assert.match(md, /\| E\/W \| 503 298 282,00 mm \|/);
	assert.match(md, /### 1\. Vienību pārbaude/);
	assert.match(md, /### 9\. Pārbaude/);
	assert.match(md, /## Kur sākt\n\n- BD900_AR_261112\.ifc \(Novietne\)/);
	assert.match(md, /\| IFC Global Z = 0 \|/);
	assert.match(coordinatesGuide(input({ remarks: null })), /Koordinācijas pārbaude vēl nav palaista/);
	assert.match(coordinatesGuide(input({ remarks: [] })), /Nevienam modelim nav atvērtu piezīmju par novietojumu/);
});

function project(id = "BD900") {
	const root = join(tmp(), `${id} Testa iela 1`);
	mkdirSync(root, { recursive: true });
	return ProjectStore.open(tmp(), { id, name: "Testa iela 1", root, createdAt: "2026-11-13T00:00:00Z" });
}
const finding = (key: string, message: string, state: Finding["state"] = "open", path = "BD900_AR_261112.ifc"): Finding => ({ id: key, checkId: "coordination", requirementId: null, severity: "error", where: { path }, message, key: `coordination:${key}`, state, firstSeen: "2026-11-13", lastSeen: "2026-11-13" });

test("the guide's input is the project's own data: no reference, no guide; only confirmed survey facts; only open placement remarks", () => {
	const s = project();
	assert.equal(guideInput(s, "2026-11-13"), null);
	s.writeMeta("coordination", REF, { kind: "t", by: "user" });
	s.write("sources", [{ id: "s1", title: "Topografija_2026.pdf", role: "Topogrāfija" }, { id: "s2", title: "PU.pdf", role: "PU" }] as unknown as Source[], { kind: "t", by: "app" });
	const fact = (key: string, value: string, state: Fact["state"]) => ({ id: key, key, value, state, source: { kind: "user", at: "x" }, by: "user", at: "x" }) as unknown as Fact;
	s.write("facts", [fact("topo.author", "Mērnieks Ozols", "confirmed"), fact("topo.surveyedOn", "2026-09-12", "proposed"), fact("topo.approvedOn", "2026-10-01", "rejected")], { kind: "t", by: "app" });
	const a = guideInput(s, "2026-11-13")!;
	assert.deepEqual(a.topo, { sources: ["Topografija_2026.pdf"], author: "Mērnieks Ozols", surveyedOn: undefined, approvedOn: undefined });
	assert.equal(a.remarks, null, "the check has not run: not the same as nothing to fix");
	s.write("findings", [finding("a", "BD900_AR_261112.ifc (Novietne): Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta"), finding("b", "BD900_AR_261112.ifc (Stāvi): Trūkst: — → 3.stavs"), finding("c", "BD900_BK_1.ifc (Novietne): Kubs: x → y", "closed")], { kind: "t", by: "app" });
	assert.deepEqual(guideInput(s, "2026-11-13")!.remarks, ["BD900_AR_261112.ifc (Novietne): Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta"]);
});

test("the panel's button keeps the guide as one note, replaced each time, and says when there is no reference", () => {
	const dir = tmp();
	const registry = new Registry(join(dir, "projects.json"), join(dir, "projects"));
	const root = join(tmp(), "BD930 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const p = registry.add(root);
	const h = coordinationHandlers({ registry, engine: {} as never, revit: {} as never, bimcraftApp: "", emit: () => {} });
	assert.throws(() => h["coordination.guide"](p.id), /Vispirms izveido koordinācijas atsauci/);
	registry.store(p.id).writeMeta("coordination", REF, { kind: "t", by: "user" });
	const md = h["coordination.guide"](p.id) as string;
	assert.match(md, /^# Koplietotās koordinātes/);
	const notes = registry.store(p.id).notes();
	assert.deepEqual(notes.map((n) => [n.id, n.type, n.by, n.title]), [["n_coords_guide", "learning", "app", "Koplietotās koordinātes: instrukcija Revit"]]);
	assert.equal(notes[0].body, md);
	h["coordination.guide"](p.id);
	assert.equal(registry.store(p.id).notes().length, 1, "a second click replaces the note instead of adding another");
	assert.equal(readdirSync(join(registry.store(p.id).dir, "versions")).filter((f) => f.startsWith("note.n_coords_guide.")).length, 1, "the earlier text is kept");
});

test("the agent's tool reads the guide and writes nothing; without a reference it says so", async () => {
	assert.equal(appLevels().coordinates_guide, "read");
	const s = project();
	const ctx: ToolCtx = { projectsDir: s.projectsDir, projectId: "BD900", dataDir: tmp(), appDir: tmp(), runDir: null };
	const tool = allTools().find((t) => t.name === "coordinates_guide")!;
	assert.match(String(await tool.run(ctx, {} as never)), /no data: projektam nav koordinācijas atsauces/);
	s.writeMeta("coordination", REF, { kind: "t", by: "user" });
	assert.match(String(await tool.run(ctx, {} as never)), /### 3\. Koordinātes uz bāzes punkta/);
	assert.equal(s.notes().length, 0, "reading the guide does not write a note");
	assert.equal(existsSync(join(s.dir, "notes", "n_coords_guide.md")), false);
});

// ---- the delivery checklist ----------------------------------------------------------------------------------------------

function draftWith(ifc: string | null) {
	const s = project();
	const d = startDraft(s, "MBP", "2026-12-01", "user");
	if (ifc) {
		writeFileSync(join(d.draft!.stagingDir, ifc), "x");
		refreshDraft(s, d.id, "user");
	}
	return { s, id: d.id };
}
const rows = (s: ProjectStore, id: string) => checklistOf(s, id, { today: "2026-11-13", sheets: null });

test("the coordinates row exists only when the project has a reference; no model staged, not done", () => {
	const { s, id } = draftWith(null);
	assert.equal(rows(s, id).some((r) => r.id === "coords"), false);
	s.writeMeta("coordination", REF, { kind: "t", by: "user" });
	const r = rows(s, id).find((x) => x.id === "coords")!;
	assert.deepEqual([r.group, r.status, r.action, r.detail], ["Modelis", "trūkst", "coordination", "vispirms jābūt IFC"]);
});

test("a staged model with open placement remarks is not done; the same remarks make the IFC row ask for a look", () => {
	const { s, id } = draftWith("BD900_AR_261201.ifc");
	s.writeMeta("coordination", REF, { kind: "t", by: "user" });
	s.write("findings", [finding("a", "BD900_AR_261201.ifc (Novietne): Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta", "open", "BD900_AR_261201.ifc"), finding("b", "BD900_AR_261201.ifc (Hierarhija): Shēma: IFC2X3 → IFC4", "open", "BD900_AR_261201.ifc"), finding("c", "BD900_BK_1.ifc (Novietne): Kubs: x → y", "open", "BD900_BK_1.ifc")], { kind: "t", by: "app" });
	const all = rows(s, id);
	const coords = all.find((r) => r.id === "coords")!;
	assert.equal(coords.status, "trūkst");
	assert.match(coords.detail!, /^1 piezīmes par novietojumu: Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta$/, "another model's remark is not this delivery's");
	const ifc = all.find((r) => r.id === "ifc")!;
	assert.equal(ifc.status, "pārbaudi");
	assert.match(ifc.detail!, /koordinācija: 2 piezīmes modelim/);
});

test("when the remarks are fixed (closed) both rows are done", () => {
	const { s, id } = draftWith("BD900_AR_261201.ifc");
	s.writeMeta("coordination", REF, { kind: "t", by: "user" });
	s.write("findings", [finding("a", "BD900_AR_261201.ifc (Novietne): Pamatpunkts: kuba nav → x", "closed", "BD900_AR_261201.ifc")], { kind: "t", by: "app" });
	const all = rows(s, id);
	assert.equal(all.find((r) => r.id === "coords")!.status, "gatavs");
	assert.deepEqual([all.find((r) => r.id === "ifc")!.status, all.find((r) => r.id === "ifc")!.detail], ["gatavs", undefined]);
});
