// 3.3 INV Area writing: the send_code_to_revit reply shape recorded from the live add-in; one call per room, invariant
// number format, a stop that names the room on the first error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseCodeResult, SNIPPETS, writeInvArea } from "../src/revit/commands.ts";
import { FIX } from "./helpers.ts";

const OK = readFileSync(join(FIX, "revit", "send_code_to_revit.txt"), "utf8");

test("the recorded reply envelope: result encoded twice", () => {
	assert.equal(parseCodeResult(OK), "ok");
	assert.throws(() => parseCodeResult('Code execution successful!\nResult: {"success":false,"result":null,"errorMessage":"Element not found"}'), /Element not found/);
	assert.throws(() => parseCodeResult("Code execution failed: CS1002"), /CS1002/);
});

test("one short call per room, parameter value with a dot, INV Area through UnitUtils in m²", async () => {
	const calls: { tool: string; args: { code: string; parameters: string[]; transactionMode: string } }[] = [];
	const r = { call: async (tool: string, args: Record<string, unknown> = {}) => (calls.push({ tool, args: args as never }), OK) };
	const res = await writeInvArea(r, [
		{ elementId: 1000001, number: "102", name: "Gaitenis", areaM2: 18.6 },
		{ elementId: 1000002, number: "103", name: "Kabinets", areaM2: 15.3 },
	]);
	assert.deepEqual(res, { written: 2, noParam: [] });
	assert.equal(calls.length, 2);
	assert.deepEqual(calls[0].args.parameters, ["1000001", "18.60"]);
	assert.equal(calls[0].args.transactionMode, "auto");
	assert.match(SNIPPETS.setInvArea, /LookupParameter\("INV Area"\)/);
	assert.match(SNIPPETS.setInvArea, /UnitTypeId\.SquareMeters/);
	assert.ok(SNIPPETS.setInvArea.split("\n").length <= 5, "short snippet");
});

test("a room without the parameter is listed; an error stops and names the room", async () => {
	const noParam = 'Code execution successful!\nResult: {"success":true,"result":"\\"no-param\\"","errorMessage":""}';
	assert.deepEqual(await writeInvArea({ call: async () => noParam }, [{ elementId: 1, number: "9", name: "x", areaM2: 1 }]), { written: 0, noParam: ["9"] });
	let n = 0;
	const flaky = { call: async () => (++n === 2 ? 'Code execution successful!\nResult: {"success":false,"result":null,"errorMessage":"Revit is busy"}' : OK) };
	await assert.rejects(
		writeInvArea(flaky, [
			{ elementId: 1, number: "101", name: "a", areaM2: 1 },
			{ elementId: 2, number: "102", name: "b", areaM2: 2 },
			{ elementId: 3, number: "103", name: "c", areaM2: 3 },
		]),
		/Telpa 102: Revit is busy \(ierakstītas 1 no 3\)/,
	);
});
