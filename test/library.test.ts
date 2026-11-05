import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library, htmlToParagraphs, titleOf } from "../src/main/library/library.ts";
import * as tools from "../src/mcp/tools.ts";
import { createProject } from "../src/kernel/project.ts";
import { pdf } from "./helpers.ts";

const snapshots = join(import.meta.dirname, "..", "data", "law-snapshots");
const dataDir = join(import.meta.dirname, "..", "data");
const tmp = () => mkdtempSync(join(tmpdir(), "bvlib-"));

const LBN201 = `<html><head><title>Noteikumi par LBN 201-15 &quot;Būvju ugunsdrošība&quot;</title></head><body>
<nav>izvēlne</nav><p>1. Noteikumi nosaka būvju ugunsdrošības prasības.</p>
<p>5. Evakuācijas ceļa platums nav mazāks par 1,0 m, ja to paredz 7.<sup>1</sup> punkts.</p>
<p>9. Prasības izpilda atbilstoši standartam LVS EN 13501-1:2019 un regulai (ES) Nr. 305/2011.</p></body></html>`;

test("html → paragraphs: navigation dropped, inline tags do not split 7.1, title read", () => {
	const p = htmlToParagraphs(LBN201);
	assert.ok(!p.some((x) => x.includes("izvēlne")));
	assert.ok(p.some((x) => x.includes("ja to paredz 7.1 punkts.")));
	assert.equal(titleOf(LBN201), 'Noteikumi par LBN 201-15 &quot;Būvju ugunsdrošība&quot;'.replace(/&quot;/g, "&quot;"));
});

test("add by link: saved with read date, searchable with citation; same text twice is refused; https only", async () => {
	const lib = new Library(tmp(), snapshots);
	const s = await lib.addUrl("https://likumi.lv/ta/id/999", "mk", async () => LBN201);
	assert.equal(s.kind, "url");
	assert.equal(s.readOn, new Date().toISOString().slice(0, 10));
	assert.ok(lib.list("mk").some((x) => x.id === s.id));
	// built-in MK texts may match too; the added source must be among the hits with its citation
	const hits = lib.search("evakuācijas ceļa platums nav mazāks", { category: "mk" }).filter((h) => h.source === s.id);
	assert.equal(hits.length, 1);
	assert.equal(hits[0].url, "https://likumi.lv/ta/id/999");
	assert.equal(hits[0].readOn, s.readOn);
	await assert.rejects(lib.addUrl("https://likumi.lv/ta/id/1000", "mk", async () => LBN201), /jau ir bibliotēkā/);
	await assert.rejects(lib.addUrl("http://likumi.lv/x", "mk", async () => LBN201), /https/);
});

test("add a PDF file (an LVS standard Boris owns): text extracted, original copy kept", async () => {
	const dir = tmp();
	const f = join(dir, "LVS EN 1991-1-1.pdf");
	writeFileSync(f, pdf("BT /F1 12 Tf 10 700 Td (Darbibas uz konstrukcijam. Pasvars un lietderigas slodzes.) Tj ET"));
	const lib = new Library(join(dir, "lib"), snapshots);
	const s = await lib.addFile(f, "lvs");
	assert.equal(s.title, "LVS EN 1991-1-1");
	assert.ok(lib.originalFile(s.id));
	assert.equal(lib.search("lietderigas slodzes", { category: "lvs" }).length, 1);
});

test("a PDF with no text layer is refused with a reason, not added empty", async () => {
	const dir = tmp();
	const f = join(dir, "scan.pdf");
	writeFileSync(f, pdf("100 100 400 300 re S"));
	await assert.rejects(new Library(join(dir, "lib"), snapshots).addFile(f, "lvs"), /skenēts PDF/);
});

test("built-in likumi.lv texts are listed per panel and searchable; they cannot be removed", () => {
	const lib = new Library(tmp(), snapshots);
	assert.deepEqual(lib.list("likums").map((s) => s.id), ["builtin-258572", "builtin-72608"]);
	assert.equal(lib.list("mk").length, 4);
	assert.ok(lib.search("Pārējos gadījumos būvprojektu minimālā sastāvā").some((h) => h.title.startsWith("MK 529")));
	assert.throws(() => lib.remove("builtin-258572"), /Iebūvētos/);
});

test("LVS and EU references are found in the texts already read, each with its paragraph", async () => {
	const lib = new Library(tmp(), snapshots);
	const lvs = lib.references("lvs");
	assert.ok(lvs.some((r) => r.ref.startsWith("LVS 190-1")), lvs.map((r) => r.ref).join(", "));
	await lib.addUrl("https://likumi.lv/ta/id/999", "mk", async () => LBN201);
	assert.ok(lib.references("lvs").some((r) => r.ref === "LVS EN 13501-1:2019"));
	assert.ok(lib.references("es").some((r) => r.ref.includes("305/2011")));
});

test("re-read: unchanged text keeps the version; changed text keeps the old file beside the new", async () => {
	const dir = tmp();
	const lib = new Library(dir, snapshots);
	const s = await lib.addUrl("https://likumi.lv/ta/id/999", "mk", async () => LBN201);
	assert.equal((await lib.reread(s.id, async () => LBN201)).changed, false);
	const r = await lib.reread(s.id, async () => LBN201.replace("1,0 m", "1,2 m"));
	assert.equal(r.changed, true);
	assert.equal(lib.search("1,2 m").filter((h) => h.source === s.id).length, 1);
	assert.ok(readdirSync(dir).some((f) => f.startsWith(`${s.id}.`) && f !== `${s.id}.txt`));
	await assert.rejects(lib.reread("builtin-258572", async () => ""), /saiti/);
});

test("removing hides the source from panels and agent search; its files stay", async () => {
	const dir = tmp();
	const lib = new Library(dir, snapshots);
	const s = await lib.addUrl("https://likumi.lv/ta/id/999", "mk", async () => LBN201);
	lib.remove(s.id);
	assert.ok(!lib.list().some((x) => x.id === s.id));
	assert.equal(lib.search("evakuācijas platums").filter((h) => h.source === s.id).length, 0);
	assert.ok(existsSync(join(dir, `${s.id}.txt`)));
});

test("agent tool search_sources returns verbatim paragraphs with source and read date, and says what exists when nothing matches", async () => {
	const root = tmp();
	createProject(root, "T");
	const libDir = tmp();
	await new Library(libDir, snapshots).addUrl("https://likumi.lv/ta/id/999", "mk", async () => LBN201);
	const ctx = { root, engine: "pi", dataDir, libraryDir: libDir };
	const hits = (await tools.searchSources(ctx, "evakuācijas ceļa platums")) as { paragraph: string; readOn: string; url: string }[];
	assert.match(hits[0].paragraph, /Evakuācijas ceļa platums/);
	assert.ok(hits[0].readOn && hits[0].url);
	assert.match(String(await tools.searchSources(ctx, "kosmosa lifts")), /Nekas neatrasts.*Būvniecības likums/);
});
