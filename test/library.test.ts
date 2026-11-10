import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../src/main/library/library.ts";
import { pdf } from "./helpers.ts";

const snapshots = join(import.meta.dirname, "..", "data", "law-snapshots");
const tmp = () => mkdtempSync(join(tmpdir(), "bvlib-"));

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


test("LVS references are found in the saved likumi.lv texts, each with its paragraph", () => {
	const lvs = new Library(tmp(), snapshots).references("lvs");
	assert.ok(lvs.some((r) => r.ref.startsWith("LVS 190-1")), lvs.map((r) => r.ref).join(", "));
});
