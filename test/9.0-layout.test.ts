// 9.0 the layout model: every operation on invented layouts keeps the invariants (no window twice, no empty group, one group
// per side, sizes clamped, the chat never closed), dock / undock / merge / pull out, neighbour on close, per-page layouts,
// the old localStorage value migrated, a damaged layout.json falls back to the defaults, the layout file in main.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LayoutFile } from "../src/main/handlers/layout.ts";
import * as L from "../src/shared/layout.ts";
import { tmp } from "./helpers.ts";

const VP = { w: 1600, h: 900 };
const valid = (l: L.Layout) => assert.deepEqual(L.problems(l), []);
const where = (l: L.Layout, id: string) => L.groupOf(l, id)?.place;

test("a new layout has the chat docked left; opening a panel floats it, opening it again brings it to the front", () => {
	let l = L.emptyLayout();
	valid(l);
	assert.equal(where(l, "chat")?.kind, "dock");
	l = L.open(l, "avoti", VP);
	l = L.open(l, "prasibas", VP);
	valid(l);
	const z = (id: string) => (where(l, id) as L.FloatPlace).z;
	assert.ok(z("prasibas") > z("avoti"));
	l = L.open(l, "avoti", VP);
	assert.ok(z("avoti") > z("prasibas"));
	assert.equal(l.focused, "avoti");
	assert.equal(L.allWindows(l).filter((x) => x === "avoti").length, 1);
});

test("opening something that is not a window id changes nothing", () => {
	const l = L.emptyLayout();
	assert.equal(L.open(l, "nezinams", VP), l);
});

test("dock to a side: a new group; dock a second window there: it joins as a tab; every side takes one group", () => {
	let l = L.open(L.open(L.emptyLayout(), "prasibas", VP), "avoti", VP);
	l = L.dock(l, "prasibas", "bottom", VP);
	assert.deepEqual(where(l, "prasibas"), { kind: "dock", side: "bottom", size: L.DEFAULT_DOCK_H, collapsed: false });
	l = L.dock(l, "avoti", "bottom", VP);
	const g = L.dockGroup(l, "bottom")!;
	assert.deepEqual(g.tabs, ["prasibas", "avoti"]);
	assert.equal(g.active, "avoti");
	l = L.dock(L.open(l, "faili", VP), "faili", "top", VP);
	l = L.dock(L.open(l, "grafiks", VP), "grafiks", "right", VP);
	valid(l);
	assert.equal(l.groups.filter((x) => x.place.kind === "dock").length, 4, "chat left, plus top / right / bottom");
});

test("the user docks Prasības at the bottom, drops Avoti onto it as a tab, and the saved layout reads back the same", () => {
	let l = L.open(L.open(L.emptyLayout(), "prasibas", VP), "avoti", VP);
	l = L.dock(l, "prasibas", "bottom", VP);
	l = L.mergeInto(l, "avoti", "prasibas");
	const back = L.parseStore(JSON.stringify(L.withShared(L.emptyStore(), l)), VP);
	assert.deepEqual(L.sharedLayout(back, "pārskats", L.emptyLayout, VP), L.normalize(l, VP));
	assert.deepEqual(L.dockGroup(l, "bottom")!.tabs, ["prasibas", "avoti"]);
});

test("a dock group's size is kept when it is resized and clamped to the window and to a minimum", () => {
	let l = L.dock(L.open(L.emptyLayout(), "avoti", VP), "avoti", "right", VP);
	l = L.resizeDock(l, "right", 500, VP);
	assert.equal((L.dockGroup(l, "right")!.place as L.DockPlace).size, 500);
	l = L.resizeDock(l, "right", 5000, VP);
	assert.equal((L.dockGroup(l, "right")!.place as L.DockPlace).size, 960, "60% of 1600");
	l = L.resizeDock(l, "right", 10, VP);
	assert.equal((L.dockGroup(l, "right")!.place as L.DockPlace).size, L.MIN_DOCK);
});

test("undock floats the whole group; pull out takes one tab out of a group", () => {
	let l = L.open(L.open(L.emptyLayout(), "prasibas", VP), "avoti", VP);
	l = L.dock(l, "prasibas", "left", VP); // joins the chat's group
	assert.deepEqual(L.dockGroup(l, "left")!.tabs, ["chat", "prasibas"]);
	l = L.pullOut(l, "prasibas", VP);
	valid(l);
	assert.equal(where(l, "prasibas")?.kind, "float");
	assert.deepEqual(L.dockGroup(l, "left")!.tabs, ["chat"]);
	l = L.dock(l, "avoti", "right", VP);
	l = L.undock(l, "avoti", VP);
	assert.equal(where(l, "avoti")?.kind, "float");
	assert.equal(L.dockGroup(l, "right"), undefined, "an emptied side has no group");
	valid(l);
});

test("merge two floating windows: one group with two tabs; split them again with pull out", () => {
	let l = L.open(L.open(L.emptyLayout(), "avoti", VP), "faili", VP);
	l = L.mergeInto(l, "faili", "avoti", 0);
	const g = L.groupOf(l, "avoti")!;
	assert.deepEqual(g.tabs, ["faili", "avoti"]);
	assert.equal(g.active, "faili");
	assert.equal(l.groups.filter((x) => x.place.kind === "float").length, 1);
	l = L.pullOut(l, "faili", VP, { x: 700, y: 300 });
	assert.equal(l.groups.filter((x) => x.place.kind === "float").length, 2);
	assert.equal((where(l, "faili") as L.FloatPlace).x, 700);
	valid(l);
});

test("merging onto itself or onto a missing or minimised window changes nothing", () => {
	let l = L.open(L.open(L.emptyLayout(), "avoti", VP), "faili", VP);
	assert.equal(L.mergeInto(l, "avoti", "avoti"), l);
	assert.equal(L.mergeInto(l, "avoti", "grafiks"), l);
	l = L.minimise(l, "faili");
	assert.equal(L.mergeInto(l, "avoti", "faili"), l);
});

test("closing the active tab picks the neighbour; closing the last tab removes the group; the filter goes with it", () => {
	let l = L.open(L.open(L.open(L.emptyLayout(), "avoti", VP), "faili", VP), "grafiks", VP);
	l = L.mergeInto(l, "faili", "avoti");
	l = L.mergeInto(l, "grafiks", "avoti");
	assert.deepEqual(L.groupOf(l, "avoti")!.tabs, ["avoti", "faili", "grafiks"]);
	l = L.setActive(l, "faili");
	l = L.close(l, "faili");
	assert.equal(L.groupOf(l, "avoti")!.active, "grafiks", "the one that took its place");
	l = L.close(l, "grafiks");
	assert.equal(L.groupOf(l, "avoti")!.active, "avoti", "no neighbour to the right: the last");
	l = L.setFilter(l, "avoti", "x");
	l = L.close(l, "avoti");
	assert.equal(L.groupOf(l, "avoti"), undefined);
	assert.deepEqual(l.filters, {});
	valid(l);
});

test("the chat is never closed, only collapsed; it can be moved and un-collapsed", () => {
	let l = L.emptyLayout();
	assert.equal(L.canClose("chat"), false);
	assert.equal(L.close(l, "chat"), l);
	l = L.collapse(l, "chat");
	assert.equal((where(l, "chat") as L.DockPlace).collapsed, true);
	l = L.open(l, "chat", VP);
	assert.equal((where(l, "chat") as L.DockPlace).collapsed, false);
	l = L.dock(l, "chat", "bottom", VP);
	assert.equal((where(l, "chat") as L.DockPlace).side, "bottom");
	l = L.toggle(L.toggle(l, "chat", VP), "chat", VP); // in front → collapse, then open again
	assert.equal((where(l, "chat") as L.DockPlace).collapsed, false);
	valid(l);
});

test("minimise a floating window and restore it where it was; collapse a docked group to a strip", () => {
	let l = L.open(L.emptyLayout(), "avoti", VP);
	l = L.move(l, "avoti", 300, 200, VP);
	l = L.minimise(l, "avoti");
	assert.equal(where(l, "avoti")?.kind, "min");
	l = L.open(l, "avoti", VP);
	const p = where(l, "avoti") as L.FloatPlace;
	assert.deepEqual([p.kind, p.x, p.y], ["float", 300, 200]);
	l = L.dock(l, "avoti", "right", VP);
	l = L.collapse(l, "avoti");
	assert.equal((where(l, "avoti") as L.DockPlace).collapsed, true);
	l = L.open(l, "avoti", VP);
	assert.equal((where(l, "avoti") as L.DockPlace).collapsed, false);
});

test("clamping: a window larger than the screen, off the screen, or below the minimum is brought back; a smaller window re-clamps everything", () => {
	let l = L.open(L.emptyLayout(), "avoti", VP);
	l = L.resize(l, "avoti", { x: 1500, y: 800, w: 4000, h: 4000 }, VP);
	let p = where(l, "avoti") as L.FloatPlace;
	assert.deepEqual([p.w, p.h, p.x, p.y], [1584, 884, 16, 16]);
	l = L.resize(l, "avoti", { x: 100, y: 100, w: 10, h: 10 }, VP);
	p = where(l, "avoti") as L.FloatPlace;
	assert.deepEqual([p.w, p.h], [L.MIN_W, L.MIN_H]);
	l = L.move(l, "avoti", 5000, -50, VP);
	p = where(l, "avoti") as L.FloatPlace;
	assert.deepEqual([p.x, p.y], [VP.w - L.MIN_W, 0]);
	l = L.resize(l, "avoti", { x: 800, y: 500, w: 700, h: 500 }, VP);
	const small = L.normalize(l, { w: 900, h: 600 });
	p = where(small, "avoti") as L.FloatPlace;
	assert.ok(p.x + p.w <= 900 && p.y + p.h <= 600, "inside the smaller window");
	valid(small);
});

test("pop out remembers the place; closing the pop-out window docks it back into that side's group or floats where it was", () => {
	let l = L.open(L.open(L.emptyLayout(), "avoti", VP), "faili", VP);
	l = L.dock(l, "avoti", "right", VP);
	l = L.dock(l, "faili", "right", VP);
	l = L.popOut(l, "faili", VP);
	assert.equal(where(l, "faili")?.kind, "pop");
	assert.deepEqual(L.poppedOut(l), ["faili"]);
	assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["avoti"]);
	l = L.popIn(l, "faili", VP);
	assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["avoti", "faili"]);
	assert.deepEqual(L.poppedOut(l), []);
	let f = L.move(L.open(L.emptyLayout(), "grafiks", VP), "grafiks", 400, 250, VP);
	f = L.popIn(L.popOut(f, "grafiks", VP), "grafiks", VP);
	assert.deepEqual([where(f, "grafiks")?.kind, (where(f, "grafiks") as L.FloatPlace).x], ["float", 400]);
	valid(l);
	valid(f);
});

test("drag targets: near an edge docks on that side (the nearest in a corner); over a tab strip joins that group; the strip wins", () => {
	assert.equal(L.dockSideAt(VP, 10, 450), "left");
	assert.equal(L.dockSideAt(VP, 1595, 450), "right");
	assert.equal(L.dockSideAt(VP, 800, 880), "bottom");
	assert.equal(L.dockSideAt(VP, 800, 450), null);
	assert.equal(L.dockSideAt(VP, 30, 10), "top", "the nearer edge in a corner");
	const strips = [{ id: "avoti", x: 0, y: 860, w: 400, h: 30 }];
	assert.deepEqual(L.dropTarget(VP, strips, 100, 870), { kind: "tabs", targetId: "avoti" });
	assert.deepEqual(L.dropTarget(VP, strips, 100, 870, "avoti"), { kind: "side", side: "bottom" }, "not onto its own strip");
	assert.equal(L.dropTarget(VP, strips, 800, 450), null);
	assert.equal(L.tabIndexAt([{ x: 0, w: 100 }, { x: 100, w: 100 }], 40), 0);
	assert.equal(L.tabIndexAt([{ x: 0, w: 100 }, { x: 100, w: 100 }], 120), 1);
	assert.equal(L.tabIndexAt([{ x: 0, w: 100 }, { x: 100, w: 100 }], 190), 2);
});

test("a long random run of operations never breaks an invariant", () => {
	const ids = ["chat", "avoti", "faili", "grafiks", "prasibas", "telpas", "viewer.props"];
	let seed = 7;
	const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
	let l = L.emptyLayout();
	for (let i = 0; i < 600; i++) {
		const id = ids[rnd(ids.length)];
		const other = ids[rnd(ids.length)];
		const side = L.SIDES[rnd(4)];
		const op = rnd(13);
		if (op === 0) l = L.open(l, id, VP);
		else if (op === 1) l = L.dock(l, id, side, VP, { whole: rnd(2) === 0 });
		else if (op === 2) l = L.undock(l, id, VP);
		else if (op === 3) l = L.mergeInto(l, id, other, rnd(4));
		else if (op === 4) l = L.pullOut(l, id, VP);
		else if (op === 5) l = L.close(l, id);
		else if (op === 6) l = L.collapse(l, id, rnd(2) === 0);
		else if (op === 7) l = L.popOut(l, id, VP);
		else if (op === 8) l = L.popIn(l, id, VP);
		else if (op === 9) l = L.resize(l, id, { x: rnd(2000), y: rnd(1200), w: rnd(3000), h: rnd(2000) }, VP);
		else if (op === 10) l = L.resizeDock(l, side, rnd(3000), VP);
		else if (op === 11) l = L.reorder(l, id, rnd(5));
		else l = L.toggle(l, id, VP);
		assert.deepEqual(L.problems(l), [], `after step ${i} (op ${op} on ${id})`);
	}
	const n = L.normalize(l, VP);
	assert.deepEqual(L.normalize(n, VP), n, "normalising is idempotent");
	assert.deepEqual(L.allWindows(n).sort(), L.allWindows(l).sort(), "and loses no window");
});

test("a damaged or foreign layout is repaired or dropped: junk, duplicates, two groups on a side, a missing chat", () => {
	assert.deepEqual(L.parseStore("{ not json", VP), L.emptyStore());
	assert.deepEqual(L.parseStore('{"version":2,"pages":{}}', VP), L.emptyStore());
	assert.deepEqual(L.parseStore(null, VP), L.emptyStore());
	const bad = {
		version: 1,
		pages: {
			x: {
				groups: [
					{ tabs: ["avoti", "avoti", "bogus"], active: "bogus", place: { kind: "dock", side: "right", size: 99999, collapsed: false } },
					{ tabs: ["faili"], active: "faili", place: { kind: "dock", side: "right", size: 300, collapsed: false } },
					{ tabs: ["avoti", "grafiks"], active: "grafiks", place: { kind: "float", x: "a", y: -5, w: 1, h: 1, z: 9 } },
					{ tabs: [], active: "x", place: { kind: "float", x: 0, y: 0, w: 400, h: 300, z: 1 } },
					{ tabs: ["telpas"], active: "telpas", place: { kind: "elsewhere" } },
				],
				focused: "gone",
				filters: { avoti: "ok", gone: "no", faili: 3 },
			},
			y: "junk",
		},
	};
	const s = L.parseStore(JSON.stringify(bad), VP);
	assert.deepEqual(Object.keys(s.pages), ["x"]);
	const l = s.pages.x;
	valid(l);
	assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["avoti", "faili"], "the two groups on one side became one");
	assert.equal((L.dockGroup(l, "right")!.place as L.DockPlace).size, 960);
	assert.deepEqual(L.groupOf(l, "grafiks")!.tabs, ["grafiks"], "avoti was already in the dock: not twice");
	assert.equal(L.groupOf(l, "telpas"), undefined);
	assert.ok(L.groupOf(l, "chat"), "the chat is put back");
	assert.equal(l.focused, null);
	assert.deepEqual(l.filters, { avoti: "ok" });
});

test("the layout file in main: saved and read back, a missing file and a damaged file give an empty store, the write is replaced whole", () => {
	const dir = tmp();
	const f = new LayoutFile(dir);
	assert.deepEqual(f.read(VP), L.emptyStore());
	const s = L.withShared(L.emptyStore(), L.normalize(L.dock(L.open(L.emptyLayout(), "avoti", VP), "avoti", "bottom", VP), VP));
	f.write(s);
	assert.deepEqual(new LayoutFile(dir).read(VP), s);
	writeFileSync(join(dir, "layout.json"), "{ half a file");
	assert.deepEqual(new LayoutFile(dir).read(VP), L.emptyStore());
	const nested = join(tmp(), "not", "yet");
	new LayoutFile(nested).write(s);
	assert.equal(JSON.parse(readFileSync(join(nested, "layout.json"), "utf8")).version, 1, "the folder is made");
	mkdirSync(join(dir, "x"), { recursive: true });
});
