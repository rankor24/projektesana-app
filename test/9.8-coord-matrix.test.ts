// 9.8 the Koordinācija page: the matrix (models × Novietne / Hierarhija / Stāvi) from invented audits — counts, ticks, a dash for
// no IFC, the order of models — a cell's lines, and the bridge messages for the federated 3D scene on BimCraft's real add-on API
// and IFC engine, with BimCraft's Models panel faked where its WebGL scene would be (the spike: its own API holds up to 63 models
// in one scene). Skipped (bridge part) only when BimCraft is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import type { AuditReport, ModelReport, ReportGroupName, ReportLine } from "../src/core/coordination-types.ts";
import { checkHostMessage, MAX_SCENE, type BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import { cellLines, cellText, coordMatrix, sceneTarget } from "../src/shared/coordination-matrix.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const line = (id: string, w: string, now: string, to: string, ask?: string): ReportLine => ({ id, kind: "k", w, now, to, ...(ask ? { ask } : {}) });
const model = (code: string, file: string, groups: Partial<Record<ReportGroupName, ReportLine[]>>, source: ModelReport["source"] = "ifc"): ModelReport => ({
	code,
	file,
	source,
	app: "Revit",
	ts: "2026-11-01",
	groups: (Object.entries(groups) as [ReportGroupName, ReportLine[]][]).filter(([, l]) => l.length).map(([g, lines]) => ({ g, lines })),
});
const audit = (models: ModelReport[]): AuditReport => ({ models, reference: {} as never, totalLines: models.reduce((n, m) => n + m.groups.reduce((k, g) => k + g.lines.length, 0), 0), date: "2026-11-13" });

const AR = model("AR", "BD940_AR.ifc", { Novietne: [line("a", "Pamatpunkts X", "100", "0"), line("b", "Pamatpunkts Y", "5", "0")], Stāvi: [line("c", "Stāvs", "Level 1", "1. stāvs", "Kāds augstums?")] });
const BK = model("BK", "BD940_BK.ifc", {});
const REVIT = model("REVIT", "BD940_AR.rvt", { Stāvi: [line("d", "Stāvs", "L2", "2. stāvs")] }, "revit");

test("the matrix: a count where a model has remarks, a tick where it agrees, a dash where there is no IFC to measure", () => {
	const m = coordMatrix(audit([AR, BK, REVIT]), [{ file: "BD940_UR.ifc", message: "fails bojāts" }]);
	assert.deepEqual(m.groups, ["Novietne", "Hierarhija", "Stāvi"]);
	assert.deepEqual(m.rows.map((r) => r.code), ["AR", "BK", "REVIT", "BD940_UR.ifc"], "the order of the audit, then the unreadable ones");
	assert.deepEqual(m.rows[0].cells.map((c) => [c.state, c.count, cellText(c)]), [["fix", 2, "2"], ["ok", 0, "✓"], ["fix", 1, "1"]]);
	assert.deepEqual(m.rows[1].cells.map(cellText), ["✓", "✓", "✓"], "a model that agrees everywhere");
	assert.deepEqual(m.rows[2].cells.map(cellText), ["—", "—", "1"], "the open Revit document is measured on its storeys only");
	assert.equal(m.rows[2].note, "atvērtais Revit dokuments: tikai stāvi");
	assert.deepEqual(m.rows[3].cells.map(cellText), ["—", "—", "—"], "an unreadable IFC is all dashes");
	assert.deepEqual([m.rows[3].source, m.rows[3].note], ["unreadable", "fails bojāts"]);
	assert.deepEqual(m.rows.map((r) => r.total), [3, 0, 1, 0]);
	assert.equal(m.total, 4);
});

test("no audit, no models: an empty matrix; an unreadable file already in the audit is not listed twice", () => {
	assert.deepEqual(coordMatrix(null), { groups: ["Novietne", "Hierarhija", "Stāvi"], rows: [], total: 0 });
	assert.equal(coordMatrix(audit([]), []).rows.length, 0);
	assert.equal(coordMatrix(audit([AR]), [{ file: "BD940_AR.ifc", message: "x" }]).rows.length, 1);
	const only = coordMatrix(null, [{ file: "x.ifc", message: "m" }]);
	assert.deepEqual(only.rows.map((r) => r.source), ["unreadable"]);
});

test("a cell's lines: action, now → to, and the question for the discipline lead; an empty or unknown cell has none", () => {
	const m = coordMatrix(audit([AR, BK]));
	assert.deepEqual(cellLines(m, "BD940_AR.ifc", "Novietne"), [{ text: "Pamatpunkts X: 100 → 0" }, { text: "Pamatpunkts Y: 5 → 0" }]);
	assert.deepEqual(cellLines(m, "BD940_AR.ifc", "Stāvi"), [{ text: "Stāvs: Level 1 → 1. stāvs", ask: "Kāds augstums?" }]);
	assert.deepEqual(cellLines(m, "BD940_BK.ifc", "Novietne"), []);
	assert.deepEqual(cellLines(m, "nav.ifc", "Novietne"), []);
	assert.deepEqual(cellLines(m, "BD940_AR.ifc", "Hierarhija"), []);
});

test("a click isolates the model in the scene: only a measured IFC; Revit, unreadable files and nothing show every model again", () => {
	const m = coordMatrix(audit([AR, REVIT]), [{ file: "x.ifc", message: "m" }]);
	assert.equal(sceneTarget(m, "BD940_AR.ifc"), "BD940_AR.ifc");
	assert.equal(sceneTarget(m, "BD940_AR.rvt"), null, "the Revit document is not in the 3D scene");
	assert.equal(sceneTarget(m, "x.ifc"), null);
	assert.equal(sceneTarget(m, "nav.ifc"), null);
	assert.equal(sceneTarget(m, null), null);
});

test("the scene messages are checked before they go", () => {
	const b = new Uint8Array([1, 2, 3]);
	assert.equal(checkHostMessage({ pj: 1, type: "scene", models: [{ name: "a.ifc", bytes: b }] }), null);
	assert.equal(checkHostMessage({ pj: 1, type: "scene", models: Array.from({ length: MAX_SCENE }, (_, i) => ({ name: `m${i}.ifc`, bytes: b })) }), null);
	assert.match(checkHostMessage({ pj: 1, type: "scene", models: [] })!, /scene needs 1 to 63/);
	assert.match(checkHostMessage({ pj: 1, type: "scene", models: Array.from({ length: MAX_SCENE + 1 }, (_, i) => ({ name: `m${i}.ifc`, bytes: b })) })!, /scene needs 1 to 63/);
	assert.match(checkHostMessage({ pj: 1, type: "scene", models: [{ name: "", bytes: b }] })!, /scene needs/);
	assert.match(checkHostMessage({ pj: 1, type: "scene", models: [{ name: "a.ifc", bytes: new Uint8Array() }] })!, /scene needs/);
	assert.equal(checkHostMessage({ pj: 1, type: "model", name: null }), null);
	assert.equal(checkHostMessage({ pj: 1, type: "model", name: "a.ifc" }), null);
	assert.match(checkHostMessage({ pj: 1, type: "model", name: "" })!, /model needs a file name/);
});

// ---- the bridge on BimCraft's real engine ----

const ROOT = join(import.meta.dirname, "..");
const DEV = join(BIMCRAFT_DIR ?? "", "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

/* eslint-disable @typescript-eslint/no-explicit-any */
const vecOf = (a: number[]) => ({ toArray: () => [...a], set: (...n: number[]) => n.forEach((x, i) => (a[i] = x)) });

test("a scene of several IFC files: the first through the importer, the others added as BimCraft's federated models; one model alone and all again", { skip: have ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	(globalThis as any).document = { createElement: () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
	const imp = (f: string) => import(pathToFileURL(join(DEV, f)).href);
	const i18n = await imp("i18n.js");
	i18n.init({ locale: "en", strings: JSON.parse(readFileSync(join(DEV, "lang", "en.json"), "utf8")) });
	const A = await imp("addons.js");
	const BA = await imp("addons/bimcraft-api.js");
	const WebIFC = await imp("ifc/api.js");
	const { IfcModel } = await imp("ifc-model.js");

	const base = tmp();
	mkdirSync(join(base, "projektesana"), { recursive: true });
	cpSync(join(ROOT, "src", "bimcraft-addon", "projektesana"), join(base, "projektesana"), { recursive: true });
	writeFileSync(join(base, "index.json"), JSON.stringify({ addons: ["projektesana"] }));

	const ch = new MessageChannel();
	const inbox: BimcraftToHost[] = [];
	ch.port1.on("message", (m) => inbox.push(m));
	(globalThis as any).__pjPort = { post: (m: unknown) => ch.port2.postMessage(m), on: (fn: (m: unknown) => void) => ch.port2.on("message", fn) };
	const wait = async <T extends BimcraftToHost["type"]>(type: T): Promise<Extract<BimcraftToHost, { type: T }>> => {
		for (let i = 0; i < 200; i++) {
			const m = inbox.find((x) => x.type === type);
			if (m) return (inbox.splice(inbox.indexOf(m), 1), m) as never;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error(`no ${type} from the bridge; got ${JSON.stringify(inbox.map((x) => x.type))}`);
	};
	const send = (m: object) => ch.port1.postMessage({ pj: 1, ...m });

	// BimCraft's Models panel (bimcraftModels): the first model is opened, add() puts another beside it; the viewer hides per model
	const added: string[] = [];
	const visible = new Map<number, boolean>();
	const panel = { models: [] as { mi: number; name: string; elements: number }[] };
	(globalThis as any).bimcraftModels = {
		add: async (f: File) => (added.push(f.name), panel.models.push({ mi: panel.models.length, name: f.name, elements: 2 })),
		list: () => panel.models,
	};
	const viewer = {
		canvas: { parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		camera: { position: vecOf([1, 2, 3]), fov: 50, updateProjectionMatrix() {} },
		controls: { target: vecOf([0, 0, 0]), addEventListener() {}, removeEventListener() {}, update() {} },
		setModelVisible: (mi: number, on: boolean) => visible.set(mi, on),
		keyBounds: () => null,
		project: () => null,
		frameKeys: () => true,
		render() {},
		onUserMove() {},
	};
	(globalThis as any).__pjViewer = viewer;

	const model = await IfcModel.create(WebIFC, null, {});
	let opened: string | null = null;
	const mem = new Map<string, string>();
	const started = await BA.startAddons({
		editor: () => (opened ? { W: WebIFC, api: model.api, mid: model.modelID } : null),
		model: () => (opened ? model : null),
		name: () => opened ?? "",
		selection: () => [],
		select: () => {},
		afterEdit: () => {},
		status: () => {},
		openIfc: async (bytes: Uint8Array, name: string) => {
			await model.load(bytes);
			opened = name;
			panel.models.length = 0;
			panel.models.push({ mi: 0, name, elements: 2 });
		},
		base: pathToFileURL(base).href + "/",
		importer: (u: string) => import(u),
		storage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) },
		verify: async () => false,
		bundledOnly: false,
		noGlobal: true,
		fetchJson: async (u: string) => JSON.parse(readFileSync(new URL(u), "utf8")),
		packages: A.packageStore(null),
	});
	(globalThis as any).ccAddons = started;
	try {
		await wait("ready");
		send({ type: "model", name: "BD940_AR.ifc" });
		assert.match((await wait("error")).message, /no scene of several models yet|./);
		send({ type: "scene", models: [] });
		assert.match((await wait("error")).message, /at least one model/);

		const a = new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc")));
		const b = new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls-rev-b.ifc")));
		send({ type: "scene", models: [{ name: "BD940_AR.ifc", bytes: a }, { name: "BD940_BK.ifc", bytes: b }, { name: "BD940_UR.ifc", bytes: b }] });
		const scene = await wait("scene");
		assert.deepEqual(scene.models.map((m) => [m.mi, m.name]), [[0, "BD940_AR.ifc"], [1, "BD940_BK.ifc"], [2, "BD940_UR.ifc"]]);
		assert.equal(opened, "BD940_AR.ifc", "the first model went through BimCraft's own importer, on its real IFC engine");
		assert.deepEqual(added, ["BD940_BK.ifc", "BD940_UR.ifc"], "the others were added as federated models");

		// one model alone: every other one hidden; all again
		send({ type: "model", name: "BD940_BK.ifc" });
		assert.deepEqual(await wait("modelShown"), { pj: 1, type: "modelShown", name: "BD940_BK.ifc", shown: 1, total: 3 });
		assert.deepEqual([...visible.entries()], [[0, false], [1, true], [2, false]]);
		send({ type: "model", name: null });
		assert.deepEqual(await wait("modelShown"), { pj: 1, type: "modelShown", name: null, shown: 3, total: 3 });
		assert.deepEqual([...visible.values()], [true, true, true]);
		send({ type: "model", name: "BD940_XX.ifc" });
		assert.match((await wait("error")).message, /not in this scene/);

		// a single model needs no Models panel
		delete (globalThis as any).bimcraftModels;
		send({ type: "scene", models: [{ name: "BD940_AR.ifc", bytes: a }] });
		assert.deepEqual((await wait("scene")).models.map((m) => m.name), ["BD940_AR.ifc"]);
		send({ type: "scene", models: [{ name: "BD940_AR.ifc", bytes: a }, { name: "BD940_BK.ifc", bytes: b }] });
		assert.match((await wait("error")).message, /needs BimCraft's Models panel/);
	} finally {
		await started.loader.setEnabled("projektesana", false).catch(() => undefined);
		ch.port1.close();
		ch.port2.close();
		for (const k of ["__pjPort", "__pjViewer", "ccAddons", "document", "bimcraftModels"]) delete (globalThis as any)[k];
	}
});
