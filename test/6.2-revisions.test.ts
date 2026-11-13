// 6.2 revisions: ids, the working-copy rule, and the diff between two exports (the invented IFC and its revision b).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { captureRevision, isWorkCopy, nextRevisionId, revisionDiff, workDir } from "../src/revit/revision.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const APP = join(BIMCRAFT_DIR ?? "", "app");
const store = () => ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-06T00:00:00Z" });

test("revision ids follow the stored list", () => {
	assert.equal(nextRevisionId([]), "r1");
	assert.equal(nextRevisionId([{ id: "r1" }, { id: "r4" }] as never), "r5");
});

test("only this project's _WORK copy counts as the working copy", () => {
	const s = store();
	assert.equal(isWorkCopy(s, join(workDir(s), "BD999-AR_WORK.rvt")), true);
	assert.equal(isWorkCopy(s, "C:\\Projekti\\BD999-AR_WORK.rvt"), false, "a _WORK file elsewhere");
	assert.equal(isWorkCopy(s, join(workDir(s), "BD999-AR.rvt")), false);
	assert.equal(isWorkCopy(s, ""), false);
});

test("capture refuses when the open document is not the working copy (recorded docInfo shape)", async () => {
	const s = store();
	const envelope = (nonce: string, value: unknown) => `Code execution successful!\nResult: ${JSON.stringify({ success: true, result: JSON.stringify({ nonce, value }), errorMessage: "" })}`;
	const r = { call: async (_t: string, a: Record<string, unknown> = {}) => envelope((a.parameters as string[]).at(-1)!, { title: "BD999-AR", path: "C:\\Projekti\\BD999-AR.rvt", version: "2026", view: "{3D}", viewId: "1" }) };
	await assert.rejects(captureRevision(s, r, { trigger: "agentBatch", summary: "x", bimcraftApp: APP }), /nav šī projekta darba kopija/);
	assert.deepEqual(s.read("revisions"), []);
});

test("diff between two exports: +1 wall, 1 changed", { skip: existsSync(join(APP, "ifc-compare.js")) ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const d = await revisionDiff(APP, new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc"))), new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls-rev-b.ifc"))));
	assert.deepEqual(d, { added: 1, removed: 0, changed: 1 });
});
