import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { registerFile, rescan, versionBlob } from "../src/kernel/files.ts";
import { textDiff } from "../src/kernel/diff.ts";
import { addTask, setTaskDone, loadTasks, addTr, updateTr, trDeadline, calendar } from "../src/main/project/work.ts";

function proj() {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	return root;
}

test("tasks: add with due date, bad date refused, done is logged", () => {
	const root = proj();
	addTask(root, "Pieprasīt TN", "2026-11-10");
	assert.throws(() => addTask(root, "x", "10.11.2026"), /GGGG-MM-DD/);
	assert.throws(() => addTask(root, " ", null));
	setTaskDone(root, "t1", true);
	assert.equal(loadTasks(root)[0].done, true);
});

test("technical rules: statuses need their dates; deadline = 11 working days after the request", () => {
	const root = proj();
	assert.throws(() => addTr(root, { who: "Sadales tīkls", issuer: "network_owner", status: "pieprasīts", requestedOn: null, receivedOn: null, file: null, note: "" }), /pieprasīšanas datumu/);
	const r = addTr(root, { who: "Sadales tīkls", issuer: "network_owner", status: "pieprasīts", requestedOn: "2026-11-03", receivedOn: null, file: null, note: "" });
	assert.equal(trDeadline(r)?.due, "2026-11-19");
	assert.deepEqual(calendar(root).map((c) => c.kind), ["tr-deadline"]);
	updateTr(root, r.id, { status: "saņemts", receivedOn: "2026-11-10" });
	assert.deepEqual(calendar(root), []);
});

test("empty project has an empty calendar (no data, not invented)", () => {
	assert.deepEqual(calendar(proj()), []);
});

test("changed source keeps both versions' bytes so the diff has two sides; the registered original is not rewritten", () => {
	const root = proj();
	const p = join(root, "PU.txt");
	writeFileSync(p, "Stāvi: 3\nPlatība: 2000");
	registerFile(root, "PU.txt", "PU");
	writeFileSync(p, "Stāvi: 3\nPlatība: 2500");
	rescan(root);
	const a = versionBlob(root, "PU.txt", 0)!;
	const b = versionBlob(root, "PU.txt", 1)!;
	assert.equal(readFileSync(a, "utf8"), "Stāvi: 3\nPlatība: 2000");
	const d = textDiff(readFileSync(a, "utf8"), readFileSync(b, "utf8"));
	assert.deepEqual(d.filter((x) => x.op !== " ").map((x) => x.op + x.line), ["-Platība: 2000", "+Platība: 2500"]);
	assert.equal(versionBlob(root, "PU.txt", 5), null);
});
