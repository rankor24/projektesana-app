// 3.4 plan geometry from a vector PDF (invented plan, test/fixtures/src/kl-plan.html → kl-plan.pdf, made by Chromium).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { geometryCsv, pdfGeometry } from "../src/sources/extract/kl-geometry.ts";
import { FIX } from "./helpers.ts";

test("stroked segments per page with their floor; clip paths left out", async () => {
	const g = await pdfGeometry(new Uint8Array(readFileSync(join(FIX, "kl-plan.pdf"))));
	assert.equal(g.length, 2);
	assert.equal(g[0].segments.length, 6, "rectangle (4) + two walls");
	assert.equal(g[1].segments.length, 5, "rectangle (4) + one wall");
	assert.equal(g[0].floor, "1");
	assert.equal(g[1].floor, "2");
});

test("known coordinates: the invented rectangle 400 × 300 with the wall at its middle, at one uniform scale", async () => {
	const [p, q] = await pdfGeometry(new Uint8Array(readFileSync(join(FIX, "kl-plan.pdf"))));
	const xs = p.segments.flatMap((s) => [s.x1, s.x2]);
	const ys = p.segments.flatMap((s) => [s.y1, s.y2]);
	const w = Math.max(...xs) - Math.min(...xs);
	const h = Math.max(...ys) - Math.min(...ys);
	assert.ok(Math.abs(w / h - 4 / 3) < 0.002, `ratio ${w / h}`);
	const wall = p.segments.find((s) => Math.abs(s.x1 - s.x2) < 0.01 && Math.abs(s.x1 - (Math.min(...xs) + w / 2)) < 0.05);
	assert.ok(wall, "the vertical wall at the middle (x = 300 of 100…500)");
	assert.ok(Math.abs(Math.abs(wall!.y2 - wall!.y1) - h) < 0.05, "as tall as the rectangle");
	const half = p.segments.find((s) => Math.abs(s.y1 - s.y2) < 0.01 && Math.abs(Math.abs(s.x2 - s.x1) - w / 2) < 0.05);
	assert.ok(half, "the horizontal wall from 100 to 300");
	const qx = q.segments.flatMap((s) => [s.x1, s.x2]);
	const qwall = q.segments.find((s) => Math.abs(s.x1 - s.x2) < 0.01 && Math.abs(s.x1 - Math.min(...qx) - (Math.max(...qx) - Math.min(...qx)) * 3 / 8) < 0.05);
	assert.ok(qwall, "page 2: wall at 250 of 100…500");
	// fractions for the overlay: top-left origin, inside the page
	assert.ok(p.fractions.every((s) => s.x1 >= 0 && s.x1 <= 1 && s.y1 >= 0 && s.y1 <= 1));
	assert.equal(p.points.length, 8, "4 corners + 2 + 2 wall ends");
});

test("CSV with ; and decimal commas", async () => {
	const csv = geometryCsv(await pdfGeometry(new Uint8Array(readFileSync(join(FIX, "kl-plan.pdf")))));
	const lines = csv.trim().split("\r\n");
	assert.equal(lines[0], "lapa;stāvs;tips;x1_mm;y1_mm;x2_mm;y2_mm");
	assert.equal(lines.filter((l) => l.includes(";līnija;")).length, 11);
	assert.match(lines[1], /^1;1;līnija;\d+,\d+;/);
});
