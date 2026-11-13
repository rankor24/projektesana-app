// 5.2 IFC compare: BimCraft's own compareModels on BimCraft's engine (from the BimCraft checkout), invented revisions:
// rev b moves wall B by 500 mm and renames it, and adds wall C.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { diffIfc } from "../src/sources/ifc-diff.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX } from "./helpers.ts";

const APP = join(BIMCRAFT_DIR ?? "", "app");

test("added, removed, changed by GlobalId, with what changed", { skip: existsSync(join(APP, "ifc-compare.js")) ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const a = new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls.ifc")));
	const b = new Uint8Array(readFileSync(join(FIX, "ifc", "two-walls-rev-b.ifc")));
	const d = await diffIfc(APP, a, b);
	assert.deepEqual(d.added, ["0Wall0000000000000003"]);
	assert.deepEqual(d.removed, []);
	assert.equal(d.changed.length, 1);
	assert.equal(d.changed[0].guid, "0Wall0000000000000002");
	assert.ok(Math.abs(d.changed[0].moved - 0.5) < 1e-6, `moved ${d.changed[0].moved} m`);
	assert.ok(d.changed[0].props.some((p) => /name/i.test(p)), JSON.stringify(d.changed[0].props));
	assert.equal(d.same, 1);
	const back = await diffIfc(APP, b, a);
	assert.deepEqual(back.removed, ["0Wall0000000000000003"]);
});
