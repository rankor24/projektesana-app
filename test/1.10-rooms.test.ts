// 1.10 room table from an invented 3-floor Kadastrālā lieta (test/fixtures/src/kl-rooms.html → kl-rooms.pdf).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pdfLayoutLines, roomsFromLines, totalsCheck } from "../src/sources/extract/kl.ts";
import { writeXlsx } from "../src/sources/export/xlsx.ts";
import { xlsxSheets } from "../src/sources/text/xlsx.ts";
import { FIX } from "./helpers.ts";

const EXPECTED = [
	["1", "101", "Vējtveris", 4.2],
	["1", "102", "Gaitenis", 18.6],
	["1", "103", "Kabinets", 15.3],
	["1", "104", "Sanitārais mezgls", 3.8],
	["2", "201", "Kāpņu telpa", 12.0],
	["2", "202", "Zāle", 48.5],
	["2", "203", "Noliktava", 6.7],
	["3", "301", "Bēniņu telpa", 55.1],
	["3", "302", "Tehniskā telpa", 9.9],
];

test("every room row of the 3-floor table, areas to one decimal, heights, pages", async () => {
	const t = roomsFromLines(await pdfLayoutLines(new Uint8Array(readFileSync(join(FIX, "kl-rooms.pdf")))));
	assert.deepEqual(
		t.rows.map((r) => [r.floor, r.no, r.name, r.area]),
		EXPECTED,
	);
	assert.equal(t.rows[0].height, 3.1);
	assert.equal(t.rows.find((r) => r.no === "301")!.page, 2);
	assert.deepEqual(t.unread, []);
	assert.ok(totalsCheck(t).every((x) => x.ok), JSON.stringify(totalsCheck(t)));
	assert.deepEqual(totalsCheck(t).map((x) => x.stated), [41.9, 67.2, 65.0, 174.1]);
});

test("OCR-style text lines parse the same way", () => {
	const t = roomsFromLines([["2. stāvs", "Nr. p.k. Telpas Nr. Telpas nosaukums Platība, m²", "5 201 Kāpņu telpa 12,0 2,90", "6 202 Zāle 48,5", "Kopā 2. stāvā 60,5"]]);
	assert.deepEqual(t.rows.map((r) => [r.floor, r.no, r.name, r.area, r.height]), [
		["2", "201", "Kāpņu telpa", 12, 2.9],
		["2", "202", "Zāle", 48.5, null],
	]);
	assert.equal(totalsCheck(t)[0].ok, true);
});

test("export to Excel: a valid workbook with numbers as numbers", () => {
	const buf = writeXlsx([{ name: "Telpas", rows: [["Stāvs", "Nr.", "Nosaukums", "Platība, m²"], ...EXPECTED.map((r) => [...r])] }]);
	const [s] = xlsxSheets(buf);
	assert.equal(s.name, "Telpas");
	assert.equal(s.rows.get(2)!.get("C"), "Vējtveris");
	assert.equal(s.rows.get(2)!.get("D"), "4.2");
	assert.equal(s.rows.size, 10);
});
