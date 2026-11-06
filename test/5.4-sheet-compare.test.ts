// 5.4 sheet compare on two invented issues of one sheet (test/fixtures/src/sheet-a.html, sheet-b.html): in b the inner
// wall moved 20 px to the right and the dimension 3000 became 3200. Both are found and named; nothing else is reported.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { diffSheets, pairPages, readSheet } from "../src/sources/sheets/vector-diff.ts";
import { FIX } from "./helpers.ts";

const A = new Uint8Array(readFileSync(join(FIX, "sheet-a.pdf")));
const B = new Uint8Array(readFileSync(join(FIX, "sheet-b.pdf")));

test("sheet number from the title block, frame found", async () => {
	const [p] = await readSheet(A);
	assert.equal(p.sheetNo, "AR-3");
	assert.ok(p.frame && p.frame.x1 - p.frame.x0 > 150, JSON.stringify(p.frame));
});

test("the moved wall and the changed dimension, named; nothing else", async () => {
	const [d] = await diffSheets(A, B);
	assert.equal(d.sheetNo, "AR-3");
	const kinds = d.changes.map((c) => c.kind).sort();
	assert.deepEqual(kinds, ["dimension-changed", "line-moved"], d.summary.join("\n"));
	const mv = d.changes.find((c) => c.kind === "line-moved")!;
	assert.ok(mv.kind === "line-moved" && mv.dx > 0 && Math.abs(mv.dy) < 0.3, JSON.stringify(mv));
	const dim = d.changes.find((c) => c.kind === "dimension-changed")!;
	assert.ok(dim.kind === "dimension-changed" && dim.from.str === "3000" && dim.to.str === "3200");
	assert.ok(d.summary.some((s) => /izmērs 3000 → 3200/.test(s)));
	assert.ok(d.summary.some((s) => /pārvietota par/.test(s)));
});

test("the same sheet against itself: no changes; pairing by sheet number", async () => {
	const [d] = await diffSheets(A, A);
	assert.deepEqual(d.changes, []);
	const pa = await readSheet(A);
	assert.equal(pairPages(pa, [...pa]).length, 1);
});
