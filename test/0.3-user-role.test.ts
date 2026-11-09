// 0.3 the user as a role, the name from the settings: data written as "boris" reads as "user" (files untouched);
// a decision and a value the user writes carry their name; the agent is told the name once; the setting is kept.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { userLine } from "../src/agent/prompt.ts";
import { overrideFinding } from "../src/checks/run.ts";
import { userFact } from "../src/core/facts.ts";
import { upgradeWho, USER_LABEL, type Finding, type Project, type Requirement } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { AppSettings } from "../src/main/settings.ts";
import { tmp } from "./helpers.ts";

const at = "2026-11-06T10:00:00.000Z";
const project = (root: string): Project => ({ id: "BD999", name: "BD999 Testa projekts", root, createdAt: at });
const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };

test("upgradeWho: only actor fields move from boris to user", () => {
	const v = upgradeWho({
		by: "boris",
		plannedFrom: "boris",
		source: { kind: "boris", at },
		comments: [{ by: "boris", text: "boris" }],
		log: { kind: "fact.boris" },
		title: "boris",
	});
	assert.deepEqual(v, { by: "user", plannedFrom: "user", source: { kind: "user", at }, comments: [{ by: "user", text: "boris" }], log: { kind: "fact.boris" }, title: "boris" });
});

test("a data folder written before the rename reads as user; the files on disk are not rewritten", () => {
	const dir = tmp();
	const s = ProjectStore.open(dir, project(tmp()));
	const d = join(dir, "BD999");
	const facts = [{ id: "f1", key: "profile.group", value: "3", source: { kind: "boris", at }, state: "confirmed", by: "boris", at }];
	writeFileSync(join(d, "facts.json"), JSON.stringify(facts));
	writeFileSync(join(d, "deliveries.json"), JSON.stringify([{ id: "d1", stage: "Skice", kind: "MBP", label: "MBP", plannedDate: "2027-02-01", plannedFrom: "boris", submittedDate: null, folder: null, items: [], checksRun: [], sent: { at, by: "boris" } }]));
	writeFileSync(join(d, "clocks.json"), JSON.stringify([{ id: "c1", by: "boris" }]));
	writeFileSync(join(d, "log.jsonl"), `${JSON.stringify({ seq: 1, at, kind: "fact.boris", by: "boris" })}\n`);
	mkdirSync(join(d, "notes"), { recursive: true });
	writeFileSync(join(d, "notes", "n1.md"), `---\n${JSON.stringify({ id: "n1", type: "decision", title: "t", refs: [], by: "boris", at })}\n---\nteksts\n`);

	const f = s.read("facts")[0];
	assert.equal(f.by, "user");
	assert.deepEqual(f.source, { kind: "user", at });
	const del = s.read("deliveries")[0];
	assert.equal(del.plannedFrom, "user");
	assert.equal(del.sent?.by, "user");
	assert.equal(s.readMeta<{ by: string }[]>("clocks", [])[0].by, "user");
	assert.equal(s.events()[0].by, "user");
	assert.equal(s.events()[0].kind, "fact.boris", "a log kind is history, not an actor");
	assert.equal(s.notes()[0].by, "user");
	assert.match(readFileSync(join(d, "facts.json"), "utf8"), /"boris"/, "read only: the file is as it was");
});

const finding: Finding = { id: "x1", checkId: "one-truth", requirementId: "r1", severity: "error", where: {}, message: "adrese atšķiras", key: "addr", state: "open", firstSeen: at, lastSeen: at };
const requirement: Requirement = { id: "r1", origin: "pu", citation: { kind: "document", sourceId: "s1", sha: "a".repeat(64), page: 1, quote: "adrese" }, text: "viena adrese", appliesTo: {}, checkId: "one-truth", status: "failed", evidence: [], state: "confirmed", by: "agent", at };

const withFinding = () => {
	const s = ProjectStore.open(tmp(), project(tmp()));
	s.write("findings", [finding], { kind: "test.findings", by: "app" });
	s.write("requirements", [requirement], { kind: "test.requirements", by: "app" });
	return s;
};

test("an override carries the name from the settings; the requirement's evidence says who", () => {
	const s = withFinding();
	overrideFinding(s, "x1", "Abas adreses pareizas, domes lēmums.", "user", "Jānis Testa");
	const f = s.read("findings")[0];
	assert.equal(f.state, "overridden");
	assert.equal(f.decision?.by, "user");
	assert.equal(f.decision?.name, "Jānis Testa");
	assert.deepEqual(s.read("requirements")[0].evidence, ["Jānis Testa: Abas adreses pareizas, domes lēmums."]);
});

test("no name in the settings: the decision has no name and the evidence says lietotājs", () => {
	const s = withFinding();
	overrideFinding(s, "x1", "Abas adreses pareizas, domes lēmums.");
	assert.equal("name" in (s.read("findings")[0].decision ?? {}), false);
	assert.deepEqual(s.read("requirements")[0].evidence, [`${USER_LABEL}: Abas adreses pareizas, domes lēmums.`]);
	assert.throws(() => overrideFinding(s, "x1", "aģents tā teica", "agent"), /tikai lietotājs, ne aģents/);
});

test("a value the user writes is confirmed at once and carries their name", () => {
	const s = ProjectStore.open(tmp(), project(tmp()));
	const named = userFact(s, "profile.group", "2", "Jānis Testa");
	assert.deepEqual([named.by, named.state, named.source], ["user", "confirmed", { kind: "user", at: named.at, name: "Jānis Testa" }]);
	const plain = userFact(s, "profile.use", "1110");
	assert.deepEqual(plain.source, { kind: "user", at: plain.at });
	assert.equal(s.events().at(-1)?.kind, "fact.user");
});

test("the agent is told the name once, on one line; no name, no line", () => {
	assert.equal(userLine("Jānis Testa"), "Lietotājs: Jānis Testa.");
	assert.equal(userLine("  Jānis\n\nTesta  "), "Lietotājs: Jānis Testa.");
	assert.equal(userLine(""), "");
	assert.equal(userLine("   "), "");
	assert.equal(userLine(undefined), "");
	assert.equal(userLine("x".repeat(200)).length, "Lietotājs: .".length + 80);
});

test("settings keep the user name; empty by default", () => {
	const s = new AppSettings(tmp(), plainCrypto);
	assert.equal(s.get().userName, "");
	assert.equal(s.set({ userName: "Jānis Testa" }).userName, "Jānis Testa");
	assert.equal(new AppSettings(s.dir, plainCrypto).get().userName, "Jānis Testa");
});
