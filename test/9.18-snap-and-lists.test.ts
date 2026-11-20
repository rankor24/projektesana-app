// 9.18 the user's second round on the window system: dock zones drawn while a window is dragged (bands at the work area's
// edges, the one under the pointer lit), a window can be made small, the list pages stack in the right panel, the conversations
// are the left side panel, Coordination opens no model by itself, the screen grab is a channel of the main process.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as L from "../src/shared/layout.ts";
import { defaultLayout, isListPage, LIST_DOCK_SIZE, PAGES, windowShown } from "../src/shared/pages.ts";
import { API_NAMES } from "../src/shared/api.ts";

const VP = { w: 1920, h: 1080 };
// the work area: right of the 170 px rail, under the 64 px top bar
const Z: L.Zone = { x: 170, y: 64, w: 1750, h: 1016 };

test("dock zones: four bands at the edges of the work area, a clear depth, the nearer edge in a corner", () => {
	const zones = L.snapZones(Z);
	assert.deepEqual(zones.map((z) => z.side), ["left", "right", "top", "bottom"]);
	for (const z of zones) assert.ok((z.side === "left" || z.side === "right" ? z.w : z.h) >= 110, `${z.side} is deep enough to hit`);
	assert.equal(L.snapBand(Z, "left"), 260, "a fifth of the width, at most 260");
	assert.equal(L.snapBand({ x: 0, y: 0, w: 400, h: 300 }, "left"), 110, "never under 110");
	assert.equal(L.dockSideInZone(Z, 180, 500), "left");
	assert.equal(L.dockSideInZone(Z, 1910, 500), "right");
	assert.equal(L.dockSideInZone(Z, 900, 70), "top");
	assert.equal(L.dockSideInZone(Z, 900, 1070), "bottom");
	assert.equal(L.dockSideInZone(Z, 900, 500), null, "the middle is for floating");
	// a corner: nearer the left edge than the top edge, as a share of each band
	assert.equal(L.dockSideInZone(Z, 175, 200), "left");
	assert.equal(L.dockSideInZone(Z, 400, 68), "top");
	// outside the work area (over the rail) is no zone
	assert.equal(L.dockSideInZone(Z, 100, 500), null);
	// the drop target uses the zones when it is given them, a tab strip first
	assert.deepEqual(L.dropTarget(VP, [], 180, 500, "avoti", Z), { kind: "side", side: "left" });
	assert.deepEqual(L.dropTarget(VP, [{ id: "faili", x: 170, y: 400, w: 300, h: 36 }], 200, 410, "avoti", Z), { kind: "tabs", targetId: "faili" });
	assert.equal(L.dropTarget(VP, [], 900, 500, "avoti", Z), null);
});

test("a window can be made small: the strip has two buttons, not seven", () => {
	const l = L.open(L.emptyLayout(), "avoti", VP);
	const small = L.resize(l, "avoti", { x: 100, y: 100, w: 10, h: 10 }, VP);
	const p = L.groupOf(small, "avoti")!.place as L.FloatPlace;
	assert.deepEqual([p.w, p.h], [L.MIN_W, L.MIN_H]);
	assert.ok(L.MIN_W <= 300);
});

test("the list pages dock on the right and stack as tabs of one panel", () => {
	let l = L.normalize(defaultLayout("parskats"), VP);
	const lists = PAGES.filter((p) => isListPage(p.id)).map((p) => p.id);
	assert.ok(lists.includes("faili") && lists.includes("avoti") && lists.includes("prasibas"));
	// what windows.go does for a list page: dock it right, then bring it to the front
	for (const id of ["faili", "avoti", "prasibas"]) {
		if (!L.groupOf(l, id)) l = L.dock(L.open(l, id, VP), id, "right", VP, { size: LIST_DOCK_SIZE });
		l = L.open(l, id, VP);
	}
	const right = L.dockGroup(l, "right")!;
	assert.deepEqual(right.tabs, ["faili", "avoti", "prasibas"], "one panel, one tab each, in the order they were opened");
	assert.equal(right.active, "prasibas");
	assert.equal((right.place as L.DockPlace).size, LIST_DOCK_SIZE);
	assert.equal(L.dockGroup(l, "left")!.tabs.join(), "chat", "nothing of them left of the chat");
	// the second click on the tab in front closes just that tab
	const closed = L.close(l, "prasibas");
	assert.deepEqual(L.dockGroup(closed, "right")!.tabs, ["faili", "avoti"]);
	assert.deepEqual(L.problems(closed), []);
	// a list is not owned by a page: it stays where it is on every page
	for (const page of ["parskats", "versijas", "koordinacija"]) assert.equal(windowShown("faili", page, true), true, page);
});

test("the conversations are the left side panel, the screen grab a channel", () => {
	const s = L.cleanSidebar({ id: L.THREADS, open: true, width: 360 });
	assert.deepEqual([s.id, s.open], [L.THREADS, true]);
	assert.ok((API_NAMES as readonly string[]).includes("screen.capture"));
});
