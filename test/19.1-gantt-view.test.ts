// Grafiks Gantt view maths: the day under the pointer while zoom ticks pile up before a redraw, the wheel's size, the drag of a bar.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayUnder, dragSpan, spanLabel, wheelPixels, wheelZoomFactor } from "../src/shared/gantt.ts";

test("the day under the pointer: from the scroll position when nothing is pending", () => {
	// label column 210, 7 px/day, scrolled 700 px, pointer at window x 450 → (700 + 450 - 210) / 7
	assert.equal(dayUnder(null, 7, 450, 700, 210), 940 / 7);
});

test("the day under the pointer: while a zoom is pending it follows the pending anchor, not the stale scroll position", () => {
	// the last tick put day 100 under x 450 and asked for 10 px/day (not drawn yet); the pointer moved 50 px right
	assert.equal(dayUnder({ day: 100, cx: 450 }, 10, 500, 0, 210), 105);
	// the pointer did not move: the same day
	assert.equal(dayUnder({ day: 100, cx: 450 }, 10, 450, 12345, 210), 100);
});

test("zooming in several ticks keeps one day still under a still pointer", () => {
	let dw = 7;
	let anchor: { day: number; cx: number } | null = null;
	const scroll = 700;
	const cx = 450;
	for (let i = 0; i < 6; i++) {
		const day = dayUnder(anchor, dw, cx, scroll, 210);
		dw *= wheelZoomFactor(-100);
		anchor = { day, cx };
	}
	assert.ok(Math.abs(anchor!.day - 940 / 7) < 1e-9);
	assert.ok(dw > 7);
});

test("a wheel notch is about 16%, a pinch step is scaled up, line and page modes count as pixels", () => {
	assert.ok(wheelZoomFactor(-100) > 1.15 && wheelZoomFactor(-100) < 1.18);
	assert.ok(wheelZoomFactor(100) < 1);
	assert.ok(wheelZoomFactor(-4) > 1.03);
	assert.equal(wheelPixels(3, 1), 48);
	assert.equal(wheelPixels(1, 2), 400);
	assert.equal(wheelPixels(120, 0), 120);
});

test("a drag moves a bar or one edge by whole days and never turns it inside out", () => {
	const s = { start: "2026-11-10", end: "2026-11-14" };
	assert.deepEqual(dragSpan(s, 3, "move"), { start: "2026-11-13", end: "2026-11-17" });
	assert.deepEqual(dragSpan(s, -2, "start"), { start: "2026-11-08", end: "2026-11-14" });
	assert.deepEqual(dragSpan(s, 9, "start"), { start: "2026-11-14", end: "2026-11-14" });
	assert.deepEqual(dragSpan(s, -9, "end"), { start: "2026-11-10", end: "2026-11-10" });
	assert.deepEqual(dragSpan({ start: "2026-12-30", end: "2026-12-31" }, 2, "move"), { start: "2027-01-01", end: "2027-01-02" });
});

test("the label on a dragged bar: dates and days", () => {
	assert.equal(spanLabel({ start: "2026-11-10", end: "2026-11-14" }), "2026-11-10 → 2026-11-14 · 5 d");
	assert.equal(spanLabel({ start: "2026-11-10", end: "2026-11-10" }), "2026-11-10");
});
