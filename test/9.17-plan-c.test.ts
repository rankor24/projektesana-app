// 9.14 layout plan C (the board "Projektesana UI layout plan", docs/ui-complaints.md B1 B3 B4 B5 E7): the comment tools'
// column beside the chat is a place of its own, a page draws only its own windows plus the shared ones, the list sidebar's
// state is stored and repaired, and a layout saved before plan C is moved over once.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as L from "../src/shared/layout.ts";
import { defaultLayout, migratePlanC, migrateToolsColumn, viewerShownOn, windowShown } from "../src/shared/pages.ts";

const VP = { w: 1920, h: 1080 };

test("the edge column: one group, any window may join it, it floats, minimises, pops out and comes back to it", () => {
	let l = L.toEdge(L.open(L.emptyLayout(), L.TOOLS, VP), L.TOOLS);
	assert.equal(L.edgeGroup(l)!.tabs.join(), L.TOOLS);
	assert.deepEqual(L.problems(l), []);
	// a second window joins the column as a tab, never a second column
	l = L.toEdge(L.open(l, "threads", VP), "threads");
	assert.deepEqual(L.edgeGroup(l)!.tabs, [L.TOOLS, "threads"]);
	assert.equal(l.groups.filter((g) => g.place.kind === "edge").length, 1);
	// float: the tool bar floats at a tool bar's size, not half the screen
	const floated = L.undock(l, L.TOOLS, VP);
	assert.equal(L.groupOf(floated, L.TOOLS)!.place.kind, "float");
	assert.ok((L.groupOf(floated, L.TOOLS)!.place as L.FloatPlace).w < L.defaultFloat(VP).w);
	// a single tab pulled out of the column floats on its own
	const single = L.toEdge(L.open(L.emptyLayout(), L.TOOLS, VP), L.TOOLS);
	assert.equal(L.groupOf(L.pullOut(single, L.TOOLS, VP), L.TOOLS)!.place.kind, "float");
	// minimise and back
	const min = L.collapse(single, L.TOOLS, true);
	assert.equal(L.groupOf(min, L.TOOLS)!.place.kind, "min");
	assert.equal(L.groupOf(L.open(min, L.TOOLS, VP), L.TOOLS)!.place.kind, "edge");
	// pop out to an OS window and back into the column
	const popped = L.popOut(single, L.TOOLS, VP);
	assert.equal(L.groupOf(popped, L.TOOLS)!.place.kind, "pop");
	assert.equal(L.groupOf(L.popIn(popped, L.TOOLS, VP), L.TOOLS)!.place.kind, "edge");
	// reopened from the Windows menu, a closed tool bar goes back where the page's default keeps it: the column
	const closed = L.close(single, L.TOOLS);
	assert.equal(L.groupOf(L.reopen(closed, L.TOOLS, defaultLayout("parskats"), VP), L.TOOLS)!.place.kind, "edge");
});

test("the edge column survives a save and a damaged file: two columns become one, a bad place is dropped", () => {
	const raw = {
		groups: [
			{ tabs: ["chat"], active: "chat", place: { kind: "dock", side: "left", size: 400, collapsed: false } },
			{ tabs: [L.TOOLS], active: L.TOOLS, place: { kind: "edge" } },
			{ tabs: ["threads"], active: "threads", place: { kind: "edge" } },
		],
		focused: "chat",
		filters: {},
	} as L.Layout;
	const n = L.normalize(raw, VP);
	assert.deepEqual(L.edgeGroup(n)!.tabs, [L.TOOLS, "threads"]);
	assert.deepEqual(L.problems(n), []);
	assert.deepEqual(L.problems(raw), ["two edge columns"]);
	const back = L.parseStore(JSON.stringify(L.withShared(L.emptyStore(), n)), VP);
	assert.equal(L.groupOf(back.shared!, L.TOOLS)!.place.kind, "edge");
});

test("B5: a page draws only its own windows and the shared ones; the hidden ones keep their place for their page", () => {
	let l = L.normalize(defaultLayout("koordinacija"), VP);
	l = L.addMissing(l, L.normalize(defaultLayout("versijas"), VP), VP);
	// both pages' bottom windows share the bottom dock in the layout
	const bottom = L.dockGroup(l, "bottom")!;
	assert.ok(bottom.tabs.includes("coord.matrix") && bottom.tabs.includes("vers.models"));
	const on = (page: string, viewer: boolean) => L.filterLayout(l, (id) => windowShown(id, page, viewer));
	// Versijas: no matrix, no reference beside the chat
	const vers = on("versijas", true);
	assert.ok(!L.allWindows(vers).some((id) => id.startsWith("coord.")));
	assert.deepEqual(L.dockGroup(vers, "bottom")!.tabs, ["vers.models", "vers.sheets", "vers.revit"]);
	assert.ok(L.dockGroup(vers, "bottom")!.tabs.includes(L.dockGroup(vers, "bottom")!.active), "a hidden active tab gives the front to one shown");
	// Koordinācija: no Versijas windows; the chat, the tools stay everywhere
	const coord = on("koordinacija", false);
	assert.ok(!L.allWindows(coord).some((id) => id.startsWith("vers.")));
	for (const page of ["parskats", "avoti", "versijas", "koordinacija"]) for (const id of ["chat", L.TOOLS]) assert.ok(L.groupOf(on(page, false), id), `${id} on ${page}`);
	// a full page with nothing open: neither page's windows; the real layout is untouched
	const home = on("parskats", false);
	assert.ok(!L.dockGroup(home, "bottom"), "the bottom dock is empty on Pārskats");
	assert.ok(L.groupOf(l, "coord.matrix") && L.groupOf(l, "vers.models"), "nothing removed from the layout");
	// nothing hidden: the same object comes back (no redraw)
	const mine = L.normalize(defaultLayout("parskats"), VP);
	assert.equal(L.filterLayout(mine, () => true), mine);
});

test("the viewer's windows show only while the viewer is on screen", () => {
	assert.equal(viewerShownOn("avoti", false), true, "a list page has the viewer");
	assert.equal(viewerShownOn("versijas", false), true);
	assert.equal(viewerShownOn("koordinacija", true), false, "the 3D scene, not the viewer");
	assert.equal(viewerShownOn("telpaslapa", true), false, "the plan, not the viewer");
	assert.equal(viewerShownOn("parskats", false), false, "a full page with no file");
	assert.equal(viewerShownOn("parskats", true), true, "a file opened beside a full page");
	assert.equal(windowShown("viewer.props", "parskats", false), false);
	assert.equal(windowShown("viewer.props", "parskats", true), true);
	assert.equal(windowShown("avoti", "koordinacija", false), true, "a list the user made a window is shared");
});

test("a layout saved before plan C moves over once: docked lists leave for the sidebar, the top tool bar goes to the column", () => {
	// the 2.6 defaults: Avoti docked right (a list page), Faili / Avoti / Prasības on a full page, tools on top
	let old = L.emptyLayout();
	old = L.dock(L.open(old, "avoti", VP), "avoti", "right", VP);
	old = L.dock(L.open(old, "faili", VP), "faili", "right", VP);
	old = L.dock(L.open(old, L.TOOLS, VP), L.TOOLS, "top", VP, { size: 84 });
	old = L.open(old, "prasibas", VP); // floated by the user: stays
	old = L.dock(L.open(old, "coord.matrix", VP), "coord.matrix", "bottom", VP);
	const m = migratePlanC(old);
	assert.ok(!L.groupOf(m, "avoti") && !L.groupOf(m, "faili"), "docked lists are gone (they open in the sidebar)");
	assert.equal(L.groupOf(m, "prasibas")!.place.kind, "float", "a list the user floated stays a window");
	assert.equal(L.groupOf(m, L.TOOLS)!.place.kind, "edge");
	assert.equal(L.groupOf(m, "coord.matrix")!.place.kind, "dock", "page windows untouched");
	assert.deepEqual(L.problems(m), []);
	// a tool bar the user moved elsewhere stays there; running it again changes nothing
	const moved = L.dock(L.open(L.emptyLayout(), L.TOOLS, VP), L.TOOLS, "bottom", VP);
	assert.equal(L.groupOf(migratePlanC(moved), L.TOOLS)!.place.kind, "dock");
	assert.deepEqual(migratePlanC(m), m);
});

test("the sidebar's state is stored and repaired: a width in range, open only with a list named", () => {
	assert.deepEqual(L.cleanSidebar(null), L.emptySidebar());
	assert.equal(L.cleanSidebar({ id: "faili", open: true, width: 10 }).width, L.SIDEBAR_MIN);
	assert.equal(L.cleanSidebar({ id: "faili", open: true, width: 99999 }).width, L.SIDEBAR_MAX);
	assert.equal(L.cleanSidebar({ id: null, open: true, width: 300 }).open, false);
	assert.equal(L.cleanSidebar({ id: "avoti", open: true, width: 300, filter: "x" }).filter, "x");
	const s = { ...L.emptyStore(), sidebar: { id: "avoti", open: true, width: 360 }, migrated: ["plan-c"] };
	const back = L.parseStore(JSON.stringify(s), VP);
	assert.deepEqual(back.sidebar, { id: "avoti", open: true, width: 360 });
	assert.deepEqual(back.migrated, ["plan-c"]);
	assert.equal(L.clampSidebar(L.SIDEBAR_MIN - L.SIDEBAR_COLLAPSE - 1), L.SIDEBAR_MIN, "the drag past the threshold closes it (Sidebar.tsx); the width never goes under the minimum");
});

test("2.6.7 the comment tools are one icon column: slim alone in a window, a normal window with company, back to the column once", () => {
	// alone, floated from the column: as slim as the icons, and it stays slim when moved, resized or reloaded
	const alone = L.undock(L.toEdge(L.open(L.emptyLayout(), L.TOOLS, VP), L.TOOLS), L.TOOLS, VP);
	const p = L.groupOf(alone, L.TOOLS)!.place as L.FloatPlace;
	assert.equal(p.w, L.TOOLS_W);
	assert.equal((L.groupOf(L.move(alone, L.TOOLS, 300, 200, VP), L.TOOLS)!.place as L.FloatPlace).w, L.TOOLS_W);
	assert.equal((L.groupOf(L.resize(alone, L.TOOLS, { x: 10, y: 10, w: 20, h: 400 }, VP), L.TOOLS)!.place as L.FloatPlace).w, L.TOOLS_W);
	const back = L.parseStore(JSON.stringify({ ...L.emptyStore(), shared: alone }), VP);
	assert.equal((L.groupOf(back.shared!, L.TOOLS)!.place as L.FloatPlace).w, L.TOOLS_W, "a reload keeps the slim window");
	// any other window keeps the usual minimum
	const other = L.resize(L.open(L.emptyLayout(), "threads", VP), "threads", { x: 10, y: 10, w: 20, h: 400 }, VP);
	assert.equal((L.groupOf(other, "threads")!.place as L.FloatPlace).w, L.MIN_W);
	// the tools in a tab group with another window float as a normal window
	const shared = L.toEdge(L.toEdge(L.open(L.open(L.emptyLayout(), L.TOOLS, VP), "threads", VP), L.TOOLS), "threads");
	assert.equal((L.groupOf(L.undock(shared, L.TOOLS, VP), L.TOOLS)!.place as L.FloatPlace).w, L.MIN_W);
	// once: floating (or minimised from floating) tools go back to the column; docked ones stay
	assert.equal(L.groupOf(migrateToolsColumn(alone), L.TOOLS)!.place.kind, "edge");
	assert.equal(L.groupOf(migrateToolsColumn(L.collapse(alone, L.TOOLS, true)), L.TOOLS)!.place.kind, "edge");
	const docked = L.dock(L.open(L.emptyLayout(), L.TOOLS, VP), L.TOOLS, "right", VP);
	assert.deepEqual(migrateToolsColumn(docked), docked);
	assert.deepEqual(L.problems(migrateToolsColumn(alone)), []);
});
