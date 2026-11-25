// The coding-agent tools added 2026-11-25: spreadsheet formulas, archives, image / PDF / drawing viewing and zoom, file conversion, DWG and DXF reading (CadCraft headless).
// Invented data only; the drawings are CadCraft's own sample files.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { writeXlsx } from "../src/sources/export/xlsx.ts";
import { evaluateWorkbook } from "../src/sources/export/xlsx-formula.ts";
import { xlsxSheets } from "../src/sources/text/xlsx.ts";
import { archiveKind, cleanName, extractArchive, listArchive, readTar, safeJoin, uniquePath, workDirOf } from "../src/agent/media.ts";
import { cleanRegion, viewImage, type NativeLike } from "../src/main/image-view.ts";
import { mediaTools } from "../src/agent/tools/media.ts";
import { lasHeader } from "../src/agent/cad-headless.ts";
import { tmp } from "./helpers.ts";

const SAMPLES = join(import.meta.dirname, "..", "resources", "cadcraft", "app", "samples");
const hasCad = existsSync(join(SAMPLES, "sample-house.dwg"));
const tool = (name: string) => mediaTools.find((t) => t.name === name)!;
const ctxOf = (dir: string) => ({ projectsDir: dir, projectId: null, dataDir: dir, appDir: dir, runDir: null, agent: "ar", thread: null, skillsDir: join(import.meta.dirname, "..", "resources", "skills") });

// ---- formulas --------------------------------------------------------------------------------------------------------------------------

test("formulas: totals, rounding, references across sheets, errors and unsupported functions", () => {
	const rows = [
		["Pozīcija", "Daudzums", "Cena", "Summa"],
		["Siena", 12.5, 18.4, { f: "B2*C2" }],
		["Durvis", 4, 210, { f: "ROUND(B3*C3;2)" }],
		["Kopā", { f: "SUM(B2:B3)" }, null, { f: "SUM(D2:D3)" }],
		["PVN 21%", null, null, { f: "ROUND(D4*21%;2)" }],
		["Ar PVN", null, null, { f: "D4+D5" }],
		["Vid.", { f: "AVERAGE(B2:B3)" }, { f: "MAX(C2:C3)" }, { f: 'IF(D4>1000;"liels";"mazs")' }],
	];
	const s2 = [{ name: "Kopsavilkums", rows: [[{ f: "Tāme!D6" }, { f: "'Tāme'!D4*2" }, { f: "SUMPRODUCT(Tāme!B2:B3;Tāme!C2:C3)" }]] }];
	const r = evaluateWorkbook([{ name: "Tāme", rows }, ...s2]);
	assert.deepEqual(r.errors, []);
	assert.equal(r.values.get("Tāme!D2"), 230);
	assert.equal(r.values.get("Tāme!D4"), 1070);
	assert.equal(r.values.get("Tāme!D5"), 224.7);
	assert.equal(Math.round((r.values.get("Tāme!D6") as number) * 100) / 100, 1294.7);
	assert.equal(r.values.get("Tāme!B7"), 8.25);
	assert.equal(r.values.get("Tāme!D7"), "liels");
	assert.equal(r.values.get("Kopsavilkums!A1"), r.values.get("Tāme!D6"), "a reference to another sheet");
	assert.equal(r.values.get("Kopsavilkums!B1"), 2140);
	assert.equal(r.values.get("Kopsavilkums!C1"), 1070);
	const bad = evaluateWorkbook([{ name: "A", rows: [[1, 0, { f: "A1/B1" }, { f: "D1+1" }, { f: "NOPE(1)" }, { f: "Z9+Y9" }, { f: "SQRT(-1)" }, { f: "IFERROR(A1/B1;0)" }]] }]);
	const by = new Map(bad.errors.map((e) => [e.cell, e.reason]));
	assert.match(by.get("A!C1") ?? "", /division by zero/);
	assert.match(by.get("A!D1") ?? "", /circular/);
	assert.match(by.get("A!E1") ?? "", /unsupported function NOPE/);
	assert.match(by.get("A!G1") ?? "", /negative/);
	assert.equal(bad.values.get("A!F1"), 0, "an empty cell counts as 0");
	assert.equal(bad.values.get("A!H1"), 0, "IFERROR");
});

test("writeXlsx with formulas: cached values, fullCalcOnLoad, and the text reader sees the totals", () => {
	const bytes = writeXlsx([{ name: "Tāme", rows: [["A", "B"], [2, { f: "A2*3" }], ["kopā", { f: "SUM(B2:B2)" }]], header: false }]);
	const files = unzipSync(bytes);
	const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
	assert.match(sheet, /<c r="B2"><f>A2\*3<\/f><v>6<\/v><\/c>/);
	assert.match(strFromU8(files["xl/workbook.xml"]!), /fullCalcOnLoad="1"/);
	assert.doesNotMatch(sheet, /<pane /, "header: false has no frozen first row");
	const s = xlsxSheets(bytes)[0]!;
	assert.equal(s.rows.get(3)?.get("B"), "6");
	// the old callers (plain cells) are unchanged
	const plain = xlsxSheets(writeXlsx([{ name: "x", rows: [["a", "b"], [1, "z"]] }]))[0]!;
	assert.equal(plain.rows.get(2)?.get("A"), "1");
});

test("write_spreadsheet: computes and returns the results, refuses a formula with an error, never overwrites", async () => {
	const dir = tmp("pj-ss-");
	const t = tool("write_spreadsheet");
	const r = (await t.run(ctxOf(dir), { name: "tame", sheets: [{ name: "Lapa1", rows: [["Nosaukums", "Skaits", "Cena", "Summa"], ["Siena", 3, 10.5, "=B2*C2"], ["Kopā", "", "", "=SUM(D2:D2)"]] }] })) as { ok: boolean; file: string; formulas: number; results: string[] };
	assert.equal(r.formulas, 2);
	assert.deepEqual(r.results, ["Lapa1!D2 = 31.5", "Lapa1!D3 = 31.5"]);
	assert.ok(existsSync(r.file) && r.file.startsWith(join(dir, "agent-work")));
	assert.equal(xlsxSheets(new Uint8Array(readFileSync(r.file)))[0]!.rows.get(3)?.get("D"), "31.5");
	await assert.rejects(t.run(ctxOf(dir), { name: "slikta", sheets: [{ name: "A", rows: [[1, 0, "=A1/B1"]] }] }), /nekas nav saglabāts.*division by zero/s);
	await assert.rejects(t.run(ctxOf(dir), { name: "x", sheets: [{ name: "A/B", rows: [[1]] }] }), /Lapas nosaukums/);
	const again = (await t.run(ctxOf(dir), { name: "tame", sheets: [{ name: "Lapa1", rows: [[1]] }] })) as { file: string };
	assert.notEqual(again.file, r.file, "a second file with the same name gets a new name");
});

// ---- archives --------------------------------------------------------------------------------------------------------------------------

/** A tar file built by hand (ustar), for the reader. */
function tar(files: Record<string, string>): Uint8Array {
	const blocks: Uint8Array[] = [];
	for (const [name, text] of Object.entries(files)) {
		const body = strToU8(text);
		const h = new Uint8Array(512);
		h.set(strToU8(name).subarray(0, 100), 0);
		h.set(strToU8(`${body.length.toString(8).padStart(11, "0")}\0`), 124);
		h[156] = name.endsWith("/") ? 53 : 48;
		h.set(strToU8("ustar\0"), 257);
		blocks.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
	}
	blocks.push(new Uint8Array(1024));
	const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
	let o = 0;
	for (const b of blocks) {
		out.set(b, o);
		o += b.length;
	}
	return out;
}

test("archives: zip, tar, tgz, gz listed and unpacked into a new folder; a path that leaves the folder is refused", async () => {
	const dir = tmp("pj-arc-");
	const zip = join(dir, "dati.zip");
	writeFileSync(zip, zipSync({ "a.txt": strToU8("viens"), "mape/b.txt": strToU8("divi"), "../ārā.txt": strToU8("nē"), "c:/win.txt": strToU8("nē") }));
	assert.equal(archiveKind(zip), "zip");
	const l = await listArchive(zip);
	assert.deepEqual(l.entries.map((e) => e.name).sort(), ["../ārā.txt", "a.txt", "c:/win.txt", "mape/b.txt"]);
	const out = uniquePath(dir, "dati");
	const r = await extractArchive(zip, out);
	assert.equal(r.files, 2);
	assert.equal(readFileSync(join(out, "mape", "b.txt"), "utf8"), "divi");
	assert.equal(r.skipped.length, 2);
	assert.ok(!existsSync(join(dir, "ārā.txt")));
	const only = await extractArchive(zip, uniquePath(dir, "dati"), ["a.txt"]);
	assert.equal(only.files, 1);

	const t = tar({ "x/": "", "x/y.txt": "tar saturs", "z.md": "# z" });
	assert.deepEqual(readTar(t).map((e) => e.name), ["x/", "x/y.txt", "z.md"]);
	const tgz = join(dir, "k.tgz");
	writeFileSync(tgz, gzipSync(t));
	assert.equal((await listArchive(tgz)).kind, "tar.gz");
	const o2 = await extractArchive(tgz, uniquePath(dir, "k"));
	assert.equal(o2.files, 2);
	const gz = join(dir, "dati.csv.gz");
	writeFileSync(gz, gzipSync(strToU8("a;b\n1;2\n")));
	const lg = await listArchive(gz);
	assert.deepEqual(lg.entries.map((e) => e.name), ["dati.csv"]);
	const og = uniquePath(dir, "gz");
	await extractArchive(gz, og);
	assert.equal(readFileSync(join(og, "dati.csv"), "utf8"), "a;b\n1;2\n");
	assert.equal(archiveKind("a.7z"), "other");
	assert.equal(safeJoin(dir, "a/../../b"), null);
	assert.equal(safeJoin(dir, "ok/b.txt"), join(dir, "ok", "b.txt"));
	assert.equal(cleanName("a<b>:c.d. "), "a_b__c.d");
	assert.equal(workDirOf("C:\\app", null), join("C:\\app", "agent-work", "general"));
});

test("archive tools: archive_list and archive_extract on a zip; the unpacked files are readable afterwards", async () => {
	const dir = tmp("pj-arct-");
	const zip = join(dir, "pielikumi.zip");
	writeFileSync(zip, zipSync({ "p1/tabula.csv": strToU8("a;b\n1;2\n"), "p1/piezimes.txt": strToU8("teksts") }));
	const l = (await tool("archive_list").run(ctxOf(dir), { path: zip })) as { entries: number; files: number; list: string[] };
	assert.equal(l.files, 2);
	const x = (await tool("archive_extract").run(ctxOf(dir), { path: zip })) as { folder: string; files: number };
	assert.equal(x.files, 2);
	assert.ok(x.folder.startsWith(join(dir, "agent-work", "general")));
	assert.equal(readFileSync(join(x.folder, "p1", "piezimes.txt"), "utf8"), "teksts");
	await assert.rejects(tool("archive_list").run(ctxOf(dir), { path: join(dir, "nav.zip") }), /Faila nav/);
});

// ---- images and regions ----------------------------------------------------------------------------------------------------------------

test("regions: fractions are checked and trimmed to the picture", () => {
	assert.deepEqual(cleanRegion({ x: 0.5, y: 0, w: 1, h: 0.5 }), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
	assert.equal(cleanRegion(undefined), undefined);
	assert.throws(() => cleanRegion({ x: 1.2, y: 0, w: 0.5, h: 0.5 }), /region/);
	assert.throws(() => cleanRegion({ x: 0, y: 0, w: 0, h: 0.5 }), /region/);
	assert.throws(() => cleanRegion({ x: "a" }), /region/);
});

/** A stand-in for nativeImage: a W×H picture that remembers what was done to it. */
function fakeNative(w: number, h: number, log: string[]): NativeLike {
	const make = (W: number, H: number): ReturnType<NativeLike["createFromBuffer"]> => ({
		isEmpty: () => false,
		getSize: () => ({ width: W, height: H }),
		crop: (r) => {
			log.push(`crop ${r.x},${r.y} ${r.width}x${r.height}`);
			return make(r.width, r.height);
		},
		resize: (o) => {
			log.push(`resize ${o.width ?? ""}x${o.height ?? ""}`);
			return o.width ? make(o.width, Math.round((H * o.width) / W)) : make(Math.round((W * o.height!) / H), o.height!);
		},
		toPNG: () => Buffer.from("png"),
		toJPEG: () => Buffer.from("jpg"),
	});
	return { createFromBuffer: () => make(w, h) };
}

test("viewImage: a whole small picture passes through; a part is cropped; a big one is reduced; a PDF part goes to the page renderer with its region", async () => {
	const dir = tmp("pj-img-");
	const png = join(dir, "foto.png");
	writeFileSync(png, Buffer.from("not really a png"));
	const log: string[] = [];
	const renderer = {
		render: async () => [],
		renderRegion: async (_b: Uint8Array, page: number, scale: number, region: unknown, maxSide: number) => {
			log.push(`pdf ${page} ${scale} ${JSON.stringify(region)} ${maxSide}`);
			return { png: new Uint8Array([1]), width: 10, height: 20, scale };
		},
	};
	const same = await viewImage({ renderer: renderer as never, native: fakeNative(800, 600, log) }, { path: png });
	assert.equal(same.mimeType, "image/png");
	assert.equal(same.image, Buffer.from("not really a png").toString("base64"));
	assert.deepEqual(log, []);
	const part = await viewImage({ renderer: renderer as never, native: fakeNative(4000, 3000, log) }, { path: png, region: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } });
	assert.deepEqual(log, ["crop 2000,750 2000x1500"], "the crop is in picture pixels; a part under the long-side limit is not reduced");
	assert.equal(part.width, 2000);
	log.length = 0;
	const big = await viewImage({ renderer: renderer as never, native: fakeNative(6000, 4000, log) }, { path: png });
	assert.deepEqual(log, ["resize 2000x"]);
	assert.equal(big.width, 2000);
	assert.equal(big.height, Math.round((4000 * 2000) / 6000));
	log.length = 0;
	const pdf = join(dir, "a.pdf");
	writeFileSync(pdf, Buffer.from("%PDF-1.4"));
	const z = await viewImage({ renderer: renderer as never }, { path: pdf, page: 3, region: { x: 0, y: 0, w: 0.3, h: 0.3 } });
	assert.deepEqual(log, ['pdf 3 4 {"x":0,"y":0,"w":0.3,"h":0.3} 3000']);
	assert.equal(z.page, 3);
	await assert.rejects(viewImage({ renderer: renderer as never }, { path: join(dir, "x.tif") }), /view_image/);
});

// ---- drawings and clouds ---------------------------------------------------------------------------------------------------------------

test("cad_describe / cad_objects: layers, sheets, text found by a word, totals, one object in full, a drawing read from DXF", { skip: !hasCad }, async () => {
	const dir = tmp("pj-cad-");
	const ctx = ctxOf(dir);
	const dwg = join(SAMPLES, "sample-house.dwg");
	const d = (await tool("cad_describe").run(ctx, { path: dwg })) as { objects: number; layers: { name: string }[]; layouts: { name: string }[] };
	assert.equal(d.objects, 72);
	assert.ok(d.layers.length >= 10 && d.layouts.length === 4);
	const hit = (await tool("cad_objects").run(ctx, { path: dwg, type: "text", text: "living" })) as { total: number; objects: { s: string; id: number; description?: string }[] };
	assert.equal(hit.total, 1);
	assert.equal(hit.objects[0]!.s, "LIVING");
	assert.equal(hit.objects[0]!.description, undefined, "no translation key in the answer");
	const counts = (await tool("cad_objects").run(ctx, { path: dwg, countOnly: true })) as { total: number; byType: Record<string, number> };
	assert.equal(counts.total, 72);
	assert.equal(counts.byType.text, 23);
	const full = (await tool("cad_objects").run(ctx, { path: dwg, id: hit.objects[0]!.id })) as { s: string };
	assert.equal(full.s, "LIVING");
	await assert.rejects(tool("cad_objects").run(ctx, { path: dwg, id: 99999 }), /nav/);
	const dxf = (await tool("cad_describe").run(ctx, { path: join(SAMPLES, "sample-asbuilt.dxf") })) as { format: string; objects: number };
	assert.match(dxf.format, /^DXF/);
	assert.equal(dxf.objects, 549);
});

test("convert_file: DWG → PDF / SVG / DXF (the DXF reads back), DXF → DWG, a CSV ↔ XLSX round trip, an unsupported pair says so", { skip: !hasCad }, async () => {
	const dir = tmp("pj-conv-");
	const ctx = ctxOf(dir);
	const conv = (a: object) => tool("convert_file").run(ctx, a) as Promise<{ files: string[] }>;
	const dwg = join(SAMPLES, "sample-house.dwg");
	const pdf = await conv({ path: dwg, to: "pdf", layout: "A-101 FLOOR PLAN" });
	assert.match(readFileSync(pdf.files[0]!).subarray(0, 5).toString(), /%PDF-/);
	assert.match(pdf.files[0]!, /agent-work/);
	const svg = await conv({ path: dwg, to: "svg" });
	assert.match(readFileSync(svg.files[0]!, "utf8"), /<svg/);
	const dxf = await conv({ path: dwg, to: "dxf" });
	const back = (await tool("cad_describe").run(ctx, { path: dxf.files[0]! })) as { objects: number; layers: unknown[] };
	assert.ok(back.objects > 50 && back.layers.length >= 10, `the DXF CadCraft wrote reads back (${back.objects} objects)`);
	const dwg2 = await conv({ path: join(SAMPLES, "sample-asbuilt.dxf"), to: "dwg" });
	const back2 = (await tool("cad_describe").run(ctx, { path: dwg2.files[0]! })) as { objects: number };
	assert.equal(back2.objects, 549);
	await assert.rejects(conv({ path: dwg, to: "dwg" }), /jau ir/);
	const csv = join(dir, "dati.csv");
	writeFileSync(csv, 'Nr;Nosaukums;Platība\n1;Virtuve;12,5\n2;"Gaitenis; liels";8\n', "utf8");
	const x = await conv({ path: csv, to: "xlsx" });
	const s = xlsxSheets(new Uint8Array(readFileSync(x.files[0]!)))[0]!;
	assert.equal(s.rows.get(2)?.get("C"), "12.5");
	assert.equal(s.rows.get(3)?.get("B"), "Gaitenis; liels");
	const c2 = await conv({ path: x.files[0]!, to: "csv" });
	assert.match(readFileSync(c2.files[0]!, "utf8"), /2;"Gaitenis; liels";8/);
	await assert.rejects(conv({ path: csv, to: "dwg" }), /nav atbalstīts/);
});

test("pointcloud_info: the header of a LAS file; a LAZ flag; a file that is not LAS is refused", async () => {
	const b = Buffer.alloc(227);
	b.write("LASF", 0);
	b[24] = 1;
	b[25] = 2;
	b.writeUInt16LE(227, 94);
	b.writeUInt32LE(227, 96);
	b[104] = 1;
	b.writeUInt16LE(28, 105);
	b.writeUInt32LE(123456, 107);
	for (const [o, v] of [[131, 0.001], [139, 0.001], [147, 0.001], [155, 100], [163, 200], [171, 3], [179, 150.5], [187, 100.5], [195, 250], [203, 200], [211, 40], [219, 3]] as [number, number][]) b.writeDoubleLE(v, o);
	const h = lasHeader(new Uint8Array(b)) as { format: string; points: number; bounds: { maxX: number; minZ: number } };
	assert.equal(h.format, "LAS 1.2");
	assert.equal(h.points, 123456);
	assert.equal(h.bounds.maxX, 150.5);
	assert.equal(h.bounds.minZ, 3);
	b[104] = 0x81;
	assert.match((lasHeader(new Uint8Array(b)) as { format: string }).format, /LAZ/);
	assert.throws(() => lasHeader(new Uint8Array(300)), /LAS/);
	const dir = tmp("pj-las-");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "mak.las"), b);
	const r = (await tool("pointcloud_info").run(ctxOf(dir), { path: join(dir, "mak.las") })) as { points: number; mb: number };
	assert.equal(r.points, 123456);
	await assert.rejects(tool("pointcloud_info").run(ctxOf(dir), { path: join(dir, "x.e57") }), /Faila nav/);
});
