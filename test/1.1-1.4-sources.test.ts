// 1.1 registry, 1.2 scan of 1.1 only, 1.3 hashing worker and duplicates, 1.4 .edoc containers — on the invented tree.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../src/core/registry.ts";
import { mergeSources } from "../src/sources/dedupe.ts";
import { hashFiles } from "../src/sources/hash.ts";
import { scanProject } from "../src/sources/pipeline.ts";
import { folderKeyOf, proposeFreeRole, surveyDateOf } from "../src/sources/roles.ts";
import { scanInputs } from "../src/sources/scan.ts";
import { readEdoc } from "../src/sources/text/edoc.ts";
import { FIX, makeDocx, tmp } from "./helpers.ts";
import { makeEdoc, makeProjectTree } from "./project-tree.ts";

test("1.1 registry: add parses the BD code, list, forget leaves both folders", () => {
	const base = tmp();
	const t = makeProjectTree(base);
	const app = tmp();
	const reg = new Registry(join(app, "projects.json"), join(app, "projects"));
	const p = reg.add(t.root);
	assert.equal(p.id, "BD999");
	assert.equal(p.name, "BD999 Testa iela 1");
	assert.ok(existsSync(join(app, "projects", "BD999", "project.json")));
	assert.deepEqual(reg.list().map((x) => x.id), ["BD999"]);
	assert.throws(() => reg.add(base), /BD koda/);
	reg.forget("BD999");
	assert.deepEqual(reg.list(), []);
	assert.ok(existsSync(t.root), "office folder untouched");
	assert.ok(existsSync(join(app, "projects", "BD999", "project.json")), "data folder kept");
});

test("1.2 folder keys, free-folder proposals, survey dates", () => {
	assert.equal(folderKeyOf("1.1.03_FF"), "1.1.3");
	assert.equal(folderKeyOf("1.1.12_arhivs"), "1.1.12");
	assert.equal(folderKeyOf("1.2_Projekta dalas"), null);
	assert.equal(proposeFreeRole("1.1.08_TAA"), "TAA");
	assert.equal(proposeFreeRole("1.1.10_Info no Pasutitaja"), "Info no pasūtītāja");
	assert.equal(proposeFreeRole("1.1.12_arhīvs"), "Arhīvs");
	assert.equal(surveyDateOf("261001_FF"), "2026-10-01");
	assert.equal(surveyDateOf("Bildes"), undefined);
});

test("1.2 scan: roles by folder, one survey for 30 photos, archive counted, 1.2 never touched", async () => {
	const t = makeProjectTree(tmp());
	const r = await scanInputs(t.root);
	const role = (rel: string) => r.folders.find((f) => rel.includes(f.name));
	assert.equal(role("1.1.4_PU")?.role, "PU");
	assert.equal(role("1.1.4_PU")?.roleFrom, "folder");
	assert.equal(role("1.1.08_TAA")?.role, "TAA");
	assert.equal(role("1.1.08_TAA")?.roleFrom, "unconfirmed");
	assert.equal(r.surveys.length, 1);
	assert.equal(r.surveys[0].images, 30);
	assert.equal(r.surveys[0].date, "2026-10-01");
	assert.equal(r.skipped.archive, 2);
	assert.equal(r.skipped.junk, 1);
	assert.ok(!r.files.some((f) => /\.png$/i.test(f.rel)), "photos are not files");
	assert.ok(!r.files.some((f) => /1\.2_Projekta/.test(f.rel)), "1.2 not read");
	assert.equal(r.files.length, 7);
	// a confirmed role is used and remembered
	const again = await scanInputs(t.root, { "1.1.8": "Cits" });
	assert.equal(again.folders.find((f) => f.folderKey === "1.1.8")?.roleFrom, "confirmed");
});

test("1.2 a project with 1 600 photos lists one survey row", async () => {
	const t = makeProjectTree(tmp(), { photos: 1600 });
	const r = await scanInputs(t.root);
	assert.equal(r.surveys.length, 1);
	assert.equal(r.surveys[0].images, 1600);
	assert.equal(r.files.length, 7);
});

test("1.3 hashing in a worker: progress in order, equal bytes become one source with two paths", async () => {
	const t = makeProjectTree(tmp());
	const r = await scanInputs(t.root);
	const seen: number[] = [];
	const hashed = await hashFiles(r.files, () => null, (done) => seen.push(done));
	assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
	assert.equal(seen[seen.length - 1], r.files.length);
	const m = mergeSources([], hashed, r.surveys, r.folders);
	const kl = m.sources.find((s) => s.paths.some((p) => p.endsWith("Kadastrala lieta.pdf")))!;
	assert.equal(kl.paths.length, 2);
	assert.ok(kl.paths.some((p) => p.endsWith("Pielikums Nr.1.pdf")));
	assert.equal(m.sources.filter((s) => s.kind === "photoSurvey").length, 1);
});

test("1.3 a re-scan with unchanged files reads no bytes; a changed file adds a version", async () => {
	const t = makeProjectTree(tmp());
	const r = await scanInputs(t.root);
	const first = await hashFiles(r.files, () => null);
	const sha = new Map(first.map((f) => [f.rel, f]));
	const second = await hashFiles(r.files, (rel, size, mtime) => (sha.get(rel)?.size === size && sha.get(rel)?.mtimeMs === mtime ? sha.get(rel)!.sha256 : null));
	assert.ok(second.every((f) => f.cached));
	const m1 = mergeSources([], first, r.surveys, r.folders);
	const pu = join(t.inputs, "1.1.4_PU", "PU.docx");
	writeFileSync(pu, makeDocx(["Projektēšanas uzdevums", "Grozījumi Nr. 1"]));
	const r2 = await scanInputs(t.root);
	const m2 = mergeSources(m1.sources, await hashFiles(r2.files, () => null), r2.surveys, r2.folders);
	const s = m2.sources.find((x) => x.paths.some((p) => p.endsWith("PU.docx")))!;
	assert.equal(s.versions.length, 2);
	assert.deepEqual(m2.changed, [s.id]);
});

test("1.4 .edoc: inner files and signers (subject name or certificate CN), personal code not kept", () => {
	const ed = readEdoc(
		makeEdoc({ "PU.docx": makeDocx(["Projektēšanas uzdevums"]), "Pielikums Nr.2.pdf": readFileSync(join(FIX, "text-lv.pdf")) }, [
			{ name: "ANNA OZOLA", at: "2026-09-01T08:00:00Z" },
			{ name: "JĀNIS BĒRZIŅŠ", at: "2026-09-02T09:30:00Z" },
			{ cert: ["Izdomāts Sertifikācijas Centrs", "LĪGA KĻAVA"], at: "2026-09-03T10:00:00Z" },
		]),
	);
	assert.deepEqual(ed.files.map((f) => f.name), ["Pielikums Nr.2.pdf", "PU.docx"]);
	assert.deepEqual(ed.signers.map((s) => [s.name, s.at]), [
		["ANNA OZOLA", "2026-09-01T08:00:00Z"],
		["JĀNIS BĒRZIŅŠ", "2026-09-02T09:30:00Z"],
		["LĪGA KĻAVA", "2026-09-03T10:00:00Z"],
	]);
	assert.ok(!JSON.stringify(ed.signers).includes("PNOLV"));
});

test("1.4 pipeline: an .edoc shows its inner documents, its signers, and a twin of a loose file is merged", async () => {
	const base = tmp();
	const t = makeProjectTree(base);
	writeFileSync(
		join(t.inputs, "1.1.4_PU", "PU parakstits.edoc"),
		makeEdoc({ "PU.docx": makeDocx(["Projektēšanas uzdevums (parakstīts)"]), "Pielikums Nr.1.pdf": readFileSync(join(FIX, "text-lv.pdf")) }, [
			{ name: "ANNA OZOLA", at: "2026-09-01T08:00:00Z" },
			{ name: "JĀNIS BĒRZIŅŠ", at: "2026-09-02T09:30:00Z" },
			{ name: "LĪGA KĻAVA", at: "2026-09-03T10:00:00Z" },
		]),
	);
	const app = tmp();
	const reg = new Registry(join(app, "projects.json"), join(app, "projects"));
	reg.add(t.root);
	const store = reg.store("BD999");
	const phases: string[] = [];
	await scanProject(store, (p) => phases.push(p.phase));
	const src = store.read("sources");
	const edoc = src.find((s) => s.paths[0]?.endsWith(".edoc"))!;
	assert.equal(edoc.signers.length, 3);
	const inner = src.filter((s) => s.container?.path === edoc.paths[0]);
	assert.equal(inner.length, 1, "PU.docx inside is its own source");
	assert.equal(inner[0].versions[0].textState, "ok");
	const kl = src.find((s) => s.paths.some((p) => p.endsWith("Kadastrala lieta.pdf")))!;
	assert.ok(kl.paths.some((p) => p.endsWith("PU parakstits.edoc::Pielikums Nr.1.pdf")), "the annex inside is the same document as the loose PDF");
	assert.equal(kl.versions[0].textState, "ok");
	assert.equal(kl.versions[0].pages, 2);
	assert.equal(src.find((s) => s.paths[0]?.endsWith("topo.dwg"))!.versions[0].textState, "unsupported");
	assert.equal(src.find((s) => s.paths[0]?.endsWith("TN Izdomatais tikls.pdf"))!.versions[0].textState, "error");
	assert.equal(phases[phases.length - 1], "done");
	assert.ok(store.readText(kl.versions[0].sha256)?.pages[0].includes("Kadastra apzīmējums"));
	// copy of a fixture under a new name later: the same source gains the path, no new source
	copyFileSync(join(FIX, "text-lv.pdf"), join(t.inputs, "1.1.2_Ipasuma dok", "Kopija.pdf"));
	await scanProject(store, () => {});
	const again = store.read("sources");
	assert.equal(again.length, src.length);
	assert.equal(again.find((s) => s.id === kl.id)!.paths.length, 4);
});

test("1.3 a big binary gets a fast identity (size + edges), not a full read; two copies still match", async () => {
	const { useFast } = await import("../src/sources/hash-worker.ts");
	assert.equal(useFast("scan.e57", 300 * 1024 * 1024), true);
	assert.equal(useFast("big.pdf", 300 * 1024 * 1024), true);
	assert.equal(useFast("pu.pdf", 2 * 1024 * 1024), false);
	const d = tmp();
	const big = Buffer.alloc(9 * 1024 * 1024, 7);
	writeFileSync(join(d, "a.e57"), big);
	writeFileSync(join(d, "b.e57"), big);
	const h = await hashFiles(["a.e57", "b.e57"].map((n) => ({ abs: join(d, n), rel: n, size: big.length, mtimeMs: 0, folderKey: "1.1.9" })), () => null);
	assert.match(h[0].sha256!, /^q:[0-9a-f]{64}$/);
	assert.equal(h[0].sha256, h[1].sha256);
	assert.equal(proposeFreeRole("1.1.09_punktu makoni"), "Punktu mākonis");
	assert.equal(proposeFreeRole("1.1.11_grafiks"), "Grafiks");
});
