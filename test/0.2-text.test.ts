// 0.2 carried text readers on invented fixtures.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { docxText } from "../src/sources/text/docx.ts";
import { extractText, normText } from "../src/sources/text/index.ts";
import { pdfText } from "../src/sources/text/pdf.ts";
import { xlsxSheets, xlsxText } from "../src/sources/text/xlsx.ts";
import { FIX, makeDocx, makeXlsx, tmp } from "./helpers.ts";

test("pdf: text per page with Latvian letters", async () => {
	const r = await pdfText(join(FIX, "text-lv.pdf"));
	assert.equal(r.pages.length, 2);
	// Chromium wraps the heading: quotes are always compared on whitespace-normalised text
	assert.match(normText(r.pages[0]), /Projektēšanas uzdevums Nr\. 99\/TEST/);
	assert.match(r.pages[0], /ā č ē ģ ī ķ ļ ņ š ū ž/);
	assert.match(r.pages[1], /energoefektivitātes klasi A/);
	assert.deepEqual(r.emptyPages, []);
});

test("docx: paragraphs and table cells", () => {
	const t = docxText(makeDocx(["1. Vispārīgā daļa", ["Telpa", "Platība"], "Būvniecības veids & grupa"]));
	assert.equal(t, "1. Vispārīgā daļa\nTelpa\tPlatība\nBūvniecības veids & grupa");
});

test("xlsx: sheet names and rows", () => {
	const buf = makeXlsx({ Grafiks: [["Posms", "Datums"], ["MBP", "2027-02-01"], ["BP", 46100]] });
	const [s] = xlsxSheets(buf);
	assert.equal(s.name, "Grafiks");
	assert.equal(s.rows.get(2)!.get("A"), "MBP");
	assert.equal(xlsxText(buf), "# Grafiks\nPosms\tDatums\nMBP\t2027-02-01\nBP\t46100");
});

test("extract: states ok, unsupported, error", async () => {
	const d = tmp();
	writeFileSync(join(d, "a.docx"), makeDocx(["Teksts"]));
	writeFileSync(join(d, "b.dwg"), "x");
	writeFileSync(join(d, "c.docx"), "not a zip");
	assert.equal((await extractText(join(d, "a.docx"))).state, "ok");
	assert.equal((await extractText(join(d, "b.dwg"))).state, "unsupported");
	const c = await extractText(join(d, "c.docx"));
	assert.equal(c.state, "error");
	assert.ok(c.reason);
});
