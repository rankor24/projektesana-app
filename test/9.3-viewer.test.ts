// 9.3 the one viewer: the tab / pane state (open, close, split, move a tab, linked camera and page, a compare as a split) and the
// bridge messages for the side panels (properties, element tree, IFC metadata, the watched camera) on BimCraft's real add-on
// API and IFC engine, with a fake 3D viewer where the WebGL one would be. Skipped only when BimCraft is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { checkHostMessage, isBimcraftMessage, type BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import * as V from "../src/shared/viewer.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const ifc = (path: string, label = path): V.ViewTarget => ({ kind: "ifc", path, label });
const doc = (sourceId: string, page?: number): V.ViewTarget => ({ kind: "source", sourceId, ...(page ? { page } : {}) });
const ok = (s: V.ViewerState) => assert.deepEqual(V.problems(s), []);

test("open: a file is a tab in the focused pane; the same file again brings its tab forward (a source's page is updated)", () => {
	let s = V.emptyViewer();
	assert.equal(V.activeTab(s), null);
	s = V.open(s, ifc("src:m1", "AR.ifc"), "AR.ifc");
	s = V.open(s, doc("s1"), "PU");
	ok(s);
	assert.deepEqual(s.panes[0].tabs.length, 2);
	assert.equal(V.activeTab(s)?.label, "PU");
	s = V.open(s, doc("s1", 4), "PU");
	assert.equal(s.tabs.length, 2, "no second tab");
	assert.deepEqual(V.activeTab(s)?.target, { kind: "source", sourceId: "s1", page: 4 });
	s = V.open(s, ifc("src:m1", "AR.ifc"), "AR.ifc");
	assert.equal(V.activeTab(s)?.label, "AR.ifc");
	assert.equal(V.targetKey(doc("s1")), V.targetKey(doc("s1", 9)), "the page is not part of the identity");
	assert.equal(V.targetLabel({ kind: "compare", a: "x", b: "y", aLabel: "A", bLabel: "B", mode: "ifc" }), "A ↔ B");
	assert.equal(V.targetLabel(doc("s9"), (id) => (id === "s9" ? "Sienas" : undefined)), "Sienas");
});

test("close: the active tab picks its neighbour; closing the last tab leaves an empty viewer; closing an unknown tab changes nothing", () => {
	let s = V.emptyViewer();
	for (const n of ["a", "b", "c"]) s = V.open(s, doc(n), n, { id: `t${n}` });
	s = V.activate(s, "tb");
	s = V.close(s, "tb");
	assert.equal(s.panes[0].active, "tc");
	s = V.close(s, "tc");
	assert.equal(s.panes[0].active, "ta");
	assert.equal(V.close(s, "nav"), s);
	s = V.close(s, "ta");
	ok(s);
	assert.deepEqual(s.panes[0], { tabs: [], active: null });
});

test("split: the second pane shows the active tab again (two angles); side by side or one above the other; unsplit keeps every tab", () => {
	let s = V.open(V.emptyViewer(), ifc("src:m1", "AR.ifc"), "AR.ifc", { id: "m" });
	s = V.open(s, doc("s1"), "PU", { id: "d" });
	s = V.activate(s, "m");
	s = V.splitPane(s, "h");
	ok(s);
	assert.deepEqual([s.split, s.panes.length, s.focused, s.panes[1].active], ["h", 2, 1, "m"]);
	assert.equal(s.tabs.length, 2, "the same tab, shown twice: not a copy");
	s = V.splitPane(s, "v");
	assert.deepEqual([s.split, s.panes.length], ["v", 2], "splitting again only turns it");
	s = V.moveTab(s, "d", 1);
	ok(s);
	assert.deepEqual(s.panes[1].tabs, ["m", "d"]);
	s = V.unsplit(s);
	ok(s);
	assert.deepEqual([s.split, s.panes.length, s.tabs.length], ["none", 1, 2]);
	assert.deepEqual(V.splitPane(V.emptyViewer(), "h"), V.emptyViewer(), "nothing open: nothing to split");
});

test("a model beside its sheet: move the sheet's tab to the second pane; a pane left empty collapses the split", () => {
	let s = V.open(V.emptyViewer(), ifc("src:m1", "AR.ifc"), "AR.ifc", { id: "m" });
	s = V.open(s, doc("sheet"), "A-101", { id: "p" });
	s = V.moveTab(s, "p", 1);
	ok(s);
	assert.deepEqual([s.split, s.panes[0].tabs, s.panes[1].tabs, s.focused], ["h", ["m"], ["p"], 1]);
	s = V.moveTab(s, "p", 0);
	ok(s);
	assert.deepEqual([s.split, s.panes.length, s.panes[0].tabs], ["none", 1, ["m", "p"]], "the sheet went back: no empty pane");
	assert.equal(V.moveTab(s, "nav", 1), s);
	assert.equal(V.moveTab(s, "m", 0).panes.length, 1, "already in pane 0 with one pane: nothing to do");
});

test("linked camera and page: only with two panes; the follower is the other pane; collapsing the split unlinks", () => {
	let s = V.open(V.emptyViewer(), ifc("src:m1", "AR.ifc"), "AR.ifc");
	assert.equal(V.setLinkedCamera(s, true), s, "one pane: nothing to link");
	s = V.setLinkedCamera(V.splitPane(s, "h"), true);
	assert.equal(V.followerOf(s, 0, "camera"), 1);
	assert.equal(V.followerOf(s, 1, "camera"), 0);
	assert.equal(V.followerOf(s, 0, "page"), null, "the page is not linked");
	s = V.setLinkedCamera(s, false);
	assert.equal(V.followerOf(s, 0, "camera"), null, "two angles that move apart");
	s = V.setLinkedPage(V.setLinkedCamera(s, true), true);
	s = V.unsplit(s);
	ok(s);
	assert.deepEqual([s.linkedCamera, s.linkedPage], [false, false]);
	assert.equal(V.followerOf(s, 0, "camera"), null);
});

test("compare as a split: A and B in two panes with the camera linked for two models, the page for two documents; what was open stays", () => {
	let s = V.open(V.emptyViewer(), doc("old"), "vecais", { id: "o" });
	s = V.compareSplit(s, { target: ifc("rev:1", "AR 1"), label: "AR 1" }, { target: ifc("rev:2", "AR 2"), label: "AR 2" });
	ok(s);
	assert.deepEqual([s.split, s.panes.length, s.panes[0].active, s.panes[1].active], ["h", 2, s.tabs.find((t) => t.label === "AR 1")!.id, s.tabs.find((t) => t.label === "AR 2")!.id]);
	assert.deepEqual([s.linkedCamera, s.linkedPage], [true, false]);
	assert.ok(s.tabs.some((t) => t.id === "o"), "the document that was open is still a tab");
	const d = V.compareSplit(V.emptyViewer(), { target: doc("a", 1), label: "A" }, { target: doc("b", 1), label: "B" }, "v");
	ok(d);
	assert.deepEqual([d.split, d.linkedCamera, d.linkedPage], ["v", false, true]);
	// BimCraft's own compare and the sheet overlay stay one tab
	const c = V.open(V.emptyViewer(), { kind: "compare", a: "rev:1", b: "rev:2", aLabel: "1", bLabel: "2", mode: "ifc" }, "1 ↔ 2");
	assert.deepEqual([c.panes.length, c.tabs[0].target.kind], [1, "compare"]);
});

test("a long run of operations never breaks the viewer's invariants", () => {
	let seed = 11;
	const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
	let s = V.emptyViewer();
	for (let i = 0; i < 500; i++) {
		const names = ["a", "b", "c", "d"];
		const n = names[rnd(4)];
		const op = rnd(9);
		if (op === 0) s = V.open(s, doc(n), n, { pane: rnd(2) });
		else if (op === 1) s = V.open(s, ifc(n), n);
		else if (op === 2 && s.tabs.length) s = V.close(s, s.tabs[rnd(s.tabs.length)].id);
		else if (op === 3) s = V.splitPane(s, rnd(2) ? "h" : "v");
		else if (op === 4) s = V.unsplit(s);
		else if (op === 5 && s.tabs.length) s = V.moveTab(s, s.tabs[rnd(s.tabs.length)].id, rnd(2));
		else if (op === 6) s = V.setLinkedCamera(s, rnd(2) === 0);
		else if (op === 7) s = V.focusPane(s, rnd(2));
		else if (op === 8 && s.tabs.length) s = V.activate(s, s.tabs[rnd(s.tabs.length)].id, rnd(2));
		assert.deepEqual(V.problems(s), [], `after step ${i}`);
	}
});

test("the host's messages are checked before they go; the new messages from BimCraft are recognised", () => {
	assert.equal(checkHostMessage({ pj: 1, type: "props", id: 30 }), null);
	assert.equal(checkHostMessage({ pj: 1, type: "props", guid: "0Wall" }), null);
	assert.match(checkHostMessage({ pj: 1, type: "props" })!, /needs an element id or a GlobalId/);
	assert.match(checkHostMessage({ pj: 1, type: "props", id: -3 })!, /needs/);
	assert.match(checkHostMessage({ pj: 1, type: "props", id: 1.5 })!, /needs/);
	assert.match(checkHostMessage({ pj: 1, type: "props", guid: "" })!, /needs/);
	assert.match(checkHostMessage({ pj: 1, type: "watch", on: "yes" as never })!, /true or false/);
	assert.equal(checkHostMessage({ pj: 1, type: "tree" }), null);
	for (const type of ["properties", "tree", "meta", "camera"]) assert.ok(isBimcraftMessage({ pj: 1, type }), type);
	assert.equal(isBimcraftMessage({ pj: 1, type: "props" }), false, "a host message is not a message from BimCraft");
});

// ---- the bridge on BimCraft's real engine ----

const ROOT = join(import.meta.dirname, "..");
const DEV = join(BIMCRAFT_DIR ?? "", "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

/* eslint-disable @typescript-eslint/no-explicit-any */
const vecOf = (a: number[]) => ({ toArray: () => [...a], set: (...n: number[]) => n.forEach((x, i) => (a[i] = x)) });

test("properties, element tree, IFC metadata and the watched camera, on BimCraft's real engine", { skip: have ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
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

	const pos = [1, 2, 3];
	const tgt = [0, 0, 0];
	const changeListeners: (() => void)[] = [];
	const viewer = {
		canvas: { parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		camera: { position: vecOf(pos), fov: 50, updateProjectionMatrix() {} },
		controls: { target: vecOf(tgt), addEventListener: (_t: string, fn: () => void) => changeListeners.push(fn), removeEventListener: (_t: string, fn: () => void) => changeListeners.splice(changeListeners.indexOf(fn), 1), update() {} },
		keyBounds: () => null,
		project: () => null,
		frameKeys: () => true,
		render() {},
		onUserMove() {},
	};
	(globalThis as any).__pjViewer = viewer;

	const model = await IfcModel.create(WebIFC, null, {});
	let opened: string | null = null;
	let sel: number[] = [];
	const mem = new Map<string, string>();
	const started = await BA.startAddons({
		editor: () => (opened ? { W: WebIFC, api: model.api, mid: model.modelID } : null),
		model: () => (opened ? model : null),
		name: () => opened ?? "",
		selection: () => sel,
		select: (ids: number[]) => (sel = ids),
		afterEdit: () => {},
		status: () => {},
		openIfc: async (bytes: Uint8Array, name: string) => {
			await model.load(bytes);
			opened = name;
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
		// nothing is open: each panel's question is answered with a reason, not silence
		for (const type of ["props", "tree", "meta"]) {
			send({ type, id: 30 });
			assert.match((await wait("error")).message, /no model is open/, type);
		}
		send({ type: "open", name: "two-walls.ifc", bytes: new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc"))) });
		await wait("opened");

		// properties: by express id and by GlobalId, the same element, every value as text
		send({ type: "props", id: 30 });
		const byId = (await wait("properties")).item;
		assert.deepEqual([byId.id, byId.guid, byId.cls, byId.name], [30, "0Wall0000000000000001", "IfcWall", "Siena A"]);
		assert.ok(Array.isArray(byId.sets));
		for (const s of byId.sets) for (const r of s.rows) assert.equal(typeof r.value, "string");
		send({ type: "props", guid: "0Wall0000000000000002" });
		const byGuid = (await wait("properties")).item;
		assert.deepEqual([byGuid.id, byGuid.name], [32, "Siena B"]);
		send({ type: "props", guid: "0Nowhere00000000000000" });
		assert.match((await wait("error")).message, /not in this model/);
		send({ type: "props" });
		assert.match((await wait("error")).message, /an id or a guid is needed/);
		send({ type: "props", id: 99999 });
		assert.match((await wait("error")).message, /not in this model|./);

		// the element tree: project → site → building → storey, the storey holds both walls
		send({ type: "tree" });
		const tree = (await wait("tree")).nodes;
		assert.equal(tree.length, 1);
		assert.deepEqual([tree[0].cls, tree[0].name], ["IfcProject", "Testa projekts"]);
		const storey = tree[0].children[0]?.children[0]?.children[0];
		assert.deepEqual([tree[0].children[0].cls, tree[0].children[0].children[0].cls, storey?.cls, storey?.name], ["IfcSite", "IfcBuilding", "IfcBuildingStorey", "1. stavs"]);
		assert.equal(storey?.elementCount, 2);
		assert.deepEqual(storey?.elements?.map((e) => [e.id, e.cls, e.name]), [[30, "IfcWall", "Siena A"], [32, "IfcWall", "Siena B"]]);

		// the IFC metadata: schema, project, header
		send({ type: "meta" });
		const meta = (await wait("meta")).info;
		assert.match(String(meta.schema), /IFC/);
		assert.equal(meta.project.name, "Testa projekts");
		assert.deepEqual([meta.elements, meta.storeys], [2, 1]);
		assert.ok("timestamp" in meta.header && "application" in meta.header);

		// the watched camera: a move is posted (not faster than every 120 ms), a move the host made is not echoed, off stops it
		send({ type: "watch", on: true });
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(changeListeners.length, 1);
		pos[0] = 5;
		changeListeners[0]();
		assert.deepEqual((await wait("camera")).camera, { position: [5, 2, 3], target: [0, 0, 0], fov: 50 });
		changeListeners[0]();
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(inbox.filter((m) => m.type === "camera").length, 0, "throttled");
		await new Promise((r) => setTimeout(r, 140));
		send({ type: "fly", camera: { position: [9, 9, 9], target: [1, 1, 1], fov: 60 } });
		await new Promise((r) => setTimeout(r, 60));
		changeListeners[0]();
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(inbox.filter((m) => m.type === "camera").length, 0, "the follower's own move is not echoed back to the first view");
		send({ type: "watch", on: false });
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(changeListeners.length, 0);
	} finally {
		await started.loader.setEnabled("projektesana", false).catch(() => undefined);
		ch.port1.close();
		ch.port2.close();
		for (const k of ["__pjPort", "__pjViewer", "ccAddons", "document"]) delete (globalThis as any)[k];
	}
});
