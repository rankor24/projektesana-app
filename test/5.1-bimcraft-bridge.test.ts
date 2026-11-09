// 5.1 the BimCraft bridge contract: BimCraft's real add-on loader and API 1.1 (getcadcraft/bimcraft app/addons/bimcraft-api.js),
// our bridge add-on (src/bimcraft-addon/projektesana), BimCraft's real IFC engine on an invented IFC, and a real
// MessageChannel standing where the frame boundary is in the app. Skipped only when the BimCraft checkout is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { elementFocus, isBimcraftMessage, type BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import { FIX, tmp } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const BIMCRAFT = process.env.BIMCRAFT_SOURCE ?? join(ROOT, "..", "getcadcraft", "bimcraft");
const DEV = join(BIMCRAFT, "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

test("bridge: ready, open through its importer, selection with GlobalIds, select by id, sketch", { skip: have ? false : `BimCraft not at ${BIMCRAFT}` }, async () => {
	(globalThis as { document?: unknown }).document ??= { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
	const imp = (f: string) => import(pathToFileURL(join(DEV, f)).href);
	const i18n = await imp("i18n.js");
	i18n.init({ locale: "en", strings: JSON.parse(readFileSync(join(DEV, "lang", "en.json"), "utf8")) });
	const A = await imp("addons.js");
	const BA = await imp("addons/bimcraft-api.js");
	const WebIFC = await imp("ifc/api.js");
	const { IfcModel } = await imp("ifc-model.js");

	// the add-ons folder the loader reads: only our bridge
	const base = tmp();
	mkdirSync(join(base, "projektesana"), { recursive: true });
	cpSync(join(ROOT, "src", "bimcraft-addon", "projektesana"), join(base, "projektesana"), { recursive: true });
	writeFileSync(join(base, "index.json"), JSON.stringify({ addons: ["projektesana"] }));

	// the frame boundary
	const ch = new MessageChannel();
	const inbox: BimcraftToHost[] = [];
	ch.port1.on("message", (m) => isBimcraftMessage(m) && inbox.push(m));
	(globalThis as { __pjPort?: unknown }).__pjPort = { post: (m: unknown) => ch.port2.postMessage(m), on: (fn: (m: unknown) => void) => ch.port2.on("message", fn) };
	const wait = async (type: string) => {
		for (let i = 0; i < 200; i++) {
			const m = inbox.find((x) => x.type === type);
			if (m) return (inbox.splice(inbox.indexOf(m), 1), m);
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error(`no ${type} from the bridge; got ${JSON.stringify(inbox)}`);
	};

	// BimCraft's side: a real model, opened when the bridge's importer hands over the bytes
	const model = await IfcModel.create(WebIFC, null, {});
	let opened: string | null = null;
	let sel: number[] = [];
	const mem = new Map<string, string>();
	const started = await BA.startAddons({
		editor: () => null,
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
	(globalThis as { ccAddons?: unknown }).ccAddons = started;
	try {
		const me = started.list().find((a: { id: string }) => a.id === "projektesana");
		assert.equal(me?.state, "active", JSON.stringify(me));
		assert.equal((await wait("ready")) && true, true);
		assert.ok(started.importerFor("model.ifc.pjifc"), "the bridge registered its importer");

		ch.port1.postMessage({ pj: 1, type: "open", name: "two-walls.ifc", bytes: new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc"))) });
		assert.equal(((await wait("opened")) as { name: string }).name, "two-walls.ifc");
		assert.equal(opened, "two-walls.ifc");

		// the user clicks a wall in BimCraft → the app hears the element with its GlobalId
		sel = [30];
		const s = (await wait("selection")) as { items: { id: number; guid: string; cls: string; name: string }[] };
		assert.deepEqual(s.items, [{ id: 30, guid: "0Wall0000000000000001", cls: "IfcWall", name: "Siena A" }]);
		assert.deepEqual(elementFocus(s.items[0], "two-walls.ifc").data?.guid, "0Wall0000000000000001");

		// the app selects by id
		ch.port1.postMessage({ pj: 1, type: "select", ids: [32] });
		const s2 = (await wait("selection")) as { items: { name: string }[] };
		assert.equal(s2.items[0].name, "Siena B");

		// a sketch is the selection with the user's note, never written to the model
		ch.port1.postMessage({ pj: 1, type: "sketch", note: "pagarināt šo sienu līdz asij B" });
		const k = (await wait("sketch")) as { items: { guid: string }[]; note: string };
		assert.equal(k.note, "pagarināt šo sienu līdz asij B");
		assert.equal(k.items[0].guid, "0Wall0000000000000002");

		// highlight by GlobalId needs BimCraft's editor; without one the bridge says so instead of failing silently
		ch.port1.postMessage({ pj: 1, type: "highlight", guids: ["0Wall0000000000000001"] });
		assert.match(((await wait("error")) as { message: string }).message, /no IFC model is open/);
	} finally {
		await started.loader.setEnabled("projektesana", false).catch(() => undefined);
		ch.port1.close();
		ch.port2.close();
		delete (globalThis as { __pjPort?: unknown }).__pjPort;
	}
});

test("bimcraft:// maps BimCraft's URL layout and nothing outside its copy", async () => {
	const { bimcraftResponse, mapBimcraftPath } = await import("../src/main/bimcraft-protocol.ts");
	const dir = tmp();
	for (const f of ["index.html", "app/bimcraft.js", "vendor/three/0.186.1/three.module.js", "site/assets/css/site.css"]) {
		mkdirSync(join(dir, f, ".."), { recursive: true });
		writeFileSync(join(dir, f), "x");
	}
	const site = { dir, vendorPins: { three: "0.186.1" }, isolate: "" };
	assert.equal(mapBimcraftPath(site, "/"), join(dir, "index.html"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/bimcraft.js"), join(dir, "app", "bimcraft.js"));
	assert.equal(mapBimcraftPath(site, "/assets/vendor/three/current/three.module.js"), join(dir, "vendor", "three", "0.186.1", "three.module.js"));
	assert.equal(mapBimcraftPath(site, "/assets/css/site.css"), join(dir, "site", "assets", "css", "site.css"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/../../../../../Windows/win.ini"), null);
	assert.equal(mapBimcraftPath(site, "/etc/passwd"), null);
	assert.equal(bimcraftResponse(site, "bimcraft://app/assets/apps/bimcraft/dev/bimcraft.js").headers["Content-Type"], "text/javascript; charset=utf-8");
	assert.equal(bimcraftResponse(site, "bimcraft://app/nav.js").status, 404);
});
