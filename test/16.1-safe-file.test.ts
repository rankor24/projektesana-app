import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Registry } from "../src/core/registry.js";
import { readJson, snapshotAppData, writeAtomic } from "../src/core/safe-file.js";

const tmp = () => mkdtempSync(join(tmpdir(), "pj-safe-"));

test("a damaged file falls back to the previous version, not to empty", () => {
	const d = tmp();
	const f = join(d, "x.json");
	writeAtomic(f, JSON.stringify({ a: 1 }));
	writeAtomic(f, JSON.stringify({ a: 2 }));
	writeFileSync(f, '{"a":', "utf8"); // a half-written file
	assert.deepEqual(readJson(f), { a: 1 });
});

test("a project list cut in half still lists the projects, and adding one keeps them", () => {
	const d = tmp();
	const office = join(d, "BD424 Duntes");
	mkdirSync(office);
	const office2 = join(d, "BD427 Other");
	mkdirSync(office2);
	const r = new Registry(join(d, "projects.json"), join(d, "projects"));
	r.add(office);
	r.add(office2); // second save leaves the first list as projects.json.bak
	writeFileSync(join(d, "projects.json"), "[{", "utf8");
	assert.deepEqual(r.list().map((p) => p.id), ["BD424"]);
	const office3 = join(d, "BD428 Third");
	mkdirSync(office3);
	r.add(office3);
	assert.deepEqual(r.list().map((p) => p.id), ["BD424", "BD428"]);
});

test("snapshot copies the key files and keeps only the last 15", () => {
	const d = tmp();
	mkdirSync(join(d, "keys"));
	mkdirSync(join(d, "chromium"));
	writeFileSync(join(d, "settings.json"), "{}");
	writeFileSync(join(d, "keys", "anthropic.key"), "k");
	writeFileSync(join(d, "chromium", "Local State"), "ls");
	for (let i = 0; i < 20; i++) snapshotAppData(d, new Date(Date.UTC(2026, 10, 1, 0, i)));
	const all = readdirSync(join(d, "backups"));
	assert.equal(all.length, 15);
	const last = join(d, "backups", all.sort().at(-1)!);
	assert.ok(existsSync(join(last, "keys", "anthropic.key")) && existsSync(join(last, "chromium", "Local State")) && existsSync(join(last, "settings.json")));
});

test("snapshot of an empty data folder does nothing", () => {
	assert.equal(snapshotAppData(tmp()), null);
});
