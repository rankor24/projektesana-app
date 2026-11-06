// 0.3 data model and store, on an invented project.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { forgetLogCache } from "../src/core/log.ts";
import { bdCodeOf, profileOf, type Collections, type Fact, type Project } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { tmp } from "./helpers.ts";

const project = (root: string): Project => ({ id: "BD999", name: "BD999 Testa projekts", root, createdAt: "2026-11-06T10:00:00.000Z" });
const at = "2026-11-06T10:00:00.000Z";

const sample: Collections = {
	sources: [{ id: "s1", kind: "document", folderKey: "1.1.1", paths: ["01_Projektesana/1.1_Izejas dati/1.1.1_PU/pu.pdf"], title: "pu", role: "PU", roleFrom: "folder", versions: [{ sha256: "a".repeat(64), size: 10, mtime: at, seenAt: at, textState: "ok", pages: 2 }], signers: [] }],
	facts: [{ id: "f1", key: "profile.group", value: "3", source: { sourceId: "s1", sha: "a".repeat(64), page: 1, quote: "3. grupa" }, state: "proposed", by: "agent", at }],
	requirements: [{ id: "r1", origin: "pu", citation: { kind: "document", sourceId: "s1", sha: "a".repeat(64), page: 2, quote: "2.1. Projektētājs izstrādā" }, text: "minimālais sastāvs", appliesTo: { stages: ["Skice"] }, checkId: null, status: "open", evidence: [], state: "proposed", by: "agent", at }],
	findings: [{ id: "x1", checkId: "one-truth", requirementId: null, severity: "error", where: { sourceId: "s1", page: 1 }, message: "adrese atšķiras", key: "addr", state: "open", firstSeen: at, lastSeen: at }],
	deliveries: [{ id: "d1", stage: "Skice", kind: "MBP", label: "MBP 270201", plannedDate: "2027-02-01", submittedDate: null, folder: null, items: [], checksRun: [] }],
	pins: [{ id: "p1", target: { sourceId: "s1", page: 1, x: 0.5, y: 0.5 }, text: "pārbaudīt", comments: [], by: "boris", at, state: "open", findingId: null, requirementId: null }],
	revisions: [{ id: "v1", at, trigger: "manualSave", ifc: null, sheets: [], roomTable: null, summary: "", diffFromPrev: null }],
};

test("store.open creates the folder set", () => {
	forgetLogCache();
	const s = ProjectStore.open(tmp(), project(tmp()));
	for (const f of ["project.json", "sources.json", "facts.json", "requirements.json", "findings.json", "deliveries.json", "pins.json", "revisions.json", "log.jsonl", "notes", "revisions", "text", "versions"]) assert.ok(existsSync(join(s.dir, f)), f);
	assert.equal(s.events()[0].kind, "project.created");
});

test("store round-trips every entity", () => {
	forgetLogCache();
	const dir = tmp();
	const s = ProjectStore.open(dir, project(tmp()));
	for (const c of Object.keys(sample) as (keyof Collections)[]) s.write(c, sample[c] as never, { kind: `${c}.set`, by: "app" });
	const again = ProjectStore.load(dir, "BD999");
	for (const c of Object.keys(sample) as (keyof Collections)[]) assert.deepEqual(again.read(c), sample[c], c);
	s.writeNote({ id: "n1", type: "decision", title: "Grupa", body: "3. grupa, jo publiska ēka > 1000 m²\n\notrā rinda", refs: ["f1"], by: "boris", at });
	assert.deepEqual(again.notes(), [{ id: "n1", type: "decision", title: "Grupa", body: "3. grupa, jo publiska ēka > 1000 m²\n\notrā rinda", refs: ["f1"], by: "boris", at }]);
});

test("a write keeps the previous version and logs an event", () => {
	forgetLogCache();
	const s = ProjectStore.open(tmp(), project(tmp()));
	const first = s.write("facts", sample.facts, { kind: "fact.proposed", by: "agent" });
	const confirmed: Fact[] = [{ ...sample.facts[0], state: "confirmed", by: "boris" }];
	const second = s.write("facts", confirmed, { kind: "fact.confirmed", by: "boris" });
	assert.equal(second.seq, first.seq + 1);
	assert.deepEqual(s.versions("facts"), [second.seq, first.seq]);
	assert.deepEqual(s.readVersion("facts", second.seq), sample.facts);
	assert.deepEqual(s.readVersion("facts", first.seq), []);
	assert.deepEqual(s.events().map((e) => e.kind), ["project.created", "fact.proposed", "fact.confirmed"]);
});

test("the store refuses to write when its data folder is inside the source root", () => {
	forgetLogCache();
	const root = tmp();
	assert.throws(() => ProjectStore.open(root, project(root)), /Izejas mapē/);
	assert.equal(existsSync(join(root, "BD999")), false);
});

test("profile: confirmed beats proposed, rejected never counts", () => {
	const f = (id: string, value: string, state: Fact["state"], t: string): Fact => ({ id, key: "profile.group", value, source: { kind: "boris", at: t }, state, by: "boris", at: t });
	assert.equal(profileOf([f("a", "2", "confirmed", "2026-01-01"), f("b", "3", "proposed", "2026-02-01")]).group?.value, "2");
	assert.equal(profileOf([f("a", "2", "rejected", "2026-03-01"), f("b", "3", "proposed", "2026-02-01")]).group?.value, "3");
});

test("BD code from the office folder name", () => {
	assert.equal(bdCodeOf("BD999 Testa iela 1"), "BD999");
	assert.equal(bdCodeOf("BD1001_Kaut kas"), "BD1001");
	assert.equal(bdCodeOf("Arhīvs"), null);
});
