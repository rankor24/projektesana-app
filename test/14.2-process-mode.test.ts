// 14.2 process mode per project: no state before the first switch, the doc type read from the `procedure` fact, the profile kept when the mode
// goes back and forth, and a profile change that needs its reason, only existing agents, the leader and S6/S7. Invented projects and agents.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_DEPTH } from "../src/core/process-def.ts";
import { PROCESS_META, docTypeFromProfile, readProcess } from "../src/core/process.ts";
import { type Fact, type FactSource, profileOf } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string): AgentSpec => ({ id, name: id.toUpperCase(), description: "", prompt: "Testa aģents, kas dara tikai izdomātus darbus.", tools: [] });
const user: FactSource = { kind: "user", at: "2026-11-01T00:00:00Z" };
const fact = (value: string, state: Fact["state"] = "confirmed", at = "2026-11-01T00:00:00Z"): Fact => ({ id: `f_${value.length}_${at}`, key: "profile.procedure", value, source: user, state, by: "user", at });

function setup(agents: string[] = ["bpv", "eks", "ar"]) {
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999 Testa iela 1", root, createdAt: "2026-11-13T00:00:00Z" });
	const settings = new AppSettings(tmp(), plainCrypto);
	settings.saveAgentSpecs(agents.map(spec));
	const events: { projectId: string | null; what: string[] }[] = [];
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: (_e, p) => events.push(p) });
	return { store, settings, h, events };
}

const setProcedure = (store: ProjectStore, value: string) => store.write("facts", [fact(value)], { kind: "t", by: "app" });

test("14.2 docTypeFromProfile: each type from the procedure fact, diacritics and case folded, unknown means būvprojekts", () => {
	const of = (value: string | null, state: Fact["state"] = "confirmed") => docTypeFromProfile(profileOf(value === null ? [] : [fact(value, state)]));
	assert.equal(of("Paskaidrojuma raksts"), "paskaidrojuma-raksts");
	assert.equal(of("PASKAIDROJUMA RAKSTS būvniecībai"), "paskaidrojuma-raksts");
	assert.equal(of("Paziņojums par būvniecību"), "pazinojums");
	assert.equal(of("pazinojums"), "pazinojums");
	assert.equal(of("Būvprojekts minimālā sastāvā"), "buvprojekts");
	assert.equal(of(null), "buvprojekts");
	assert.equal(of("Paskaidrojuma raksts", "rejected"), "buvprojekts", "a rejected fact is not the profile");
	assert.equal(of("Paziņojums", "proposed"), "pazinojums", "a proposed fact counts when nothing is confirmed");
	const both = profileOf([fact("Paziņojums", "proposed", "2026-11-05T00:00:00Z"), fact("Paskaidrojuma raksts", "confirmed", "2026-11-01T00:00:00Z")]);
	assert.equal(docTypeFromProfile(both), "paskaidrojuma-raksts", "the confirmed one wins over a newer proposed one");
});

test("14.2 no state before the first switch; the first switch reads the procedure fact and the agents that exist", async () => {
	const { store, h, events } = setup();
	assert.equal(readProcess(store), null);
	assert.equal(await h["process.get"]("BD999"), null);
	setProcedure(store, "Paskaidrojuma raksts");
	const s = await h["process.setMode"]("BD999", "process");
	assert.equal(s.mode, "process");
	assert.equal(s.docType, "paskaidrojuma-raksts");
	assert.deepEqual(s.profile.depth, DEFAULT_DEPTH["paskaidrojuma-raksts"]);
	assert.deepEqual(s.profile.agents, ["bpv", "eks", "ar"]);
	assert.equal(s.stage, "S1");
	assert.deepEqual(readProcess(store), s, "it is on disk");
	assert.equal(store.events().some((e) => e.kind === "process.mode"), true, "logged as process.mode");
	assert.deepEqual(events.at(-1), { projectId: "BD999", what: ["process"] });
	assert.equal(PROCESS_META, "process");
});

test("14.2 no procedure fact gives būvprojekts", async () => {
	const { h } = setup();
	assert.equal((await h["process.setMode"]("BD999", "process")).docType, "buvprojekts");
});

test("14.2 R6: process mode needs the agent bpv; a missing eks is fine", async () => {
	const none = setup(["ar", "eks"]);
	await assert.rejects(async () => none.h["process.setMode"]("BD999", "process"), /Procesa režīmam vajag aģentu bpv \(Iestatījumi → Aģenti\)\./);
	assert.equal(readProcess(none.store), null, "nothing written");
	const noEks = setup(["bpv", "ar"]);
	assert.deepEqual((await noEks.h["process.setMode"]("BD999", "process")).profile.agents, ["bpv", "ar"]);
});

test("14.2 cowork and back to process keeps stage, gates and the profile", async () => {
	const { store, h } = setup();
	const first = await h["process.setMode"]("BD999", "process");
	const moved = { ...first, stage: "S3" as const, iteration: { ...first.iteration, S2: 1 }, gates: [{ id: "H2" as const, stage: "S2" as const, iteration: 2, state: "approved" as const, noteId: "n1", at: "2026-11-02T00:00:00Z", decidedAt: "2026-11-03T00:00:00Z" }] };
	store.writeMeta(PROCESS_META, moved, { kind: "process.test", by: "app" });
	const cow = await h["process.setMode"]("BD999", "cowork");
	assert.equal(cow.mode, "cowork");
	assert.deepEqual({ ...cow, mode: "process" }, moved);
	const again = await h["process.setMode"]("BD999", "process");
	assert.deepEqual(again, moved);
	assert.equal(again.stage, "S3");
	assert.equal(again.gates.length, 1);
});

test("14.2 cowork before any state is refused: there is nothing to keep", async () => {
	const { h, store } = setup();
	await assert.rejects(async () => h["process.setMode"]("BD999", "cowork"), /nav ieslēgts/);
	assert.equal(readProcess(store), null);
});

test("14.2 setProfile needs a why and a state", async () => {
	const { h } = setup();
	await assert.rejects(async () => h["process.setProfile"]("BD999", { depth: { S2: "izlaiž" }, why: "x" }), /nav ieslēgts/);
	await h["process.setMode"]("BD999", "process");
	for (const why of ["", "   "]) await assert.rejects(async () => h["process.setProfile"]("BD999", { depth: { S2: "izlaiž" }, why }), /Profila maiņai vajag pamatojumu\./);
});

test("14.2 setProfile refuses an unknown agent and removing bpv, and writes nothing", async () => {
	const { h, store } = setup();
	const s = await h["process.setMode"]("BD999", "process");
	await assert.rejects(async () => h["process.setProfile"]("BD999", { agents: ["bpv", "nav-tāda"], why: "pārbaude" }), /nav-tāda/);
	await assert.rejects(async () => h["process.setProfile"]("BD999", { agents: ["ar", "eks"], why: "pārbaude" }), /bpv/);
	await assert.rejects(async () => h["process.setProfile"]("BD999", { agents: [], why: "pārbaude" }), /bpv/);
	assert.deepEqual(readProcess(store), s);
});

test("14.2 setProfile never lets S6 or S7 be skipped", async () => {
	const { h } = setup();
	await h["process.setMode"]("BD999", "process");
	for (const st of ["S6", "S7"] as const) await assert.rejects(async () => h["process.setProfile"]("BD999", { depth: { [st]: "izlaiž" }, why: "pārbaude" }), /S6 un S7 nevar izlaist\./);
	const ok = await h["process.setProfile"]("BD999", { depth: { S6: "vienkāršota" }, why: "mazs projekts" });
	assert.equal(ok.profile.depth.S6, "vienkāršota");
});

test("14.2 setProfile changes depth, agents and doc type, and each change is logged with its why", async () => {
	const { h, store, events } = setup();
	await h["process.setMode"]("BD999", "process");
	const s1 = await h["process.setProfile"]("BD999", { depth: { S2: "izlaiž", S3: "vienkāršota" }, agents: ["bpv", "ar"], why: "nav izpētes, bez eks" });
	assert.equal(s1.profile.depth.S2, "izlaiž");
	assert.equal(s1.profile.depth.S3, "vienkāršota");
	assert.deepEqual(s1.profile.agents, ["bpv", "ar"]);
	assert.equal(s1.profile.changes.length, 3, "S2, S3 and the agents");
	assert.ok(s1.profile.changes.every((c) => c.why === "nav izpētes, bez eks" && c.at && c.what));
	assert.deepEqual(readProcess(store), s1);
	assert.equal(store.events().some((e) => e.kind === "process.profile"), true);
	assert.deepEqual(events.at(-1), { projectId: "BD999", what: ["process"] });

	const same = await h["process.setProfile"]("BD999", { depth: { S2: "izlaiž" }, why: "tas pats" });
	assert.equal(same.profile.changes.length, 3, "a value that is already set is not a change");

	const s2 = await h["process.setProfile"]("BD999", { docType: "pazinojums", why: "tomēr paziņojums" });
	assert.equal(s2.docType, "pazinojums");
	assert.deepEqual(s2.profile.depth, DEFAULT_DEPTH.pazinojums, "a new doc type brings its own depth row");
	// the reset overwrites S1, S3, S4 and S5 (S2 was already "izlaiž"): each has its own entry beside the doc type line
	const moved = s2.profile.changes.slice(3);
	assert.equal(moved.length, 5);
	assert.match(moved[0].what, /dokumenta veids/);
	assert.deepEqual(moved.slice(1).map((c) => c.what), ["S1 dziļums: pilna → vienkāršota (jauns dokumenta veids)", "S3 dziļums: vienkāršota → izlaiž (jauns dokumenta veids)", "S4 dziļums: pilna → vienkāršota (jauns dokumenta veids)", "S5 dziļums: pilna → vienkāršota (jauns dokumenta veids)"]);
	assert.ok(moved.every((c) => c.why === "tomēr paziņojums"));
});

test("14.2 changing the depth of the escalated stage clears escalated; another stage does not", async () => {
	const { h, store } = setup();
	const s = await h["process.setMode"]("BD999", "process");
	store.writeMeta(PROCESS_META, { ...s, stage: "S4", escalated: "S4" }, { kind: "process.test", by: "app" });
	const other = await h["process.setProfile"]("BD999", { depth: { S3: "vienkāršota" }, why: "cits posms" });
	assert.equal(other.escalated, "S4");
	const same = await h["process.setProfile"]("BD999", { agents: ["bpv", "ar", "eks"], why: "aģenti" });
	assert.equal(same.escalated, "S4", "agents alone do not clear it");
	const cleared = await h["process.setProfile"]("BD999", { depth: { S4: "vienkāršota" }, why: "vienkāršojam" });
	assert.equal(cleared.escalated, null);
});

test("14.2 a doc type reset clears escalated when the escalated stage's depth moves, and keeps it when it does not", async () => {
	const { h, store } = setup();
	const s = await h["process.setMode"]("BD999", "process");
	store.writeMeta(PROCESS_META, { ...s, stage: "S4", escalated: "S4" }, { kind: "process.test", by: "app" });
	// būvprojekts → paziņojums moves S4 (pilna → vienkāršota)
	assert.equal((await h["process.setProfile"]("BD999", { docType: "pazinojums", why: "cits veids" })).escalated, null);
	store.writeMeta(PROCESS_META, { ...readProcess(store)!, stage: "S6", escalated: "S6" }, { kind: "process.test", by: "app" });
	// paziņojums → paskaidrojuma raksts leaves S6 on "pilna"
	const kept = await h["process.setProfile"]("BD999", { docType: "paskaidrojuma-raksts", why: "vēlreiz" });
	assert.equal(kept.escalated, "S6");
});

test("14.2 a mode that is already set changes nothing: no write, no log entry, no event; an unknown mode is refused", async () => {
	const { h, store, events } = setup();
	await h["process.setMode"]("BD999", "process");
	const logged = store.events().length;
	const sent = events.length;
	const again = await h["process.setMode"]("BD999", "process");
	assert.equal(again.mode, "process");
	assert.equal(store.events().length, logged);
	assert.equal(events.length, sent);
	await assert.rejects(async () => h["process.setMode"]("BD999", "x" as never), /Nezināms režīms/);
	const noop = await h["process.setProfile"]("BD999", { agents: again.profile.agents, why: "nekas nemainās" });
	assert.deepEqual(noop, again);
	assert.equal(events.length, sent, "a profile change that changes nothing announces nothing");
});

test("14.2 setProfile refuses agents that are not an array of strings or repeat an id", async () => {
	const { h, store } = setup();
	const s = await h["process.setMode"]("BD999", "process");
	for (const agents of ["bpv", [1, "bpv"], ["bpv", "bpv"], ["bpv", "ar", "ar"]]) await assert.rejects(async () => h["process.setProfile"]("BD999", { agents: agents as never, why: "pārbaude" }), /Aģentu saraksts|atkārtojumi/);
	assert.deepEqual(readProcess(store), s);
});
