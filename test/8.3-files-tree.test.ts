// 8.3 the Faili tab's data: one level at a time, folders first with the files below them, junk hidden, the scan's role laid
// over folders and files, files inside an .edoc listed under it, names searched with diacritics folded, nothing outside
// the root. Invented tree and invented sources.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Source } from "../src/core/model.ts";
import { buildOverlay, insideBase, listDirectory, relKey, searchTree } from "../src/sources/tree.ts";
import { tmp } from "./helpers.ts";

const put = (root: string, rel: string, body = "x") => {
	const f = join(root, ...rel.split("/"));
	mkdirSync(join(f, ".."), { recursive: true });
	writeFileSync(f, body);
};

const O = "01_Projektesana/1.1_Izejas dati";
function office() {
	const root = tmp();
	put(root, `${O}/1.1.1_Pasūtījums/Uzdevums.pdf`, "%PDF-1.4 uzdevums");
	put(root, `${O}/1.1.2_Tehniskie noteikumi/TN_ŪK.edoc`, "zip");
	put(root, `${O}/1.1.3_Foto/261013_AA/a.jpg`);
	put(root, `${O}/1.1.3_Foto/261013_AA/b.jpg`);
	put(root, `${O}/1.1.3_Foto/261013_AA/c.jpg`);
	put(root, `${O}/1.1.3_Foto/Thumbs.db`);
	put(root, `${O}/1.1.1_Pasūtījums/~$Uzdevums.docx`);
	put(root, "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/BD900_AR.ifc");
	put(root, "00_Vadiba/Piezimes.txt");
	return root;
}

const src = (id: string, paths: string[], role: string, container?: Source["container"], size = 1234): Source =>
	({ id, kind: "document", folderKey: "1.1.1", paths, title: id, role, roleFrom: "folder", versions: [{ sha256: id, size, mtime: "2026-11-01T10:00:00.000Z" }], signers: [], ...(container ? { container } : {}) }) as unknown as Source;

function overlayOf(root: string) {
	const edoc = `${O}/1.1.2_Tehniskie noteikumi/TN_ŪK.edoc`;
	return buildOverlay(
		root,
		[src("s1", [`${O}/1.1.1_Pasūtījums/Uzdevums.pdf`], "Uzdevums"), src("s2", [`${edoc}::TN.pdf`], "Tehniskie noteikumi", { path: edoc, inner: "TN.pdf" }, 9000)],
		[{ rel: `${O}/1.1.1_Pasūtījums`, role: "Uzdevums", roleFrom: "folder" }],
	);
}

test("one level: folders first in natural order, then files; the root's top level", async () => {
	const root = office();
	const top = await listDirectory(root, "");
	assert.deepEqual(top.entries.map((e) => [e.name, e.kind]), [["00_Vadiba", "dir"], ["01_Projektesana", "dir"]]);
	assert.equal(top.hidden, 0);
	const inputs = await listDirectory(root, O);
	assert.deepEqual(inputs.entries.map((e) => e.name), ["1.1.1_Pasūtījums", "1.1.2_Tehniskie noteikumi", "1.1.3_Foto"]);
});

test("a folder says how many files are below it, junk not counted; a file says its size and date", async () => {
	const root = office();
	const inputs = await listDirectory(root, O);
	const by = Object.fromEntries(inputs.entries.map((e) => [e.name, e]));
	assert.equal(by["1.1.1_Pasūtījums"].files, 1, "~$Uzdevums.docx is Office's lock file");
	assert.equal(by["1.1.3_Foto"].files, 3, "Thumbs.db is not a file of the project");
	assert.equal(by["1.1.3_Foto"].capped, undefined);
	const files = await listDirectory(root, `${O}/1.1.1_Pasūtījums`);
	assert.deepEqual(files.entries.map((e) => e.name), ["Uzdevums.pdf"]);
	assert.equal(files.entries[0].size, "%PDF-1.4 uzdevums".length);
	assert.match(files.entries[0].mtime!, /^\d{4}-\d{2}-\d{2}T/);
	const photos = await listDirectory(root, `${O}/1.1.3_Foto`);
	assert.deepEqual(photos.entries.map((e) => e.name), ["261013_AA"], "Thumbs.db is hidden");
});

test("the scan's role is laid over a folder and over a file, and a file is linked to its source", async () => {
	const root = office();
	const ov = overlayOf(root);
	const inputs = await listDirectory(root, O, ov);
	const folder = inputs.entries.find((e) => e.name === "1.1.1_Pasūtījums")!;
	assert.deepEqual([folder.role, folder.roleFrom], ["Uzdevums", "folder"]);
	assert.equal(inputs.entries.find((e) => e.name === "1.1.3_Foto")!.role, undefined, "no role known: no chip");
	const file = (await listDirectory(root, `${O}/1.1.1_Pasūtījums`, ov)).entries[0];
	assert.deepEqual([file.sourceId, file.role], ["s1", "Uzdevums"]);
	const ifc = (await listDirectory(root, "01_Projektesana/1.2_Projekta dalas/AR/04_IFC", ov)).entries[0];
	assert.equal(ifc.sourceId, undefined, "a file the scan did not register has no source");
});

test("the match is by relative path, whatever the slashes or case of the stored path", () => {
	const root = tmp();
	const ov = buildOverlay(root, [src("s9", ["01_PROJEKTESANA\\1.1_IZEJAS DATI\\Fails.pdf"], "x")]);
	assert.equal(ov.sourceByRel.get(relKey("01_Projektesana/1.1_Izejas dati/Fails.pdf"))?.id, "s9");
});

test("files the scan found inside an .edoc are listed under it, as rows of their own", async () => {
	const root = office();
	const ov = overlayOf(root);
	const dir = await listDirectory(root, `${O}/1.1.2_Tehniskie noteikumi`, ov);
	const edoc = dir.entries[0];
	assert.equal(edoc.name, "TN_ŪK.edoc");
	assert.equal(edoc.inner, 1);
	const inside = await listDirectory(root, `${edoc.rel}::`, ov);
	assert.deepEqual(inside.entries.map((e) => [e.name, e.rel, e.sourceId, e.size]), [["TN.pdf", `${edoc.rel}::TN.pdf`, "s2", 9000]]);
});

test("nothing outside the root: .. and an absolute path elsewhere are refused", async () => {
	const root = office();
	await assert.rejects(listDirectory(root, ".."), /Ārpus mapes/);
	await assert.rejects(listDirectory(root, "00_Vadiba/../../x"), /Ārpus mapes/);
	assert.equal(insideBase(root, "00_Vadiba/Piezimes.txt"), join(root, "00_Vadiba", "Piezimes.txt"));
	assert.equal(insideBase(root, ".."), null);
	assert.equal(insideBase(root, ""), root);
});

test("a long folder is cut at 400 and says how many are not shown", async () => {
	const root = tmp();
	for (let i = 0; i < 450; i++) put(root, `liela/f${String(i).padStart(3, "0")}.txt`);
	const l = await listDirectory(root, "liela");
	assert.equal(l.entries.length, 400);
	assert.equal(l.hidden, 50);
	assert.equal(l.entries[0].name, "f000.txt");
});

test("search: names with diacritics folded, folders too, and names inside containers; short queries refused", async () => {
	const root = office();
	const ov = overlayOf(root);
	const names = async (q: string) => (await searchTree(root, q, ov)).entries.map((e) => e.name).sort();
	assert.deepEqual(await names("ifc"), ["04_IFC", "BD900_AR.ifc"]);
	assert.deepEqual(await names("pasutijums"), ["1.1.1_Pasūtījums"]);
	assert.deepEqual(await names("uzdevums"), ["Uzdevums.pdf"], "the lock file is not a result");
	assert.deepEqual(await names("tn_"), ["TN_ŪK.edoc"]);
	assert.deepEqual(await names("TN.PDF"), ["TN.pdf"], "inside the container");
	const hit = (await searchTree(root, "uzdevums", ov)).entries[0];
	assert.equal(hit.sourceId, "s1");
	assert.equal(hit.rel, `${O}/1.1.1_Pasūtījums/Uzdevums.pdf`.replace(/\//g, "\\"), "rel from the root, like a listing's");
	await assert.rejects(searchTree(root, "a"), /vismaz 2/);
	assert.deepEqual(await names("nav-tada-faila"), []);
});
