// 5.6 sketch: what Boris marked in BimCraft with his note reaches the agent as an instruction (elements by GlobalId),
// never as model data; the agent's draw_sketch only highlights on screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { focusText } from "../src/agent/focus.ts";
import { viewerTools } from "../src/agent/tools/viewer.ts";
import { sketchFocus } from "../src/shared/bimcraft-protocol.ts";
import { readUi } from "../src/shared/ui-instruction.ts";

test("a sketch in the Fokuss: elements with GlobalIds and the note", () => {
	const f = sketchFocus([{ id: 32, guid: "0Wall0000000000000002", cls: "IfcWall", name: "Siena B" }], "pagarināt līdz asij B", "BD999-AR.ifc");
	assert.equal(f.kind, "sketch");
	assert.deepEqual(f.data, { model: "BD999-AR.ifc", note: "pagarināt līdz asij B", elements: [{ guid: "0Wall0000000000000002", cls: "IfcWall", name: "Siena B" }] });
	const t = focusText([f]);
	assert.match(t, /^Fokuss \(1\):\n- skice \[sketch:sketch:[a-z0-9]+\] skice: 1 elementi — pagarināt līdz asij B /);
	assert.match(t, /"guid":"0Wall0000000000000002"/);
});

test("draw_sketch and highlight are screen instructions only", async () => {
	const t = Object.fromEntries(viewerTools.map((x) => [x.name, x]));
	assert.equal(t.draw_sketch.level, "annotate");
	const out = (await t.draw_sketch.run({} as never, { guids: ["g1"], note: "šeit jauna siena" })) as string;
	assert.deepEqual(readUi(out), { highlight: { guids: ["g1"], note: "šeit jauna siena" } });
	assert.deepEqual(readUi((await t.open_panel.run({} as never, { name: "telpas" })) as string), { open_panel: { name: "telpas", filter: undefined } });
	assert.equal(readUi("plain text"), null);
});
