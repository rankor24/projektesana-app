// 0.2 carried core: guard, log.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkRead, checkWrite } from "../src/core/guard.ts";
import { appendLog, readLog } from "../src/core/log.ts";
import { tmp } from "./helpers.ts";

const cfg = { sourceRoot: "C:\\Projekti\\BD999 Testa projekts", dataDir: "C:\\AppData\\Projektesana\\projects\\BD999" };

test("guard: reads inside the source root and the data folder", () => {
	assert.equal(checkRead(cfg, "01_Projektesana\\1.1_Izejas dati\\a.pdf").ok, true);
	assert.equal(checkRead(cfg, join(cfg.dataDir, "facts.json")).ok, true);
});

test("guard: denies traversal out of the source root", () => {
	assert.equal(checkRead(cfg, "..\\..\\Windows\\system.ini").ok, false);
	assert.equal(checkRead(cfg, "C:\\Windows\\win.ini").ok, false);
	assert.equal(checkRead(cfg, "").ok, false);
});

test("guard: never writes into the source root", () => {
	assert.equal(checkWrite(cfg, join(cfg.sourceRoot, "01_Projektesana", "x.pdf")).ok, false);
	assert.equal(checkWrite(cfg, "..\\..\\..\\..\\Projekti\\BD999 Testa projekts\\x.txt").ok, false);
	assert.equal(checkWrite(cfg, "facts.json").ok, true);
	assert.equal(checkWrite(cfg, "C:\\Temp\\x.json").ok, false);
});

test("guard: a data folder placed inside the source root is still not writable", () => {
	assert.equal(checkWrite({ sourceRoot: "C:\\P", dataDir: "C:\\P\\.app" }, "facts.json").ok, false);
});

test("log: appends with rising seq and keeps every line", () => {
	const f = join(tmp(), "log.jsonl");
	const a = appendLog(f, { kind: "project.created", by: "user" });
	const b = appendLog(f, { kind: "source.scanned", by: "app", data: { n: 3 } });
	assert.equal(a.seq, 1);
	assert.equal(b.seq, 2);
	const { entries, bad } = readLog(f);
	assert.equal(bad, 0);
	assert.deepEqual(
		entries.map((e) => e.kind),
		["project.created", "source.scanned"],
	);
});

test("log: a torn last line is skipped and the next entry starts on its own line", () => {
	const f = join(tmp(), "log.jsonl");
	appendLog(f, { kind: "a", by: "app" });
	appendFileSync(f, '{"kind":"torn","by":"ap');
	const c = appendLog(f, { kind: "c", by: "app" });
	assert.equal(c.seq, 2);
	const { entries, bad } = readLog(f);
	assert.equal(bad, 1);
	assert.deepEqual(
		entries.map((e) => e.kind),
		["a", "c"],
	);
	assert.equal(readFileSync(f, "utf8").split("\n").filter(Boolean).length, 3);
});
