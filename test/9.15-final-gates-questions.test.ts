// Final review, what happens after the user decides: a gate's decision reaches the leader of the new stage (R48), S5 gets a line in Gaida tevi, a question for the user can be
// closed with an answer the agent hears, the process handlers refresh Gaida tevi, and an escalated S5 keeps its H5 fix list. Invented project and agents; the agent loop is scripted.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { Mailbox, mailDir } from "../src/core/messages.ts";
import { type ProcessState, initial, readProcess, step, switchMode, writeProcess } from "../src/core/process.ts";
import { waitingEksStarts } from "../src/core/process-waiting.ts";
import { ProjectStore } from "../src/core/store.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { requirementHandlers } from "../src/main/handlers/requirements.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string): AgentSpec => ({ id, name: id.toUpperCase(), description: id, prompt: `You are AGENT ${id}.`, tools: ["write_note"] });
const IDS = ["bpv", "eks", "ar"];
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const gateRec = (id: string, stage: string, state: "waiting" | "approved" | "returned" = "waiting") => ({ id, stage, iteration: 1, state, noteId: "n_g", at: "2026-11-16T10:00:00.000Z" }) as never;

function rig(at: { stage?: ProcessState["stage"]; gates?: ProcessState["gates"]; escalated?: ProcessState["escalated"] } = {}) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const settings = new AppSettings(dir, plainCrypto);
	settings.saveAgentSpecs(IDS.map(spec));
	switchMode(store, "process", IDS, "user");
	writeProcess(store, { ...readProcess(store)!, ...(at.stage ? { stage: at.stage } : {}), ...(at.gates ? { gates: at.gates } : {}), ...(at.escalated ? { escalated: at.escalated } : {}) }, "user");
	const prompts: { who: string; prompt: string }[] = [];
	const s = new AgentSession({
		runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }),
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => IDS.map(spec),
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (r: PiRunOptions) => {
			prompts.push({ who: /AGENT (\w+)\./.exec(r.systemPrompt ?? "")?.[1] ?? "lead", prompt: r.prompt });
			r.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const registry = { store: () => store } as never;
	const h = processHandlers({ registry, settings, emit: () => undefined, session: s });
	const settle = async () => {
		for (let i = 0; i < 400 && (s.queueView().running.length || s.queueView().queued.length); i++) await tick();
		await tick(20);
	};
	return { dir, store, s, h, registry, prompts, settle, mail: () => new Mailbox(mailDir(dir, dir, "BD999")), state: () => readProcess(store)! };
}
const nobody = (r: ReturnType<typeof rig>) => assert.deepEqual(r.prompts, [], "no agent was woken");

// ---- I5 / R48 ---------------------------------------------------------------------------------------------------------------------

test("R48: approving H1 tells bpv, as a system ask from the lead: 'H1 apstiprināts, stadija S2.'", async () => {
	const r = rig({ gates: [gateRec("H1", "S1")] });
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	assert.equal(r.state().stage, "S2");
	const m = r.mail().messages().find((x) => x.to === "bpv")!;
	assert.ok(m, "a message for bpv");
	assert.equal(m.from, "lead");
	assert.equal(m.kind, "ask");
	assert.equal(m.text, "H1 apstiprināts, stadija S2.");
	assert.equal(r.prompts[0].who, "bpv", "bpv woke first; its answer then returns to the lead, as for any ask");
	assert.match(r.prompts[0].prompt, /H1 apstiprināts, stadija S2\./);
});

test("R48: returning H2 tells bpv 'H2 atgriezts: <comment>' and the stage stays", async () => {
	const r = rig({ stage: "S2", gates: [gateRec("H2", "S2")] });
	r.h["process.gate"]("BD999", { approve: false, comment: "Trūkst platību tabulas." });
	await r.settle();
	assert.equal(r.state().stage, "S2");
	assert.match(r.prompts.find((p) => p.who === "bpv")!.prompt, /H2 atgriezts: Trūkst platību tabulas\./);
	assert.equal(r.mail().messages().filter((x) => x.to === "bpv").length, 1);
});

test("R48: H4 approved into S5 writes nothing to mail and wakes nobody; Gaida tevi shows the 'start eks' item until eks has worked", async () => {
	const r = rig({ stage: "S4", gates: [gateRec("H4", "S4")] });
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	assert.equal(r.state().stage, "S5");
	assert.deepEqual(r.mail().messages(), []);
	nobody(r);
	assert.deepEqual(r.s.waiting().filter((w) => w.kind === "start-eks"), [{ kind: "start-eks", projectId: "BD999" }]);
	// the user opens eks's thread: an empty conversation is not the expert at work, the line stays (R48: until a run of eks begins)
	await tick(10);
	const t = r.s.openThread("BD999", "eks");
	assert.deepEqual(r.s.waiting().filter((w) => w.kind === "start-eks"), [{ kind: "start-eks", projectId: "BD999" }]);
	// the user writes to eks: its run begins and the line goes
	await r.s.sendToThread(t.id, "BD999", "Sāc ekspertīzi.", []);
	await r.settle();
	assert.deepEqual(r.s.waiting().filter((w) => w.kind === "start-eks"), []);
});

test("R48: no post after H7 (learning is the user's button), none for a return that escalated the stage", async () => {
	const a = rig({ stage: "S7", gates: [gateRec("H7", "S7")] });
	a.h["process.gate"]("BD999", { approve: true });
	await a.settle();
	assert.equal(a.state().stage, "mācības");
	assert.deepEqual(a.mail().messages(), []);
	// the third return of S3 was the limit: the fourth escalates
	const b = rig({ stage: "S3", gates: [gateRec("H3", "S3")] });
	writeProcess(b.store, { ...b.state(), iteration: { ...b.state().iteration, S3: 3 } }, "user");
	b.h["process.gate"]("BD999", { approve: false, comment: "Vēlreiz." });
	await b.settle();
	assert.equal(b.state().escalated, "S3");
	assert.deepEqual(b.mail().messages(), []);
});

test("R48: waitingEksStarts: only S5, only while no gate waits, not escalated, and not once eks has worked after the stage began", () => {
	const dir = tmp();
	const open = (p: ProcessState) => {
		const store = ProjectStore.open(dir, { id: "BD1", name: "BD1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
		writeProcess(store, p, "user");
	};
	const s5 = { ...initial("buvprojekts", IDS), stage: "S5" as const, gates: [{ ...gateRec("H4", "S4", "approved"), decidedAt: "2026-11-16T10:00:00.000Z" }] };
	open(s5);
	assert.equal(waitingEksStarts(dir, () => null).length, 1, "eks has no thread");
	assert.equal(waitingEksStarts(dir, () => "2026-11-16T09:00:00.000Z").length, 1, "its thread is older than the approval");
	assert.equal(waitingEksStarts(dir, () => "2026-11-16T11:00:00.000Z").length, 0, "it has worked since");
	open({ ...s5, stage: "S4" });
	assert.equal(waitingEksStarts(dir, () => null).length, 0);
	open({ ...s5, escalated: "S5" });
	assert.equal(waitingEksStarts(dir, () => null).length, 0);
	open({ ...s5, gates: [...s5.gates, gateRec("H5", "S5")] });
	assert.equal(waitingEksStarts(dir, () => null).length, 0, "a gate waits: that is the card");
});

// ---- m1 ---------------------------------------------------------------------------------------------------------------------------

test("m1: setMode, setProfile, change, gate and finish each tell the session so Gaida tevi refreshes", () => {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const settings = new AppSettings(dir, plainCrypto);
	settings.saveAgentSpecs(IDS.map(spec));
	let told = 0;
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: () => undefined, session: { notesChanged: () => void told++, postSystem: () => [] } });
	h["process.setMode"]("BD999", "process");
	assert.equal(told, 1);
	h["process.setProfile"]("BD999", { why: "tests", depth: { S2: "vienkāršota" } });
	assert.equal(told, 2);
	h["process.change"]("BD999", "Klients grib vēl vienu stāvu.");
	assert.equal(told, 3);
	writeProcess(store, { ...readProcess(store)!, stage: "mācības" }, "user");
	h["process.finish"]("BD999");
	assert.equal(told, 4);
});

// ---- m2 ---------------------------------------------------------------------------------------------------------------------------

test("m2: an escalated S5 approved with a fix list keeps it in its gate record, and S6 is next", () => {
	const s = { ...initial("buvprojekts", IDS), stage: "S5" as const, escalated: "S5" as const };
	const r = step(s, { type: "gate.approve", at: "2026-11-16T10:00:00.000Z", fix: ["r1", "r2"] });
	assert.ok(r.ok);
	assert.equal(r.state.stage, "S6");
	assert.deepEqual(r.state.gates.at(-1)!.fix, ["r1", "r2"]);
	assert.equal(r.state.escalated, null);
	// without a list: S7, as before
	const r2 = step(s, { type: "gate.approve", at: "2026-11-16T10:00:00.000Z" });
	assert.ok(r2.ok && r2.state.stage === "S7");
});

// ---- I6 ---------------------------------------------------------------------------------------------------------------------------

function questionRig() {
	const r = rig();
	const q = { id: "n_q1", type: "question" as const, title: "Kuru sienu izvēlēties?", body: "Divi varianti: A vai B.", refs: [], by: "agent" as const, at: "2026-11-16T10:00:00.000Z", agent: "ar", to: "user", status: "open" as const };
	r.store.writeNote(q);
	const told: number[] = [];
	const notes = requirementHandlers({ registry: r.registry, engine: {} as never, emit: () => undefined, session: { notesChanged: () => void told.push(1), answerQuestion: (...a) => r.s.answerQuestion(...a) } });
	return { ...r, q, notes, told };
}

test("I6: closing a question with an answer writes an `answer` note and the asking agent hears it in its own thread", async () => {
	const r = questionRig();
	const asked = r.s.openThread("BD999", "ar", "Sienas");
	const closed = r.notes["notes.setStatus"]("BD999", r.q.id, "closed", "  Izvēlies B.  ");
	assert.equal(closed.status, "closed");
	const answer = r.store.notes("answer" as never).find((n) => n.refs.includes(r.q.id))!;
	assert.ok(answer, "an answer note refers to the question");
	assert.equal(answer.body, "Izvēlies B.");
	assert.equal(answer.by, "user");
	assert.equal(answer.agent, "ar");
	await r.settle();
	const ar = r.prompts.filter((p) => p.who === "ar");
	assert.equal(ar.length, 1, "ar ran once");
	assert.match(ar[0].prompt, /Izvēlies B\./);
	assert.deepEqual(r.s.listThreads("BD999").filter((t) => t.agent === "ar").map((t) => t.id), [asked.id], "no second thread was made for it");
	assert.ok(r.told.length >= 1, "Gaida tevi refreshed");
});

test("I6: closing without an answer writes no note and wakes nobody; a closed thread of the asker is not used", async () => {
	const r = questionRig();
	r.notes["notes.setStatus"]("BD999", r.q.id, "closed");
	await r.settle();
	assert.equal(r.store.notes("answer" as never).length, 0);
	nobody(r);
	// an answer whose asker has only a closed thread gets a fresh one
	const r2 = questionRig();
	const old = r2.s.openThread("BD999", "ar", "Vecā");
	r2.s.closeThread(old.id, "BD999");
	r2.notes["notes.setStatus"]("BD999", r2.q.id, "closed", "Paldies, B.");
	await r2.settle();
	assert.equal(r2.prompts.filter((p) => p.who === "ar").length, 1);
	assert.equal(r2.s.listThreads("BD999").filter((t) => t.agent === "ar" && t.state !== "closed").length, 1);
});

test("I6: an answer to a question of an agent that no longer exists is written to Atmiņa and goes nowhere", async () => {
	const r = questionRig();
	r.store.writeNote({ ...r.q, id: "n_q2", agent: "pazudis" });
	r.notes["notes.setStatus"]("BD999", "n_q2", "closed", "Atbilde.");
	await r.settle();
	assert.equal(r.store.notes("answer" as never).length, 1);
	nobody(r);
});
