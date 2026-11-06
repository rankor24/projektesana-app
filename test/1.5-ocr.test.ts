// 1.5 OCR in Latvian: the fixture is an image-only PDF of invented Latvian text with every diacritic (made by
// scripts/make-fixtures.mjs from test/fixtures/src/scan-lv.image.html). No text layer: pdfjs reads nothing from it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pdfText } from "../src/sources/text/pdf.ts";
import { Ocr } from "../src/sources/text/ocr.ts";
import { FIX } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const SCAN = join(FIX, "scan-lv.pdf");
const WORDS = ["Izdomātā", "būvvalde", "saskaņo", "Ēkas", "īpašnieks", "Kļaviņš", "ģeoloģiskā", "Ļoti", "ņemt", "Čuguna", "žogs", "jāsaglabā", "Mūra", "Ķieģeļu", "Ķekavā"];
const LETTERS = ["ā", "č", "ē", "ģ", "ī", "ķ", "ļ", "ņ", "š", "ū", "ž"];

const tessdata = join(ROOT, "resources", "tessdata");
if (!existsSync(join(tessdata, "lav.traineddata.gz"))) execFileSync(process.execPath, [join(ROOT, "scripts", "fetch-ocr-data.mjs")], { stdio: "inherit" });

test("the scanned fixture has no text layer", async () => {
	const r = await pdfText(SCAN);
	assert.deepEqual(r.emptyPages, [1]);
});

test("OCR of the scanned page image reads the Latvian words and every diacritic", async () => {
	const pdf = readFileSync(SCAN);
	const jpeg = pdf.subarray(pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff])), pdf.lastIndexOf(Buffer.from([0xff, 0xd9])) + 2);
	const ocr = new Ocr(tessdata);
	try {
		const r = await ocr.recognize(jpeg);
		for (const w of WORDS) assert.ok(r.text.includes(w), `missing "${w}" in:\n${r.text}`);
		for (const l of LETTERS) assert.ok(r.text.toLocaleLowerCase("lv").includes(l), `missing letter ${l}`);
		assert.ok(r.confidence > 80);
	} finally {
		await ocr.close();
	}
});

test("in Electron: the offscreen renderer rasterises the PDF page and OCR reads it", { timeout: 120_000 }, () => {
	// the check runs the app's built modules
	if (!existsSync(join(ROOT, "dist", "main", "offscreen.js")) || !existsSync(join(ROOT, "dist", "sources", "text", "ocr.js"))) execFileSync("npx", ["tsc", "-p", "tsconfig.main.json"], { cwd: ROOT, shell: true, stdio: "inherit" });
	if (!existsSync(join(ROOT, "dist", "renderer", "offscreen", "render.html"))) execFileSync("npx", ["vite", "build"], { cwd: ROOT, shell: true, stdio: "inherit" });
	const electron = join(ROOT, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
	const r = spawnSync(electron, [join(ROOT, "scripts", "ocr-check.mjs"), SCAN, "1"], { cwd: ROOT, encoding: "utf8", timeout: 110_000 });
	const line = r.stdout.split("\n").find((l) => l.startsWith("OCR_RESULT ") || l.startsWith("OCR_ERROR "));
	assert.ok(line, `no result from Electron: ${r.stdout}\n${r.stderr}`);
	assert.ok(line.startsWith("OCR_RESULT "), line);
	const { pages } = JSON.parse(line.slice("OCR_RESULT ".length)) as { pages: { text: string; confidence: number }[] };
	for (const w of WORDS) assert.ok(pages[0].text.includes(w), `missing "${w}" in:\n${pages[0].text}`);
});

test("pipeline: a scanned annex ends with state ocr and its Latvian text cached per sha", async () => {
	const { copyFileSync } = await import("node:fs");
	const { Registry } = await import("../src/core/registry.ts");
	const { scanProject } = await import("../src/sources/pipeline.ts");
	const { makeProjectTree } = await import("./project-tree.ts");
	const { tmp } = await import("./helpers.ts");
	const t = makeProjectTree(tmp());
	copyFileSync(SCAN, join(t.inputs, "1.1.2_Ipasuma dok", "Pielikums Nr.3.pdf"));
	const app = tmp();
	const reg = new Registry(join(app, "projects.json"), join(app, "projects"));
	reg.add(t.root);
	const store = reg.store("BD999");
	const ocr = new Ocr(tessdata);
	try {
		// this test's page image source: the JPEG a scanner put on the page (the app renders the page instead, in Electron)
		await scanProject(store, () => {}, {
			ocr: async (bytes, pages) => {
				const b = Buffer.from(bytes());
				const jpeg = b.subarray(b.indexOf(Buffer.from([0xff, 0xd8, 0xff])), b.lastIndexOf(Buffer.from([0xff, 0xd9])) + 2);
				return new Map([[pages[0], (await ocr.recognize(jpeg)).text]]);
			},
		});
	} finally {
		await ocr.close();
	}
	const s = store.read("sources").find((x) => x.paths[0]?.endsWith("Pielikums Nr.3.pdf"))!;
	const v = s.versions[0];
	assert.equal(v.textState, "ocr");
	assert.match(v.textReason ?? "", /OCR: lpp. 1/);
	assert.ok(store.readText(v.sha256)!.pages[0].includes("Kļaviņš"));
});
