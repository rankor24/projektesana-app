// 8.9 the coordination audit: facts read out of invented IFC files by BimCraft's engine (header, project / site / building,
// placements in mm whatever the file's unit, storeys with heights, the marker), the audit lines per model phrased as instructions,
// the reference seeded from the models and corrected by hand, the check with its findings, the per-file cache and the HTML report.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { auditLines, auditModel, buildAudit, classifyStorey, disciplineOf, EMPTY_REFERENCE, factsFromRevit, formatCoordinate, formatDistance, referenceWarnings, schemeFor, seedReference, toNumber } from "../src/core/coordination.ts";
import type { CoordReference, ModelFacts } from "../src/core/coordination-types.ts";
import { renderAuditHtml } from "../src/core/coordination-html.ts";
import { ProjectStore } from "../src/core/store.ts";
import { coordinationCheck } from "../src/checks/checks/coordination.ts";
import { runChecks } from "../src/checks/run.ts";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { parseIfcHeader, projectFacts, readIfcFacts } from "../src/sources/ifc-facts.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, tmp } from "./helpers.ts";

const APP = join(BIMCRAFT_DIR ?? "", "app");
const SKIP = BIMCRAFT_DIR ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}`;

// ---- an invented IFC with nested placements -----------------------------------------------------------------------------

interface Spec {
	file?: string;
	schema?: string;
	app?: string;
	ts?: string;
	metres?: boolean;
	project?: string;
	site?: { name: string; x: number; y: number; z: number } | null;
	building?: { name: string; x: number; y: number; z: number } | null;
	storeys?: { name: string; z: number }[];
	cubes?: { name: string; x: number; y: number; z: number }[];
}
const num = (n: number) => (Number.isInteger(n) ? `${n}.` : String(n));

function makeIfc(s: Spec): Uint8Array {
	const k = s.metres ? 0.001 : 1; // file unit per mm
	const L: string[] = [];
	let id = 100;
	const add = (body: string) => (L.push(`#${id}=${body};`), id++ && id - 1);
	const point = (x: number, y: number, z: number) => add(`IFCCARTESIANPOINT((${num(x * k)},${num(y * k)},${num(z * k)}))`);
	const axis = (x: number, y: number, z: number) => add(`IFCAXIS2PLACEMENT3D(#${point(x, y, z)},$,$)`);
	const place = (rel: number | null, x: number, y: number, z: number) => add(`IFCLOCALPLACEMENT(${rel ? `#${rel}` : "$"},#${axis(x, y, z)})`);
	const site = s.site === undefined ? { name: "Zeme", x: 515000, y: 310000, z: 9450 } : s.site;
	const building = s.building === undefined ? { name: "Eka", x: 515000, y: 310000, z: 9450 } : s.building;
	const sp = site ? place(null, site.x, site.y, site.z) : null;
	const bp = building ? place(sp, building.x - (site?.x ?? 0), building.y - (site?.y ?? 0), building.z - (site?.z ?? 0)) : sp;
	const bw = building ?? site ?? { x: 0, y: 0, z: 0 };
	if (site) add(`IFCSITE('SITEGUID000000000000001',$,'${site.name}',$,$,#${sp},$,$,.ELEMENT.,$,$,$,$,$)`);
	if (building) add(`IFCBUILDING('BLDGGUID000000000000001',$,'${building.name}',$,$,#${bp},$,$,.ELEMENT.,$,$,$)`);
	(s.storeys ?? []).forEach((st, i) => add(`IFCBUILDINGSTOREY('STRYGUID00000000000000${i}',$,'${st.name}',$,$,#${place(bp, 0, 0, st.z - bw.z)},$,$,.ELEMENT.,${num(st.z * k)})`));
	(s.cubes ?? []).forEach((c, i) => add(`IFCBUILDINGELEMENTPROXY('CUBEGUID00000000000000${i}',$,'${c.name}',$,'${c.name}',#${place(bp, c.x - bw.x, c.y - bw.y, c.z - bw.z)},$,$,.NOTDEFINED.)`));
	const text = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('${s.file ?? "model.ifc"}','${s.ts ?? "2026-11-12T10:00:00"}',('Izdomats'),('Izdomats'),'','${s.app ?? "Revit 2026"}','');\nFILE_SCHEMA(('${s.schema ?? "IFC4"}'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('PROJGUID00000000000001',$,'${s.project ?? "Projekts"}',$,$,$,$,(#11),#7);\n#2=IFCSIUNIT(*,.LENGTHUNIT.,${s.metres ? "$" : ".MILLI."},.METRE.);\n#3=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n#7=IFCUNITASSIGNMENT((#2,#3));\n#8=IFCCARTESIANPOINT((0.,0.,0.));\n#9=IFCAXIS2PLACEMENT3D(#8,$,$);\n#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);\n${L.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
	return new TextEncoder().encode(text);
}

const GOOD: Spec = { file: "BD900_AR_261112.ifc", storeys: [{ name: "1.stavs", z: 9450 }, { name: "2.stavs", z: 12600 }, { name: "3.stavs", z: 15750 }], cubes: [{ name: "GVB_KUBS:GVB_KUBS:1234", x: 515000, y: 310000, z: 9450 }] };

test("the STEP header gives the schema, the day and the authoring application", () => {
	assert.deepEqual(parseIfcHeader(makeIfc({ schema: "IFC2X3", app: "ArchiCAD 27", ts: "2026-10-03T08:15:00" })), { schema: "IFC2X3", ts: "2026-10-03", app: "ArchiCAD 27" });
	assert.deepEqual(parseIfcHeader(new TextEncoder().encode("nav IFC")), { schema: null, ts: "", app: "" });
});

test("facts out of an IFC: names, placements composed through the chain, storeys with heights, the marker", { skip: SKIP }, async () => {
	const f = await readIfcFacts(APP, makeIfc(GOOD), "BD900_AR_261112.ifc", ["GVB_KUBS", "KUBS"]);
	assert.deepEqual([f.code, f.source, f.schema, f.app, f.ts, f.project], ["AR", "ifc", "IFC4", "Revit 2026", "2026-11-12", "Projekts"]);
	assert.deepEqual([f.site?.name, f.site?.x, f.site?.y, f.site?.z], ["Zeme", 515000, 310000, 9450]);
	assert.deepEqual([f.building?.name, f.building?.x, f.building?.y, f.building?.z], ["Eka", 515000, 310000, 9450], "the building's placement is relative to the site's: the engine composes the chain");
	assert.deepEqual(f.storeys, [{ name: "1.stavs", elevation: 9450 }, { name: "2.stavs", elevation: 12600 }, { name: "3.stavs", elevation: 15750 }]);
	assert.equal(f.cubes.length, 1);
	assert.deepEqual([f.cubes[0].x, f.cubes[0].y, f.cubes[0].z], [515000, 310000, 9450]);
	assert.match(f.cubes[0].name, /GVB_KUBS/);
});

test("a file in metres gives the same millimetres; a model with no site, no building, no storeys says null and empty", { skip: SKIP }, async () => {
	const m = await readIfcFacts(APP, makeIfc({ ...GOOD, metres: true }), "BD900_AR_261112.ifc", ["KUBS"]);
	assert.deepEqual([m.building?.z, m.storeys[1].elevation, m.cubes[0].x], [9450, 12600, 515000]);
	const bare = await readIfcFacts(APP, makeIfc({ file: "BD900_SM_1.ifc", site: null, building: null, project: "X" }), "BD900_SM_1.ifc", ["KUBS"]);
	assert.deepEqual([bare.site, bare.building, bare.storeys, bare.cubes, bare.project, bare.code], [null, null, [], [], "X", "SM"]);
});

test("a file that is not an IFC is refused with its name", { skip: SKIP }, async () => {
	await assert.rejects(readIfcFacts(APP, new TextEncoder().encode("nav ifc"), "BD900_X.ifc", []), /BD900_X\.ifc/);
});

// ---- the audit, on facts --------------------------------------------------------------------------------------------------

const REF: CoordReference = { ...EMPTY_REFERENCE, basePoint: { x: "515000", y: "310000", z: "9450" }, hierarchy: { project: "Projekts", site: "Zeme", building: "Eka", schema: "IFC4" }, filePrefix: "BD900", storeySchemes: [{ id: "default", label: "Pamatshema", storeys: ["1.stavs", "2.stavs", "3.stavs"], elevations: { "1.stavs": "9450", "2.stavs": "12600", "3.stavs": "15750" }, disciplines: [] }] };
const placed = (name: string, x: number, y: number, z: number) => ({ name, x, y, z });
const model = (o: Partial<ModelFacts> = {}): ModelFacts => ({ code: "AR", file: "BD900_AR_261112.ifc", source: "ifc", app: "Revit 2026", ts: "2026-11-12", schema: "IFC4", project: "Projekts", site: placed("Zeme", 515000, 310000, 9450), building: placed("Eka", 515000, 310000, 9450), storeys: [{ name: "1.stavs", elevation: 9450 }, { name: "2.stavs", elevation: 12600 }, { name: "3.stavs", elevation: 15750 }], cubes: [placed("GVB_KUBS:GVB_KUBS", 515000, 310000, 9450)], ...o });
const linesOf = (m: ModelFacts, ref = REF) => auditModel(m, ref).groups.flatMap((g) => g.lines.map((l) => `${g.g}|${l.kind}|${l.w}|${l.now}|${l.to}`));

test("a model that matches the reference has nothing to fix", () => {
	assert.deepEqual(linesOf(model()), []);
});

test("Novietne: marker missing, off the base point, duplicated; site and building too high, together or apart; building at the origin", () => {
	assert.deepEqual(linesOf(model({ cubes: [] })), ["Novietne|cube-missing|Pamatpunkts|kuba nav|GVB_KUBS uz bāzes punkta"]);
	assert.deepEqual(linesOf(model({ cubes: [placed("GVB_KUBS:x", 515000.5, 310000, 9450)] })), [], "inside the 1 mm tolerance");
	assert.deepEqual(linesOf(model({ cubes: [placed("GVB_KUBS:x", 515300, 310400, 9450)] })), ["Novietne|cube-offset|Kubs|GVB_KUBS · 500 mm nost|GVB_KUBS uz bāzes punkta"]);
	assert.deepEqual(linesOf(model({ cubes: [placed("K", 515000, 310000, 9450), placed("K", 515000, 313000, 9450), placed("K", 515000, 310000, 9450)] })), ["Novietne|cube-duplicate|Kubs 2|0 mm nost|dzēst", "Novietne|cube-duplicate|Kubs 3|3,00 m nost|dzēst"], "the nearest is the keeper, the others are strays, nearest first");
	const dup = linesOf(model({ cubes: [placed("K", 515000, 310000, 9450), placed("K", 515000, 313000, 9450)] }));
	assert.deepEqual(dup, ["Novietne|cube-duplicate|Kubs 2|3,00 m nost|dzēst"]);
	assert.deepEqual(linesOf(model({ site: placed("Zeme", 515000, 310000, 94500), building: placed("Eka", 515000, 310000, 94500) })), [`Novietne|spatial-z|Site+Building|Z = ${formatCoordinate(94500)}|Z = ${formatCoordinate(9450)} mm`], "one fix, said once");
	assert.deepEqual(linesOf(model({ site: placed("Zeme", 515000, 310000, 0) })).map((l) => l.split("|")[1]), ["site-z"]);
	assert.deepEqual(linesOf(model({ building: placed("Eka", 0, 0, 0) })).map((l) => l.split("|")[1]), ["building-origin"], "never georeferenced: the whole triple, not a wrong Z");
});

test("Hierarhija: a typo in the file prefix, the three names, an entity not exported at all, the schema", () => {
	assert.deepEqual(linesOf(model({ file: "BD9OO_EL_1.ifc", code: "EL", project: "Cits", site: placed("zeme ", 515000, 310000, 9450), building: null, schema: "IFC2X3" })), ["Hierarhija|file-prefix|Faila nosaukums|BD9OO_…|BD900_…", "Hierarhija|name-project|IfcProject|Cits|Projekts", "Hierarhija|name-building|IfcBuilding|nav eksportēts|Eka", "Hierarhija|schema|Shēma|IFC2X3|IFC4"]);
	assert.deepEqual(linesOf(model({ site: placed("  ZEME ", 515000, 310000, 9450) })), [], "case and spacing do not make a different name");
});

test("Stāvi: how each name differs, and the order of the fixes", () => {
	assert.equal(classifyStorey("1.stavs", ["1.stavs"]).how, "exact");
	assert.equal(classifyStorey("1.stavs ", ["1.stavs"]).how, "space");
	assert.equal(classifyStorey("1.Stavs", ["1.stavs"]).how, "case");
	assert.equal(classifyStorey("03 3.stavs - mg", ["3.stavs", "1.stavs"]).how, "rename");
	assert.deepEqual([classifyStorey("11.stavs", ["1.stavs", "11.stavs"]).target], ["11.stavs"], "the longest contained name wins: 1.stavs cannot take 11.stavs");
	assert.equal(classifyStorey("Pagrabs", ["1.stavs"]).how, "none");
	const lines = linesOf(model({ storeys: [{ name: "1.stavs ", elevation: 9450 }, { name: "2.Stavs", elevation: 12600 }, { name: "03 3.stavs - mg", elevation: 15750 }, { name: "Jumts", elevation: 20000 }] }));
	assert.deepEqual(lines.map((l) => l.split("|").slice(1, 5).join("|")), ["storey-space|Lieka atstarpe|«1.stavs »|«1.stavs»", "storey-case|Lielais burts|2.Stavs|2.stavs", "storey-rename|Pārsaukt|03 3.stavs - mg|3.stavs", "storey-extra|Nav sarakstā|Jumts|dzēst vai pārsaukt"]);
});

test("Stāvi: no storeys at all; a different nomenclature entirely says it once with a question; missing storeys listed", () => {
	assert.deepEqual(linesOf(model({ storeys: [] })), ["Stāvi|storeys-absent|Nosaukumi|neviena IfcBuildingStorey|1.stavs, 2.stavs, 3.stavs"]);
	const other = auditModel(model({ storeys: [{ name: "01", elevation: 0 }, { name: "J1", elevation: -3000 }] }), REF).groups[0].lines;
	assert.equal(other.length, 1);
	assert.deepEqual([other[0].kind, other[0].ask, other[0].wide], ["storeys-scheme", "Jāsakrīt ar saskaņoto sarakstu", true]);
	assert.deepEqual(linesOf(model({ storeys: [{ name: "1.stavs", elevation: 9450 }] })), ["Stāvi|storey-missing|Trūkst|—|2.stavs, 3.stavs"]);
});

test("Stāvi: the height of a storey is checked where the scheme gives one, within the tolerance, on the right name", () => {
	assert.deepEqual(linesOf(model({ storeys: [{ name: "1.stavs", elevation: 9450.4 }, { name: "2.stavs", elevation: 12700 }, { name: "3.stavs", elevation: null }] })), [`Stāvi|storey-elevation|Augstums 2.stavs|${formatCoordinate(12700)} mm|${formatCoordinate(12600)} mm`]);
	const noHeights: CoordReference = { ...REF, storeySchemes: [{ ...REF.storeySchemes[0], elevations: undefined }] };
	assert.deepEqual(linesOf(model({ storeys: [{ name: "1.stavs", elevation: 1 }, { name: "2.stavs", elevation: 2 }, { name: "3.stavs", elevation: 3 }] }), noHeights), [], "a scheme without heights is checked by name only");
});

test("the open Revit document is measured by its levels only; its file name picks the scheme", () => {
	const ref: CoordReference = { ...REF, storeySchemes: [REF.storeySchemes[0], { id: "EB16", label: "EB16", storeys: ["EB16_1", "EB16_2"], disciplines: ["UR"] }] };
	const rv = factsFromRevit("BD900_UR", [{ name: "EB16_2", elevationMm: 3000 }, { name: "EB16_1", elevationMm: 0 }, { name: "Level 9", elevationMm: 50000 }], "2026-11-13");
	assert.deepEqual([rv.code, rv.source, rv.storeys.map((s) => s.name)], ["UR", "revit", ["EB16_1", "EB16_2", "Level 9"]]);
	const rep = auditModel(rv, ref);
	assert.deepEqual(rep.groups.map((g) => g.g), ["Stāvi"], "no marker, hierarchy or placement lines for Revit");
	assert.deepEqual(rep.groups[0].lines.map((l) => l.kind), ["storey-extra"]);
	assert.deepEqual(schemeFor(ref, "UR").storeys, ["EB16_1", "EB16_2"]);
	assert.deepEqual(schemeFor(ref, "AR").storeys, ["1.stavs", "2.stavs", "3.stavs"], "a discipline with no scheme of its own takes the default");
});

test("line ids are stable between runs and carry no position; the audit counts its lines", () => {
	const m = model({ cubes: [], storeys: [{ name: "1.stavs", elevation: 9450 }] });
	const a = buildAudit([m], REF, "2026-11-13");
	const b = buildAudit([m, model({ code: "BK", file: "BD900_BK_1.ifc" })], REF, "2026-11-14");
	const ids = (x: typeof a) => auditLines(x).filter((l) => l.code === "AR").map((l) => l.id);
	assert.deepEqual(ids(a), ids(b));
	assert.deepEqual(ids(a), ["AR|Novietne|cube-missing", "AR|Stāvi|storey-missing"]);
	assert.equal(a.totalLines, 2);
	assert.equal(b.models.length, 2);
	assert.deepEqual(b.models.map((x) => x.code), ["AR", "BK"], "in discipline order");
});

test("numbers: grouping spaces and comma decimals read back; coordinates and distances are shown the way a drawing reads", () => {
	assert.equal(toNumber("503 298 283,5"), 503298283.5);
	assert.equal(toNumber("94500"), 94500);
	assert.equal(toNumber("nav"), null);
	assert.equal(toNumber(""), null);
	assert.equal(formatCoordinate(503298283), "503 298 283,00");
	assert.equal(formatCoordinate(-1500.5, " "), "−1 500,50");
	assert.equal(formatCoordinate(undefined), "—");
	assert.equal(formatDistance(400), "400 mm");
	assert.equal(formatDistance(3000), "3,00 m");
	assert.deepEqual(["BD427_AR_261110.ifc", "BD427_BK.ifc", "Plans.ifc", "BD900-AVK-1.ifc"].map(disciplineOf), ["AR", "BK", "Plans", "AVK"]);
});

// ---- the reference: seeded from the models, corrected by hand ------------------------------------------------------------

test("seeding takes what the models agree on: base point, names, schema, prefix, the storeys most of them share with their heights", () => {
	const ar = model();
	const bk = model({ code: "BK", file: "BD900_BK_1.ifc" });
	const odd = model({ code: "EL", file: "BD9OO_EL_1.ifc", project: "Cits", storeys: [{ name: "Level 1", elevation: 0 }] });
	const r = seedReference([ar, bk, odd], {}, "2026-11-13T00:00:00.000Z");
	assert.deepEqual(r.basePoint, { x: "515000", y: "310000", z: "9450" });
	assert.deepEqual(r.hierarchy, { project: "Projekts", site: "Zeme", building: "Eka", schema: "IFC4" });
	assert.equal(r.filePrefix, "BD900", "the minority prefix is the typo, not the rule");
	assert.deepEqual(r.storeySchemes[0].storeys, ["1.stavs", "2.stavs", "3.stavs"]);
	assert.deepEqual(r.storeySchemes[0].elevations, { "1.stavs": "9450", "2.stavs": "12600", "3.stavs": "15750" });
	assert.deepEqual(r.cubeNames, ["GVB_KUBS"]);
	assert.equal(r.seededFrom, "modeļi");
	assert.deepEqual(linesOf(odd, r).filter((l) => l.startsWith("Hierarhija")).map((l) => l.split("|")[1]), ["file-prefix", "name-project"], "the odd model is what gets reported");
});

test("a typed-in BIP value wins, unless every model with the marker disagrees: then the models are right and the warning names the BIP", () => {
	const models = [model(), model({ code: "BK", file: "BD900_BK_1.ifc" })];
	assert.equal(seedReference(models, { basePoint: { z: "9450" } }).basePoint.z, "9450");
	const typo = seedReference(models, { basePoint: { x: "515000", y: "310000", z: "94500" } });
	assert.equal(typo.basePoint.z, "9450", "the BIP's 94500 contradicts all models and the BIP's own level table");
	assert.ok(referenceWarnings(typo, models, { z: "94500" }).some((w) => /BIP norāda pamatpunkta Z = 94500, bet modeļi rāda 9450/.test(w)));
	assert.equal(seedReference([model({ cubes: [placed("K", 1, 1, 1)] }), model({ code: "BK", file: "BD900_BK_1.ifc" })], { basePoint: { z: "9450" } }).basePoint.z, "9450", "the models disagree among themselves: the BIP decides");
	const withStoreys = seedReference(models, { storeys: [{ name: "P", elevation: "6300" }, { name: "1.stavs" }, { building: "EB16", name: "EB16_1" }, { building: "EB16", name: "EB16_2" }, { building: "EB16", name: "EB16_3" }] });
	assert.deepEqual(withStoreys.storeySchemes.map((s) => [s.id, s.storeys.length]), [["default", 3], ["Pamatshēma", 2]], "the biggest group is the default; the others keep their building's name");
});

test("a volume goes to the model that builds it; the warnings name what is still undecided", () => {
	const bk = model({ code: "BK", file: "BD900_BK_1.ifc", storeys: [{ name: "1.stavs", elevation: 9450 }] });
	const ur = model({ code: "UR", file: "BD900_UR_1.ifc", storeys: [{ name: "EB16_1", elevation: 0 }, { name: "EB16_2", elevation: 3000 }, { name: "EB16_3", elevation: 6000 }] });
	const r = seedReference([bk, ur], { storeys: [{ name: "1.stavs" }, { name: "2.stavs" }, { name: "3.stavs" }, { name: "4.stavs" }, { name: "EB16_1", building: "EB16" }, { name: "EB16_2", building: "EB16" }, { name: "EB16_3", building: "EB16" }] });
	assert.deepEqual(r.storeySchemes.map((s) => [s.id, s.disciplines]), [["default", []], ["EB16", ["UR"]]]);
	const owner = r.storeySchemes.find((s) => s.disciplines.includes("UR"));
	assert.ok(owner, "the secondary volume is assigned to UR");
	assert.deepEqual(owner!.storeys, ["EB16_1", "EB16_2", "EB16_3"]);
	const empty = referenceWarnings(EMPTY_REFERENCE, []);
	assert.ok(empty.includes("Pamatpunkta X nav norādīts."));
	assert.ok(empty.includes("Stāvu saraksts ir tukšs: modeļu stāvi netiks pārbaudīti."));
	assert.ok(empty.includes("IFC hierarhijā trūkst «schema» vērtības."));
	// two models that follow the list and both add a storey the scheme lacks: probably a gap in the scheme
	const a = model({ storeys: [...model().storeys, { name: "Pamatstavs", elevation: 6300 }] });
	const b = model({ code: "IN", file: "BD900_IN_1.ifc", storeys: [...model().storeys, { name: "Pamatstavs", elevation: 6300 }] });
	assert.ok(referenceWarnings(REF, [a, b]).some((w) => /«Pamatstavs» ir 2 modeļos/.test(w)));
	assert.equal(referenceWarnings(REF, [a]).some((w) => /Pamatstavs/.test(w)), false, "one model alone is a defect, not a gap");
});

// ---- the check, the cache, the report ------------------------------------------------------------------------------------

function projectWith(files: Record<string, Spec>) {
	const root = tmp();
	for (const [rel, spec] of Object.entries(files)) {
		const f = join(root, ...rel.split("/"));
		mkdirSync(join(f, ".."), { recursive: true });
		writeFileSync(f, makeIfc({ ...spec, file: rel.split("/").pop() }));
	}
	const store = ProjectStore.open(tmp(), { id: "BD900", name: "BD900", root, createdAt: "2026-11-13T00:00:00Z" });
	return { root, store };
}
const AR = "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/BD900_AR_261112.ifc";
const BK = "01_Projektesana/1.2_Projekta dalas/BK/04_IFC/BD900_BK_261112.ifc";
const OLD = "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/Arhivs/BD900_AR_260901.ifc";

test("facts are read once per file version: a cached file is not read again, a changed one is", { skip: SKIP }, async () => {
	const { root, store } = projectWith({ [AR]: GOOD, [BK]: GOOD, [OLD]: { ...GOOD, cubes: [] } });
	const first = await projectFacts(APP, store, ["KUBS"]);
	assert.deepEqual(first.facts.map((f) => f.file).sort(), ["BD900_AR_261112.ifc", "BD900_BK_261112.ifc"], "the archived file is not audited");
	assert.deepEqual(first.errors, []);
	// mark the cached facts: a second call must hand back the mark, because nothing changed
	const cache = store.readMeta<Record<string, { sig: string; facts: ModelFacts }>>("ifc-facts", {});
	assert.equal(Object.keys(cache).length, 2);
	for (const v of Object.values(cache)) v.facts.app = "CACHED";
	store.writeMeta("ifc-facts", cache, { kind: "t", by: "app" });
	assert.deepEqual((await projectFacts(APP, store, ["KUBS"])).facts.map((f) => f.app), ["CACHED", "CACHED"]);
	// another marker name is another question: read again
	assert.deepEqual((await projectFacts(APP, store, ["KUBS", "EP_KUBS"])).facts.map((f) => f.app), ["Revit 2026", "Revit 2026"]);
	// a changed file is read again, an unchanged one is not
	const again = store.readMeta<Record<string, { sig: string; facts: ModelFacts }>>("ifc-facts", {});
	for (const v of Object.values(again)) v.facts.app = "CACHED";
	store.writeMeta("ifc-facts", again, { kind: "t", by: "app" });
	writeFileSync(join(root, ...AR.split("/")), makeIfc({ ...GOOD, file: "BD900_AR_261112.ifc", app: "Revit 2027", project: "Mainīts" }));
	const third = (await projectFacts(APP, store, ["KUBS", "EP_KUBS"])).facts;
	assert.deepEqual(third.map((f) => [f.file, f.app]).sort(), [["BD900_AR_261112.ifc", "Revit 2027"], ["BD900_BK_261112.ifc", "CACHED"]]);
});

test("a file that cannot be read is reported with its name, not hidden", { skip: SKIP }, async () => {
	const { root, store } = projectWith({ [AR]: GOOD });

	mkdirSync(join(root, "01_Projektesana/1.2_Projekta dalas/BK/04_IFC"), { recursive: true });
	writeFileSync(join(root, ...BK.split("/")), "nav ifc");
	const r = await projectFacts(APP, store, ["KUBS"]);
	assert.deepEqual(r.facts.map((f) => f.file), ["BD900_AR_261112.ifc"]);
	assert.equal(r.errors.length, 1);
	assert.match(r.errors[0].message, /BD900_BK_261112\.ifc/);
});

test("the check: nothing until there is a reference; then one finding per line, errors for placement; fixing the model closes it", { skip: SKIP }, async () => {
	const { root, store } = projectWith({ [AR]: { ...GOOD, cubes: [] }, [BK]: GOOD });
	registerCheck(coordinationCheck);
	try {
		const facts = (names: string[], deliveryId?: string) => projectFacts(APP, store, names, deliveryId);
		const run = () => runChecks(store, "manual", { dataDir: tmp(), today: "2026-11-13", ifcFacts: facts, only: ["coordination"] });
		const none = await run();
		assert.deepEqual(none.skipped.map((s) => s.id), ["coordination"]);
		assert.match(none.skipped[0].reason, /nav koordinācijas atsauces/);
		store.writeMeta("coordination", REF, { kind: "t", by: "user" });
		const r = await run();
		assert.equal(r.open, 1);
		const f = store.read("findings").filter((x) => x.checkId === "coordination");
		assert.equal(f.length, 1);
		assert.deepEqual([f[0].severity, f[0].where.path, f[0].state], ["error", "BD900_AR_261112.ifc", "open"]);
		assert.match(f[0].message, /^BD900_AR_261112\.ifc \(Novietne\): Pamatpunkts: kuba nav → GVB_KUBS uz bāzes punkta$/);
		await run();
		assert.equal(store.read("findings").filter((x) => x.checkId === "coordination").length, 1, "the same remark is the same finding on the next run");
		// the author fixes the model
		writeFileSync(join(root, ...AR.split("/")), makeIfc({ ...GOOD, file: "BD900_AR_261112.ifc", app: "Revit 2027" }));
		await run();
		assert.equal(store.read("findings").find((x) => x.checkId === "coordination")!.state, "closed");
		// no facts available (BimCraft missing): skipped, the finding is left as it was
		const noEngine = await runChecks(store, "manual", { dataDir: tmp(), today: "2026-11-13", only: ["coordination"] });
		assert.match(noEngine.skipped[0].reason, /BimCraft nav pieejams/);
	} finally {
		unregisterCheck("coordination");
	}
});

test("the HTML report: one section per model, the lines with now and to, the reference on top, everything escaped", () => {
	const bad = model({ project: "<b>Cits</b> & co", cubes: [] });
	const html = renderAuditHtml(buildAudit([bad, model({ code: "BK", file: "BD900_BK_1.ifc" })], REF, "2026-11-13"), { title: "Modeļu koordinācijas atskaite", project: "BD900 Testa iela" });
	assert.match(html, /^<!doctype html>/);
	assert.match(html, /<h3>AR <span class="file">BD900_AR_261112\.ifc<\/span><\/h3>/);
	assert.match(html, /<h4>Novietne<\/h4>/);
	assert.match(html, /kuba nav<\/td><td class="arrow">→<\/td><td class="to">GVB_KUBS uz bāzes punkta/);
	assert.match(html, /&lt;b&gt;Cits&lt;\/b&gt; &amp; co/);
	assert.doesNotMatch(html, /<b>Cits<\/b>/);
	assert.match(html, /Visi pārbaudītie lielumi sakrīt ar atsauci\./, "BK has nothing to fix and says so");
	assert.match(html, /Pamatpunkts: E 515 000,00 · N 310 000,00 · Z 9 450,00 mm \(pielaide 1 mm\)/);
	assert.doesNotMatch(html, /<script|<link|src=/i);

});
