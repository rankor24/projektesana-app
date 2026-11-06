// 6.1 Revit commands with a nonce per call: reply shapes recorded live (values invented), a foreign reply refused.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseNonced, revitExport, runSnippet, workName, wrap } from "../src/revit/exports.ts";
import { FIX } from "./helpers.ts";

const rec = (n: string) => readFileSync(join(FIX, "revit", n), "utf8");

/** The add-in's envelope (recorded shape) around a value, with the call's own nonce. */
const envelope = (nonce: string, value: unknown) => `Code execution successful!\nResult: ${JSON.stringify({ success: true, result: JSON.stringify({ nonce, value }), errorMessage: "" }, null, 2)}`;

test("the snippet runs in a lambda and returns { nonce, value }; the nonce is the last parameter", () => {
	const w = wrap("return document.Title;", 2);
	assert.match(w, /System\.Func<object> __pj = \(\) => \{\nreturn document\.Title;\n\};/);
	assert.match(w, /nonce = \(string\)parameters\[2\]/);
});

test("view geometry from the recorded reply shape", async () => {
	let sent: { code: string; parameters: string[]; transactionMode: string } | null = null;
	const r = {
		call: async (_t: string, a: Record<string, unknown> = {}) => {
			sent = a as never;
			return rec("view_geometry.txt").replace("NONCE", (a.parameters as string[]).at(-1)!);
		},
	};
	const g = await revitExport.viewGeometry(r, "1000100");
	assert.equal(g.name, "1. STĀVA PLĀNS");
	assert.equal(g.scale, 100);
	assert.deepEqual(g.min, [1000.5, 2000.25]);
	assert.equal(sent!.parameters[0], "1000100");
	assert.equal(sent!.transactionMode, "none");
});

test("a reply that belongs to another call is refused (as seen live)", async () => {
	assert.throws(() => parseNonced(rec("send_code_foreign.txt"), "pj-000000000000"), /nepieder šim izsaucienam/);
	await assert.rejects(runSnippet({ call: async () => rec("send_code_foreign.txt") }, "return 1;"), /nepieder/);
	await assert.rejects(runSnippet({ call: async () => envelope("pj-cafecafecafe", 1) }, "return 1;"), /nepieder/);
});

test("IFC export runs in a transaction; PDF export does not; working copy names", async () => {
	const modes: string[] = [];
	const r = {
		call: async (_t: string, a: Record<string, unknown> = {}) => {
			modes.push(String(a.transactionMode));
			return envelope((a.parameters as string[]).at(-1)!, true);
		},
	};
	assert.equal(await revitExport.exportIfc(r, "C:\\x", "m.ifc"), true);
	assert.equal(await revitExport.exportPdf(r, "C:\\x", "a.pdf", ["1", "2"]), true);
	assert.deepEqual(modes, ["auto", "none"]);
	assert.equal(workName("BD999-AR.rvt"), "BD999-AR_WORK.rvt");
	assert.equal(workName("BD999-AR_WORK"), "BD999-AR_WORK.rvt");
});
