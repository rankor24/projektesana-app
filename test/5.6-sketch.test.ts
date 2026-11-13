// 5.6 sketch: what the user marked in BimCraft with their note reaches the agent as an instruction (elements by GlobalId),
// never as model data; the agent's draw_sketch only highlights on screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { focusText } from "../src/agent/focus.ts";
import { viewerTools } from "../src/agent/tools/viewer.ts";
import { sketchFocus } from "../src/shared/bimcraft-protocol.ts";
import { pdfSketchFocus } from "../src/shared/focus-items.ts";
import { readUi } from "../src/shared/ui-instruction.ts";

test("a sketch in the Fokuss: elements with GlobalIds and the note", () => {
	const f = sketchFocus([{ id: 32, guid: "0Wall0000000000000002", cls: "IfcWall", name: "Siena B" }], "pagarināt līdz asij B", "BD999-AR.ifc");
	assert.equal(f.kind, "sketch");
	assert.deepEqual(f.data, { model: "BD999-AR.ifc", note: "pagarināt līdz asij B", elements: [{ guid: "0Wall0000000000000002", cls: "IfcWall", name: "Siena B" }] });
	const t = focusText([f]);
	assert.match(t, /^Fokuss \(1\):\n- skice \[sketch:sketch:[a-z0-9]+\] skice: 1 elementi — pagarināt līdz asij B /);
	assert.match(t, /"guid":"0Wall0000000000000002"/);
});

test("8.2 a sketch on a PDF page: the rectangle, its text and the note, the note first so a long text never cuts it off", () => {
	const long = "teksts ".repeat(300);
	const f = pdfSketchFocus("s_ar", "AR-1.pdf", 3, { x: 0.12345, y: 0.2, w: 0.3, h: 0.1 }, long, "  šeit jābūt durvīm  ");
	assert.equal(f.kind, "sketch");
	assert.equal(f.label, "skice: AR-1.pdf, lpp. 3 — šeit jābūt durvīm");
	assert.deepEqual(Object.keys(f.data!), ["note", "sourceId", "page", "rect", "text"]);
	assert.deepEqual((f.data as { rect: unknown }).rect, { x: 0.123, y: 0.2, w: 0.3, h: 0.1 });
	const t = focusText([f]);
	assert.match(t, /- skice \[sketch:sketch:s_ar:3:0\.123,0\.2,0\.3,0\.1\] skice: AR-1\.pdf, lpp\. 3 — šeit jābūt durvīm \{"note":"šeit jābūt durvīm","sourceId":"s_ar","page":3/);
	assert.equal(pdfSketchFocus("s_ar", "AR-1.pdf", 1, { x: 0, y: 0, w: 0.1, h: 0.1 }, "", "").label, "skice: AR-1.pdf, lpp. 1");
});

test("draw_sketch and highlight are screen instructions only", async () => {
	const t = Object.fromEntries(viewerTools.map((x) => [x.name, x]));
	assert.equal(t.draw_sketch.level, "annotate");
	const out = (await t.draw_sketch.run({} as never, { guids: ["g1"], note: "šeit jauna siena" })) as string;
	assert.deepEqual(readUi(out), { highlight: { guids: ["g1"], note: "šeit jauna siena" } });
	assert.deepEqual(readUi((await t.open_panel.run({} as never, { name: "telpas" })) as string), { open_panel: { name: "telpas" } });
	assert.equal(readUi("plain text"), null);
});
