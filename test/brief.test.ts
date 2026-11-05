import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { registerFile } from "../src/kernel/files.ts";
import { appendChat, setFact, markUnknown, completeness, loadBrief } from "../src/main/chat/brief.ts";

function proj() {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	writeFileSync(join(root, "PU.txt"), "Projektēšanas uzdevums\nObjekts: Duntes iela 8, Rīga.\nPasūtītājs: SIA Tests.");
	registerFile(root, "PU.txt", "PU");
	return root;
}

test("a fact needs a quote that is really in the registered file", async () => {
	const root = proj();
	await setFact(root, "object", "Duntes iela 8, Rīga", { kind: "file", path: "PU.txt", quote: "Objekts: Duntes iela 8,  Rīga." }, "agent:claude");
	assert.equal(loadBrief(root).facts.object.value, "Duntes iela 8, Rīga");
	await assert.rejects(setFact(root, "client", "SIA X", { kind: "file", path: "PU.txt", quote: "Pasūtītājs: SIA Izdomāts" }, "agent:claude"), /nav atrodams/);
});

test("a file that is not registered is refused", async () => {
	const root = proj();
	writeFileSync(join(root, "other.txt"), "x y z");
	await assert.rejects(setFact(root, "object", "x", { kind: "file", path: "other.txt", quote: "x y z" }, "agent:claude"), /nav reģistrēts/);
});

test("a Boris quote must be in his own chat messages, not in the agent's", async () => {
	const root = proj();
	appendChat(root, "agent", "Vai zemes gabals ir kadastrā?");
	appendChat(root, "boris", "Kadastra apzīmējums 0100 000 1234, platība 2400 m2");
	const at = new Date().toISOString();
	await setFact(root, "land", "0100 000 1234; 2400 m2", { kind: "boris", quote: "platība 2400 m2", at }, "agent:claude");
	await assert.rejects(setFact(root, "client", "SIA X", { kind: "boris", quote: "Vai zemes gabals", at }, "agent:claude"), /Boriss čatā/);
});

test("engine facts are parsed and drive the checklist; unknown keys and bad numbers are refused", async () => {
	const root = proj();
	appendChat(root, "boris", "jauna publiska ēka, 3 stāvi, 2500 m2");
	const at = new Date().toISOString();
	const s = { kind: "boris" as const, quote: "jauna publiska ēka", at };
	assert.match(completeness(root).blocked ?? "", /engine\.work/);
	await setFact(root, "engine.work", "new_build", s, "agent:claude");
	await setFact(root, "engine.use", "public", s, "agent:claude");
	await setFact(root, "engine.floorsAbove", "3", { kind: "boris", quote: "3 stāvi", at }, "agent:claude");
	await assert.rejects(setFact(root, "engine.floorsAbove", "trīs", { kind: "boris", quote: "3 stāvi", at }, "agent:claude"), /nav skaitlis/);
	await assert.rejects(setFact(root, "engine.nonsense", "1", s, "agent:claude"), /Nezināma atslēga/);
	const c = completeness(root);
	assert.equal(c.blocked, null);
	assert.equal(c.complete, false);
	assert.equal(c.items.find((i) => i.id === "object")?.status, "open");
});

test("setup is complete only when every required item is filled or unknown by Boris's own words", async () => {
	const root = proj();
	appendChat(root, "boris", "jauna publiska ēka. nezinu");
	const at = new Date().toISOString();
	const s = { kind: "boris" as const, quote: "jauna publiska ēka", at };
	await setFact(root, "engine.work", "new_build", s, "agent:claude");
	await setFact(root, "engine.use", "public", s, "agent:claude");
	const open = completeness(root).items.filter((i) => i.required && i.status === "open");
	for (const it of open) await markUnknown(root, it.id, "nezinu", "agent:claude");
	assert.equal(completeness(root).complete, true);
	await assert.rejects(markUnknown(root, "object", "es nezinu visu", "agent:claude"), /Boriss čatā/);
});
