import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRead, checkWrite } from "../src/kernel/guard.ts";
import { appendLog, readLog, logPath } from "../src/kernel/log.ts";
import { createProject, loadProject } from "../src/kernel/project.ts";
import { Registry } from "../src/kernel/registry.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "bv-"));

test("guard denies traversal outside the project", () => {
	const root = tmp();
	assert.equal(checkRead({ root }, "..\\..\\x.txt").ok, false);
	assert.equal(checkRead({ root }, "a/b.pdf").ok, true);
});

test("guard: sources and .bv are not writable", () => {
	const root = tmp();
	const src = join(root, "PU.pdf");
	assert.equal(checkWrite({ root, sources: [src] }, "PU.pdf").ok, false);
	assert.equal(checkWrite({ root }, ".bv/log.jsonl").ok, false);
	assert.equal(checkWrite({ root }, "out/new.pdf").ok, true);
});

test("log appends with increasing seq and skips torn lines", () => {
	const root = tmp();
	createProject(root, "Test");
	appendLog(root, { kind: "pin.added", by: "boris" });
	writeFileSync(logPath(root), readFileSync(logPath(root), "utf8") + "{torn", "utf8");
	appendLog(root, { kind: "page.approved", by: "boris" });
	const { entries, bad } = readLog(root);
	assert.equal(bad, 1);
	assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3]);
});

test("createProject builds .bv and refuses a second project in the same folder", () => {
	const root = tmp();
	const m = createProject(root, "Duntes 8");
	assert.equal(loadProject(root)?.name, "Duntes 8");
	assert.ok(existsSync(join(root, ".bv", "revisions")));
	assert.equal(m.bvVersion, 1);
	assert.throws(() => createProject(root, "x"));
	assert.throws(() => createProject(tmp(), "  "));
});

test("registry forget leaves the folder alone", () => {
	const root = tmp();
	createProject(root, "A");
	const r = new Registry(join(tmp(), "reg.json"));
	r.add(root);
	r.forget(root);
	assert.deepEqual(r.list(), []);
	assert.ok(existsSync(join(root, ".bv")));
});
