// Spec §2: src/kernel must have no imports from the rest of the app, so it can be lifted into a shared package by moving the folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("src/kernel imports only node: modules and its own files", () => {
	const dir = join(import.meta.dirname, "..", "src", "kernel");
	const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
	assert.ok(files.length >= 7);
	for (const f of files) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const m of src.matchAll(/from\s+"([^"]+)"/g)) {
			const spec = m[1];
			assert.ok(spec.startsWith("node:") || /^\.\/[a-z]+\.js$/.test(spec), `${f} imports ${spec}`);
		}
	}
});
