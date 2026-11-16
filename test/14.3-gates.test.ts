// 14.3 gates: the leader asks for a gate with the office's template, it waits in Gaida tevi, only the user approves or returns it, and no tool can
// pass a gate. Invented project and agents; the agent loop of the session test is scripted, nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { type GateArgs, type ProcessState, changeProfile, decideGate, gateSummary, initial as initialState, readProcess, requestGate, skipStage, switchMode, writeProcess } from "../src/core/process.ts";
import { STAGE_CARD } from "../src/core/process-def.ts";
import { waitingGates } from "../src/core/process-waiting.ts";
import { ProjectStore } from "../src/core/store.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import type { WaitingItem } from "../src/shared/thread-types.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string): AgentSpec => ({ id, name: id.toUpperCase(), description: "", prompt: "Testa aģents, kas dara tikai izdomātus darbus.", tools: [] });
const AGENTS = ["bpv", "eks", "ar"];
const ARGS: GateArgs = { result: ["Izejas datu saraksts sastādīts", "Profils noteikts"], files: ["1.1_Izejas dati/saraksts.xlsx"], deviations: "", questions: ["J-1", "J-2"], risks: "", decisions: [], next: "S2, bpv un ar" };

/** A project in process mode, the agents saved, and the tools' ctx for any agent. */
function rig(o: { mode?: "process" | "cowork" } = {}) {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const settings = new AppSettings(dir, plainCrypto);
	settings.saveAgentSpecs(AGENTS.map(spec));
	if (o.mode !== undefined) {
		switchMode(store, "process", AGENTS, "user");
		if (o.mode === "cowork") switchMode(store, "cowork", AGENTS, "user");
	}
	const ctx = (agent: string | null): ToolCtx => ({ projectsDir: dir, projectId: "BD999", dataDir: dir, appDir: dir, runDir: null, agent, thread: null });
	const tool = (name: string) => allTools().find((t) => t.name === name)!;
	const call = async (agent: string | null, name: string, args: Record<string, unknown> = {}) => tool(name).run(ctx(agent), args as never);
	const told: { projectId: string | null; what: string[] }[] = [];
	const sessionTold: number[] = [];
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: (_e, p) => told.push(p), session: { notesChanged: () => sessionTold.push(1) } });
	const state = () => readProcess(store)!;
	return { dir, store, ctx, call, h, state, told, sessionTold };
}

const gateNotes = (store: ProjectStore) => store.notes("gate" as never);
/** Puts the project at another stage, the way an earlier approval would have left it. */
const moveTo = (store: ProjectStore, patch: Partial<ProcessState>) => writeProcess(store, { ...readProcess(store)!, ...patch }, "user");

// ---- the template -----------------------------------------------------------------------------------------------------------

test("14.3 gateSummary renders chapter 13 exactly: header, seven lines, the closing sentence; lists joined with '; ', empty ones are 'nav'", () => {
	const s = switchMode(rig().store, "process", AGENTS, "user");
	assert.equal(
		gateSummary(s, "BD999", ARGS),
		[
			"GATE H1 | Projekts: BD999 | Stadija: S1 | Iterācija: 1",
			"",
			"Rezultāts: Izejas datu saraksts sastādīts; Profils noteikts",
			"Faili: 1.1_Izejas dati/saraksts.xlsx",
			"Atkāpes no profila: nav",
			"Atvērtie jautājumi cilvēkam: J-1; J-2",
			"Riski un pieņēmumi: nav",
			"Lēmumi, kas vajadzīgi no cilvēka: nav",
			"Nākamā stadija: S2, bpv un ar",
			"",
			"Lūdzu atļauju turpināt.",
		].join("\n"),
	);
});

test("14.3 gateSummary: deviations first, then the profile changes since the previous gate; the iteration counts the returns of the stage", () => {
	const r = rig({ mode: "process" });
	const base = r.state();
	const s: ProcessState = {
		...base,
		stage: "S3",
		iteration: { ...base.iteration, S3: 1 },
		profile: { ...base.profile, changes: [{ at: "2026-11-16T08:00:00.000Z", what: "S2 izlaista", why: "nav izpētes" }, { at: "2026-11-16T10:00:00.000Z", what: "S4 dziļums: pilna → vienkāršota", why: "mazs projekts" }] },
		gates: [{ id: "H2", stage: "S2", iteration: 1, state: "approved", noteId: "n1", at: "2026-11-16T09:00:00.000Z" }],
	};
	const text = gateSummary(s, "BD999", { ...ARGS, deviations: "viens variants", risks: "TN vēl nav" });
	assert.match(text, /^GATE H3 \| Projekts: BD999 \| Stadija: S3 \| Iterācija: 2\n/);
	assert.match(text, /\nAtkāpes no profila: viens variants; S4 dziļums: pilna → vienkāršota \(mazs projekts\)\n/, "the change before the previous gate was reported then");
	assert.match(text, /\nRiski un pieņēmumi: TN vēl nav\n/);
	const first = gateSummary({ ...s, gates: [] }, "BD999", ARGS);
	assert.match(first, /\nAtkāpes no profila: S2 izlaista \(nav izpētes\); S4 dziļums: pilna → vienkāršota \(mazs projekts\)\n/, "without a previous gate every change counts");
});

// ---- who may ask, and the note -----------------------------------------------------------------------------------------------

test("14.3 a non-leader's request is refused with the leader's code, in every stage, and nothing is written", async () => {
	const r = rig({ mode: "process" });
	for (const who of ["ar", "eks", "lead", null]) {
		await assert.rejects(r.call(who, "process_request_gate", ARGS as never), { message: "Gate pieprasa tikai stadijas vadītājs (bpv)." });
	}
	assert.deepEqual(gateNotes(r.store), []);
	assert.deepEqual(r.state().gates, []);
	// S5 is led by eks: bpv is the one refused there
	moveTo(r.store, { stage: "S5" });
	await assert.rejects(r.call("bpv", "process_request_gate", ARGS as never), { message: "Gate pieprasa tikai stadijas vadītājs (eks)." });
	assert.deepEqual(gateNotes(r.store), []);
});

test("14.3 the leader's request writes a gate note equal to the template and waits; the project's gate is an item of Gaida tevi", async () => {
	const r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	const [n] = gateNotes(r.store);
	assert.equal(n.type, "gate");
	assert.equal(n.title, "GATE H1 · S1");
	assert.equal(n.agent, "bpv");
	assert.equal(n.by, "agent");
	assert.equal(n.body, gateSummary({ ...r.state(), gates: [] }, "BD999", ARGS));
	const [g] = r.state().gates;
	assert.deepEqual({ id: g.id, stage: g.stage, state: g.state, noteId: g.noteId, iteration: g.iteration }, { id: "H1", stage: "S1", state: "waiting", noteId: n.id, iteration: 1 });
	assert.deepEqual(waitingGates(r.dir), [{ kind: "gate", gate: "H1", projectId: "BD999", noteId: n.id }]);
	// eks asks for H5 in S5
	moveTo(r.store, { stage: "S5", gates: [] });
	await r.call("eks", "process_request_gate", { ...ARGS, next: "S6" } as never);
	assert.equal(gateNotes(r.store).length, 2);
	assert.equal(gateNotes(r.store).some((x) => x.title === "GATE H5 · S5" && x.agent === "eks"), true);
});

test("14.3 a request the process refuses leaves no note behind: a second one while the first waits, and H6 before the re-check", async () => {
	const r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	await assert.rejects(r.call("bpv", "process_request_gate", ARGS as never), { message: "Gate jau gaida lēmumu." });
	assert.equal(gateNotes(r.store).length, 1);
	assert.equal(r.state().gates.length, 1);
	moveTo(r.store, { stage: "S6", gates: [], reviewed: false });
	await assert.rejects(r.call("bpv", "process_request_gate", ARGS as never), /review\.done/);
	assert.equal(gateNotes(r.store).length, 1, "still the first note only");
	assert.equal(r.state().gates.length, 0);
});

// ---- the user's decision -----------------------------------------------------------------------------------------------------

test("14.3 process.gate approve moves the stage on, takes the item out, appends the decision to the note and keeps the earlier text", async () => {
	const r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	const [n] = gateNotes(r.store);
	const s = r.h["process.gate"]("BD999", { approve: true, comment: "Labi." });
	assert.equal(s.stage, "S2");
	assert.equal(s.gates[0].state, "approved");
	assert.deepEqual(waitingGates(r.dir), []);
	const after = gateNotes(r.store)[0];
	assert.equal(after.id, n.id);
	assert.ok(after.body.startsWith(n.body), "the template text stays as it was");
	assert.match(after.body.slice(n.body.length), /^\n\nLēmums \d{4}-\d{2}-\d{2}: apstiprināts\. Komentārs: Labi\.$/);
	assert.ok(readdirSync(join(r.store.dir, "versions")).some((f) => f.startsWith(`note.${n.id}.`)), "the first version of the note is kept");
	assert.deepEqual(r.told.at(-1), { projectId: "BD999", what: ["process"] });
	assert.equal(r.sessionTold.length, 1, "Gaida tevi is told");
	assert.equal(r.store.events().some((e) => e.kind === "process.gate" && e.by === "user"), true, "logged as the user's");
});

test("14.3 process.gate return needs a comment; a returned gate leaves the list, the stage repeats, and the next request is iteration 2", async () => {
	const r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	assert.throws(() => r.h["process.gate"]("BD999", { approve: false }), { message: "Atgriešanai vajag komentāru." });
	assert.throws(() => r.h["process.gate"]("BD999", { approve: false, comment: "  " }), { message: "Atgriešanai vajag komentāru." });
	assert.equal(r.state().gates[0].state, "waiting", "refused returns changed nothing");
	assert.equal(r.sessionTold.length, 0);
	const s = r.h["process.gate"]("BD999", { approve: false, comment: "Trūkst TN." });
	assert.equal(s.stage, "S1");
	assert.equal(s.iteration.S1, 1);
	assert.deepEqual(waitingGates(r.dir), []);
	assert.match(gateNotes(r.store)[0].body, /Lēmums \d{4}-\d{2}-\d{2}: atgriezts\. Komentārs: Trūkst TN\.$/);
	await r.call("bpv", "process_request_gate", ARGS as never);
	assert.match(gateNotes(r.store).find((n) => n.id === r.state().gates[1].noteId)!.body, /Iterācija: 2/);
});

test("14.3 process.gate with no waiting gate is refused, and so is a project without process mode", async () => {
	const r = rig({ mode: "process" });
	assert.throws(() => r.h["process.gate"]("BD999", { approve: true }), { message: "Šajā stadijā nav gaidoša gate." });
	const off = rig();
	assert.throws(() => off.h["process.gate"]("BD999", { approve: true }), { message: "Procesa režīms nav ieslēgts." });
});

test("14.3 H5 approval carries the remarks to fix into the decision line", async () => {
	const r = rig({ mode: "process" });
	moveTo(r.store, { stage: "S5" });
	await r.call("eks", "process_request_gate", ARGS as never);
	const s = r.h["process.gate"]("BD999", { approve: true, fix: ["P1", "P3"] });
	assert.equal(s.stage, "S6");
	assert.match(gateNotes(r.store)[0].body, /apstiprināts\. Labot: P1, P3\.$/);
});

// ---- no tool passes a gate ---------------------------------------------------------------------------------------------------

test("14.3 the process tools are the five named ones; none is named for approving, and no tool of any group can pass a gate", async () => {
	const names = allTools().map((t) => t.name);
	assert.deepEqual(names.filter((n) => n.startsWith("process_")).sort(), ["process_request_gate", "process_review_done", "process_set_profile", "process_skip_stage", "process_status"]);
	assert.deepEqual(names.filter((n) => /gate|approve|return/.test(n)), ["process_request_gate"]);
	const level = (n: string) => allTools().find((t) => t.name === n)!.level;
	assert.equal(level("process_status"), "read");
	for (const n of ["process_request_gate", "process_skip_stage", "process_set_profile", "process_review_done"]) assert.equal(level(n), "run");
});

test("14.3 every process tool run by every agent against a waiting gate leaves it waiting, in every stage that has a gate", async () => {
	for (const stage of ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const) {
		const r = rig({ mode: "process" });
		moveTo(r.store, { stage, reviewed: true });
		await r.call(stage === "S5" ? "eks" : "bpv", "process_request_gate", ARGS as never);
		const gate = () => r.state().gates.find((g) => g.state === "waiting");
		assert.ok(gate(), `${stage}: waiting`);
		const noteId = gate()!.noteId;
		const args: Record<string, Record<string, unknown>> = {
			process_status: {},
			process_request_gate: ARGS as never,
			process_skip_stage: { why: "mēģinājums" },
			process_set_profile: { why: "mēģinājums", depth: { S1: "vienkāršota" } },
			process_review_done: {},
		};
		for (const t of allTools().filter((x) => x.name.startsWith("process_"))) {
			for (const who of ["bpv", "eks", "ar", "lead", null]) {
				await (async () => t.run(r.ctx(who), args[t.name] as never))().catch(() => undefined);
				assert.equal(gate()?.state, "waiting", `${stage}: ${t.name} by ${who} did not touch the gate`);
				assert.equal(r.state().stage, stage, `${stage}: ${t.name} by ${who} did not move the stage`);
				assert.equal(gate()?.noteId, noteId);
			}
		}
		assert.equal(r.state().gates.length, 1, `${stage}: no second gate`);
		assert.equal(gateNotes(r.store).length, 1, `${stage}: no second note`);
		assert.equal(waitingGates(r.dir).length, 1);
	}
});

// ---- the other tools ---------------------------------------------------------------------------------------------------------

test("14.3 process_status returns the state and the card of the current stage; with no process it says so", async () => {
	const r = rig({ mode: "process" });
	const s = (await r.call("ar", "process_status")) as { state: ProcessState; card: unknown };
	assert.equal(s.state.stage, "S1");
	assert.deepEqual(s.card, STAGE_CARD.S1);
	moveTo(r.store, { stage: "mācības" });
	assert.equal(((await r.call("ar", "process_status")) as { card: unknown }).card, null);
	assert.equal(await rig().call("ar", "process_status"), "Procesa režīms nav ieslēgts.");
});

test("14.3 in co-work every process tool but process_status refuses, whoever asks, and nothing changes", async () => {
	const r = rig({ mode: "cowork" });
	const before = JSON.stringify(r.state());
	for (const [name, args] of [["process_request_gate", ARGS], ["process_skip_stage", { why: "x" }], ["process_set_profile", { why: "x", depth: { S1: "pilna" } }], ["process_review_done", {}]] as const) {
		for (const who of ["bpv", "eks", "ar"]) await assert.rejects(r.call(who, name, args as never), { message: "Procesa režīms nav ieslēgts." }, `${name} by ${who}`);
	}
	assert.equal(JSON.stringify(r.state()), before);
	assert.deepEqual(gateNotes(r.store), []);
	assert.equal(((await r.call("bpv", "process_status")) as { state: ProcessState }).state.mode, "cowork");
	// a project that never had process mode refuses the same way
	const none = rig();
	await assert.rejects(none.call("bpv", "process_skip_stage", { why: "x" }), { message: "Procesa režīms nav ieslēgts." });
	assert.equal(existsSync(join(none.store.dir, "process.json")), false);
});

test("14.3 process_skip_stage: bpv only, with a reason; the stage is passed over and the skip is in the profile changes", async () => {
	const r = rig({ mode: "process" });
	for (const who of ["eks", "ar", "lead", null]) await assert.rejects(r.call(who, "process_skip_stage", { why: "nevajag" }), { message: "Tikai bpv var izlaist stadiju." });
	assert.equal(r.state().stage, "S1");
	await assert.rejects(r.call("bpv", "process_skip_stage", { why: " " }), { message: "Stadijas izlaišanai jānorāda pamatojums." });
	await r.call("bpv", "process_skip_stage", { why: "izpētes nav vajadzīgas" });
	assert.equal(r.state().stage, "S2");
	assert.equal(r.state().profile.changes.at(-1)!.what, "S1 izlaista");
	assert.equal(r.store.events().some((e) => e.kind === "process.skip" && e.by === "agent"), true, "the write is logged as the agent's skip");
});

test("14.3 process_set_profile: bpv only, through changeProfile (a reason, bpv stays, S6 and S7 stay), changes logged", async () => {
	const r = rig({ mode: "process" });
	for (const who of ["eks", "ar", "lead", null]) await assert.rejects(r.call(who, "process_set_profile", { why: "x", depth: { S2: "izlaiž" } }), { message: "Tikai bpv var mainīt profilu." });
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "", depth: { S2: "izlaiž" } }), { message: "Profila maiņai vajag pamatojumu." });
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "x", depth: { S7: "izlaiž" } }), { message: "S6 un S7 nevar izlaist." });
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "x", agents: ["eks", "ar"] }), { message: "Profilā jābūt aģentam bpv." });
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "x", agents: ["bpv", "nav"] }), { message: "Nav tādu aģentu: nav." });
	assert.deepEqual(r.state().profile.changes, []);
	await r.call("bpv", "process_set_profile", { why: "mazs projekts", docType: "paskaidrojuma-raksts", depth: { S2: "izlaiž" }, agents: ["bpv", "eks"] });
	const p = r.state().profile;
	assert.equal(r.state().docType, "paskaidrojuma-raksts");
	assert.equal(p.depth.S2, "izlaiž");
	assert.deepEqual(p.agents, ["bpv", "eks"]);
	assert.ok(p.changes.length >= 3 && p.changes.every((c) => c.why === "mazs projekts"));
	assert.equal(r.store.events().some((e) => e.kind === "process.profile" && e.by === "agent"), true, "logged through changeProfile, as the agent's");
});

test("14.3 process_review_done: eks only, in S6 only; it opens the H6 request that was refused before", async () => {
	const r = rig({ mode: "process" });
	moveTo(r.store, { stage: "S6" });
	for (const who of ["bpv", "ar", "lead", null]) await assert.rejects(r.call(who, "process_review_done"), { message: "Tikai eks var atzīmēt ekspertīzes atkārtotu pārbaudi." });
	await assert.rejects(r.call("bpv", "process_request_gate", ARGS as never), /review\.done/);
	await r.call("eks", "process_review_done");
	assert.equal(r.state().reviewed, true);
	await r.call("bpv", "process_request_gate", ARGS as never);
	assert.equal(r.state().gates[0].id, "H6");
	// not in S6: the process says so
	const o = rig({ mode: "process" });
	await assert.rejects(o.call("eks", "process_review_done"), { message: "Atkārtota pārbaude attiecas tikai uz S6." });
});

// ---- Gaida tevi ---------------------------------------------------------------------------------------------------------------

test("14.3 waitingGates: only projects in process mode with a waiting gate; an unreadable project is skipped", async () => {
	const r = rig({ mode: "process" });
	assert.deepEqual(waitingGates(r.dir), []);
	await r.call("bpv", "process_request_gate", ARGS as never);
	const other = ProjectStore.open(r.dir, { id: "BD998", name: "BD998 Cita iela 2", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	writeFileSync(join(other.dir, "process.json"), "{ torn");
	assert.equal(waitingGates(r.dir).length, 1);
	assert.deepEqual(waitingGates(join(r.dir, "nav-tādas-mapes")), []);
	switchMode(r.store, "cowork", AGENTS, "user");
	assert.deepEqual(waitingGates(r.dir), [], "co-work: the gate cannot be decided, so it is not offered");
});

test("14.3 through a session: a process tool's result tells the window; the gate is in Gaida tevi and leaves it when the user decides", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	writeFileSync(join(dir, "agents.json"), JSON.stringify(AGENTS.map(spec)));
	switchMode(store, "process", AGENTS, "user");
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const told: WaitingItem[][] = [];
	const data: { projectId: string | null; what: string[] }[] = [];
	let dataAfterStatus = -1;
	let dataAfterError = -1;
	let toldByTool = false;
	let readOnlyTold = -1;
	const ctx: ToolCtx = { projectsDir: dir, projectId: "BD999", dataDir: dir, appDir: dir, runDir: null, agent: "bpv", thread: null };
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onWaiting: (items) => told.push(items),
		onData: (projectId, what) => data.push({ projectId, what }),
		runAgent: async (o) => {
			// the tools server writes in its own process; the main process learns of it from the tool's result
			const before = told.length;
			o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_status", ok: true });
			readOnlyTold = told.length - before;
			dataAfterStatus = data.length;
			o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_skip_stage", ok: false, detail: "Tikai bpv var izlaist stadiju." });
			dataAfterError = data.length;
			await allTools().find((t) => t.name === "process_request_gate")!.run(ctx, ARGS as never);
			o.onEvent({ type: "tool_result", name: "mcp__projektesana-tools__process_request_gate", ok: true });
			toldByTool = told.some((l) => l.some((x) => x.kind === "gate"));
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	await s.send("BD999", "sāc", []);
	for (let i = 0; i < 100 && (s.queueView().running.length || !s.waiting().length); i++) await new Promise((r) => setTimeout(r, 5));
	const [n] = store.notes("gate" as never);
	assert.deepEqual(s.waiting().filter((x) => x.kind === "gate"), [{ kind: "gate", gate: "H1", projectId: "BD999", noteId: n.id }]);
	assert.equal(toldByTool, true, "the result of the request tool carried the gate to the window, before the run ended");
	assert.equal(readOnlyTold, 0, "process_status changes nothing and tells nothing");
	assert.deepEqual([dataAfterStatus, dataAfterError], [0, 0], "neither a read tool nor a refused write refreshes the window");
	assert.deepEqual(data, [{ projectId: "BD999", what: ["process"] }], "the successful request refreshes an open process view, once");
	// the user decides (what the IPC handler does), then tells the session
	const settings = new AppSettings(dir, plainCrypto);
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: () => undefined, session: s });
	h["process.gate"]("BD999", { approve: true });
	assert.deepEqual(s.waiting().filter((x) => x.kind === "gate"), []);
	assert.deepEqual(told.at(-1)!.filter((x) => x.kind === "gate"), []);
});

// ---- who is offered the write tools (R35) -------------------------------------------------------------------------------------

const WRITE = ["process_request_gate", "process_skip_stage", "process_set_profile", "process_review_done"];

test("14.3 offering: the lead gets no write-level process tool, bpv its three, eks its two, any other specialist none; process_status is the lead's like any read tool", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const seen = new Map<string, { allow: string[]; gate: (name: string) => Promise<unknown> }>();
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: { who: "x" } }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => AGENTS.map((id) => ({ ...spec(id), prompt: "You are AGENT " + id + "." })),
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (o) => {
			const who = /AGENT (\w+)\./.exec(o.systemPrompt ?? "")?.[1] ?? "lead";
			seen.set(who, { allow: Object.values(o.mcp ?? {}).flatMap((m) => [...m.allow]), gate: async (name) => o.beforeToolCall?.({ toolCall: { name, id: "t", arguments: {} }, args: {} } as never, new AbortController().signal) });
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	for (const who of ["lead", ...AGENTS]) {
		await s.sendToThread(s.openThread("BD999", who).id, "BD999", "sāc", []);
		for (let i = 0; i < 100 && (s.queueView().running.length || !seen.has(who)); i++) await new Promise((r) => setTimeout(r, 5));
	}
	const tools = (who: string) => seen.get(who)!.allow.filter((n) => n.startsWith("process_")).sort();
	assert.deepEqual(tools("lead"), ["process_status"], "the lead keeps the read tool only");
	assert.deepEqual(tools("bpv"), ["process_request_gate", "process_set_profile", "process_skip_stage", "process_status"]);
	assert.deepEqual(tools("eks"), ["process_request_gate", "process_review_done", "process_status"]);
	assert.deepEqual(tools("ar"), ["process_status"]);
	// the gate agrees with the allow list: a call the list does not offer is refused before it runs
	for (const [who, own] of [["lead", []], ["bpv", ["process_request_gate", "process_skip_stage", "process_set_profile"]], ["eks", ["process_request_gate", "process_review_done"]], ["ar", []]] as const) {
		// only the refusals are called: an allowed write would take the project's write lock, which this scripted run never frees
		for (const n of WRITE.filter((x) => !(own as readonly string[]).includes(x))) {
			const r = (await seen.get(who)!.gate(n)) as { block?: boolean } | undefined;
			assert.equal(r?.block, true, `${who}: ${n}`);
		}
	}
});

test("14.3 offering: a delegate lane of bpv or eks never gets the write tools; the declarations count follows the same split", async () => {
	const { specialistTools, ownTools } = await import("../src/agent/subagents.ts");
	const { declarationTokens } = await import("../src/agent/declarations.ts");
	const { appLevels } = await import("../src/agent/tools/defs.ts");
	const { makeLevelOf, offered } = await import("../src/agent/tools/levels.ts");
	const levelOf = makeLevelOf({}, appLevels(), {});
	const listed = offered(allTools().map((t) => t.name), levelOf);
	for (const id of ["bpv", "eks"]) {
		assert.deepEqual(specialistTools(listed, levelOf, new Set(), spec(id)).filter((n) => WRITE.includes(n)), [], `${id}: a lane has none`);
		assert.ok(ownTools(listed, levelOf, new Set(), spec(id)).some((n) => WRITE.includes(n)), `${id}: its own thread has them`);
	}
	assert.ok(declarationTokens(spec("bpv")) > declarationTokens(spec("ar")), "bpv's declarations carry its three tools");
	assert.ok(declarationTokens(spec("bpv")) > declarationTokens(spec("eks")));
	assert.ok(declarationTokens(spec("eks")) > declarationTokens(spec("ar")));
});

test("14.3 validateSpec refuses a spec that lists one of the four write tools: they come to bpv and eks by themselves", async () => {
	const { validateSpec } = await import("../src/agent/agents.ts");
	const { MAIN_TOOL_LEVELS } = await import("../src/agent/subagents.ts");
	const { appLevels } = await import("../src/agent/tools/defs.ts");
	const { makeLevelOf } = await import("../src/agent/tools/levels.ts");
	const { REVIT_LEVELS } = await import("../src/agent/tools/revit-levels.ts");
	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const known = allTools().map((t) => t.name);
	for (const n of WRITE) {
		const v = validateSpec({ id: "bpv", name: "BPV", description: "", prompt: "Projekta vadītājs, izdomāts teksts.", tools: [n] }, levelOf, known);
		assert.deepEqual(v, { ok: false, error: `${n} tiek dots aģentam bpv/eks automātiski; to nevajag norādīt.` });
	}
	const ok = validateSpec({ id: "bpv", name: "BPV", description: "", prompt: "Projekta vadītājs, izdomāts teksts.", tools: ["process_status"] }, levelOf, known);
	assert.ok(ok.ok, "process_status is a plain read tool");
});

test("14.3 the settings page does not offer the four write tools as rows to tick", async () => {
	const { agentHandlers } = await import("../src/main/handlers/agents.ts");
	const rows = agentHandlers({ settings: new AppSettings(tmp(), plainCrypto) })["agents.list"]().tools.map((r) => r.name);
	for (const n of WRITE) assert.ok(!rows.includes(n), n);
	assert.ok(rows.length > 10, "the other tools are still there");
});

// ---- R36: escalation is the user's; compare-and-write ----------------------------------------------------------------------

/** The project's process escalated at S3: three returns went past the limit. */
const escalate = (r: ReturnType<typeof rig>) => moveTo(r.store, { stage: "S3", escalated: "S3", iteration: { ...r.state().iteration, S3: 4 } });
const ESC = { message: "Stadija S3 gaida cilvēka lēmumu." };

test("14.3 an escalated stage cannot be skipped by an agent: the tool refuses, the state keeps the escalation; the user's own skip still works", async () => {
	const r = rig({ mode: "process" });
	escalate(r);
	const before = JSON.stringify(r.state());
	await assert.rejects(r.call("bpv", "process_skip_stage", { why: "ātrāk" }), ESC);
	assert.equal(JSON.stringify(r.state()), before, "nothing written");
	assert.throws(() => skipStage(r.store, "ātrāk", "agent"), ESC, "the core refuses an agent whatever path calls it");
	const s = skipStage(r.store, "lietotājs izlemj", "user");
	assert.equal(s.stage, "S4");
	assert.equal(s.escalated, null, "the user's decision clears it");
});

test("14.3 an agent cannot change the depth of the escalated stage; other profile changes still go through; the user's change clears the escalation", async () => {
	const r = rig({ mode: "process" });
	escalate(r);
	const before = JSON.stringify(r.state());
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "vienkāršot", depth: { S3: "vienkāršota" } }), ESC);
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "izlaist", depth: { S3: "izlaiž" } }), ESC);
	assert.equal(JSON.stringify(r.state()), before, "nothing written");
	// a doc type whose table moves the S3 cell is the same thing
	await assert.rejects(r.call("bpv", "process_set_profile", { why: "cits veids", docType: "pazinojums" }), ESC);
	assert.equal(JSON.stringify(r.state()), before);
	await r.call("bpv", "process_set_profile", { why: "cits dziļums", depth: { S4: "vienkāršota" } });
	assert.equal(r.state().escalated, "S3", "a change elsewhere leaves the escalation as it is");
	const s = changeProfile(r.store, { why: "lietotājs izlemj", depth: { S3: "vienkāršota" } }, AGENTS, "user");
	assert.equal(s.escalated, null);
});

/** A store whose process file is changed by someone else right after the caller reads it. */
/** `after`: how many reads pass before the slip (the IPC handlers read once for their own announcement). */
function slipping(store: ProjectStore, slip: (cur: ProcessState) => ProcessState, after = 0) {
	let done = false;
	let reads = 0;
	return new Proxy(store, {
		get(t, k) {
			if (k === "readMeta") {
				return (name: string, fallback: unknown) => {
					const v = t.readMeta(name, fallback);
					if (!done && name === "process" && reads++ >= after) {
						done = true;
						t.writeMeta("process", slip(v as ProcessState), { kind: "process.other", by: "app" });
					}
					return v;
				};
			}
			const v = (t as never as Record<string | symbol, unknown>)[k];
			return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
		},
	});
}
const CHANGED = { message: "Procesa stāvoklis mainījās; mēģini vēlreiz." };

test("14.3 compare-and-write: a write slipped in after the read makes every process write refuse, and nothing of the stale one lands", async () => {
	const touch = (s: ProcessState): ProcessState => ({ ...s, reviewed: !s.reviewed });
	// the leader's request: no gate, and no note left behind
	let r = rig({ mode: "process" });
	assert.throws(() => requestGate(slipping(r.store, touch) as never, "BD999", "bpv", ARGS), CHANGED);
	assert.deepEqual(r.state().gates, []);
	assert.deepEqual(gateNotes(r.store), []);
	// skip
	r = rig({ mode: "process" });
	assert.throws(() => skipStage(slipping(r.store, touch) as never, "x", "agent"), CHANGED);
	assert.equal(r.state().stage, "S1");
	// profile
	r = rig({ mode: "process" });
	assert.throws(() => changeProfile(slipping(r.store, touch) as never, { why: "x", depth: { S2: "izlaiž" } }, AGENTS, "agent"), CHANGED);
	assert.deepEqual(r.state().profile.changes, []);
	// the user's mode switch
	r = rig({ mode: "process" });
	assert.throws(() => switchMode(slipping(r.store, touch) as never, "cowork", AGENTS, "user"), CHANGED);
	assert.equal(r.state().mode, "process");
	// the user's decision
	r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	assert.throws(() => decideGate(slipping(r.store, touch) as never, { approve: true }), CHANGED);
	assert.equal(r.state().gates[0].state, "waiting");
	assert.match(gateNotes(r.store)[0].body, /Lūdzu atļauju turpināt.$/, "the note has no decision line either");
	// the first mode switch (no file yet) is guarded too
	const none = rig();
	assert.throws(() => switchMode(slipping(none.store, () => initialState("buvprojekts", AGENTS)) as never, "process", AGENTS, "user"), CHANGED);
});

test("14.3 compare-and-write: with nothing slipped in every write goes through, and the IPC handlers carry the same refusal", async () => {
	const r = rig({ mode: "process" });
	await r.call("bpv", "process_request_gate", ARGS as never);
	assert.equal(r.state().gates.length, 1);
	r.h["process.gate"]("BD999", { approve: true });
	assert.equal(r.state().stage, "S2");
	const h = processHandlers({ registry: { store: () => slipping(r.store, (s) => ({ ...s, reviewed: true }), 1) } as never, settings: new AppSettings(r.dir, plainCrypto), emit: () => undefined });
	assert.throws(() => h["process.setProfile"]("BD999", { why: "x", depth: { S4: "vienkāršota" } }), CHANGED);
	assert.equal(r.state().profile.depth.S4, "pilna");
});
