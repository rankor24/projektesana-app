// 1.8 Fokuss serialisation: exactly what the agent receives when the user selects a region, a text, a source.
import assert from "node:assert/strict";
import { test } from "node:test";
import { focusText, isFocusItem } from "../src/agent/focus.ts";
import { regionFocus, sourceFocus, textFocus } from "../src/shared/focus-items.ts";

test("nothing selected", () => {
	assert.equal(focusText([]), "Fokuss: nekas");
});

test("a page region carries page, rect in page fractions and the text inside", () => {
	const r = regionFocus("s_abc", "Kadastrālā lieta", 3, { x: 0.12345, y: 0.5, w: 0.25, h: 0.1 }, "  Kadastra   apzīmējums: 0000 000 0000 ");
	assert.deepEqual(r, {
		kind: "page-region",
		id: "s_abc:3:0.123,0.5,0.25,0.1",
		label: "Kadastrālā lieta, lpp. 3 — “Kadastra apzīmējums: 0000 000 0000”",
		data: { sourceId: "s_abc", page: 3, rect: { x: 0.123, y: 0.5, w: 0.25, h: 0.1 }, text: "Kadastra apzīmējums: 0000 000 0000" },
	});
	assert.equal(
		focusText([r]),
		'Fokuss (1):\n- lapas apgabals [page-region:s_abc:3:0.123,0.5,0.25,0.1] Kadastrālā lieta, lpp. 3 — “Kadastra apzīmējums: 0000 000 0000” {"sourceId":"s_abc","page":3,"rect":{"x":0.123,"y":0.5,"w":0.25,"h":0.1},"text":"Kadastra apzīmējums: 0000 000 0000"}',
	);
});

test("a text selection and a source; long text is cut so the Fokuss cannot fill the context", () => {
	const long = "ā".repeat(5000);
	const t = textFocus("s1", "PU", 2, long);
	assert.equal((t.data!.text as string).length, 1500);
	const out = focusText([sourceFocus("s1", "PU", "PU"), t]);
	assert.ok(out.startsWith("Fokuss (2):\n- avots [source:s1] PU {"));
	assert.ok(out.length < 1200, "data is cut at 800 characters per item");
});

test("only well-formed items are accepted from the run folder", () => {
	assert.equal(isFocusItem(sourceFocus("s1", "PU", "PU")), true);
	assert.equal(isFocusItem({ kind: "evil", id: "x", label: "y" }), false);
	assert.equal(isFocusItem(null), false);
});
