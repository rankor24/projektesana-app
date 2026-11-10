// Checks on the app's own Revit snippets only. Nothing here talks to Revit; nothing about Revit's replies is assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SNIPPETS } from "../src/main/revit/commands.ts";

test("every snippet stays small (one read or write per call)", () => {
	for (const [name, code] of Object.entries(SNIPPETS)) assert.ok(code.split("\n").length <= 16,`${name} is ${code.split("\n").length} lines`);
});

test("the app never sends delete or write-the-original code", () => {
	for (const code of Object.values(SNIPPETS)) assert.ok(!/\.Delete\(|OverwriteExistingFile = true/.test(code));
});
