// 9.1 the page registry: every panel reachable from exactly one page, every page's default layout valid under 9.0, every old
// open_panel name still resolves, the palette lists pages by group, the status pill is one pill at most.
import assert from "node:assert/strict";
import { test } from "node:test";
import { PANEL_IDS } from "../src/shared/layout.ts";
import * as L from "../src/shared/layout.ts";
import { rank } from "../src/shared/palette.ts";
import * as P from "../src/shared/pages.ts";
import { PANEL_NAMES } from "../src/shared/ui-instruction.ts";

const VP = { w: 1600, h: 900 };

test("every panel is the panel of exactly one page, or a global window; no page twice", () => {
	const ids = P.PAGES.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length, "no page twice");
	for (const id of PANEL_IDS) {
		const pages = ids.filter((x) => x === id).length;
		const global = P.GLOBAL_PANELS.includes(id) ? 1 : 0;
		assert.equal(pages + global, 1, `${id} must be reachable from exactly one place`);
	}
	for (const p of P.PAGES) assert.ok(PANEL_IDS.includes(p.id), `${p.id} is a panel`);
});

test("the rail has the three groups in order, every page once, Koordinācija a page of its own", () => {
	const g = P.railGroups();
	assert.deepEqual(g.map((x) => x.title), ["Projekts", "Dati", "Nodošana"]);
	assert.deepEqual(g[0].pages.map((p) => p.title), ["Pārskats", "Grafiks", "Telpas", "Prasības"], "Telpas (lapa) is not here: it opens from the Telpas sidebar");
	assert.deepEqual(g[1].pages.map((p) => p.title), ["Avoti", "Faili", "Normatīvi", "Atmiņa"]);
	assert.deepEqual(g[2].pages.map((p) => p.title), ["Nodevumi", "Versijas", "Koordinācija"]);
	assert.equal(g.flatMap((x) => x.pages).length, P.PAGES.filter((p) => !p.hidden).length, "a hidden page (Telpas as a page) is not in the rail");
	assert.deepEqual(P.PAGES.filter((p) => p.hidden).map((p) => p.id), ["telpaslapa"]);
	assert.equal(P.pageById("koordinacija")?.kind, "page");
	assert.equal(P.pageById("normativi")?.group, "dati");
});

test("every page's default layout is valid; the chat is docked left on every page; list pages add no window (they open in the sidebar), full pages open with a smaller chat and nothing docked right", () => {
	for (const p of P.PAGES) {
		const l = P.defaultLayout(p.id);
		assert.deepEqual(L.problems(l), [], `layout of ${p.id}`);
		assert.deepEqual(L.normalize(l, VP).groups.map((g) => g.tabs), l.groups.map((g) => g.tabs), `${p.id} is already normal`);
		const chat = L.groupOf(l, "chat")!;
		assert.equal((chat.place as L.DockPlace).side, "left");
		if (p.canvas === "scene") {
			// the page whose canvas is the federated 3D: matrix at the bottom, the reference beside the chat as a tab
			assert.deepEqual(L.dockGroup(l, "bottom")!.tabs, ["coord.matrix"]);
			assert.deepEqual(L.dockGroup(l, "left")!.tabs, ["chat", "coord.reference"]);
			assert.equal(L.dockGroup(l, "left")!.active, "chat", "the chat stays in front");
			assert.equal(L.dockGroup(l, "right"), undefined, "the cell's lines open on a click");
			continue;
		}
		if (p.canvas === "plan") {
			// the tile plan on the canvas; the differences and the inventory as one group on the right, INV Area at the bottom
			assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["telpas.diffs", "telpas.inventory"]);
			assert.equal(L.dockGroup(l, "right")!.active, "telpas.diffs");
			assert.deepEqual(L.dockGroup(l, "bottom")!.tabs, ["telpas.inv"]);
			continue;
		}
		if (p.canvas === "viewer") {
			// the viewer on the canvas; the change list on the right, Modeļi / Lapu izmaiņas / Revit at the bottom
			assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["vers.list"]);
			assert.deepEqual(L.dockGroup(l, "bottom")!.tabs, ["vers.models", "vers.sheets", "vers.revit"]);
			assert.equal(L.dockGroup(l, "bottom")!.active, "vers.models");
			continue;
		}
		// B3: nothing opens as right-side tabs any more; the lists live in the sidebar between the rail and the chat
		assert.equal(L.dockGroup(l, "right"), undefined, `${p.id}: nothing docked right`);
		assert.ok(!L.groupOf(l, p.id), `${p.id}: the page's own panel is not a window (sidebar or main area)`);
		for (const list of P.PAGES.filter((x) => x.kind === "sidebar")) assert.ok(!L.groupOf(l, list.id), `${p.id}: ${list.id} is not a window`);
		// B1: the comment tools in the column beside the chat
		assert.equal(L.groupOf(l, L.TOOLS)!.place.kind, "edge", `${p.id}: tools in the edge column`);
		assert.deepEqual(L.allWindows(l).sort(), ["chat", L.TOOLS].sort(), `${p.id}: the chat and the tools only`);
		if (p.kind === "sidebar") assert.equal((chat.place as L.DockPlace).size, L.DEFAULT_DOCK);
		else {
			assert.equal((chat.place as L.DockPlace).size, P.FULL_PAGE_CHAT);
			assert.ok(P.FULL_PAGE_CHAT < L.DEFAULT_DOCK, "smaller chat");
		}
	}
	assert.deepEqual(L.problems(P.defaultLayout("nezinams")), [], "an unknown page gets the smallest layout");
	assert.deepEqual(L.dockGroup(P.defaultLayout("nezinams"), "right"), undefined);
});

test("every name open_panel and the links used before still resolves; Koordinācija's old filter opens its page", () => {
	for (const old of ["projekts", "faili", "grafiks", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas"]) {
		const t = P.resolveOpen(old);
		assert.ok(t, old);
		assert.equal(t.panel, old);
	}
	assert.deepEqual(P.resolveOpen("prasibas", "coordination"), { panel: "koordinacija", page: "koordinacija" });
	assert.deepEqual(P.resolveOpen("prasibas", "findings"), { panel: "prasibas", page: "prasibas", filter: "findings" });
	assert.deepEqual(P.resolveOpen("nodevumi", "D12"), { panel: "nodevumi", page: "nodevumi", filter: "D12" });
	assert.deepEqual(P.resolveOpen("projekts"), { panel: "projekts", page: null, filter: undefined });
	assert.equal(P.resolveOpen("iestatijumi")?.page, null);
	assert.equal(P.resolveOpen("nav-tāda"), null);
	for (const n of PANEL_NAMES) assert.ok(P.resolveOpen(n), `agent name ${n}`);
	for (const n of ["parskats", "koordinacija", "normativi"]) assert.ok((PANEL_NAMES as readonly string[]).includes(n), `${n} can be opened by the agent`);
});

test("the palette lists every page with its group, in rail order, and a group name finds its pages", () => {
	const items = P.pageItems();
	assert.deepEqual(items.map((i) => i.id), [...P.PAGES.map((p) => p.id), ...P.GLOBAL_PANELS]);
	assert.ok(items.find((i) => i.id === "nodevumi")!.hint.startsWith("Nodošana"));
	const found = rank(items.map((i) => ({ id: i.id, group: "panel" as const, label: i.label, hint: i.hint, keywords: i.keywords })), "nodosana").map((i) => i.id);
	assert.deepEqual([...found].sort(), ["koordinacija", "nodevumi", "versijas"]);
	assert.equal(rank(items.map((i) => ({ id: i.id, group: "panel" as const, label: i.label, hint: i.hint })), "koord")[0].id, "koordinacija");
});

test("the status pill is one pill at most: open errors first, else the stage, else nothing", () => {
	assert.equal(P.statusPill(null), null);
	assert.deepEqual(P.statusPill({ stage: "Skice", openFindings: 3, openInfo: 2 }), { text: "3 atradumi", tone: "bad", open: { panel: "prasibas", filter: "findings" } });
	assert.deepEqual(P.statusPill({ stage: "Skice", openFindings: 0, openInfo: 5 }), { text: "Skice", tone: "ok", open: { panel: "parskats" } });
	assert.equal(P.statusPill({ stage: null, openFindings: 0, openInfo: 5 }), null, "info alone is never a pill");
	assert.deepEqual([1, 2, 10, 11, 12, 21, 100, 101].map(P.findingsWord), ["atradums", "atradumi", "atradumi", "atradumi", "atradumi", "atradums", "atradumi", "atradums"]);
});

test("the page open when the app closed is kept in the layout file", () => {
	const s = { ...L.withPage(L.emptyStore(), "avoti", P.defaultLayout("avoti")), current: "avoti" };
	assert.equal(L.parseStore(JSON.stringify(s), VP).current, "avoti");
	assert.equal(L.parseStore(JSON.stringify({ ...s, current: 7 }), VP).current, undefined);
});
