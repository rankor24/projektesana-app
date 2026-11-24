// Telpas plan: the room search, status filter and sort order, and the pan / zoom rules of the canvas. Invented rooms only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { filterRooms, kindsPresent, NO_FILTER, sortRooms, tiles, type PlanRoom } from "../src/shared/rooms-plan.ts";
import { clampView, HOME, MAX_ZOOM, panBy, place, wheelPixels, wheelZoomFactor, zoomAt } from "../src/shared/pan-zoom.ts";

const room = (no: string, name: string, area: number, diff: PlanRoom["diff"] = null): PlanRoom => ({ no, name, area, floor: "1", diff });
const rooms = [room("001/10", "gaitenis", 20), room("001/2", "vannas istaba", 4.5, "area"), room("001/1", "Virtuve", 12, "name"), room("001/3", "atpūtas telpa", 30, "missing-in-model")];

test("sort: by area both ways, by number naturally, by name, differences first", () => {
	const nos = (k: Parameters<typeof sortRooms>[1]) => sortRooms(rooms, k).map((r) => r.no);
	assert.deepEqual(nos("area-desc"), ["001/3", "001/10", "001/1", "001/2"]);
	assert.deepEqual(nos("area-asc"), ["001/2", "001/1", "001/10", "001/3"]);
	assert.deepEqual(nos("no"), ["001/1", "001/2", "001/3", "001/10"]);
	assert.deepEqual(nos("name"), ["001/3", "001/10", "001/2", "001/1"]);
	assert.deepEqual(nos("diff"), ["001/3", "001/2", "001/1", "001/10"]); // missing-in-model, area, name, then rooms with none
	assert.equal(rooms[0]!.no, "001/10", "the input is not reordered");
});

test("filter: text on number or name in any case, status all / diffs / ok / one kind", () => {
	const nos = (f: Partial<typeof NO_FILTER>) => filterRooms(rooms, { ...NO_FILTER, ...f }).map((r) => r.no);
	assert.equal(nos({}).length, 4);
	assert.deepEqual(nos({ text: "virt" }), ["001/1"]);
	assert.deepEqual(nos({ text: " 001/1" }), ["001/10", "001/1"].filter((n) => n.includes("001/1")));
	assert.deepEqual(nos({ status: "diffs" }), ["001/2", "001/1", "001/3"]);
	assert.deepEqual(nos({ status: "ok" }), ["001/10"]);
	assert.deepEqual(nos({ status: "area" }), ["001/2"]);
	assert.deepEqual(nos({ text: "telpa", status: "diffs" }), ["001/3"]);
	assert.deepEqual(kindsPresent(rooms), ["missing-in-model", "area", "name"]);
});

test("a filtered plan still fills its box, and a small room gets bigger when the others are filtered out", () => {
	const all = tiles(sortRooms(rooms, "area-desc"), 600, 360);
	const few = tiles(sortRooms(filterRooms(rooms, { ...NO_FILTER, status: "diffs" }), "area-desc"), 600, 360);
	const sum = (t: ReturnType<typeof tiles>) => Math.round(t.reduce((s, x) => s + x.w * x.h, 0));
	assert.equal(sum(all), 600 * 360);
	assert.equal(sum(few), 600 * 360);
	const bath = (t: ReturnType<typeof tiles>) => t.find((x) => x.room.no === "001/2")!;
	assert.ok(bath(few).w * bath(few).h > bath(all).w * bath(all).h);
});

test("zoom keeps the point under the pointer, stays inside the canvas, and has limits", () => {
	const W = 600;
	const H = 360;
	const v = zoomAt(HOME, 4, 300, 100, W, H);
	assert.equal(v.k, 4);
	// the canvas point that was under (300, 100) is still there
	assert.ok(Math.abs((300 - v.x) / v.k - 300) < 1e-9 && Math.abs((100 - v.y) / v.k - 100) < 1e-9);
	assert.deepEqual(zoomAt(HOME, 0.2, 10, 10, W, H), HOME, "cannot zoom out past the whole plan");
	assert.equal(zoomAt(HOME, 1000, 10, 10, W, H).k, MAX_ZOOM);
	// zooming in at a corner keeps the corner
	assert.deepEqual(zoomAt(HOME, 3, 0, 0, W, H), { k: 3, x: 0, y: 0 });
	// zooming back out at the same place gets back to the start
	assert.deepEqual(zoomAt(v, 1, 300, 100, W, H), HOME);
});

test("pan moves the view but never shows empty space", () => {
	const W = 600;
	const H = 360;
	const v = zoomAt(HOME, 2, 300, 180, W, H); // x = -300, y = -180
	assert.deepEqual(panBy(v, 100, 50, W, H), { k: 2, x: -200, y: -130 });
	assert.deepEqual(panBy(v, 9999, 9999, W, H), { k: 2, x: 0, y: 0 });
	assert.deepEqual(panBy(v, -9999, -9999, W, H), { k: 2, x: -600, y: -360 });
	assert.deepEqual(panBy(HOME, 50, 50, W, H), HOME, "nothing to pan at whole plan");
	assert.deepEqual(clampView({ k: 2, x: 40, y: -500 }, W, H), { k: 2, x: 0, y: -360 });
});

test("place maps a canvas rectangle to the window", () => {
	const r = { x: 100, y: 50, w: 60, h: 40 };
	assert.deepEqual(place(HOME, r), { left: 100, top: 50, width: 60, height: 40 });
	assert.deepEqual(place({ k: 2, x: -150, y: -20 }, r), { left: 50, top: 80, width: 120, height: 80 });
});

test("wheel: lines and pages count as pixels; a notch zooms about 16%, up is bigger", () => {
	assert.equal(wheelPixels(3, 1), 48);
	assert.equal(wheelPixels(1, 2), 400);
	assert.equal(wheelPixels(120, 0), 120);
	assert.ok(Math.abs(wheelZoomFactor(-100) - 1.16) < 0.01);
	assert.ok(wheelZoomFactor(100) < 1 && wheelZoomFactor(-100) > 1);
	assert.ok(wheelZoomFactor(-4) > Math.exp(4 * 0.0015), "small pinch steps are scaled up");
});
