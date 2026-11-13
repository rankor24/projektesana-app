// 8.11 sheet change → IFC element: the labels of a changed text name an element (room number, name, mark); the area is checked
// against the model; with the old model, the elements round a space that moved or were resized are the likely cause; what has no
// label is said to be untraceable. Pure core on synthetic elements, then BimCraft's engine on invented IFC files.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync as mkdir } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../src/core/registry.ts";
import { compareHandlers } from "../src/main/handlers/compare.ts";
import { withTraceModel } from "../src/sources/ifc-trace-model.ts";
import { boxChange, contextOf, describeMatch, itemsFromPage, matchScore, norm, numberIn, tokensOf, traceItem, type Box, type TraceElement, type TraceModel } from "../src/sources/sheets/trace.ts";
import type { PageDiff, PageText, SheetPage } from "../src/sources/sheets/vector-diff.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const APP = join(BIMCRAFT_DIR ?? "", "app");
const SKIP = BIMCRAFT_DIR ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}`;

// ---- pure core ------------------------------------------------------------------------------------------------------------

const el = (o: Partial<TraceElement> & { guid: string }): TraceElement => ({ cls: "IfcWall", name: null, longName: null, keys: [], area: null, boundedBy: [], origin: null, box: () => null, ...o });
const model = (elements: TraceElement[], solids: TraceElement[] = []): TraceModel => {
	const all = new Map([...elements, ...solids].map((e) => [e.guid, e]));
	return { elements, find: (g) => all.get(g), solids };
};
const BOX = (x: number, w = 4): Box => [x, 0, 0, x + w, 0.2, 3];

test("a label matches an element whole or as a word inside; a short token only whole; punctuation and diacritics are literal", () => {
	assert.equal(matchScore("1-7", ["1-7"]), 3);
	assert.equal(matchScore("virtuve", ["virtuve 1-7"]), 2);
	assert.equal(matchScore("1-7", ["11-7"]), 0, "not inside another number");
	assert.equal(matchScore("1-7", ["telpa 1-7 virtuve"]), 2);
	assert.equal(matchScore("d1", ["d12"]), 0, "short tokens never match inside a longer key");
	assert.equal(matchScore("ab", ["ab"]), 3);
	assert.equal(matchScore("ģērbtuve", ["ģērbtuve"]), 3);
	assert.equal(matchScore("dušas", ["dušas telpa"]), 2);
	assert.equal(matchScore("a.b", ["axb"]), 0, "a dot in a label is a dot, not a wildcard");
	assert.equal(norm("  Virtuve  "), "virtuve");
	assert.equal(norm("ĀBOLS"), "ābols");
});

test("tokens come from the labels round the change; for a text change also the old and new text; one-letter ones are dropped", () => {
	assert.deepEqual(tokensOf({ id: "1", kind: "area", old: "14.2", new: "15.1", context: "1-7 · Virtuve · x" }), ["1-7", "virtuve"]);
	assert.deepEqual(tokensOf({ id: "2", kind: "text", old: "D-12", new: "D-13", context: "Durvis" }), ["durvis", "d-12", "d-13"]);
	assert.deepEqual(tokensOf({ id: "3", kind: "area", context: "" }), []);
	assert.equal(numberIn("15,1 m²"), 15.1);
	assert.equal(numberIn("nav"), null);
});

test("two boxes: nothing under 2 mm, then moved, resized, or both, in millimetres", () => {
	assert.equal(boxChange(BOX(0), BOX(0.0015)), null);
	assert.equal(boxChange(null, BOX(0)), null);
	assert.deepEqual(boxChange(BOX(0), BOX(0.5)), { change: "moved", dxMm: 500, dyMm: 0, dzMm: 0, dsizeMm: [0, 0, 0] });
	assert.deepEqual(boxChange(BOX(0, 4), BOX(0, 4.5)), { change: "moved and resized", dxMm: 250, dyMm: 0, dzMm: 0, dsizeMm: [500, 0, 0] }, "one end moved: the centre moved too");
	const both = boxChange([0, 0, 0, 4, 0.2, 3], [-0.25, 0, 0, 4.25, 0.2, 3])!;
	assert.deepEqual([both.change, both.dxMm, both.dsizeMm], ["resized", 0, [500, 0, 0]]);
});

const space = (o: Partial<TraceElement> = {}) => el({ guid: "S1", cls: "IfcSpace", name: "1-7", longName: "Virtuve", keys: ["1-7", "virtuve"], area: 15.1, ...o });

test("an area change: the space is found by its labels, the sheet is checked against the model, the boundaries that changed are the cause", () => {
	const wallA = el({ guid: "WA", name: "Siena A", keys: ["siena a"], box: () => BOX(0) });
	const wallB = el({ guid: "WB", name: "Siena B", keys: ["siena b"], box: () => BOX(4.5) });
	const wallBold = el({ guid: "WB", name: "Siena B", keys: ["siena b"], box: () => BOX(4) });
	const nw = model([space({ boundedBy: ["WA", "WB"] }), wallA, wallB]);
	const old = model([space({ area: 14.2 }), el({ ...wallA, box: () => BOX(0) }), wallBold]);
	const r = traceItem({ id: "1", kind: "area", old: "14.2", new: "15.1", context: "1-7 · Virtuve" }, nw, old);
	assert.equal(r.matches.length, 1);
	const m = r.matches[0];
	assert.deepEqual([m.guid, m.inOld, m.area, m.sheetAgreesWithModel, m.modelAreaChanged], ["S1", true, { old: 14.2, new: 15.1 }, true, true]);
	assert.equal(m.causes?.via, "space-boundary");
	assert.deepEqual(m.causes?.elements.map((e) => [e.guid, e.change, e.dxMm]), [["WB", "moved", 500]], "the wall that did not change is not listed");
});

test("the sheet's area and the model's disagree: said, not hidden; within the sheet's rounding it agrees", () => {
	const nw = model([space({ area: 15.1 })]);
	const at = (v: string) => traceItem({ id: "1", kind: "area", old: "14.2", new: v, context: "1-7" }, nw, null).matches[0].sheetAgreesWithModel;
	assert.equal(at("15.1"), true);
	assert.equal(at("15,14"), true, "0.04 under the sheet's one-decimal rounding");
	assert.equal(at("16.0"), false);
	const m = traceItem({ id: "1", kind: "area", old: "14.2", new: "16.0", context: "1-7" }, nw, null).matches[0];
	assert.equal(m.inOld, null, "no old model given");
	assert.equal(m.causes, undefined, "and so no causes");
	assert.match(describeMatch({ id: "1", kind: "area", new: "16.0" }, m).join(" "), /NESAKRĪT ar modeli/);
});

test("a space with no boundaries: what is within 15 m is looked at, nearest first, and what is further is not", () => {
	const near = el({ guid: "N1", name: "Tuvā siena", keys: ["tuva siena"], origin: [2, 0], box: () => BOX(1) });
	const nearOld = el({ guid: "N1", name: "Tuvā siena", keys: ["tuva siena"], origin: [2, 0], box: () => BOX(0.8) });
	const far = el({ guid: "F1", name: "Tālā siena", keys: ["tala siena"], origin: [60, 0], box: () => BOX(60) });
	const farOld = el({ guid: "F1", keys: [], origin: [60, 0], box: () => BOX(59) });
	const added = el({ guid: "A1", name: "Jauna kolonna", keys: ["jauna kolonna"], origin: [3, 1], box: () => BOX(3) });
	const sp = space({ origin: [0, 0], box: () => [0, 0, 0, 3, 3, 3] });
	const nw = model([sp], [near, far, added]);
	const old = model([space({ area: 14.2 })], [nearOld, farOld]);
	const c = traceItem({ id: "1", kind: "area", new: "15.1", context: "1-7" }, nw, old).matches[0].causes!;
	assert.equal(c.via, "nearby");
	assert.deepEqual(c.elements.map((e) => [e.guid, e.change]), [["N1", "moved"], ["A1", "added"]], "the far wall moved too, but not near this room");
});

test("a text change names a door by its mark; a moved or resized solid with that label is reported; a label that names nothing finds nothing", () => {
	const door = el({ guid: "D1", cls: "IfcDoor", name: "Durvis", keys: ["durvis", "d-12"], box: () => BOX(1, 1) });
	const doorOld = el({ guid: "D1", cls: "IfcDoor", name: "Durvis", keys: ["durvis", "d-12"], box: () => BOX(0.5, 1) });
	const r = traceItem({ id: "2", kind: "text", old: "D-11", new: "D-12", context: "" }, model([door]), model([doorOld]));
	assert.deepEqual(r.matches.map((m) => [m.guid, m.shapeChange?.change, m.shapeChange?.dxMm]), [["D1", "moved", 500]]);
	assert.deepEqual(traceItem({ id: "3", kind: "text", new: "Neeksistējoša", context: "" }, model([door]), null).matches, []);
	// a space is preferred for an area, and the best score first
	const a = el({ guid: "W9", name: "1-7", keys: ["1-7"] });
	const ranked = traceItem({ id: "4", kind: "area", new: "15.1", context: "1-7" }, model([a, space()]), null).matches.map((m) => m.guid);
	assert.deepEqual(ranked, ["S1", "W9"], "same score: the space first for an area");
});

test("in words: the element, the area check, the causes", () => {
	const nw = model([space({ boundedBy: ["WB"] }), el({ guid: "WB", name: "Siena B", keys: ["siena b"], box: () => BOX(4.5) })]);
	const old = model([space({ area: 14.2 }), el({ guid: "WB", name: "Siena B", keys: ["siena b"], box: () => BOX(4) })]);
	const item = { id: "1", kind: "area" as const, old: "14.2", new: "15.1", context: "1-7" };
	const text = describeMatch(item, traceItem(item, nw, old).matches[0]);
	assert.deepEqual(text, ["Space 1-7 Virtuve", "modeļa platība 15,10 m² (agrāk 14,20 m²)", "lapas 15.1 sakrīt ar modeli", "platība modelī ir mainījusies starp versijām", "iespējamie cēloņi (telpas robežas):", "  Wall Siena B: pārvietots (500; 0; 0 mm)"]);
});

// ---- from the sheet compare to items -----------------------------------------------------------------------------------------

const T = (str: string, x: number, y: number): PageText => ({ str, x, y });
const page = (n: number, texts: PageText[]): SheetPage => ({ page: n, sheetNo: "AR-3", segments: [], texts, frame: null, sizeMm: { w: 420, h: 297 } });

test("a changed area becomes an item with the labels near it; a bare dimension and a line cannot be traced and say why", () => {
	const nearA = T("1-7", 100, 100);
	const nearB = T("Virtuve", 100, 106);
	const far = T("Gaitenis", 300, 200);
	const dim = T("3600", 102, 104);
	const a = page(1, [T("14.2", 100, 103), nearA, nearB, far, dim]);
	const b = page(1, [T("15.1", 100, 103), nearA, nearB, far, dim]);
	const diff: PageDiff = {
		a: 1,
		b: 1,
		sheetNo: "AR-3",
		summary: [],
		changes: [
			{ kind: "dimension-changed", from: a.texts[0], to: b.texts[0] },
			{ kind: "dimension-changed", from: T("3600", 50, 50), to: T("3700", 50, 50) },
			{ kind: "text-added", text: T("D-12", 120, 120) },
			{ kind: "line-moved", from: { x1: 0, y1: 0, x2: 10, y2: 0 }, to: { x1: 5, y1: 0, x2: 15, y2: 0 }, dx: 5, dy: 0, length: 10 },
			{ kind: "line-added", seg: { x1: 0, y1: 0, x2: 1, y2: 0 }, length: 1 },
			{ kind: "line-removed", seg: { x1: 0, y1: 0, x2: 1, y2: 0 }, length: 1 },
		],
	};
	const { items, untraceable } = itemsFromPage(diff, a, b, "AR-3:");
	assert.deepEqual(items[0], { id: "AR-3:1.1", kind: "area", old: "14.2", new: "15.1", context: "1-7 · Virtuve" });
	assert.deepEqual(items[1].kind, "text");
	assert.deepEqual(items[1].new, "D-12");
	assert.equal(untraceable.length, 4);
	assert.match(untraceable[0].text, /izmērs 3600 → 3700/);
	assert.match(untraceable[0].why, /nav iezīmes/);
	assert.deepEqual(untraceable.slice(1).map((u) => u.text), ["pārvietota līnija", "jauna līnija", "noņemta līnija"]);
	assert.match(untraceable[1].why, /izsekot nevar/);
	// dimension numbers are not labels: "3600" is not part of the context
	assert.equal(contextOf(a.texts[0], a), "1-7 · Virtuve");
});

// ---- the IFC adapter ----------------------------------------------------------------------------------------------------------

interface Wall {
	guid: string;
	name: string;
	x: number;
	len?: number;
}
interface SpaceSpec {
	guid: string;
	name: string;
	longName: string;
	area: number;
	number?: string;
	bounds: string[];
}

function makeIfc(walls: Wall[], spaces: SpaceSpec[], metres = false): Uint8Array {
	const k = metres ? 0.001 : 1;
	const n = (v: number) => (Number.isInteger(v * k) ? `${v * k}.` : String(v * k));
	const L: string[] = [];
	let id = 100;
	const add = (body: string) => (L.push(`#${id}=${body};`), id++);
	const place = (rel: number | null, x: number) => {
		const p = add(`IFCCARTESIANPOINT((${n(x)},${n(0)},${n(0)}))`);
		const ax = add(`IFCAXIS2PLACEMENT3D(#${p},$,$)`);
		return add(`IFCLOCALPLACEMENT(${rel ? `#${rel}` : "$"},#${ax})`);
	};
	const site = place(null, 0);
	const bld = place(site, 0);
	const wallId = new Map<string, number>();
	for (const w of walls) {
		const prof = add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,$,${n(w.len ?? 4000)},${n(200)})`);
		const dir = add(`IFCDIRECTION((0.,0.,1.))`);
		const org = add(`IFCCARTESIANPOINT((${n(0)},${n(0)},${n(0)}))`);
		const pos = add(`IFCAXIS2PLACEMENT3D(#${org},$,$)`);
		const solid = add(`IFCEXTRUDEDAREASOLID(#${prof},#${pos},#${dir},${n(3000)})`);
		const rep = add(`IFCSHAPEREPRESENTATION(#11,'Body','SweptSolid',(#${solid}))`);
		const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
		wallId.set(w.guid, add(`IFCWALL('${w.guid}',$,'${w.name}',$,$,#${place(bld, w.x)},#${shape},$,.STANDARD.)`));
	}
	for (const s of spaces) {
		const sp = add(`IFCSPACE('${s.guid}',$,'${s.name}',$,$,#${place(bld, 0)},$,'${s.longName}',.ELEMENT.,.INTERNAL.,$)`);
		const q = add(`IFCQUANTITYAREA('NetFloorArea',$,$,${s.area},$)`);
		const eq = add(`IFCELEMENTQUANTITY('Q${s.guid.slice(1)}',$,'Qto_SpaceBaseQuantities',$,$,(#${q}))`);
		add(`IFCRELDEFINESBYPROPERTIES('R${s.guid.slice(1)}',$,$,$,(#${sp}),#${eq})`);
		if (s.number) {
			const p = add(`IFCPROPERTYSINGLEVALUE('Number',$,IFCLABEL('${s.number}'),$)`);
			const ps = add(`IFCPROPERTYSET('P${s.guid.slice(1)}',$,'Pset_SpaceCommon',$,(#${p}))`);
			add(`IFCRELDEFINESBYPROPERTIES('X${s.guid.slice(1)}',$,$,$,(#${sp}),#${ps})`);
		}
		for (const b of s.bounds) add(`IFCRELSPACEBOUNDARY('B${s.guid.slice(1)}${b}',$,$,$,#${sp},#${wallId.get(b)},$,.PHYSICAL.,.INTERNAL.)`);
	}
	const text = `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('t.ifc','2026-11-12T10:00:00',('X'),('X'),'','','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n#1=IFCPROJECT('PROJGUID00000000000001',$,'P',$,$,$,$,(#11),#7);\n#2=IFCSIUNIT(*,.LENGTHUNIT.,${metres ? "$" : ".MILLI."},.METRE.);\n#3=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);\n#7=IFCUNITASSIGNMENT((#2,#3));\n#8=IFCCARTESIANPOINT((0.,0.,0.));\n#9=IFCAXIS2PLACEMENT3D(#8,$,$);\n#11=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);\n${L.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
	return new TextEncoder().encode(text);
}

const WALLS_OLD: Wall[] = [{ guid: "WALLAAAAAAAAAAAAAAAAAA", name: "Siena A", x: 0 }, { guid: "WALLBBBBBBBBBBBBBBBBBB", name: "Siena B", x: 4000 }, { guid: "WALLCCCCCCCCCCCCCCCCCC", name: "Siena C", x: 60000 }];
const WALLS_NEW: Wall[] = [{ guid: "WALLAAAAAAAAAAAAAAAAAA", name: "Siena A", x: 0, len: 4500 }, { guid: "WALLBBBBBBBBBBBBBBBBBB", name: "Siena B", x: 4500 }, { guid: "WALLCCCCCCCCCCCCCCCCCC", name: "Siena C", x: 60000 }];
const SPACE_OLD: SpaceSpec = { guid: "SPACE1AAAAAAAAAAAAAAAA", name: "Telpa 7", longName: "Virtuve", area: 14.2, number: "1-7", bounds: ["WALLAAAAAAAAAAAAAAAAAA", "WALLBBBBBBBBBBBBBBBBBB"] };
const SPACE_NEW: SpaceSpec = { ...SPACE_OLD, area: 15.1 };

test("an IFC read through BimCraft: the space is found by its number (a property) and its name, with its area and boundaries; boxes come from the mesh", { skip: SKIP }, async () => {
	await withTraceModel(APP, makeIfc(WALLS_NEW, [SPACE_NEW]), "new.ifc", (m) => {
		const sp = m.elements.find((e) => e.cls.toLowerCase() === "ifcspace")!;
		assert.deepEqual([sp.name, sp.longName, sp.area], ["Telpa 7", "Virtuve", 15.1]);
		assert.ok(sp.keys.includes("1-7"), "the Number property is a key");
		assert.ok(sp.keys.includes("virtuve"));
		assert.deepEqual(sp.boundedBy.sort(), ["WALLAAAAAAAAAAAAAAAAAA", "WALLBBBBBBBBBBBBBBBBBB"]);
		const b = m.find("WALLBBBBBBBBBBBBBBBBBB")!;
		assert.equal(b.name, "Siena B");
		const box = b.box()!;
		// a rectangle profile is centred on its placement: 4 m long at x = 4.5 m spans 2.5 .. 6.5
		assert.ok(Math.abs(box[0] - 2.5) < 0.01 && Math.abs(box[3] - 6.5) < 0.01, `Siena B spans x 2.5..6.5 m, got ${box.map((v) => v.toFixed(3)).join(",")}`);
		assert.ok(Math.abs(box[5] - 3) < 0.01, "3 m high");
		assert.equal(m.find("nav-tada"), undefined);
		assert.deepEqual(m.solids.map((s) => s.name).sort(), ["Siena A", "Siena B", "Siena C"]);
	});
});

test("a file in metres gives the same boxes in metres", { skip: SKIP }, async () => {
	await withTraceModel(APP, makeIfc(WALLS_NEW, [SPACE_NEW], true), "new-m.ifc", (m) => {
		const box = m.find("WALLBBBBBBBBBBBBBBBBBB")!.box()!;
		assert.ok(Math.abs(box[0] - 2.5) < 0.01 && Math.abs(box[3] - 6.5) < 0.01);
	});
});

test("the trace on two real models: the area change is matched and explained by the walls that moved and were extended, not by the one far away", { skip: SKIP }, async () => {
	const oldBytes = makeIfc(WALLS_OLD, [SPACE_OLD]);
	const newBytes = makeIfc(WALLS_NEW, [SPACE_NEW]);
	await withTraceModel(APP, newBytes, "new.ifc", (nw) =>
		withTraceModel(APP, oldBytes, "old.ifc", (old) => {
			const item = { id: "1", kind: "area" as const, old: "14.2", new: "15.1", context: "1-7 · Virtuve" };
			const r = traceItem(item, nw, old);
			assert.equal(r.matches.length, 1);
			const m = r.matches[0];
			assert.deepEqual([m.sheetAgreesWithModel, m.modelAreaChanged, m.inOld], [true, true, true]);
			assert.equal(m.causes?.via, "space-boundary");
			const byName = Object.fromEntries(m.causes!.elements.map((e) => [e.name, e]));
			assert.deepEqual(Object.keys(byName).sort(), ["Siena A", "Siena B"], "Siena C did not change and does not bound the space");
			assert.deepEqual([byName["Siena B"].change, byName["Siena B"].dxMm], ["moved", 500]);
			assert.deepEqual([byName["Siena A"].change, byName["Siena A"].dxMm, byName["Siena A"].dsizeMm], ["resized", 0, [500, 0, 0]], "extended on both sides of its placement: longer, not moved");
			// without the old model: the match and the area check, no causes
			const alone = traceItem(item, nw, null).matches[0];
			assert.deepEqual([alone.sheetAgreesWithModel, alone.causes, alone.inOld], [true, undefined, null]);
		}),
	);
});

test("the same on a space with no boundaries: what is near is looked at, the wall 56 m away is not", { skip: SKIP }, async () => {
	const item = { id: "1", kind: "area" as const, old: "14.2", new: "15.1", context: "1-7" };
	await withTraceModel(APP, makeIfc(WALLS_NEW, [{ ...SPACE_NEW, bounds: [] }]), "new.ifc", (nw) =>
		withTraceModel(APP, makeIfc(WALLS_OLD, [{ ...SPACE_OLD, bounds: [] }]), "old.ifc", (old) => {
			const c = traceItem(item, nw, old).matches[0].causes!;
			assert.equal(c.via, "nearby");
			assert.deepEqual(c.elements.map((e) => e.name).sort(), ["Siena A", "Siena B"]);
		}),
	);
});

test("a file that is not an IFC is refused with its name", { skip: SKIP }, async () => {
	await assert.rejects(withTraceModel(APP, new TextEncoder().encode("nav ifc"), "BD1_X.ifc", () => 1), /BD1_X\.ifc/);
});

// ---- through the handler, on the invented sheet issues of 5.4 ------------------------------------------------------------------

test("two issues of a sheet where only a wall moved and a dimension changed: nothing has a label, and the answer says so instead of guessing", { skip: SKIP }, async () => {
	const dir = tmp();
	const registry = new Registry(join(dir, "projects.json"), join(dir, "projects"));
	const root = join(tmp(), "BD940 Testa iela 1");
	mkdir(join(root, "01_Projektesana", "1.2_Projekta dalas", "AR", "04_IFC"), { recursive: true });
	copyFileSync(join(FIX, "sheet-a.pdf"), join(root, "A.pdf"));
	copyFileSync(join(FIX, "sheet-b.pdf"), join(root, "B.pdf"));
	copyFileSync(join(FIX, "ifc", "two-walls.ifc"), join(root, "01_Projektesana", "1.2_Projekta dalas", "AR", "04_IFC", "BD940_AR.ifc"));
	const p = registry.add(root);
	const h = compareHandlers({ registry, bimcraftApp: APP, openPath: async () => "" });
	const rel = join("01_Projektesana", "1.2_Projekta dalas", "AR", "04_IFC", "BD940_AR.ifc");
	const v = await h["sheets.trace"](p.id, "A.pdf", "B.pdf", rel, rel);
	assert.deepEqual([v.rows, v.total], [[], 0]);
	assert.equal(v.untraceable.length, 2);
	assert.deepEqual(v.untraceable.map((u) => u.text).sort(), ["izmērs 3000 → 3200", "pārvietota līnija"]);
	assert.ok(v.untraceable.every((u) => u.sheetNo === "AR-3" && u.why.length > 20));
	// a model that is not there, or a file that is not an IFC, is refused with a reason
	await assert.rejects(h["sheets.trace"](p.id, "A.pdf", "B.pdf", "nav.ifc", null), /ENOENT|nav|Ārpus/i);
	await assert.rejects(h["sheets.trace"](p.id, "A.pdf", "B.pdf", "A.pdf", null), /Nepareizs faila veids/);
	assert.ok(registry.store(p.id).events().some((e) => e.kind === "sheets.traced"));
});
