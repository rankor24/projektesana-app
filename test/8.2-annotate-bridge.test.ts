// 8.2 the annotation view's bridge: the real add-on on BimCraft's real add-on API and IFC engine (as 5.1), with a fake 3D
// viewer and a fake DOM standing where BimCraft's WebGL viewer and the page are. Covers: capture (selection, camera,
// BCF viewpoint), numbered dots on their elements that follow the camera, a click on a dot, fly to a saved camera, fly to
// an element. Skipped only when the BimCraft checkout is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import type { BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const DEV = join(BIMCRAFT_DIR ?? "", "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

/* eslint-disable @typescript-eslint/no-explicit-any */
const vecOf = (a: number[]) => ({ toArray: () => [...a], set: (...n: number[]) => n.forEach((x, i) => (a[i] = x)) });
function el(): any {
	const e: any = {
		style: {},
		children: [] as any[],
		attrs: {} as Record<string, string>,
		listeners: {} as Record<string, (ev: unknown) => void>,
		textContent: "",
		title: "",
		parent: null,
		appendChild: (c: any) => (e.children.push(c), (c.parent = e), c),
		remove: () => {
			if (e.parent) e.parent.children = e.parent.children.filter((x: any) => x !== e);
		},
		addEventListener: (t: string, fn: (ev: unknown) => void) => (e.listeners[t] = fn),
		setAttribute: (k: string, v: string) => (e.attrs[k] = v),
	};
	return e;
}

test("capture, dots that follow the camera, a click on a dot, fly to a camera and to an element", { skip: have ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const host = el();
	(globalThis as any).document = { createElement: () => el(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
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

	// the fake viewer: a camera, orbit controls, bounds per key (30 = Siena A, 32 = Siena B), a projection, framing
	const pos = [1, 2, 3];
	const tgt = [0, 0, 0];
	let scale = 10;
	let framed: number[] | null = null;
	const changeListeners: (() => void)[] = [];
	const viewer = {
		canvas: { parentElement: host, getBoundingClientRect: () => ({ left: 10, top: 20 }) },
		camera: { position: vecOf(pos), fov: 50, updateProjectionMatrix() {} },
		controls: { target: vecOf(tgt), addEventListener: (_t: string, fn: () => void) => changeListeners.push(fn), removeEventListener() {}, update() {} },
		keyBounds: (keys: number[]) => (keys[0] === 30 ? { min: [0, 0, 0], max: [2, 2, 2] } : keys[0] === 32 ? { min: [10, 0, 0], max: [12, 2, 2] } : null),
		project: (p: number[]) => ({ x: 100 + p[0] * scale, y: 200 + p[1] * scale }),
		frameKeys: (keys: number[]) => ((framed = keys), true),
		render() {},
		onUserMove() {},
	};
	(globalThis as any).__pjViewer = viewer;
	(globalThis as any).bimcraftIssues = { capture: () => ({ camera: { kind: "perspective", viewPoint: [4, 5, 6], direction: [0, 1, 0], up: [0, 0, 1], fov: 55 }, selection: [], snapshot: new Uint8Array([1]) }) };

	const model = await IfcModel.create(WebIFC, null, {});
	let opened: string | null = null;
	let sel: number[] = [];
	const mem = new Map<string, string>();
	const started = await BA.startAddons({
		editor: () => (opened ? { W: {}, api: model.api, mid: model.modelID } : null),
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
		// before a model is open: nothing to draw, nothing to capture
		send({ type: "markers", markers: [{ id: "p1", guid: "0Wall0000000000000001", n: 1, state: "open" }] });
		assert.deepEqual(await wait("markers"), { pj: 1, type: "markers", drawn: 0, asked: 1 });
		send({ type: "capture" });
		assert.match((await wait("error")).message, /no model is open/);

		send({ type: "open", name: "two-walls.ifc", bytes: new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc"))) });
		await wait("opened");

		// capture: the selection with its GlobalId, the camera in viewer space, the BCF camera in IFC space (no snapshot bytes)
		sel = [30];
		await wait("selection");
		send({ type: "capture" });
		const cap = await wait("captured");
		assert.equal(cap.items[0].guid, "0Wall0000000000000001");
		assert.deepEqual(cap.camera, { position: [1, 2, 3], target: [0, 0, 0], fov: 50 });
		assert.deepEqual(cap.viewpoint, { kind: "perspective", viewPoint: [4, 5, 6], direction: [0, 1, 0], up: [0, 0, 1], fov: 55 });

		// dots: one per found element, numbered, centred on the element's bounds, in canvas coordinates; unknown GlobalId skipped
		send({
			type: "markers",
			markers: [
				{ id: "p1", guid: "0Wall0000000000000001", n: 1, state: "open" },
				{ id: "p2", guid: "0Wall0000000000000002", n: 2, state: "resolved" },
				{ id: "p3", guid: "0Nowhere00000000000000", n: 3, state: "open" },
			],
		});
		assert.deepEqual(await wait("markers"), { pj: 1, type: "markers", drawn: 2, asked: 3 });
		const layer = host.children[0];
		assert.equal(layer.attrs["data-pj-markers"], "");
		assert.equal(layer.style.pointerEvents, "none", "the layer lets the model be picked through it");
		const [d1, d2] = layer.children;
		assert.deepEqual([d1.textContent, d2.textContent], ["1", "2"]);
		assert.deepEqual([d1.style.left, d1.style.top], ["100px", "190px"], "centre (1,1,1) → page (110,210) → canvas (100,190)");
		assert.deepEqual([d2.style.left, d2.style.top], ["200px", "190px"], "centre (11,1,1) → page (210,210)");
		assert.equal(d1.style.pointerEvents, "auto");
		assert.notEqual(d1.style.background, d2.style.background, "state shows in the colour");

		// the camera moves: the dots follow
		scale = 20;
		for (const fn of changeListeners) fn();
		assert.deepEqual([d1.style.left, d1.style.top], ["110px", "200px"]);

		// the user clicks a dot
		d2.listeners.click({ stopPropagation() {} });
		assert.equal((await wait("marker")).id, "p2");

		// fly to a saved camera (fov clamped), and to an element
		send({ type: "fly", camera: { position: [7, 8, 9], target: [1, 1, 1], fov: 500 } });
		await new Promise((r) => setTimeout(r, 60));
		assert.deepEqual([pos, tgt, viewer.camera.fov], [[7, 8, 9], [1, 1, 1], 120]);
		send({ type: "fly", guid: "0Wall0000000000000002" });
		await new Promise((r) => setTimeout(r, 60));
		assert.deepEqual(framed, [32]);
		assert.deepEqual(sel, [32]);

		// what cannot be done is said, not ignored
		send({ type: "fly", camera: { position: [1, 2], target: [0, 0, 0], fov: 50 } });
		assert.match((await wait("error")).message, /no usable camera/);
		send({ type: "fly", guid: "0Nowhere00000000000000" });
		assert.match((await wait("error")).message, /not in this model/);

		// an empty set clears the dots; opening another model does too
		send({ type: "markers", markers: [] });
		assert.deepEqual(await wait("markers"), { pj: 1, type: "markers", drawn: 0, asked: 0 });
		assert.equal(layer.children.length, 0);
	} finally {
		await started.loader.setEnabled("projektesana", false).catch(() => undefined);
		ch.port1.close();
		ch.port2.close();
		for (const k of ["__pjPort", "__pjViewer", "bimcraftIssues", "ccAddons", "document"]) delete (globalThis as any)[k];
	}
});
