import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdfContentRect } from "../src/main/loop/pdfrect.ts";
import { extractText } from "../src/main/files/text.ts";

/** Smallest valid PDF with one content stream (page 600 x 800). Built here only to test measurement; not product data. */
function pdf(content: string): Buffer {
	const objs = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	const offs: number[] = [];
	objs.forEach((o, i) => {
		offs.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(out, "latin1");
}

const tmp = () => mkdtempSync(join(tmpdir(), "bv-"));

test("content rectangle is measured from vector paths, flipped to top-left origin", async () => {
	const f = join(tmp(), "a.pdf");
	writeFileSync(f, pdf("100 100 400 300 re S"));
	const r = await pdfContentRect(f);
	assert.ok(Math.abs(r.x0 - 100 / 600) < 1e-3 && Math.abs(r.x1 - 500 / 600) < 1e-3);
	assert.ok(Math.abs(r.y0 - (1 - 400 / 800)) < 1e-3 && Math.abs(r.y1 - (1 - 100 / 800)) < 1e-3);
});

test("a cm transform before the path is applied", async () => {
	const f = join(tmp(), "b.pdf");
	writeFileSync(f, pdf("q 2 0 0 2 0 0 cm 50 50 100 100 re S Q"));
	const r = await pdfContentRect(f);
	assert.ok(Math.abs(r.x0 - 100 / 600) < 1e-3 && Math.abs(r.x1 - 300 / 600) < 1e-3);
});

test("a page without vector graphics is reported, not guessed", async () => {
	const f = join(tmp(), "c.pdf");
	writeFileSync(f, pdf("BT /F1 12 Tf 10 10 Td (x) Tj ET"));
	await assert.rejects(pdfContentRect(f), /nav vektoru/);
});

test("PDF text extraction returns the page text", async () => {
	const f = join(tmp(), "d.pdf");
	writeFileSync(f, pdf("BT /F1 12 Tf 10 700 Td (Duntes iela 8) Tj ET"));
	assert.match(await extractText(f), /Duntes iela 8/);
});

test("unsupported formats are refused with a clear message", async () => {
	await assert.rejects(extractText("C:\\x\\a.dwg"), /vēl netiek lasīts/);
});
