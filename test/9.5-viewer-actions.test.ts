// 9.5 the agent drives the viewer: instruction validation, the protocol messages for each action on BimCraft's real add-on API
// and IFC engine (with a fake 3D viewer where the WebGL one would be), the run card's chips from a run's lines, and: nothing
// writes a store. Skipped (bridge part) only when BimCraft is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { addPin } from "../src/core/pins.ts";
import { ProjectStore } from "../src/core/store.ts";
import { checkHostMessage, type BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import { checkViewerAction, chipLabel, readUi, uiResult, viewerChips, type ViewerAction } from "../src/shared/ui-instruction.ts";
import { toolLine } from "../src/shared/activity.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const mk = () => ProjectStore.open(tmp(), { id: "BD932", name: "BD932", root: tmp(), createdAt: "2026-11-13T00:00:00Z" });
const ctxOf = (s: ProjectStore): ToolCtx => ({ projectsDir: s.projectsDir, projectId: s.project.id, dataDir: tmp(), appDir: tmp(), runDir: null, agent: null, thread: null });
const tool = (name: string) => allTools().find((t) => t.name === name)!;
const G1 = "0Wall0000000000000001";
const G2 = "0Wall0000000000000002";

test("instruction validation: each action's rules, in words", () => {
	const ok: ViewerAction[] = [
		{ action: "fly_to", pin: "p1" },
		{ action: "fly_to", guid: G1 },
		{ action: "select", guids: [G1] },
		{ action: "isolate", guids: [G1, G2], ghost: true },
		{ action: "isolate", guids: [] },
		{ action: "colour", property: "Pset_WallCommon.FireRating" },
		{ action: "colour", property: "", guids: [G1] },
		{ action: "split" },
		{ action: "split", dir: "v" },
		{ action: "split", a: "s1", b: "s2", dir: "h" },
	];
	for (const a of ok) assert.equal(checkViewerAction(a), null, JSON.stringify(a));
	const bad: [ViewerAction, RegExp][] = [
		[{ action: "fly_to" }, /a pin or an element/],
		[{ action: "fly_to", pin: "p1", guid: G1 }, /one of them/],
		[{ action: "select", guids: [] }, /at least one/],
		[{ action: "select", guids: ["", G1] }, /list of GlobalIds/],
		[{ action: "isolate", guids: Array.from({ length: 501 }, (_, i) => `g${i}`) }, /at most 500/],
		[{ action: "isolate", guids: "x" as never }, /list of GlobalIds/],
		[{ action: "colour", property: "x".repeat(81) }, /up to 80/],
		[{ action: "colour", property: "A", guids: [] }, /at least one/],
		[{ action: "split", dir: "x" as never }, /h or v/],
		[{ action: "split", a: "s1" }, /both a and b/],
		[{ action: "split", a: "s1", b: "s1" }, /two different/],
		[{ action: "orbit" } as never, /unknown viewer action/],
	];
	for (const [a, re] of bad) assert.match(checkViewerAction(a) ?? "", re, JSON.stringify(a));
});

test("the tools: levels, results carry the instruction, what cannot be done is said to the model and nothing is sent to the window", async () => {
	for (const n of ["viewer_fly_to", "viewer_select", "viewer_isolate", "viewer_colour", "viewer_split"]) assert.equal(appLevels()[n], "annotate", n);
	const s = mk();
	const c = ctxOf(s);
	const a = readUi(String(await tool("viewer_isolate").run(c, { guids: [G1, G2] } as never)))?.viewer;
	assert.deepEqual(a, { action: "isolate", guids: [G1, G2] });
	assert.deepEqual(readUi(String(await tool("viewer_isolate").run(c, { guids: [], ghost: true } as never)))?.viewer, { action: "isolate", guids: [] }.action === "isolate" ? { action: "isolate", guids: [], ghost: true } : null);
	assert.deepEqual(readUi(String(await tool("viewer_colour").run(c, { property: "FireRating" } as never)))?.viewer, { action: "colour", property: "FireRating" });
	assert.deepEqual(readUi(String(await tool("viewer_select").run(c, { guids: [G1] } as never)))?.viewer, { action: "select", guids: [G1] });
	assert.deepEqual(readUi(String(await tool("viewer_split").run(c, {} as never)))?.viewer, { action: "split" });
	await assert.rejects(async () => tool("viewer_select").run(c, { guids: [] } as never), /at least one/);
	await assert.rejects(async () => tool("viewer_fly_to").run(c, {} as never), /a pin or an element/);
	await assert.rejects(async () => tool("viewer_fly_to").run(c, { pin: "p_nav" } as never), /nav atrasta/);
	await assert.rejects(async () => tool("viewer_split").run(c, { a: "s1", b: "s2" } as never), /Avots s1 nav atrasts/);
	const pin = addPin(s, { elementGuid: G1, model: "AR.ifc" }, "pārbaudīt", "user");
	assert.deepEqual(readUi(String(await tool("viewer_fly_to").run(c, { pin: pin.id } as never)))?.viewer, { action: "fly_to", pin: pin.id });
});

test("nothing writes a store: the viewer tools leave every collection and the log as they were", async () => {
	const s = mk();
	addPin(s, { elementGuid: G1 }, "x piezīme", "user");
	const before = { events: s.events().length, pins: JSON.stringify(s.read("pins")), tasks: JSON.stringify(s.read("tasks")), facts: JSON.stringify(s.read("facts")), plan: JSON.stringify(s.read("plan")) };
	const c = ctxOf(s);
	for (const [n, a] of [["viewer_select", { guids: [G1] }], ["viewer_isolate", { guids: [G1] }], ["viewer_colour", { property: "name" }], ["viewer_split", {}], ["viewer_fly_to", { guid: G1 }]] as const) await tool(n).run(c, a as never);
	assert.deepEqual({ events: s.events().length, pins: JSON.stringify(s.read("pins")), tasks: JSON.stringify(s.read("tasks")), facts: JSON.stringify(s.read("facts")), plan: JSON.stringify(s.read("plan")) }, before);
});

test("the run card's chips: each successful viewer call in order, from the activity lines; a failed call and other tools give none", () => {
	const call = (name: string, input: object, result: string) => ({ kind: "tool", status: "ok", detail: `${JSON.stringify(input)}\n\n→ ${result}`, text: name });
	const lines = [
		{ kind: "start", text: "uzdevums" },
		call("read_source", { sourceId: "s1" }, "teksts"),
		call("viewer_isolate", { guids: [G1, G2, "g3"] }, uiResult("ok", { viewer: { action: "isolate", guids: [G1, G2, "g3"] } })),
		{ kind: "tool", status: "failed", detail: `{}\n\n→ ${uiResult("ok", { viewer: { action: "isolate", guids: [G1] } })}` },
		call("viewer_colour", { property: "FireRating" }, uiResult("ok", { viewer: { action: "colour", property: "FireRating" } })),
		call("open_panel", { name: "avoti" }, uiResult("ok", { open_panel: { name: "avoti" } })),
		call("viewer_split", { dir: "v" }, uiResult("ok", { viewer: { action: "split", dir: "v" } })),
		{ kind: "tool", status: "ok", detail: "bez rezultāta" },
		{ kind: "tool", status: "ok" },
		call("viewer_select", { guids: [] }, uiResult("ok", { viewer: { action: "select", guids: [] } })),
	];
	const chips = viewerChips(lines);
	assert.deepEqual(chips.map((c) => [c.n, c.label]), [[1, "Izolēt 3 elementus"], [2, "Krāsot pēc FireRating"], [3, "Divi skati (virs)"]], "the invalid select (no guids) gives no chip");
	assert.deepEqual(chips[0].action, { action: "isolate", guids: [G1, G2, "g3"] });
	assert.deepEqual(["Rādīt visu", "Izcelt 2 elementus", "Noņemt krāsas", "Uz piezīmi p9", "Uz elementu", "Divi faili blakus", "Iezīmēt 1 elementu", "Iezīmēt 21 elementu", "Iezīmēt 11 elementus"].length, 9);
	assert.equal(chipLabel({ action: "isolate", guids: [] }), "Rādīt visu");
	assert.equal(chipLabel({ action: "isolate", guids: ["a", "b"], ghost: true }), "Izcelt 2 elementus");
	assert.equal(chipLabel({ action: "colour", property: "" }), "Noņemt krāsas");
	assert.equal(chipLabel({ action: "fly_to", pin: "p9" }), "Uz piezīmi p9");
	assert.equal(chipLabel({ action: "split", a: "s1", b: "s2" }), "Divi faili blakus");
	assert.deepEqual([1, 11, 21].map((n) => chipLabel({ action: "select", guids: Array.from({ length: n }, (_, i) => `g${i}`) })), ["Iezīmēt 1 elementu", "Iezīmēt 11 elementus", "Iezīmēt 21 elementu"]);
	assert.deepEqual(viewerChips([]), []);
	assert.deepEqual(toolLine("viewer_isolate", undefined, () => null), { text: "Izolē elementus", kind: "ui" }, "the run card names it like any tool");
});

test("the host messages for isolate and colour are checked before they go", () => {
	assert.equal(checkHostMessage({ pj: 1, type: "isolate", guids: [G1] }), null);
	assert.equal(checkHostMessage({ pj: 1, type: "isolate", guids: [] }), null);
	assert.match(checkHostMessage({ pj: 1, type: "isolate", guids: [""] })!, /isolate needs/);
	assert.match(checkHostMessage({ pj: 1, type: "isolate", guids: "x" as never })!, /isolate needs/);
	assert.equal(checkHostMessage({ pj: 1, type: "colour", property: "FireRating" }), null);
	assert.equal(checkHostMessage({ pj: 1, type: "colour", property: "" }), null);
	assert.match(checkHostMessage({ pj: 1, type: "colour", property: "x".repeat(81) })!, /colour needs/);
	assert.match(checkHostMessage({ pj: 1, type: "colour", property: "A", guids: [] })!, /colour needs/);
});

test("the fixed context with the five viewer tools stays under the 10K guard", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const s = new AgentSession({ runtime: async () => rt, settings: () => ({ ...DEFAULT_SETTINGS }), toolsServer: () => ({ command: "node", args: [], env: {} }), revit: () => null, ctx: { projectsDir: dir, dataDir: dir, appDir: dir }, runsDir: join(dir, "runs"), chatDir: join(dir, "chat"), emit: () => {} });
	const c = await s.context(null, { text: "x", focus: [] });
	console.log(`fixed context ${c.fixedEstimate} tokens, ${allTools().length + 2} tool declarations`);
	assert.ok(c.fixedEstimate < 10_000, `fixed ${c.fixedEstimate}`);
});

// ---- the bridge on BimCraft's real engine ----

const ROOT = join(import.meta.dirname, "..");
const DEV = join(BIMCRAFT_DIR ?? "", "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

/* eslint-disable @typescript-eslint/no-explicit-any */
const vecOf = (a: number[]) => ({ toArray: () => [...a], set: (...n: number[]) => n.forEach((x, i) => (a[i] = x)) });

test("isolate, show all, colour by a property with a legend, clear: BimCraft's own visibility and colouring calls on its real engine", { skip: have ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	(globalThis as any).document = { createElement: () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} }), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
	const imp = (f: string) => import(pathToFileURL(join(DEV, f)).href);
	const i18n = await imp("i18n.js");
	i18n.init({ locale: "en", strings: JSON.parse(readFileSync(join(DEV, "lang", "en.json"), "utf8")) });
	const A = await imp("addons.js");
	const BA = await imp("addons/bimcraft-api.js");
	const WebIFC = await imp("ifc/api.js");
	const { IfcModel } = await imp("ifc-model.js");
	const addon = await import(pathToFileURL(join(ROOT, "src", "bimcraft-addon", "projektesana", "main.js")).href);

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

	// the fake viewer records what BimCraft's own calls were asked
	const calls: { isolate?: { keys: number[]; ghost: boolean }; showAll: number; colours: Map<number, string> | null; applied: number } = { showAll: 0, colours: null, applied: 0 };
	const viewer = {
		canvas: { parentElement: null, getBoundingClientRect: () => ({ left: 0, top: 0 }) },
		camera: { position: vecOf([1, 2, 3]), fov: 50, updateProjectionMatrix() {} },
		controls: { target: vecOf([0, 0, 0]), addEventListener() {}, removeEventListener() {}, update() {} },
		vis: { isolate: (keys: number[], o: { ghost: boolean }) => (calls.isolate = { keys, ghost: !!o?.ghost }), showAll: () => (calls.showAll++, (calls.isolate = undefined)) },
		applyVisibility: () => calls.applied++,
		setColors: (m: Map<number, string> | null) => (calls.colours = m),
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
		send({ type: "isolate", guids: [G1] });
		assert.match((await wait("error")).message, /no model is open/);
		send({ type: "colour", property: "name" });
		assert.match((await wait("error")).message, /no model is open/);
		send({ type: "open", name: "two-walls.ifc", bytes: new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc"))) });
		await wait("opened");

		// isolate: the guids become the viewer's own keys; ghost is passed on; the viewer redraws
		send({ type: "isolate", guids: [G1] });
		assert.deepEqual(await wait("viewed"), { pj: 1, type: "viewed", action: "isolate", found: 1, asked: 1 });
		assert.deepEqual(calls.isolate, { keys: [30], ghost: false });
		assert.equal(calls.applied, 1);
		send({ type: "isolate", guids: [G1, G2, "0Nowhere00000000000000"], ghost: true });
		assert.deepEqual(await wait("viewed"), { pj: 1, type: "viewed", action: "isolate", found: 2, asked: 3 });
		assert.deepEqual(calls.isolate, { keys: [30, 32], ghost: true });
		send({ type: "isolate", guids: ["0Nowhere00000000000000"] });
		assert.match((await wait("error")).message, /none of the elements is in this model/);
		send({ type: "isolate", guids: [] });
		assert.deepEqual(await wait("viewed"), { pj: 1, type: "viewed", action: "show_all", found: 0, asked: 0 });
		assert.equal(calls.showAll, 1);

		// colour by an attribute: one legend row per value, biggest first then by name, each with a palette colour
		send({ type: "colour", property: "name" });
		const byName = await wait("coloured");
		assert.deepEqual([byName.property, byName.total, byName.painted, byName.partial], ["name", 2, 2, false]);
		assert.deepEqual(byName.legend, [{ value: "Siena A", color: addon.COLOUR_PALETTE[0], count: 1 }, { value: "Siena B", color: addon.COLOUR_PALETTE[1], count: 1 }]);
		assert.deepEqual([...calls.colours!.entries()], [[30, addon.COLOUR_PALETTE[0]], [32, addon.COLOUR_PALETTE[1]]]);
		// by the class (a name the user writes in either language of the attribute table)
		send({ type: "colour", property: "Class" });
		const byClass = await wait("coloured");
		assert.deepEqual(byClass.legend, [{ value: "IfcWall", color: addon.COLOUR_PALETTE[0], count: 2 }]);
		// a property no element has: one grey row "no value", every element still painted
		send({ type: "colour", property: "Pset_WallCommon.FireRating" });
		const none = await wait("coloured");
		assert.deepEqual(none.legend, [{ value: "", color: addon.NO_VALUE_COLOUR, count: 2 }]);
		// restricted to some elements
		send({ type: "colour", property: "name", guids: [G2] });
		const only = await wait("coloured");
		assert.deepEqual([only.total, only.legend.map((l) => l.value)], [1, ["Siena B"]]);
		// an empty property clears
		send({ type: "colour", property: "" });
		assert.deepEqual(await wait("viewed"), { pj: 1, type: "viewed", action: "uncolour", found: 0, asked: 0 });
		assert.equal(calls.colours, null);
	} finally {
		await started.loader.setEnabled("projektesana", false).catch(() => undefined);
		ch.port1.close();
		ch.port2.close();
		for (const k of ["__pjPort", "__pjViewer", "ccAddons", "document"]) delete (globalThis as any)[k];
	}
});

test("a property is read from an attribute or from a property set row, with or without the set's name", async () => {
	const addon = await import(pathToFileURL(join(ROOT, "src", "bimcraft-addon", "projektesana", "main.js")).href);
	const p = { id: 1, cls: "IfcWall", name: "Siena", objectType: null, typeName: "SB200", tag: "", sets: [{ name: "Pset_WallCommon", rows: [{ name: "FireRating", value: "EI60" }, { name: "IsExternal", value: "" }] }, { name: "Other", rows: [{ name: "FireRating", value: "EI30" }] }] };
	assert.equal(addon.valueOfProperty(p, "name"), "Siena");
	assert.equal(addon.valueOfProperty(p, "KLASE"), "IfcWall");
	assert.equal(addon.valueOfProperty(p, "typeName"), "SB200");
	assert.equal(addon.valueOfProperty(p, "objectType"), null);
	assert.equal(addon.valueOfProperty(p, "tag"), null, "an empty text is no value");
	assert.equal(addon.valueOfProperty(p, "firerating"), "EI60", "the first set that has it");
	assert.equal(addon.valueOfProperty(p, "Other.FireRating"), "EI30");
	assert.equal(addon.valueOfProperty(p, "Pset_WallCommon.IsExternal"), null);
	assert.equal(addon.valueOfProperty(p, "Nav.FireRating"), null);
});
