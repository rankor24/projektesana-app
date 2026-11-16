// 14.5 the status page and the registers: statusText is short and cut at whole lines, decisions and questions are numbered by time and rendered in the
// formats of process 7.4 and 7.5, exportRegisters writes only inside the project's data folder, process agents carry the status in their standing text
// (co-work agents do not), and a reply on an open topic passes the profile rule (R38). Invented project and agents; nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { standingFor } from "../src/agent/agents.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { ThreadRunner } from "../src/agent/thread-runner.ts";
import { DEFAULT_LIMITS, Mailbox, canSend, mailDir, openTasks, type Topic } from "../src/core/messages.ts";
import type { Note } from "../src/core/model.ts";
import { STAGE_CARD, stageCard } from "../src/core/process-def.ts";
import { type ProcessState, decisionLog, initial, questionLog, statusText, writeProcess } from "../src/core/process.ts";
import { exportRegisters } from "../src/core/registers.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import type { Message } from "../src/shared/message-types.ts";
import { LEAD_ID } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `Tu esi AĢENTS ${id}, izdomāts testa aģents.`, tools: [] });
const PROFILE = ["bpv", "eks", "ar", "bk"];
const proc = (o: Partial<ProcessState> = {}): ProcessState => ({ ...initial("buvprojekts", PROFILE), ...o });
const NOW = "2026-11-16T10:00:00Z";

const note = (o: Partial<Note> & Pick<Note, "id" | "type" | "at">): Note => ({ title: `Temats ${o.id}`, body: `Teksts ${o.id}`, refs: [], by: "agent", ...o });
const day = (i: number) => `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T08:${String(i % 60).padStart(2, "0")}:00Z`;
const task = (id: string, to: string, goal: string, at: string): Message => ({ id, at, wave: "w", topic: `tp_${id}`, from: "bpv", to, kind: "task", text: goal, refs: [], fromThread: "t1", toThread: "t2", depth: 1, state: "queued", task: { id, goal, context: [], expects: "x", iteration: 1 } });

// ---- statusText -------------------------------------------------------------------------------------------------------------

test("14.5 statusText: stage and iteration first, then the waiting gate, open questions and open tasks, newest first", () => {
	const s = proc({ stage: "S4", iteration: { S1: 0, S2: 0, S3: 0, S4: 1, S5: 0, S6: 0, S7: 0 }, gates: [{ id: "H4", stage: "S4", iteration: 2, state: "waiting", noteId: "n9", at: NOW }] });
	const notes = [
		note({ id: "q1", type: "question", at: "2026-11-02T08:00:00Z", title: "Vecais jautājums", to: "user", agent: "ar", status: "open" }),
		note({ id: "q2", type: "question", at: "2026-11-03T08:00:00Z", title: "Slēgts jautājums", to: "user", agent: "ar", status: "closed" }),
		note({ id: "q3", type: "question", at: "2026-11-04T08:00:00Z", title: "Jaunais jautājums", to: "bpv", agent: "bk", status: "open" }),
		note({ id: "d1", type: "decision", at: "2026-11-05T08:00:00Z" }),
	];
	const open = [task("m1", "ar", "Vecais uzdevums", "2026-11-10T08:00:00Z"), task("m2", "bk", "Jaunais uzdevums", "2026-11-11T08:00:00Z")];
	const lines = statusText(s, { notes, open, now: NOW }).split("\n");
	assert.deepEqual(lines, [
		"Stadija S4 (iterācija 2 no 3)",
		"Gaida gate H4: lēmums cilvēkam.",
		"Atvērtie jautājumi:",
		"- J-3 bpv: Jaunais jautājums",
		"- J-1 user: Vecais jautājums",
		"Atvērtie uzdevumi:",
		"- m2 → bk: Jaunais uzdevums",
		"- m1 → ar: Vecais uzdevums",
	]);
});

test("14.5 statusText: empty sections say nav, no gate line without a waiting gate", () => {
	assert.equal(statusText(proc(), { notes: [], open: [], now: NOW }), "Stadija S1 (iterācija 1 no 3)\nAtvērtie jautājumi: nav\nAtvērtie uzdevumi: nav");
	assert.equal(statusText(proc({ stage: "mācības" }), { notes: [], open: [], now: NOW }).split("\n")[0], "Stadija mācības");
});

test("14.5 statusText stays under 3000 characters with 200 open questions, keeps both sections and ends on a whole line", () => {
	const notes = Array.from({ length: 200 }, (_, i) => note({ id: `q${i}`, type: "question", at: day(i), title: `Jautājums par pārseguma biezumu ${i}`, to: "user", agent: "ar", status: "open" }));
	const open = Array.from({ length: 40 }, (_, i) => task(`m${i}`, "bk", `Uzdevums ${i}`, day(i)));
	const text = statusText(proc(), { notes, open, now: NOW });
	assert.ok(text.length < 3000, `${text.length}`);
	const lines = text.split("\n");
	assert.ok(lines.includes("Atvērtie uzdevumi:"), "the questions do not push the tasks out");
	assert.ok(lines.filter((l) => l.startsWith("- J-")).length > 20 && lines.filter((l) => l.startsWith("- m")).length > 5);
	// every line is complete: a line cut in the middle would not match its shape
	for (const l of lines) assert.match(l, /^(Stadija S1 .*|Atvērtie (jautājumi|uzdevumi):|- J-\d+ user: Jautājums par pārseguma biezumu \d+|- m\d+ → bk: Uzdevums \d+)$/);
	assert.equal(statusText(proc(), { notes, open, now: NOW }, 200).length < 200, true, "a small limit cuts too");
});

// ---- registers --------------------------------------------------------------------------------------------------------------

test("14.5 a decision note renders as the 7.4 block, numbered by time; a cancellation is numbered too", () => {
	const notes = [
		note({ id: "d3", type: "decision", at: "2026-11-13T09:00:00Z", title: "Pārseguma biezums", body: "220 mm asīs 1-4.", agent: "bk", to: "ar", stage: "S4", reviewed: false }),
		note({ id: "d1", type: "decision", at: "2026-11-11T09:00:00Z", title: "Pirmais", body: "Pirmais lēmums.", agent: "ar", to: "bk", reviewed: true }),
		note({ id: "d2", type: "decision", at: "2026-11-12T09:00:00Z", title: "Atcelts: Pirmais", body: "Nederīgs.", by: "user", cancels: "d1", refs: ["d1"] }),
		note({ id: "q1", type: "question", at: "2026-11-10T09:00:00Z" }),
	];
	const log = decisionLog(notes);
	assert.equal(log.length, 3);
	assert.equal(log[2], ["L-3 | 2026-11-13 | S4 | Puses: ar, bk", "Temats: Pārseguma biezums", "Lēmums: 220 mm asīs 1-4.", "Ietekme: BK, AR", "BPV pārskatīts: nē"].join("\n"));
	assert.match(log[0], /^L-1 \| 2026-11-11 \| - \| Puses: ar, bk\n/);
	assert.match(log[0], /BPV pārskatīts: jā$/);
	assert.match(log[1], /^L-2 \| 2026-11-12 \| - \| Puses: -\nTemats: Atcelts: Pirmais\nLēmums: Nederīgs\./, "the cancellation has its own number");
});

test("14.5 a question note renders as the 7.5 block: the answer is the title of the answer note that refs it", () => {
	const notes = [
		note({ id: "q1", type: "question", at: "2026-11-10T09:00:00Z", title: "Kāds ir grunts ūdens līmenis?", agent: "bk", to: "user", stage: "S1", status: "closed" }),
		note({ id: "a1", type: "answer", at: "2026-11-11T09:00:00Z", title: "Līmenis -2,4 m", refs: ["q1"], by: "user" }),
		note({ id: "q2", type: "question", at: "2026-11-12T09:00:00Z", title: "Vai jumts ir zaļais?", agent: "ar", to: "bpv", status: "open" }),
	];
	const log = questionLog(notes);
	assert.equal(log[0], ["J-1 | 2026-11-10 | S1 | No: bk | Kam: user", "Jautājums: Kāds ir grunts ūdens līmenis?", "Ietekme, ja neatbild: nav", "Atbilde: Līmenis -2,4 m", "Statuss: slēgts"].join("\n"));
	assert.equal(log[1], ["J-2 | 2026-11-12 | - | No: ar | Kam: bpv", "Jautājums: Vai jumts ir zaļais?", "Ietekme, ja neatbild: nav", "Atbilde: -", "Statuss: atvērts"].join("\n"));
});

function project(over: { agents?: string[] } = {}) {
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const projectsDir = tmp();
	const store = ProjectStore.open(projectsDir, { id: "BD999", name: "BD999 Testa iela 1", root, createdAt: "2026-11-13T00:00:00Z" });
	return { root, projectsDir, store, state: proc({ profile: { ...proc().profile, agents: over.agents ?? PROFILE } }) };
}

test("14.5 exportRegisters writes the six kinds of file inside the data folder and overwrites its own files", () => {
	const { store, state } = project();
	store.writeNote(note({ id: "d1", type: "decision", at: "2026-11-11T09:00:00Z", title: "Pirmais", agent: "ar", to: "bk" }));
	store.writeNote(note({ id: "q1", type: "question", at: "2026-11-12T09:00:00Z", title: "Pirmais jautājums", agent: "ar", to: "user", status: "open" }));
	store.writeNote(note({ id: "r1", type: "risk", at: "2026-11-12T10:00:00Z", title: "Izpēte kavējas", body: "Pieņemam, ka grunts ir smilts.", agent: "bpv" }));
	store.writeNote(note({ id: "c1", type: "change", at: "2026-11-12T11:00:00Z", title: "Pasūtītājs prasa lielāku balkonu", agent: "bpv" }));
	store.writeNote(note({ id: "g1", type: "gate", at: "2026-11-12T12:00:00Z", title: "GATE H1 · S1", body: "GATE H1 | Projekts: BD999\n\nLūdzu atļauju turpināt.", agent: "bpv" }));
	const s: ProcessState = { ...state, profile: { ...state.profile, changes: [{ at: "2026-11-12T13:00:00Z", what: "S2 izlaista", why: "nav vajadzīga" }] }, gates: [{ id: "H1", stage: "S1", iteration: 1, state: "waiting", noteId: "g1", at: NOW }] };
	const dir = join(store.dir, "export", "00_vadiba");
	const paths = exportRegisters(store, dir, s);
	assert.deepEqual(readdirSync(dir).sort(), ["gate_H1.md", "izmainu_zurnals.md", "jautajumu_zurnals.md", "lemumu_zurnals.md", "projekta_statuss.md", "risku_registrs.md"]);
	assert.deepEqual(paths.map((p) => p.slice(dir.length + 1)).sort(), readdirSync(dir).sort());
	const rd = (f: string) => readFileSync(join(dir, f), "utf8");
	assert.match(rd("lemumu_zurnals.md"), /L-1 \| 2026-11-11 \| - \| Puses: ar, bk/);
	assert.match(rd("jautajumu_zurnals.md"), /J-1 \| 2026-11-12 \| - \| No: ar \| Kam: user[\s\S]*Statuss: atvērts/);
	assert.match(rd("risku_registrs.md"), /Izpēte kavējas[\s\S]*Pieņemam, ka grunts ir smilts\./);
	assert.match(rd("izmainu_zurnals.md"), /Pasūtītājs prasa lielāku balkonu[\s\S]*S2 izlaista \(nav vajadzīga\)/);
	assert.match(rd("projekta_statuss.md"), /^Stadija S1 \(iterācija 1 no 3\)\nGaida gate H1: lēmums cilvēkam\.\nAtvērtie jautājumi:\n- J-1 user: Pirmais jautājums/);
	assert.equal(rd("gate_H1.md").trim(), "GATE H1 | Projekts: BD999\n\nLūdzu atļauju turpināt.");

	// a gate note that has since been decided: the file follows the note's latest version; a second export replaces the first
	store.writeNote(note({ id: "g1", type: "gate", at: "2026-11-12T12:00:00Z", title: "GATE H1 · S1", body: "GATE H1 | Projekts: BD999\n\nLēmums 2026-11-16: apstiprināts.", agent: "bpv" }));
	store.writeNote(note({ id: "d2", type: "decision", at: "2026-11-14T09:00:00Z", title: "Otrais", agent: "bk", to: "ar" }));
	exportRegisters(store, dir, s);
	assert.match(rd("gate_H1.md"), /Lēmums 2026-11-16: apstiprināts\./);
	assert.match(rd("lemumu_zurnals.md"), /L-2 \| 2026-11-14/);
	assert.equal(rd("lemumu_zurnals.md").match(/^L-1 /gm)?.length, 1, "no duplicates from the earlier export");
});

test("14.5 exportRegisters with nothing to say writes nav; one gate file per gate id, the newest wins", () => {
	const { store, state } = project();
	store.writeNote(note({ id: "g1", type: "gate", at: "2026-11-12T12:00:00Z", title: "GATE H4 · S4", body: "pirmā", agent: "bpv" }));
	store.writeNote(note({ id: "g2", type: "gate", at: "2026-11-13T12:00:00Z", title: "GATE H4 · S4", body: "otrā", agent: "bpv" }));
	const s: ProcessState = {
		...state,
		stage: "S4",
		gates: [
			{ id: "H4", stage: "S4", iteration: 1, state: "returned", noteId: "g1", at: NOW },
			{ id: "H4", stage: "S4", iteration: 2, state: "waiting", noteId: "g2", at: NOW },
		],
	};
	const dir = join(store.dir, "export", "00_vadiba");
	exportRegisters(store, dir, s);
	assert.equal(readFileSync(join(dir, "lemumu_zurnals.md"), "utf8").trim().split("\n").at(-1), "nav");
	assert.equal(readFileSync(join(dir, "gate_H4.md"), "utf8").trim(), "otrā");
});

test("14.5 exportRegisters refuses a dir inside the office project folder, or outside the data folder, and writes nothing", () => {
	const { store, state, root } = project();
	const inOffice = join(root, "00_vadiba");
	assert.throws(() => exportRegisters(store, inOffice, state), /Izejas mapē app neraksta nekad/);
	assert.equal(existsSync(inOffice), false);
	assert.throws(() => exportRegisters(store, join(tmp(), "export"), state), /Ārpus app datu mapes/);
});

test("14.5 process.export returns the paths under <project data>\\export\\00_vadiba; no process state, no export", () => {
	const { store, state } = project();
	const settings = new AppSettings(tmp(), { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() });
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: () => undefined });
	assert.throws(() => h["process.export"]("BD999"), /Procesa režīms nav ieslēgts/);
	writeProcess(store, state, "user");
	const paths = h["process.export"]("BD999");
	assert.equal(paths.length, 5, "five files without a gate note");
	for (const p of paths) {
		assert.ok(p.startsWith(join(store.dir, "export", "00_vadiba")), p);
		assert.ok(existsSync(p), p);
	}
});

// ---- the stage card ---------------------------------------------------------------------------------------------------------

test("14.5 stageCard is the stage's card as text: title, goal, who, steps, output and gate", () => {
	const t = stageCard("S4");
	const c = STAGE_CARD.S4;
	assert.ok(t.startsWith(c.title));
	for (const x of [c.goal, c.involved, c.gate, ...c.actions, ...c.output]) assert.ok(t.includes(x), x);
});

// ---- open tasks -------------------------------------------------------------------------------------------------------------

test("14.5 openTasks: tasks not answered yet, not failed or stopped", () => {
	const t1 = task("m1", "ar", "Pirmais", "2026-11-10T08:00:00Z");
	const t2 = { ...task("m2", "ar", "Otrais", "2026-11-10T09:00:00Z"), state: "failed" as const };
	const t3 = task("m3", "bk", "Trešais", "2026-11-10T10:00:00Z");
	const answer: Message = { ...t3, id: "m4", kind: "reply", from: "bk", to: "bpv", fromThread: "t2", toThread: "t1", task: undefined };
	const ask: Message = { ...t1, id: "m5", kind: "ask", topic: "tp_ask" };
	assert.deepEqual(openTasks([t1, t2, t3, answer, ask]).map((m) => m.id), ["m1"]);
});

// ---- standing text: the runner -----------------------------------------------------------------------------------------------

function runnerSetup(profileAgents: string[] | null) {
	const { store, projectsDir, root } = project();
	const dir = tmp();
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const threads = new ThreadStore(join(dir, "threads"));
	const specs = ["bpv", "eks", "ar", "bk"].map(spec);
	const mailboxes = new Map<string, Mailbox>();
	const sys: string[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		complete: async () => ({}) as never,
		runAgent: async (o) => {
			sys.push(o.systemPrompt ?? "");
			o.onEvent({ type: "done", text: "ok" });
		},
		agents: () => specs,
		threads: () => threads,
		locks: new LockRegistry(),
		mail: (id) => mailboxes.get(id ?? "") ?? mailboxes.set(id ?? "", new Mailbox(mailDir(dir, projectsDir, id))).get(id ?? "")!,
	});
	if (profileAgents) writeProcess(store, initial("buvprojekts", profileAgents), "user");
	store.writeNote(note({ id: "q1", type: "question", at: "2026-11-12T09:00:00Z", title: "Vai ir izpēte?", agent: "ar", to: "user", status: "open" }));
	mailboxes.set("BD999", new Mailbox(mailDir(dir, projectsDir, "BD999")));
	mailboxes.get("BD999")!.add({ wave: "w", topic: "tp1", from: "bpv", to: "ar", kind: "task", text: "x", refs: [], fromThread: "t1", toThread: "t2", depth: 1, task: { id: "u1", goal: "Sagatavot izejas datu sarakstu", context: [], expects: "saraksts", iteration: 1 } });
	const textOf = async (agent: string) => {
		const sp = agent === LEAD_ID ? null : (specs.find((s) => s.id === agent) ?? null);
		const th = threads.create({ projectId: "BD999", agent, title: agent, startedBy: "user" });
		sys.length = 0;
		await runner.run({ runId: `r_${agent}`, thread: th, spec: sp, text: "labdien", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => true });
		return sys[0];
	};
	return { store, textOf, root };
}

test("14.5 process mode: every agent of the profile has the status, the stage's leader also the stage card, the lead only when it is in the profile", async () => {
	const t = runnerSetup(["bpv", "eks", "ar"]);
	const bpv = await t.textOf("bpv");
	assert.match(bpv, /Stadija S1 \(iterācija 1 no 3\)\nAtvērtie jautājumi:\n- J-1 user: Vai ir izpēte\?\nAtvērtie uzdevumi:\n- .* → ar: Sagatavot izejas datu sarakstu/);
	assert.ok(bpv.includes(STAGE_CARD.S1.title), "bpv leads S1: the card");
	const ar = await t.textOf("ar");
	assert.match(ar, /Stadija S1 /);
	assert.ok(!ar.includes(STAGE_CARD.S1.title), "ar does not lead S1");
	assert.ok(!(await t.textOf("bk")).includes("Stadija S1"), "bk is not in the profile");
	assert.ok(!(await t.textOf(LEAD_ID)).includes("Stadija S1"), "the lead is not in the profile");

	const t2 = runnerSetup(["bpv", "eks", "ar", "lead"]);
	assert.match(await t2.textOf(LEAD_ID), /Stadija S1 /);
});

test("14.5 the stage's leader changes with the stage: eks carries the S5 card", async () => {
	const t = runnerSetup(["bpv", "eks", "ar"]);
	writeProcess(t.store, { ...initial("buvprojekts", ["bpv", "eks", "ar"]), stage: "S5" }, "user");
	const eks = await t.textOf("eks");
	assert.ok(eks.includes(STAGE_CARD.S5.title) && eks.includes("Stadija S5 "));
	assert.ok(!(await t.textOf("bpv")).includes(STAGE_CARD.S5.title));
});

test("14.5 co-work: no status and no card for anybody, and the lead's text is byte-identical to the one without the fields", async () => {
	for (const profile of [null, ["bpv", "eks", "ar"]]) {
		const t = runnerSetup(profile);
		if (profile) {
			const s = initial("buvprojekts", profile);
			writeProcess(t.store, { ...s, mode: "cowork" }, "user");
		}
		for (const a of ["bpv", "ar", LEAD_ID]) {
			const text = await t.textOf(a);
			assert.ok(!text.includes("Stadija S1") && !text.includes("Atvērtie jautājumi") && !text.includes(STAGE_CARD.S1.title), `${a} ${profile ? "cowork" : "no process"}`);
		}
	}
	const d = { appDir: tmp(), userName: "Tests", specs: [spec("ar")], skills: [], knowledge: "" };
	assert.equal(standingFor(null, { ...d, processCard: "", status: "" }), standingFor(null, d));
	assert.ok(standingFor(null, { ...d, status: "STATUSS" }).endsWith("STATUSS"));
});

// ---- R38 ----------------------------------------------------------------------------------------------------------------------

test("14.5 (R38) a reply on an open topic between its two parties passes the profile rule; asks and tasks stay refused", () => {
	const specs = [...PROFILE, "ek"].map(spec);
	const p = proc({ profile: { ...proc().profile, agents: ["bpv", "ar"] } }); // bk is outside the profile
	const topic = (o: Partial<Topic> = {}): Topic => ({ id: "tp1", title: "Pārsegums", parties: ["ar", "bk"], parent: null, state: "open", openedAt: NOW, ...o });
	const c = { agents: specs, limits: DEFAULT_LIMITS, messages: [], process: p };
	const m = (o: object) => ({ from: "bk", to: "ar", kind: "reply" as const, topic: topic(), depth: 1, ...o });
	assert.equal(canSend(m({}), c).ok, true, "bk answers ar's question although bk is not in the profile");
	assert.equal(canSend(m({ from: "ar", to: "bk" }), c).ok, true, "and the other way round");
	for (const kind of ["ask", "task"] as const) {
		const r = canSend(m({ kind, from: "bpv", to: "bk", topic: null }), c);
		assert.equal(r.ok, false, kind);
		assert.equal((r as { reason: string }).reason, "Aģents bk nav procesa profilā.");
	}
	const ask = canSend(m({ kind: "ask" }), c);
	assert.equal(ask.ok === false && ask.reason, "Aģents bk nav procesa profilā.", "an ask from outside the profile stays refused even between the topic's parties");
	// not its own topic, a closed topic or a third party: the profile rule holds
	assert.equal(canSend(m({ topic: null }), c).ok, false);
	assert.equal(canSend(m({ topic: topic({ parties: ["ar", "bpv"] }) }), c).ok, false);
	const closed = canSend(m({ topic: topic({ state: "agreed" }) }), c);
	assert.equal(closed.ok === false && closed.code, "process");
});
