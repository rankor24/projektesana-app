// 8.1 every IFC of a project is a model to the app: 1.1 (existing building), 1.2 (sections), 1.4 (handed over), arhīvs
// folders (marked old, not hidden), drafts' staging folders and captured revisions. Invented tree, invented bytes.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { listModels, originOf, projectModels } from "../src/sources/models.ts";
import { tmp } from "./helpers.ts";

const put = (root: string, rel: string, body = "ISO-10303-21;") => {
	const f = join(root, ...rel.split("/"));
	mkdirSync(join(f, ".."), { recursive: true });
	writeFileSync(f, body);
};

function officeTree() {
	const root = tmp();
	put(root, "01_Projektesana/1.1_Izejas dati/1.1.3_Esoša ēka/Esosa_eka.ifc");
	put(root, "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/BD900_AR_261001.ifc");
	put(root, "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/Arhīvs/BD900_AR_260901.ifc");
	put(root, "01_Projektesana/1.2_Projekta dalas/BK/04_IFC/BD900_BK_261002.ifc");
	put(root, "01_Projektesana/1.4_Nodevumi/MBP/261020/BD900_AR_261020.ifc");
	put(root, "01_Projektesana/1.2_Projekta dalas/AR/04_IFC/piezimes.txt", "not a model");
	return root;
}

test("which part of the office tree a folder is", () => {
	assert.equal(originOf("1.1_Izejas dati"), "izejas dati");
	assert.equal(originOf("1.2_Projekta dalas"), "projekta daļas");
	assert.equal(originOf("1.4_Nodevumi"), "nodevumi");
	assert.equal(originOf("1.10_Cits"), "cits");
	assert.equal(originOf("3_Pasūtītājs"), "cits");
});

test("IFCs in 1.1, 1.2 and 1.4 are all listed with their part and section; arhīvs is marked old and sorted last", async () => {
	const root = officeTree();
	const list = await listModels(root);
	const by = (name: string) => list.find((m) => m.name === name)!;
	assert.equal(list.length, 5, "txt is not a model");
	assert.deepEqual([by("Esosa_eka.ifc").origin, by("Esosa_eka.ifc").section], ["izejas dati", "1.1.3_Esoša ēka"]);
	assert.deepEqual([by("BD900_AR_261001.ifc").origin, by("BD900_AR_261001.ifc").section, by("BD900_AR_261001.ifc").archived], ["projekta daļas", "AR", false]);
	assert.deepEqual([by("BD900_BK_261002.ifc").origin, by("BD900_BK_261002.ifc").section], ["projekta daļas", "BK"]);
	assert.deepEqual([by("BD900_AR_261020.ifc").origin, by("BD900_AR_261020.ifc").section], ["nodevumi", "MBP"]);
	assert.equal(by("BD900_AR_260901.ifc").archived, true);
	assert.equal(list.at(-1)!.name, "BD900_AR_260901.ifc", "old files after the current ones");
	assert.ok(list.every((m) => !m.rel.startsWith("/") && !/^[A-Za-z]:/.test(m.rel)), "rel is relative to the project folder");
});

test("no office folder → empty list, not an error", async () => {
	assert.deepEqual(await listModels(tmp()), []);
	assert.deepEqual(await listModels(join(tmp(), "missing")), []);
});

test("projectModels adds the IFCs staged in drafts and the revisions the app captured", async () => {
	const root = officeTree();
	const dataDir = tmp();
	const store = ProjectStore.open(dataDir, { id: "BD900", name: "BD900", root, createdAt: "2026-11-13T00:00:00Z" });
	put(store.dir, "nodevumi/MBP/261113/BD900_AR_261113.ifc");
	put(store.dir, "revisions/r1/model.ifc");
	store.write("revisions", [
		{ id: "r1", at: "2026-11-12T10:00:00.000Z", trigger: "agentBatch", ifc: "revisions/r1/model.ifc", sheets: [], roomTable: null, summary: "grīdas", diffFromPrev: null },
		{ id: "r2", at: "2026-11-12T11:00:00.000Z", trigger: "manualSave", ifc: null, sheets: [], roomTable: null, summary: "bez IFC", diffFromPrev: null },
	], { kind: "test", by: "test" });
	const all = await projectModels(store);
	const staged = all.find((m) => m.origin === "uzmetums")!;
	assert.equal(staged.name, "BD900_AR_261113.ifc");
	assert.equal(staged.section, ["MBP", "261113"].join(String.fromCharCode(92)));
	assert.ok(staged.rel.startsWith(store.dir), "a draft's file is opened by its absolute path in the data folder");
	const revs = all.filter((m) => m.origin === "revīzija");
	assert.deepEqual(revs.map((m) => m.rel), ["rev:r1"], "a revision without an IFC is not a model");
	assert.equal(all.filter((m) => m.origin !== "uzmetums" && m.origin !== "revīzija").length, 5);
});
