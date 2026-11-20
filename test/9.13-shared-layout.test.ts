// 9.13 one layout for the whole app: a window stays where the user put it when the page changes, a page adds its own
// windows once (beside their default mates, nothing that is open moves, the focus stays), the comment tool bar is a window
// like the others, a new window opens big enough to work in, and a store from the per-page builds starts the shared layout.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as L from "../src/shared/layout.ts";
import { defaultLayout, pageWindows } from "../src/shared/pages.ts";

const VP = { w: 1920, h: 1080 };

test("the comment tool bar is a window: it docks on top by default, on any side, floats, joins a group", () => {
	const def = L.normalize(defaultLayout("parskats"), VP);
	assert.deepEqual(L.problems(def), []);
	const g = L.groupOf(def, L.TOOLS)!;
	assert.equal(g.place.kind === "dock" && g.place.side, "top");
	assert.ok(L.isWindowId(L.TOOLS));
	for (const side of ["left", "right", "bottom"] as const) assert.equal(L.groupOf(L.dock(def, L.TOOLS, side, VP), L.TOOLS)!.place.kind, "dock");
	assert.equal(L.groupOf(L.undock(def, L.TOOLS, VP), L.TOOLS)!.place.kind, "float");
	const joined = L.mergeInto(def, L.TOOLS, "chat");
	assert.deepEqual(L.groupOf(joined, "chat")!.tabs, ["chat", L.TOOLS]);
	// every page lists it, so the Windows menu can bring it back
	for (const p of ["parskats", "versijas", "koordinacija", "telpas"]) assert.ok(pageWindows(p).includes(L.TOOLS), p);
});

test("a slim bar may dock on top or bottom (72 px); a side panel keeps its width", () => {
	assert.equal(L.clampDock("top", 10, VP), L.MIN_DOCK_BAR);
	assert.equal(L.clampDock("bottom", 90, VP), 90);
	assert.equal(L.clampDock("left", 10, VP), L.MIN_DOCK);
	assert.ok(L.clampDock("top", 5000, VP) <= VP.h * 0.6);
});

test("a new window opens big: about half the screen wide, two thirds high, never under 720 x 520", () => {
	const big = L.defaultFloat(VP);
	assert.deepEqual([big.w, big.h], [1056, 778]);
	const small = L.defaultFloat({ w: 1100, h: 700 });
	assert.deepEqual([small.w, small.h], [720, 520]);
	const l = L.open(L.emptyLayout(), "avoti", VP);
	const p = L.groupOf(l, "avoti")!.place as L.FloatPlace;
	assert.deepEqual([p.w, p.h], [big.w, big.h]);
	assert.ok(L.MIN_W >= 360 && L.MIN_H >= 260, "and cannot be shrunk to a sliver");
});

test("opening a page adds its windows once; a floating window, the dock sizes and the focus stay as the user left them", () => {
	// the user: floated Faili, moved the chat to the right, made it wide
	let l = L.normalize(defaultLayout("parskats"), VP);
	l = L.undock(l, "faili", VP);
	l = L.move(l, "faili", 700, 200, VP);
	l = L.dock(l, "chat", "right", VP, { size: 700 });
	l = L.focus(l, "faili");
	const before = JSON.stringify([L.groupOf(l, "faili"), L.dockGroup(l, "right")?.place, l.focused]);
	const next = L.addMissing(l, L.normalize(defaultLayout("koordinacija"), VP), VP);
	// the new page's windows arrive
	for (const id of ["coord.matrix", "coord.reference"]) assert.ok(L.groupOf(next, id), id);
	assert.equal(L.groupOf(next, "coord.matrix")!.place.kind === "dock" && (L.groupOf(next, "coord.matrix")!.place as L.DockPlace).side, "bottom");
	// the floating window did not move, the chat is still on the right at 700, the focus did not jump
	assert.equal(JSON.stringify([L.groupOf(next, "faili"), L.dockGroup(next, "right")?.place, next.focused]).includes('"x":700'), true);
	assert.equal(next.focused, "faili");
	assert.deepEqual(L.groupOf(next, "faili")!.place, (L.groupOf(l, "faili")!.place));
	assert.equal(((L.dockGroup(next, "right")!.place) as L.DockPlace).size, 700);
	assert.ok(before.length > 0);
	assert.deepEqual(L.problems(next), []);
	// nothing is added twice, and a second pass changes nothing
	assert.deepEqual(L.addMissing(next, L.normalize(defaultLayout("koordinacija"), VP), VP), next);
});

test("a page that joins an existing group does not hide the tab that was in front", () => {
	// Koordinācija's Reference tab joins the chat's group: the chat stays the tab in front
	const l = L.normalize(defaultLayout("parskats"), VP);
	assert.equal(L.groupOf(l, "chat")!.active, "chat");
	const next = L.addMissing(l, L.normalize(defaultLayout("koordinacija"), VP), VP);
	const g = L.groupOf(next, "chat")!;
	assert.ok(g.tabs.includes("coord.reference"));
	assert.equal(g.active, "chat");
});

test("a window the user closed stays closed when the page is opened again (it is added only the first time)", () => {
	const def = L.normalize(defaultLayout("versijas"), VP);
	let l = L.addMissing(L.normalize(defaultLayout("parskats"), VP), def, VP);
	assert.ok(L.groupOf(l, "vers.list"));
	l = L.close(l, "vers.list");
	// the store only calls addMissing for a page not in `visited`; the layout itself is untouched by anything else
	assert.equal(L.groupOf(l, "vers.list"), undefined);
	// the way back: reopen where the default keeps it
	const back = L.reopen(l, "vers.list", def, VP);
	assert.equal((L.groupOf(back, "vers.list")!.place as L.DockPlace).side, "right");
});

test("the shared layout is stored and read back; a store from the per-page builds starts it from the open page", () => {
	const shared = L.dock(L.open(L.emptyLayout(), "avoti", VP), "avoti", "bottom", VP);
	const s = L.withShared(L.emptyStore(), shared, ["parskats", "avoti"]);
	const back = L.parseStore(JSON.stringify(s), VP);
	assert.deepEqual(back.visited, ["parskats", "avoti"]);
	assert.deepEqual(L.sharedLayout(back, "parskats", defaultLayout, VP), L.normalize(shared, VP));
	assert.equal(L.parseStore(JSON.stringify({ ...s, visited: [1, "x"] }), VP).visited!.join(), "x");
	// old file: only per-page layouts
	const old = { ...L.withPage(L.emptyStore(), "versijas", L.dock(L.open(L.emptyLayout(), "faili", VP), "faili", "left", VP)), current: "versijas" };
	const start = L.sharedLayout(L.parseStore(JSON.stringify(old), VP), "versijas", defaultLayout, VP);
	assert.ok(L.groupOf(start, "faili"));
	assert.deepEqual(L.problems(start), []);
});

test("maximize fills the screen with a margin and goes back to the old size; a move or resize forgets the old size", () => {
	let l = L.open(L.emptyLayout(), "avoti", VP);
	const was = { ...(L.groupOf(l, "avoti")!.place as L.FloatPlace) };
	assert.equal(L.isMaximized(l, "avoti"), false);
	l = L.toggleMaximize(l, "avoti", VP);
	const m = L.groupOf(l, "avoti")!.place as L.FloatPlace;
	assert.deepEqual([m.x, m.y, m.w, m.h], [8, 8, VP.w - 16, VP.h - 16]);
	assert.equal(L.isMaximized(l, "avoti"), true);
	assert.deepEqual(L.problems(l), []);
	// it survives the file (restore is kept) and comes back to the size it had
	const back = L.parseStore(JSON.stringify(L.withShared(L.emptyStore(), l)), VP).shared!;
	assert.equal(L.isMaximized(back, "avoti"), true);
	const r = L.groupOf(L.toggleMaximize(back, "avoti", VP), "avoti")!.place as L.FloatPlace;
	assert.deepEqual([r.x, r.y, r.w, r.h], [was.x, was.y, was.w, was.h]);
	assert.equal(L.isMaximized(L.toggleMaximize(back, "avoti", VP), "avoti"), false);
	// dragged while maximized: that is the new size, nothing to go back to
	assert.equal(L.isMaximized(L.move(l, "avoti", 100, 100, VP), "avoti"), false);
	assert.equal(L.isMaximized(L.resize(l, "avoti", { x: 50, y: 50, w: 900, h: 600 }, VP), "avoti"), false);
	// docked groups do not maximize
	const d = L.dock(L.open(L.emptyLayout(), "faili", VP), "faili", "right", VP);
	assert.equal(L.toggleMaximize(d, "faili", VP), d);
});
