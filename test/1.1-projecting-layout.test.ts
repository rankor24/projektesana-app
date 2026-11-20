// The office folders 1.1 … 1.4 under 01_Projektesana (the standard) or straight in the project folder (some projects): the scan, the
// deliveries and the models find them the same way. Invented folders in a temp directory; nothing real is read.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findDeliveriesDir } from "../src/sources/deliveries.ts";
import { listModels } from "../src/sources/models.ts";
import { partDir, partDirSync, projectingDir } from "../src/sources/projecting.ts";
import { findInputs, scanInputs } from "../src/sources/scan.ts";

function tree(dirs: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "projecting-"));
	for (const d of dirs) mkdirSync(join(root, d), { recursive: true });
	return root;
}

test("standard layout: 01_Projektesana holds 1.1 and 1.4", async (t) => {
	const root = tree(["01_Projektēšana/1.1_Izejas dati", "01_Projektēšana/1.4_Nodevumi", "02_Cits/1.1_Izejas dati"]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(await projectingDir(root), join(root, "01_Projektēšana"));
	assert.equal(await findInputs(root), join(root, "01_Projektēšana", "1.1_Izejas dati"));
	assert.equal(await findDeliveriesDir(root), join(root, "01_Projektēšana", "1.4_Nodevumi"));
});

test("flat layout: 1.1 … 1.4 straight in the project folder, any spacing and case", async (t) => {
	const root = tree([".bv", "1.1 Izejas Dati/1.1.4_PU", "1.2_Projekts/AR", "1.3_Komunikacija", "1.4_Nodevumi"]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, "1.2_Projekts", "AR", "ar.ifc"), "ISO-10303-21;");
	assert.equal(await projectingDir(root), root);
	assert.equal(await findInputs(root), join(root, "1.1 Izejas Dati"));
	assert.equal(await findDeliveriesDir(root), join(root, "1.4_Nodevumi"));
	assert.equal(partDirSync(root, "1.4"), join(root, "1.4_Nodevumi"));
	const scan = await scanInputs(root);
	assert.equal(scan.inputsRel, "1.1 Izejas Dati");
	assert.deepEqual(scan.problems, []);
	const models = await listModels(root);
	assert.deepEqual(models.map((m) => [m.name, m.section]), [["ar.ifc", "AR"]]);
});

test("neither: no 01_Projektesana and no 1.x folder is no projecting folder, and the scan says where it looked", async (t) => {
	const root = tree(["docs", "1.10_Cits", "1.1.2_Ipasums"]);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(await projectingDir(root), null);
	assert.equal(await partDir(root, "1.1"), null);
	const scan = await scanInputs(root);
	assert.equal(scan.inputsRel, null);
	assert.deepEqual(scan.problems, ["Nav mapes 1.1_Izejas dati (ne 01_Projektesana mapē, ne projekta mapē)."]);
});
