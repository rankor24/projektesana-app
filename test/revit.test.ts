import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCodeResult, revitStatus, ensureActiveDocument, viewGeometry, SNIPPETS, exportPdf, type RevitCaller } from "../src/main/revit/commands.ts";

const fake = (answers: Record<string, string>, seen: { tool: string; args: Record<string, unknown> }[] = []): RevitCaller => ({
	async call(tool, args) {
		seen.push({ tool, args });
		const a = answers[tool];
		if (a === undefined) throw new Error(`no answer for ${tool}`);
		return a;
	},
});

test("no Revit instance gives `not connected` with the server's own note, not a crash", async () => {
	const s = await revitStatus(fake({ list_revit_instances: JSON.stringify({ selectedPid: null, count: 0, instances: [], note: "No sessions" }) }));
	assert.deepEqual(s, { state: "not connected", reason: "No sessions" });
	assert.equal((await revitStatus(fake({}))).state, "not connected");
});

test("parseCodeResult unwraps the server text, the envelope and the double-serialised object", () => {
	const inner = JSON.stringify({ path: "C:\\p\\A_WORK.rvt" });
	const text = `Code execution successful!\nResult: ${JSON.stringify({ Success: true, Result: inner })}`;
	assert.deepEqual(parseCodeResult(text), { path: "C:\\p\\A_WORK.rvt" });
	assert.equal(parseCodeResult(`Result: ${JSON.stringify({ Success: true, Result: "true" })}`), true);
	assert.throws(() => parseCodeResult("Code execution failed: boom"), /boom/);
	assert.throws(() => parseCodeResult(`Result: ${JSON.stringify({ Success: false, ErrorMessage: "compile error" })}`), /compile error/);
});

test("wrong active document stops the run", async () => {
	const doc = JSON.stringify({ Success: true, Result: JSON.stringify({ title: "Other", path: "C:\\x\\Other.rvt", version: "2026", isFamily: false, view: "L1", viewId: "11" }) });
	const r = fake({ send_code_to_revit: `Result: ${doc}` });
	await assert.rejects(ensureActiveDocument(r, "C:\\p\\A_WORK.rvt"), /Atver darba kopiju/);
	assert.equal((await ensureActiveDocument(r, "C:\\x\\other.RVT")).title, "Other");
});

test("exportPdf passes folder and file name as parameters with transactionMode none", async () => {
	const seen: { tool: string; args: Record<string, unknown> }[] = [];
	await exportPdf(fake({ send_code_to_revit: `Result: ${JSON.stringify({ Success: true, Result: "true" })}` }, seen), "C:\\out", "A-101", "11");
	assert.deepEqual(seen[0].args.parameters, ["C:\\out", "A-101", "11"]);
	assert.equal(seen[0].args.transactionMode, "none");
});

test("viewGeometry maps Revit's reply to ViewGeometry, keeping the measured page rectangle", async () => {
	const raw = { id: "11", name: "1. stāvs", type: "FloorPlan", scale: 100, cropActive: true, level: "L1", elevMm: 0, min: [0, 0], max: [10000, 5000], origin: [1000, 2000, 0], right: [1, 0, 0], up: [0, 1, 0] };
	const r = fake({ send_code_to_revit: `Result: ${JSON.stringify({ Success: true, Result: JSON.stringify(raw) })}` });
	const g = await viewGeometry(r, "11", { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
	assert.equal(g.viewId, 11);
	assert.deepEqual(g.cropMax, [10000, 5000]);
	assert.equal(g.pageRect.x1, 0.9);
});

test("every snippet stays small (one read or write per call)", () => {
	for (const [name, code] of Object.entries(SNIPPETS)) assert.ok(code.split("\n").length <= 16,`${name} is ${code.split("\n").length} lines`);
});

test("the app never sends delete or write-the-original code", () => {
	for (const code of Object.values(SNIPPETS)) assert.ok(!/\.Delete\(|OverwriteExistingFile = true/.test(code));
});
