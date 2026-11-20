// 5.6 drawing sets (Versijas → Lapu izmaiņas) and the Revit file list: PDF and DWG of the project folder grouped by drawing,
// one version chain per kind, the PDF = DWG check, Revit backups left out, and which listed .rvt is the one open in Revit.
// Invented tree, invented bytes, invented dates.
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ModelRow } from "../src/shared/api.ts";
import { drawingSets, isRevitBackup, lastPair, openRevitMatch, revOf, seriesKey } from "../src/shared/drawing-sets.ts";
import { listModels, listProjectFiles } from "../src/sources/models.ts";
import { tmp } from "./helpers.ts";

const row = (name: string, mtime: string, section = "AR"): ModelRow => ({ rel: `01_Projektesana\\1.2_Projekta dalas\\${section}\\${name}`, name, section, size: 1, mtime, origin: "projekta daļas", archived: false });

test("revision suffix: the number, none = first issue; the drawing key drops it", () => {
	assert.equal(revOf("DUN8_AR_00001_02"), 2);
	assert.equal(revOf("Plans_v3"), 3);
	assert.equal(revOf("DUN8_AR_00001"), 0);
	assert.equal(revOf("AR-3"), 0);
	assert.equal(seriesKey("DUN8_AR_00001_02"), seriesKey("DUN8_AR_00001"));
});

test("PDF chains with PDF, DWG with DWG; the newest of both is the same issue", () => {
	const sets = drawingSets([
		row("DUN8_AR_00001_01.pdf", "2026-10-01T10:00:00.000Z"),
		row("DUN8_AR_00001_02.pdf", "2026-11-01T10:00:00.000Z"),
		row("DUN8_AR_00001_01.dwg", "2026-10-01T09:00:00.000Z"),
		row("DUN8_AR_00001_02.dwg", "2026-11-01T09:30:00.000Z"),
		row("DUN8_AR_00001.ifc", "2026-11-01T09:30:00.000Z"),
	]);
	assert.equal(sets.length, 1, "the IFC is not a drawing");
	const s = sets[0]!;
	assert.equal(s.title, "DUN8_AR_00001");
	assert.deepEqual(s.pdf.map((f) => f.name), ["DUN8_AR_00001_01.pdf", "DUN8_AR_00001_02.pdf"]);
	assert.deepEqual(s.dwg.map((f) => f.name), ["DUN8_AR_00001_01.dwg", "DUN8_AR_00001_02.dwg"]);
	assert.equal(s.state, "sakrīt");
	assert.deepEqual(lastPair(s.pdf)?.map((f) => f.name), ["DUN8_AR_00001_01.pdf", "DUN8_AR_00001_02.pdf"]);
});

test("order is by revision suffix, not by date: a re-saved _01 stays before _02", () => {
	const s = drawingSets([row("X_00001_02.pdf", "2026-10-01T00:00:00.000Z"), row("X_00001_01.pdf", "2026-11-05T00:00:00.000Z")])[0]!;
	assert.deepEqual(s.pdf.map((f) => f.rev), [1, 2]);
});

test("PDF = DWG: versions differ, DWG changed after the plot, one kind only", () => {
	const differ = drawingSets([row("A_00001_02.pdf", "2026-11-01T10:00:00.000Z"), row("A_00001_01.dwg", "2026-10-01T10:00:00.000Z")])[0]!;
	assert.equal(differ.state, "versijas nesakrīt");
	assert.match(differ.why, /PDF _02, jaunākais DWG _01/);
	const newer = drawingSets([row("B_00001_01.pdf", "2026-11-01T10:00:00.000Z"), row("B_00001_01.dwg", "2026-11-03T10:00:00.000Z")])[0]!;
	assert.equal(newer.state, "DWG jaunāks");
	const sameHour = drawingSets([row("C_00001_01.pdf", "2026-11-01T10:00:00.000Z"), row("C_00001_01.dwg", "2026-11-01T10:40:00.000Z")])[0]!;
	assert.equal(sameHour.state, "sakrīt", "a DWG saved within the hour of its plot is the same issue");
	assert.equal(drawingSets([row("D_00001.pdf", "2026-11-01T10:00:00.000Z")])[0]!.state, "tikai PDF");
	assert.equal(drawingSets([row("E_00001.dwg", "2026-11-01T10:00:00.000Z")])[0]!.state, "tikai DWG");
});

test("drawings with versions are listed first", () => {
	const sets = drawingSets([row("A_single.pdf", "2026-11-01T10:00:00.000Z"), row("Z_00001_01.pdf", "2026-10-01T10:00:00.000Z"), row("Z_00001_02.pdf", "2026-11-01T10:00:00.000Z")]);
	assert.deepEqual(sets.map((s) => s.title), ["Z_00001", "A_single"]);
});

test("Revit backups are not models", () => {
	assert.equal(isRevitBackup("DUN8_AR.0003.rvt"), true);
	assert.equal(isRevitBackup("DUN8_AR.rvt"), false);
	assert.equal(isRevitBackup("DUN8_AR_2026.rvt"), false);
});

test("the open Revit document: by its path, by name only (local copy), or none", () => {
	const root = "E:\\P\\BD900";
	const rows = [{ rel: "01_Projektesana\\1.2_Projekta dalas\\AR\\BD900_AR.rvt", name: "BD900_AR.rvt" }];
	assert.deepEqual(openRevitMatch(rows, root, { title: "BD900_AR", path: "e:/p/bd900/01_Projektesana/1.2_Projekta dalas/AR/BD900_AR.rvt" }), { rel: rows[0]!.rel, by: "path" });
	assert.deepEqual(openRevitMatch(rows, root, { title: "BD900_AR_boriss", path: "C:\\Users\\boriss\\Documents\\BD900_AR_boriss.rvt" }), { rel: rows[0]!.rel, by: "name" });
	assert.equal(openRevitMatch(rows, root, { title: "Cits", path: "C:\\Cits.rvt" }), null);
	assert.equal(openRevitMatch(rows, root, null), null);
});

test("one folder walk for every kind: PDF, DWG and RVT found where the IFC are found", async () => {
	const root = tmp();
	const put = (rel: string, mtime?: string) => {
		const f = join(root, ...rel.split("/"));
		mkdirSync(join(f, ".."), { recursive: true });
		writeFileSync(f, "x");
		if (mtime) utimesSync(f, new Date(mtime), new Date(mtime));
	};
	put("01_Projektesana/1.2_Projekta dalas/AR/02_DWG/BD900_AR_00001_01.dwg");
	put("01_Projektesana/1.2_Projekta dalas/AR/03_PDF/BD900_AR_00001_01.pdf");
	put("01_Projektesana/1.2_Projekta dalas/AR/03_PDF/Arhīvs/BD900_AR_00001.pdf");
	put("01_Projektesana/1.2_Projekta dalas/AR/01_RVT/BD900_AR.rvt");
	put("01_Projektesana/1.2_Projekta dalas/AR/01_RVT/BD900_AR.0001.rvt");
	put("01_Projektesana/1.2_Projekta dalas/AR/04_IFC/BD900_AR.ifc");
	const sheets = await listProjectFiles(root, [".pdf", ".dwg"]);
	assert.deepEqual(sheets.map((f) => f.name).sort(), ["BD900_AR_00001.pdf", "BD900_AR_00001_01.dwg", "BD900_AR_00001_01.pdf"]);
	assert.equal(sheets.find((f) => f.name === "BD900_AR_00001.pdf")?.archived, true);
	const sets = drawingSets(sheets);
	assert.equal(sets.length, 1);
	assert.equal(sets[0]!.pdf.length, 2, "the archived first issue is the start of the PDF chain");
	const rvt = await listProjectFiles(root, [".rvt"]);
	assert.deepEqual(rvt.map((f) => f.name).filter((n) => !isRevitBackup(n)), ["BD900_AR.rvt"]);
	assert.deepEqual((await listModels(root)).map((f) => f.name), ["BD900_AR.ifc"], "listModels still lists only IFC");
});
