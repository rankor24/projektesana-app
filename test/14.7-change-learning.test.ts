// 14.7 changes and learning: the user records a client change, bpv judges its impact (a basic change in S4 returns the process to S3 and is listed in the next gate's
// deviations), after H7 each agent of the profile is asked for lessons that arrive as proposals, "Pabeigt" ends the process; and the ekspertīze wall of 14.6 hides gate and
// answer notes and the user's gate comments too (R42). Invented project and agents; the agent loop is scripted, nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { declarationTokens } from "../src/agent/declarations.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { ownTools } from "../src/agent/subagents.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { Mailbox, mailDir } from "../src/core/messages.ts";
import { OfficeMemory } from "../src/core/office-memory.ts";
import { type GateArgs, type ProcessState, eksMayRead, initial, readProcess, requestGate, step, switchMode, writeProcess } from "../src/core/process.ts";
import { PROCESS_OWN_TOOLS, PROCESS_TOOLS_OF } from "../src/core/process-def.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string): AgentSpec => ({ id, name: id.toUpperCase(), description: id, prompt: `You are AGENT ${id}.`, tools: ["write_note"] });
const IDS = ["bpv", "eks", "ar"];
const ARGS: GateArgs = { result: ["Koncepcija"], files: [], deviations: "", questions: [], risks: "", decisions: [], next: "S4" };
const CHANGE = "Pasūtītājs grib pārvietot kāpņu telpu uz ēkas rietumu pusi un pievienot trešo stāvu.";

/** A project in process mode with the real session (its agent loop scripted), the handlers on it and the tools' ctx. */
function rig(o: { mode?: "process" | "cowork"; stage?: ProcessState["stage"] } = { mode: "process" }, script?: (who: string, o: PiRunOptions) => Promise<void>) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const settings = new AppSettings(dir, plainCrypto);
	settings.saveAgentSpecs(IDS.map(spec));
	if (o.mode) {
		switchMode(store, "process", IDS, "user");
		if (o.stage) writeProcess(store, { ...readProcess(store)!, stage: o.stage }, "user");
		if (o.mode === "cowork") switchMode(store, "cowork", IDS, "user");
	}
	const prompts: { who: string; prompt: string }[] = [];
	const data: { projectId: string | null; what: string[] }[] = [];
	const s = new AgentSession({
		runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }),
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: { who: "x" } }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => IDS.map(spec),
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onData: (projectId, what) => data.push({ projectId, what }),
		runAgent: async (r) => {
			const who = /AGENT (\w+)\./.exec(r.systemPrompt ?? "")?.[1] ?? "lead";
			prompts.push({ who, prompt: r.prompt });
			await script?.(who, r);
			r.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const told: { projectId: string | null; what: string[] }[] = [];
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: (_e, p) => told.push(p), session: s });
	const ctx = (agent: string | null): ToolCtx => ({ projectsDir: dir, projectId: "BD999", dataDir: dir, appDir: dir, runDir: null, agent, thread: null });
	const call = async (agent: string | null, name: string, args: Record<string, unknown> = {}) => allTools().find((t) => t.name === name)!.run(ctx(agent), args as never);
	const mail = () => new Mailbox(mailDir(dir, dir, "BD999"));
	const state = () => readProcess(store)!;
	const to = (patch: Partial<ProcessState>) => writeProcess(store, { ...readProcess(store)!, ...patch }, "user");
	const settle = async (until: () => boolean = () => true) => {
		for (let i = 0; i < 400 && (s.queueView().running.length || s.queueView().queued.length || !until()); i++) await new Promise((r) => setTimeout(r, 5));
	};
	return { dir, store, s, h, ctx, call, mail, state, to, told, prompts, settle, data };
}

const withState = (p: Partial<ProcessState>): ProcessState => ({ ...initial("buvprojekts", IDS), ...p });
const gate = (state: "waiting" | "approved" | "returned" = "waiting") => ({ id: "H4" as const, stage: "S4" as const, iteration: 1, state, noteId: "n_g", at: "2026-11-16T10:00:00.000Z" });

// ---- the state machine --------------------------------------------------------------------------------------------------------

test("14.7 a basic change in S4 returns to S3, answers a waiting gate as returned and keeps the iteration counts; escalation of S4 is cleared", () => {
	const s = withState({ stage: "S4", iteration: { S1: 0, S2: 0, S3: 1, S4: 4, S5: 0, S6: 0, S7: 0 }, escalated: "S4", gates: [gate("waiting")], reviewed: true });
	const r = step(s, { type: "change", basic: true, at: "2026-11-16T11:00:00.000Z" });
	assert.ok(r.ok);
	if (!r.ok) return;
	assert.equal(r.state.stage, "S3");
	assert.equal(r.state.escalated, null, "S4 was left: its escalation is over");
	assert.deepEqual(r.state.iteration, s.iteration, "the returns so far stay as history");
	assert.deepEqual([r.state.gates[0].state, r.state.gates[0].comment], ["returned", "Pasūtītāja izmaiņa: mainās pamata risinājums."]);
	assert.equal(r.state.reviewed, false);
});

test("14.7 a non-basic change, and a basic one outside S4, change no stage; another stage's escalation is kept", () => {
	for (const [basic, stage] of [[false, "S4"], [true, "S2"], [true, "S5"]] as const) {
		const r = step(withState({ stage }), { type: "change", basic, at: "2026-11-16T11:00:00.000Z" });
		assert.ok(r.ok);
		if (r.ok) assert.equal(r.state.stage, stage, `${basic} in ${stage}`);
	}
	const r = step(withState({ stage: "S4", escalated: "S4" }), { type: "change", basic: false, at: "x" });
	assert.ok(r.ok && r.state.escalated === "S4", "a change that moves nothing clears nothing");
});

// ---- process_change_impact ----------------------------------------------------------------------------------------------------

test("14.7 the tool is bpv's own: level run, in PROCESS_TOOLS_OF for bpv only, never in a spec, never the lead's; the lead's declarations do not carry it", () => {
	const t = allTools().find((x) => x.name === "process_change_impact")!;
	assert.equal(t.level, "run");
	assert.deepEqual(Object.entries(PROCESS_TOOLS_OF).filter(([, v]) => v.includes("process_change_impact")).map(([k]) => k), ["bpv"]);
	assert.ok(PROCESS_OWN_TOOLS.has("process_change_impact"));
	const levelOf = (n: string) => allTools().find((x) => x.name === n)?.level ?? "read";
	const listed = allTools().map((x) => x.name);
	const offered = (id: string) => ownTools(listed, levelOf, new Set(), spec(id)).filter((n) => n === "process_change_impact");
	assert.deepEqual([offered("bpv"), offered("eks"), offered("ar")], [["process_change_impact"], [], []]);
	// the lead's fixed declarations are counted without the process agents' own tools, so they are what they were before the tool existed (measured: 8791 tokens)
	assert.equal(declarationTokens(null), 8791);
});

async function change(r: ReturnType<typeof rig>, text = CHANGE): Promise<string> {
	return r.h["process.change"]("BD999", text).id;
}

test("14.7 bpv judges a basic change in S4: the process is back in S3, the profile lists it, the note keeps the assessment, the next gate's deviations name it", async () => {
	const r = rig({ mode: "process", stage: "S4" });
	const id = await change(r);
	await r.settle();
	const s = await r.call("bpv", "process_change_impact", { noteId: id, basic: true, sections: ["ar", "bk"], note: "Mainās kāpņu telpas novietojums, tātad koncepcija." });
	assert.deepEqual(s, { ok: true, stage: "S3", message: "Pamata risinājums mainās: process atgriezts uz S3." });
	assert.equal(r.state().stage, "S3");
	const entry = r.state().profile.changes.at(-1)!;
	assert.equal(entry.what, `Klienta izmaiņa ${id}: pamata risinājums mainās; sadaļas: ar, bk`);
	assert.equal(entry.why, "Mainās kāpņu telpas novietojums, tātad koncepcija.");
	const note = r.store.notes("change").find((n) => n.id === id)!;
	assert.match(note.body, /^Pasūtītājs grib/);
	assert.match(note.body, /Ietekme \d{4}-\d{2}-\d{2}: pamata risinājums mainās\. Sadaļas: ar, bk\. Mainās kāpņu telpas/);
	assert.ok(r.store.events().some((e) => e.kind === "process.change"), "logged");
	// the next gate (H3) lists it under the deviations
	requestGate(r.store, "BD999", "bpv", ARGS);
	const summary = r.store.notes("gate").at(-1)!.body;
	assert.match(summary, new RegExp(`Atkāpes no profila: .*Klienta izmaiņa ${id}: pamata risinājums mainās; sadaļas: ar, bk \\(Mainās kāpņu`));
});

test("14.7 a non-basic change stays in S4; the entry says so; no sections is 'nav'; a change is judged once", async () => {
	const r = rig({ mode: "process", stage: "S4" });
	const id = await change(r, "Durvju rokturi jāmaina uz nerūsējošiem.");
	const out = (await r.call("bpv", "process_change_impact", { noteId: id, basic: false, sections: [], note: "Detaļa, koncepcija nemainās." })) as { stage: string; message: string };
	assert.deepEqual([out.stage, out.message], ["S4", "Ietekme ierakstīta."]);
	assert.equal(r.state().stage, "S4");
	assert.equal(r.state().profile.changes.at(-1)!.what, `Klienta izmaiņa ${id}: pamata risinājums nemainās; sadaļas: nav`);
	const before = JSON.stringify(r.state());
	await assert.rejects(r.call("bpv", "process_change_impact", { noteId: id, basic: true, sections: ["ar"], note: "Pārdomāju." }), { message: "Šī izmaiņa jau ir novērtēta." });
	assert.equal(JSON.stringify(r.state()), before, "the second judgement changed nothing");
});

test("14.7 process_change_impact refuses: anyone but bpv, co-work, a note that is no change, no reason, and an agent while the stage waits for the user", async () => {
	const r = rig({ mode: "process", stage: "S4" });
	const id = await change(r);
	const args = { noteId: id, basic: true, sections: ["ar"], note: "Mainās." };
	for (const who of ["eks", "ar", "lead", null]) await assert.rejects(r.call(who, "process_change_impact", args), { message: "Tikai bpv var novērtēt izmaiņas ietekmi." }, String(who));
	await assert.rejects(r.call("bpv", "process_change_impact", { ...args, noteId: "n_nav" }), { message: "Izmaiņas piezīme n_nav nav atrasta." });
	r.store.writeNote({ id: "n_dec", type: "decision", title: "Lēmums", body: "x", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", agent: "ar" });
	await assert.rejects(r.call("bpv", "process_change_impact", { ...args, noteId: "n_dec" }), { message: "Izmaiņas piezīme n_dec nav atrasta." }, "a decision note is not a change");
	await assert.rejects(r.call("bpv", "process_change_impact", { ...args, note: "  " }), { message: "Ietekmes vērtējumam vajag pamatojumu." });
	// R36: the stage waits for the user, an agent's judgement could clear that
	r.to({ escalated: "S4" });
	const before = JSON.stringify(r.state());
	await assert.rejects(r.call("bpv", "process_change_impact", args), { message: "Stadija S4 gaida cilvēka lēmumu." });
	assert.equal(JSON.stringify(r.state()), before);
	// co-work: every process tool but process_status refuses
	const c = rig({ mode: "cowork" });
	await assert.rejects(c.call("bpv", "process_change_impact", args), { message: "Procesa režīms nav ieslēgts." });
});

// ---- process.change (the user) ------------------------------------------------------------------------------------------------

test("14.7 process.change writes a change note by the user at the current stage and asks bpv on a new topic; bpv is woken with the text and the tool's name", async () => {
	const r = rig({ mode: "process", stage: "S4" }, async (who, o) => {
		if (who !== "bpv") return;
		// the real loop: bpv reads the message, finds the note id in it and judges
		const id = /\(Piezīme (n_\w+)\.\)/.exec(o.prompt)?.[1];
		assert.ok(id, "the note id is in the message");
		await allTools().find((t) => t.name === "process_change_impact")!.run({ projectsDir: r.dir, projectId: "BD999", dataDir: r.dir, appDir: r.dir, runDir: null, agent: "bpv", thread: null }, { noteId: id, basic: true, sections: ["ar"], note: "Koncepcija mainās." } as never);
	});
	const note = r.h["process.change"]("BD999", `  ${CHANGE}  `);
	assert.deepEqual([note.type, note.by, note.stage, note.title, note.body], ["change", "user", "S4", "Klienta izmaiņa", CHANGE]);
	assert.deepEqual(r.store.notes("change").map((n) => n.id), [note.id]);
	assert.deepEqual(r.told.at(-1), { projectId: "BD999", what: ["notes"] });

	const mb = r.mail();
	const topic = mb.topics()[0];
	assert.equal(topic.title, `Izmaiņa: ${CHANGE.slice(0, 60)}`);
	assert.deepEqual(topic.parties, ["lead", "bpv"]);
	const m = mb.messages()[0];
	assert.deepEqual([m.from, m.to, m.kind, m.topic, m.refs], ["lead", "bpv", "ask", topic.id, [note.id]]);
	assert.ok(m.text.startsWith(CHANGE) && m.text.endsWith("Novērtē ietekmi ar process_change_impact."));
	// the recipient's thread is on the topic; the sender's is the lead's
	const threads = new ThreadStore(threadsDir(r.dir, r.dir, "BD999"));
	assert.equal(threads.get(m.toThread)!.agent, "bpv");
	assert.equal(threads.get(m.toThread)!.topic, topic.id);
	assert.equal(threads.get(m.fromThread)!.agent, "lead");

	await r.settle(() => r.state().stage === "S3");
	assert.equal(r.prompts.find((p) => p.who === "bpv")!.prompt.includes(CHANGE), true, "bpv's run read the change");
	assert.equal(r.state().stage, "S3", "and judged it");
});

test("14.7 process.change refuses in co-work, with no process, after H7, with no text; nothing is written or sent", () => {
	const none = rig({});
	const cow = rig({ mode: "cowork" });
	const late = rig({ mode: "process", stage: "mācības" });
	for (const [x, msg] of [[none, "Procesa režīms nav ieslēgts."], [cow, "Procesa režīms nav ieslēgts."], [late, "Visas stadijas ir pabeigtas; atliek mācības."]] as const) {
		assert.throws(() => x.h["process.change"]("BD999", CHANGE), { message: msg });
		assert.deepEqual(x.store.notes("change"), []);
		assert.deepEqual(x.mail().messages(), []);
	}
	const s4 = rig({ mode: "process", stage: "S4" });
	assert.throws(() => s4.h["process.change"]("BD999", "   "), { message: "Izmaiņas teksts ir tukšs." });
	assert.deepEqual(s4.mail().messages(), []);
});

// ---- learning -----------------------------------------------------------------------------------------------------------------

test("14.7 process.learn is refused before H7 (every stage), in co-work and when the process is done; finish before the learning round is refused", () => {
	for (const stage of ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const) {
		const r = rig({ mode: "process", stage });
		assert.throws(() => r.h["process.learn"]("BD999"), { message: "Mācības sākas pēc H7." }, stage);
		assert.throws(() => r.h["process.finish"]("BD999"), { message: "Mācības sākas pēc H7 apstiprināšanas." }, stage);
		assert.deepEqual(r.mail().messages(), []);
	}
	assert.throws(() => rig({ mode: "cowork" }).h["process.learn"]("BD999"), { message: "Procesa režīms nav ieslēgts." });
	assert.throws(() => rig({}).h["process.learn"]("BD999"), { message: "Procesa režīms nav ieslēgts." });
	assert.throws(() => rig({ mode: "process", stage: "done" }).h["process.learn"]("BD999"), { message: "Process ir pabeigts." });
});

test("14.7 process.learn after H7: one task per agent of the profile, from bpv (from the lead for bpv); the lessons arrive as proposals of each agent, none standing; Pabeigt ends the process", async () => {
	const r = rig({ mode: "process", stage: "mācības" }, async (who, o) => {
		// bpv is woken once more by the others' answers to its tasks; that run reads replies and has no lesson to write
		if (!o.prompt.includes("Ieraksti šī projekta mācības")) return;
		await r.call(who, "write_note", { type: "learning", title: `Mācība no ${who}`, body: "Sienu rasējumus saskaņot ar BK jau S3.", scope: "birojs" });
	});
	const out = r.h["process.learn"]("BD999");
	assert.deepEqual(out, { asked: ["bpv", "eks", "ar"] });
	const ms = r.mail().messages().filter((m) => m.kind === "task");
	assert.deepEqual(ms.map((m) => [m.from, m.to]), [["lead", "bpv"], ["bpv", "eks"], ["bpv", "ar"]]);
	assert.ok(ms.every((m) => m.text === "Ieraksti šī projekta mācības biroja atmiņā (write_note scope birojs, type learning). Bez klientu vārdiem un adresēm."));
	const topics = r.mail().topics();
	assert.deepEqual(topics.map((t) => t.title), ["Mācības", "Mācības", "Mācības"]);
	assert.equal(new Set(ms.map((m) => m.wave)).size, 1, "one wave");
	// the same call again while the tasks are open asks nobody twice
	assert.deepEqual(r.h["process.learn"]("BD999"), { asked: [] });
	assert.equal(r.mail().messages().filter((m) => m.kind === "task").length, 3);

	const mem = new OfficeMemory(join(r.dir, "memory"));
	await r.settle(() => IDS.every((id) => mem.list({ agent: id }).length === 1));
	for (const id of IDS) {
		const own = mem.list({ agent: id });
		assert.equal(own.length, 1, id);
		assert.deepEqual([own[0].type, own[0].state, own[0].by, own[0].title], ["learning", "proposed", "agent", `Mācība no ${id}`]);
	}
	assert.deepEqual(mem.list({ standing: true }), [], "nothing is standing until the user accepts it");
	assert.equal(r.prompts.filter((p) => p.prompt.includes("write_note scope birojs")).length, 3, "every agent's run read the task");

	const done = r.h["process.finish"]("BD999");
	assert.equal(done.stage, "done");
	assert.equal(r.state().stage, "done");
	assert.ok(r.store.events().some((e) => e.kind === "process.learned" && e.by === "user"));
	assert.throws(() => r.h["process.finish"]("BD999"), { message: "Process ir pabeigts." });
});

test("14.7 process.learn leaves out an agent that is no longer in the settings", async () => {
	const r = rig({ mode: "process", stage: "mācības" });
	new AppSettings(r.dir, plainCrypto).saveAgentSpecs(["bpv", "ar"].map(spec));
	assert.deepEqual(r.h["process.learn"]("BD999"), { asked: ["bpv", "ar"] });
	await r.settle();
});

// ---- the ekspertīze wall (R42) ------------------------------------------------------------------------------------------------

test("14.7 eksMayRead: decisions, questions, gate summaries and answers of others are hidden from eks; its own and every other type are read", () => {
	for (const type of ["decision", "question", "gate", "answer"]) {
		assert.equal(eksMayRead({ type, agent: "ar" }), false, `${type} of ar`);
		assert.equal(eksMayRead({ type }), false, `${type} of nobody (the user's)`);
		assert.equal(eksMayRead({ type, agent: "eks" }), true, `${type} of eks`);
	}
	for (const type of ["learning", "risk", "change"]) assert.equal(eksMayRead({ type, agent: "ar" }), true, type);
});

test("14.7 read_notes: eks in process mode reads no gate or answer note that is not its own; in co-work it does; others read all", async () => {
	const r = rig({ mode: "process", stage: "S5" });
	const mk = (type: "gate" | "answer" | "learning", agent: string | undefined, title: string) => r.store.writeNote({ id: `n_${title}`, type, title, body: "teksts", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", ...(agent ? { agent } : {}) });
	mk("gate", "bpv", "GATE H4");
	mk("gate", "eks", "GATE H5");
	mk("answer", undefined, "Lietotāja atbilde");
	mk("learning", "ar", "Mācība");
	const titles = async (agent: string, project = r) => {
		const out = (await project.call(agent, "read_notes", {})) as string | { title: string }[];
		return typeof out === "string" ? [] : out.map((n) => n.title).sort();
	};
	assert.deepEqual(await titles("eks"), ["GATE H5", "Mācība"]);
	assert.deepEqual(await titles("ar"), ["GATE H4", "GATE H5", "Lietotāja atbilde", "Mācība"]);
	const c = rig({ mode: "cowork" });
	c.store.writeNote({ id: "n_g", type: "gate", title: "GATE H4", body: "x", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", agent: "bpv" });
	assert.deepEqual(await titles("eks", c), ["GATE H4"]);
});

test("14.7 process_status for eks leaves out the user's gate comments and no note text is in it; for the others the comments stay", async () => {
	const r = rig({ mode: "process", stage: "S5" });
	r.store.writeNote({ id: "n_x", type: "decision", title: "Slepens lēmums", body: "Autoru strīda teksts", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", agent: "ar" });
	r.to({ gates: [{ ...gate("returned"), comment: "Atgriežu, jo trūkst TN." }, { ...gate("approved"), id: "H4", iteration: 2, comment: "Labi, turpini." }] });
	const eks = (await r.call("eks", "process_status")) as { state: ProcessState };
	assert.equal(eks.state.gates.length, 2);
	assert.ok(eks.state.gates.every((g) => !("comment" in g)), "no comment");
	assert.deepEqual(eks.state.gates.map((g) => g.state), ["returned", "approved"], "the states stay");
	assert.equal(JSON.stringify(eks).includes("Autoru strīda teksts"), false);
	assert.equal(JSON.stringify(eks).includes("trūkst TN"), false);
	for (const who of ["bpv", "ar", "lead"]) {
		const other = (await r.call(who, "process_status")) as { state: ProcessState };
		assert.deepEqual(other.state.gates.map((g) => g.comment), ["Atgriežu, jo trūkst TN.", "Labi, turpini."], who);
	}
	// the stored state itself is whole
	assert.equal(r.state().gates[0].comment, "Atgriežu, jo trūkst TN.");
});

// ---- gates stay the user's (R43) and the window hears of a judgement ---------------------------------------------------------------

test("14.7 an agent's basic judgement is refused while a gate waits, with the gate named; the gate stays and nothing is logged; a non-basic one goes through", async () => {
	const r = rig({ mode: "process", stage: "S4" });
	const id = await change(r);
	requestGate(r.store, "BD999", "bpv", ARGS);
	const before = JSON.stringify(r.state());
	await assert.rejects(r.call("bpv", "process_change_impact", { noteId: id, basic: true, sections: ["ar"], note: "Mainās." }), { message: "Gate H4 gaida lietotāja lēmumu; to vispirms atgriež lietotājs." });
	assert.equal(JSON.stringify(r.state()), before, "stage, gate and profile untouched");
	assert.equal(r.store.notes("change").find((n) => n.id === id)!.body, CHANGE, "the note too");
	// a judgement that moves nothing may go on while the gate waits
	const ok = (await r.call("bpv", "process_change_impact", { noteId: id, basic: false, sections: [], note: "Detaļa." })) as { stage: string };
	assert.equal(ok.stage, "S4");
	assert.equal(r.state().gates.find((g) => g.state === "waiting")?.id, "H4");
	// the user returns the gate, then the same judgement of another change moves the stage
	r.h["process.gate"]("BD999", { approve: false, comment: "Gaidu klienta izmaiņu vērtējumu." });
	const id2 = await change(r, "Klients grib papildu lifta šahtu.");
	assert.equal(((await r.call("bpv", "process_change_impact", { noteId: id2, basic: true, sections: ["bk"], note: "Mainās konstrukcija." })) as { stage: string }).stage, "S3");
});

test("14.7 through a session: a successful process_change_impact result tells the window; a refused one and process_status do not", async () => {
	const r = rig({ mode: "process", stage: "S4" }, async (_who, o) => {
		o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_status", ok: true });
		o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_change_impact", ok: false, detail: "Šī izmaiņa jau ir novērtēta." });
		assert.deepEqual(r.data, [], "neither a read tool nor a refused judgement refreshes the window");
		o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_change_impact", ok: true });
	});
	await r.s.send("BD999", "sāc", []);
	await r.settle(() => r.data.length > 0);
	assert.deepEqual(r.data, [{ projectId: "BD999", what: ["process"] }]);
});
