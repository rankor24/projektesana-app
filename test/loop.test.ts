import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { addPin } from "../src/kernel/pins.ts";
import { buildPrompt, PROMPT_MAX } from "../src/main/loop/prompt.ts";

test("open pins go into the prompt before the long rules text, and the prompt is capped", () => {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	const pin = addPin(root, "r1", { kind: "pdf", sheet: "a.pdf", page: 1, x: 0.5, y: 0.5, viewId: 11 }, "pārbīdi kāpnes");
	const p = buildPrompt({ instruction: "labo", brief: { facts: {}, engine: {} }, pins: [pin], rulesJson: "R".repeat(PROMPT_MAX * 2) });
	assert.ok(p.indexOf("pārbīdi kāpnes") < p.indexOf("RRRR"));
	assert.ok(p.indexOf("Noteikumi") < p.indexOf("pārbīdi kāpnes"));
	assert.equal(p.length, PROMPT_MAX);
});
