import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { docxText, extractText, xlsxText } from "../src/main/files/text.ts";
import { proposeRole } from "../src/main/files/roles.ts";
import { htmlToText } from "../src/main/rules/verify.ts";
import { textDiff } from "../src/kernel/diff.ts";
import { AppApi } from "../src/main/api.ts";
import { Store } from "../src/main/store.ts";
import { SNIPPETS } from "../src/main/revit/commands.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "bv-"));
const dataDir = join(import.meta.dirname, "..", "data");

const docx = (paras: string[]) => zipSync({ "word/document.xml": strToU8(`<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`) });
const xlsx = (rows: string[][]) =>
	zipSync({
		"xl/sharedStrings.xml": strToU8(`<sst>${rows.flat().map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
		"xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((_, j) => `<c r="${"AB"[j]}${i + 1}" t="s"><v>${i * r.length + j}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`),
	});

test("DOCX and XLSX text can be read and diffed (document diff, spec §8)", async () => {
	const dir = tmp();
	writeFileSync(join(dir, "a.docx"), docx(["Stāvi: 3", "Platība &amp; apjoms: 2000 m2"]));
	writeFileSync(join(dir, "b.docx"), docx(["Stāvi: 3", "Platība &amp; apjoms: 2500 m2"]));
	const a = await extractText(join(dir, "a.docx"));
	const b = await extractText(join(dir, "b.docx"));
	assert.equal(a, "Stāvi: 3\nPlatība & apjoms: 2000 m2");
	assert.deepEqual(textDiff(a, b).filter((x) => x.op !== " ").map((x) => x.op + x.line), ["-Platība & apjoms: 2000 m2", "+Platība & apjoms: 2500 m2"]);
	writeFileSync(join(dir, "t.xlsx"), xlsx([["Telpa", "m2"], ["Foajē", "20"]]));
	assert.equal(await extractText(join(dir, "t.xlsx")), "Sheet 1: A1=Telpa\nSheet 1: B1=m2\nSheet 1: A2=Foajē\nSheet 1: B2=20");
	assert.throws(() => docxText(zipSync({ "x.txt": strToU8("y") })), /document\.xml/);
	assert.equal(xlsxText(zipSync({ "xl/worksheets/sheet1.xml": strToU8("<worksheet/>") })), "");
});

test("role proposal quotes the words it matched; unknown files get no proposal", async () => {
	const dir = tmp();
	writeFileSync(join(dir, "uzdevums.txt"), "Pielikums\nProjektēšanas uzdevums objektam Duntes iela 8");
	assert.deepEqual(await proposeRole(join(dir, "uzdevums.txt")), { role: "PU", quote: "Projektēšanas uzdevums", from: "text" });
	writeFileSync(join(dir, "Topogrāfija_2026.dwg"), "binary");
	assert.deepEqual(await proposeRole(join(dir, "Topogrāfija_2026.dwg")), { role: "Topogrāfija", quote: "Topogrāfija_2026", from: "filename" });
	writeFileSync(join(dir, "scan.laz"), "x");
	assert.equal((await proposeRole(join(dir, "scan.laz")))?.role, "Punktu mākonis");
	writeFileSync(join(dir, "random.txt"), "nekas īpašs");
	assert.equal(await proposeRole(join(dir, "random.txt")), null);
});

test("view snippets stay small and carry their parameters", () => {
	for (const k of ["createMissingPlans", "setViewScale", "createElevations", "createSheet"] as const) assert.ok(SNIPPETS[k].split("\n").length <= 16, k);
	assert.match(SNIPPETS.createSheet, /ViewSheet\.Create/);
	assert.match(SNIPPETS.createElevations, /CreateElevation\(document, plan\.Id, i\)/);
});

test("setting a role is logged and does not touch the file", async () => {
	const dir = tmp();
	const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
	const api = new AppApi({ store: new Store(join(dir, "d"), crypto), engine: {} as never, pi: async () => { throw new Error("no pi"); }, serverJs: "s", dataDir, emit: () => {} });
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const src = join(dir, "x.txt");
	writeFileSync(src, "Projektēšanas uzdevums");
	const [f] = api.filesImport(root, [src], "Cits");
	api.filesSetRole(root, f.path, "PU");
	assert.equal(api.filesList(root)[0].role, "PU");
	assert.throws(() => api.filesSetRole(root, f.path, "Izdomāta"), /Nezināma loma/);
	assert.match(readFileSync(join(root, ".bv", "log.jsonl"), "utf8"), /file\.role/);
	assert.equal(readFileSync(join(root, f.path), "utf8"), "Projektēšanas uzdevums");
});

test("htmlToText matches the snapshot style; an inline tag inside a number does not split it", () => {
	assert.equal(htmlToText("<p>7.3&nbsp;Pārējos &amp; gadījumos</p><script>x()</script>"), "7.3 Pārējos & gadījumos");
	assert.equal(htmlToText("<p>7.<sup>1</sup> un <a href='x'>7.2</a> punktā</p><p>otrs</p>"), "7.1 un 7.2 punktā otrs");
});
