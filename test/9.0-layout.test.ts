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


test("the comment tools window alone may be as low as one row of icons; every other window keeps its minimum height", () => {
	let l = L.open(L.emptyLayout(), L.TOOLS, VP);
	l = L.resize(l, L.TOOLS, { x: 100, y: 100, w: 190, h: 10 }, VP);
	const g = L.groupOf(l, L.TOOLS)?.place;
	assert.equal(g?.kind, "float");
	assert.equal(g?.kind === "float" && g.h, L.TOOLS_H);
	assert.ok(L.TOOLS_H < L.MIN_H);
	assert.equal(L.minHOf(L.minWOf([L.TOOLS])), L.TOOLS_H);
	assert.equal(L.minHOf(L.minWOf([L.CHAT])), L.MIN_H);
	assert.equal(L.clampGeo({ x: 0, y: 0, w: 400, h: 10 }, VP).h, L.MIN_H);
	valid(l);
});
