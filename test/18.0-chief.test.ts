// Phase C: BPV as Chief (task format, standing threads, limits, escalation, the level that flows down, "@visi"), the department lead, pause / full stop, incidents,
// check before done, pinned threads. The pure rules first; then the tools over a real mailbox and thread store; then the coordinator with a runner that does nothing.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { standingFor } from "../src/agent/agents.ts";
import { taskTools } from "../src/agent/task-tools.ts";
import { chiefOf } from "../src/agent/task-tools.ts";
import type { MailDeps } from "../src/agent/mail.ts";
import { afterCheck, checkBrief, CHECK_ROUNDS, fixBrief, readVerdict, roundsOf, worthChecking } from "../src/core/check-work.ts";
import { holdsChiefTools, levelOfMessages, mayAssign, mayHandleIncidentOf, minLevel, nextIteration, nextTaskId, standingThread, taskThreadTitle } from "../src/core/chief.ts";
import { Holds, applyPause, handoffText, heldBy, refusalText } from "../src/core/holds.ts";
import { INCIDENT_HARD_LIMIT, IncidentLedger, IncidentStore, STALL_MS, isStalled } from "../src/core/incidents.ts";
import { DEFAULT_LIMITS, Mailbox, answered, canSend, type Message } from "../src/core/messages.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { ThreadsDb, SCHEMA_VERSION } from "../src/core/threads-db.ts";
import type { Note } from "../src/core/model.ts";
import { checkEscalation, parseEscalation, renderEscalation } from "../src/shared/escalation.ts";
import { parseEveryone, toEveryoneText } from "../src/shared/everyone.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_DEPARTMENTS, type Department } from "../src/shared/departments.ts";
import { NOTHING_HELD } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { initial } from "../src/core/process.ts";
import { tmp } from "./helpers.ts";
import { ActivityLog } from "../src/main/activity.ts";
import { readUsage } from "../src/agent/usage.ts";

const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: "", prompt: "", tools: [], ...extra });
const TEAM: AgentSpec[] = ["bpv", "ar", "bk", "uk", "avk", "eks"].map((id) => spec(id));
// the inženiertīkli department is led by ŪK
const DEPTS: Department[] = DEFAULT_DEPARTMENTS.map((d) => (d.id === "inzeniertikli" ? { ...d, lead: "uk" } : d));

// ---- who may hand out work -------------------------------------------------------------------------------------------------------------------

test("mayAssign: BPV to anyone but Kvalitāte; a department lead only inside its department; nobody to eks", () => {
	assert.deepEqual(mayAssign("bpv", "ar", TEAM, DEPTS), { ok: true, as: "bpv" });
	assert.equal(mayAssign("bpv", "eks", TEAM, DEPTS).ok, false, "the expert reports to the human, not under BPV");
	assert.equal(mayAssign("bpv", "bpv", TEAM, DEPTS).ok, false);
	assert.equal(mayAssign("bpv", "nav", TEAM, DEPTS).ok, false);
	assert.deepEqual(mayAssign("uk", "avk", TEAM, DEPTS), { ok: true, as: "lead" }, "ŪK leads inženiertīkli");
	const out = mayAssign("uk", "ar", TEAM, DEPTS);
	assert.equal(out.ok, false, "AR is not in its department");
	assert.equal(mayAssign("ar", "bk", TEAM, DEPTS).ok, false, "an agent that leads nothing hands out nothing");
	assert.equal(holdsChiefTools("bpv", TEAM, DEPTS), true);
	assert.equal(holdsChiefTools("uk", TEAM, DEPTS), true);
	assert.equal(holdsChiefTools("ar", TEAM, DEPTS), false);
	assert.equal(holdsChiefTools("uk", TEAM, DEFAULT_DEPARTMENTS), false, "no lead set: only BPV");
});

test("process mode: a task is the stage leader's, and a department lead's inside its department", () => {
	const p = { ...initial("buvprojekts", ["bpv", "ar", "bk", "uk", "avk"]), stage: "S4" as const };
	const base = { limits: DEFAULT_LIMITS, messages: [] as Message[], process: p, agents: TEAM, departments: DEPTS };
	const ask = (from: string, to: string) => canSend({ from, to, kind: "task", topic: null, depth: 1, iteration: 1, stage: "S4" }, base);
	assert.equal(ask("bpv", "avk").ok, true);
	const lead = ask("uk", "avk");
	assert.equal(lead.ok, true, "a department lead may task its own department");
	const other = ask("uk", "bk");
	assert.equal(other.ok, false, "but not another department's agent");
	assert.equal(canSend({ from: "uk", to: "avk", kind: "task", topic: null, depth: 1, iteration: 1, stage: "S4" }, { ...base, departments: DEFAULT_DEPARTMENTS }).ok, false, "no lead set: nobody but the stage leader");
});

test("the ceiling flows down and is never raised on the way", () => {
	assert.equal(minLevel("confirm", "run"), "run");
	assert.equal(minLevel("run", "confirm"), "run");
	assert.equal(minLevel("confirm", "confirm"), "confirm");
	assert.equal(minLevel(undefined, "run"), "run");
	assert.equal(minLevel(undefined, undefined), undefined);
	const ms = [{ id: "m1", level: "confirm" as const }, { id: "m2", level: "run" as const }, { id: "m3" }];
	assert.equal(levelOfMessages(["m1"], ms), "confirm");
	assert.equal(levelOfMessages(["m1", "m2"], ms), "run", "the lowest of the messages a run reads");
	assert.equal(levelOfMessages(["m3"], ms), undefined, "a message with no ceiling leaves the receiver's own");
});

// ---- the task tools over a real mailbox -------------------------------------------------------------------------------------------------------

function kit(self = "bpv", o: { held?: (a: string) => string | null; level?: "run" | "confirm"; process?: ReturnType<typeof initial> | null } = {}) {
	const dir = tmp("chief-");
	const mailbox = new Mailbox(join(dir, "mail"));
	const threads = new ThreadStore(join(dir, "threads"));
	const mine = threads.create({ projectId: "P1", agent: self, title: "BPV saruna", startedBy: "user" });
	const notes: Note[] = [];
	let woke = 0;
	const changed: string[] = [];
	const deps = (agent: string, thread: string): MailDeps => ({
		mailbox,
		threads,
		agents: () => TEAM,
		limits: () => DEFAULT_LIMITS,
		self: { agent, threadId: thread, projectId: "P1", wave: "w1", depth: 0 },
		enqueue: () => void woke++,
		note: () => undefined,
		notes: () => ({ writeNote: (n) => void notes.push(n) }),
		notesChanged: () => undefined,
		process: () => o.process ?? null,
		departments: () => DEPTS,
		held: o.held,
		level: () => o.level,
		threadChanged: (t) => void changed.push(t.title),
	});
	const run = async (tool: { execute: (id: string, p: any) => Promise<any> }, p: object) => {
		const r = await tool.execute("x", p);
		return { text: r.content[0].text as string, error: !!r.isError };
	};
	return { mailbox, threads, mine, notes, deps, run, woke: () => woke, changed };
}
const toolOf = (d: MailDeps, name: string) => taskTools(d, { chief: true }).find((t) => t.name === name)!;
const GOAL = { goal: "Sagatavo ugunsdrošības daļu", expects: "06_dokumenti/ugunsdrosiba.docx", context: ["01_izejas_dati/PU.pdf"], stage: "S4" };

test("assign_task: UZDEVUMS into the agent's standing thread for the stage (made, then reused); the title carries the task id; the agent is woken", async () => {
	const k = kit();
	const d = k.deps("bpv", k.mine.id);
	const a = await k.run(toolOf(d, "assign_task"), { to: "ar", ...GOAL });
	assert.equal(a.error, false, a.text);
	const ar = k.threads.list({ agent: "ar" });
	assert.equal(ar.length, 1);
	assert.equal(ar[0].title, taskThreadTitle("S4", "ar", "U-1"));
	assert.match(ar[0].title, /U-1$/);
	const m = k.mailbox.messages();
	assert.equal(m.length, 1);
	assert.equal(m[0].kind, "task");
	assert.equal(m[0].task?.id, "U-1");
	assert.equal(m[0].task?.iteration, 1);
	assert.equal(m[0].toThread, ar[0].id);
	assert.equal(m[0].fromThread, k.mine.id);
	assert.equal(k.woke(), 1, "the coordinator is told to deliver and wake");

	// the next task for the same stage goes into the same thread; its title now names the new task
	const b = await k.run(toolOf(d, "assign_task"), { to: "ar", ...GOAL, goal: "Labo pēc piezīmēm", rework: true });
	assert.equal(b.error, false, b.text);
	assert.equal(k.threads.list({ agent: "ar" }).length, 1, "one standing thread per agent per stage");
	assert.match(k.threads.get(ar[0].id)!.title, /U-2$/);
	assert.equal(k.mailbox.messages()[1].task?.iteration, 2, "a rework counts up");
	// another stage: another thread
	await k.run(toolOf(d, "assign_task"), { to: "ar", ...GOAL, stage: "S6" });
	assert.equal(k.threads.list({ agent: "ar" }).length, 2);
});

test("assign_task: the 4th round of one stage's work is the user's, as a question with options and a recommendation (process 1.5, 8)", async () => {
	const k = kit();
	const d = k.deps("bpv", k.mine.id);
	for (let i = 0; i < 3; i++) assert.equal((await k.run(toolOf(d, "assign_task"), { to: "ar", ...GOAL, rework: i > 0 })).error, false);
	const fourth = await k.run(toolOf(d, "assign_task"), { to: "ar", ...GOAL, rework: true });
	assert.equal(fourth.error, true);
	assert.equal(k.mailbox.messages().length, 3, "nothing was sent");
	assert.equal(k.notes.length, 1);
	const e = parseEscalation(k.notes[0].body);
	assert.ok(e, "the question is an escalation the card can draw as buttons");
	assert.equal(e!.reason, "neatrisināts");
	assert.equal(e!.options.length, 3);
	assert.equal(k.notes[0].to, "user");
	assert.equal(k.notes[0].status, "open");
});

test("assign_task: refused for eks, for an agent outside the lead's department, and while the agent is paused; the refusal says why and sends nothing", async () => {
	const k = kit("bpv", { held: (a) => (a === "bk" ? handoffText("agent", "BK") : null) });
	const d = k.deps("bpv", k.mine.id);
	assert.equal((await k.run(toolOf(d, "assign_task"), { to: "eks", ...GOAL })).error, true);
	const paused = await k.run(toolOf(d, "assign_task"), { to: "bk", ...GOAL });
	assert.equal(paused.error, true);
	assert.match(paused.text, /apturēts/);
	assert.match(paused.text, /Nemēģini vēlreiz/);
	assert.equal(k.mailbox.messages().length, 0);
	const lead = kit("uk");
	const ld = lead.deps("uk", lead.mine.id);
	assert.equal((await lead.run(toolOf(ld, "assign_task"), { to: "avk", ...GOAL })).error, false, "ŪK leads its department");
	assert.equal((await lead.run(toolOf(ld, "assign_task"), { to: "bk", ...GOAL })).error, true);
	assert.equal(chiefOf(ld), true);
	assert.equal(chiefOf(kit("ar").deps("ar", "t")), false);
});

test("the Chief's ceiling goes with the task, and a process-mode task works for a department lead too", async () => {
	const p = { ...initial("buvprojekts", ["bpv", "ar", "bk", "uk", "avk"]), stage: "S4" as const };
	const k = kit("uk", { level: "run", process: p });
	const d = k.deps("uk", k.mine.id);
	const r = await k.run(toolOf(d, "assign_task"), { to: "avk", goal: "x", expects: "y" });
	assert.equal(r.error, false, r.text);
	assert.equal(k.mailbox.messages()[0].level, "run");
	assert.equal(k.mailbox.messages()[0].task?.stage, "S4", "the stage that is on is the default");
});

test("report_answer: ATBILDE with the task's id into the thread that handed it out; nothing to answer when no task is open", async () => {
	const k = kit();
	const bpv = k.deps("bpv", k.mine.id);
	await k.run(toolOf(bpv, "assign_task"), { to: "ar", ...GOAL });
	const arThread = k.threads.list({ agent: "ar" })[0];
	const ar = k.deps("ar", arThread.id);
	const ok = await k.run(taskTools(ar, { chief: false })[0] as never, { status: "izpildīts", results: ["06_dokumenti/ugunsdrosiba.docx"], decisions: ["L-3"] });
	assert.equal(ok.error, false, ok.text);
	const all = k.mailbox.messages();
	assert.equal(all.length, 2);
	assert.equal(all[1].kind, "reply");
	assert.equal(all[1].reply?.id, "U-1");
	assert.equal(all[1].toThread, k.mine.id);
	assert.equal(answered(all[0], all), true);
	const again = await k.run(taskTools(ar, { chief: false })[0] as never, { status: "izpildīts" });
	assert.equal(again.error, true, "answered once");
});

test("exchanges: at most 3 messages from each side on a topic, then the topic goes up (process 7.3); the task id and the iteration are counted from the mailbox", () => {
	const topic = { id: "t1", title: "x", parties: ["ar", "bk"] as [string, string], parent: null, state: "open" as const, openedAt: "" };
	const msg = (n: number, from: string): Message => ({ id: `m${n}`, at: "", wave: "w", topic: "t1", from, to: from === "ar" ? "bk" : "ar", kind: "ask", text: "", refs: [], fromThread: "a", toThread: "b", depth: 1, state: "delivered" });
	const sent = [msg(1, "ar"), msg(2, "bk"), msg(3, "ar"), msg(4, "bk"), msg(5, "ar")];
	const ok = canSend({ from: "bk", to: "ar", kind: "ask", topic, depth: 1 }, { agents: TEAM, limits: DEFAULT_LIMITS, messages: sent, departments: DEPTS });
	assert.equal(ok.ok, true, "bk has sent 2");
	const refused = canSend({ from: "ar", to: "bk", kind: "ask", topic, depth: 1 }, { agents: TEAM, limits: DEFAULT_LIMITS, messages: [...sent, msg(6, "ar")], departments: DEPTS });
	assert.equal(refused.ok, false);
	assert.equal(!refused.ok && refused.code, "exchanges");
	assert.equal(!refused.ok && refused.passUp, true, "the refusal passes the topic up");
	const tasks = [{ kind: "task" as const, toThread: "th", task: { id: "U-1", stage: "S4", goal: "", context: [], expects: "", iteration: 2 } }, { kind: "task" as const, toThread: "th", task: { id: "U-4", goal: "", context: [], expects: "", iteration: 1 } }];
	assert.equal(nextTaskId(tasks), "U-3");
	assert.equal(nextIteration(tasks, "th", "S4", true), 3);
	assert.equal(nextIteration(tasks, "th", "S4", false), 1);
	assert.equal(nextIteration(tasks, "th", "S6", true), 1, "another stage starts again");
	assert.equal(standingThread([{ id: "x", agent: "ar", title: "S4 · AR · U-1", state: "idle" }, { id: "y", agent: "ar", title: "S4 · AR · U-0", state: "closed" }], "S4", "ar")?.id, "x");
});

test("escalation: at most three options, a recommendation among them; the card reads back what was written; '@visi' goes to BPV", () => {
	const bad = checkEscalation({ reason: "izmaksas", problem: "p", options: ["a", "b", "c", "d"], recommend: 1 });
	assert.equal(bad.ok, false);
	assert.equal(checkEscalation({ reason: "izmaksas", problem: "p", options: ["a", "b"], recommend: 3 }).ok, false);
	assert.equal(checkEscalation({ reason: "nezināms", problem: "p", options: ["a"], recommend: 1 }).ok, false);
	const ok = checkEscalation({ reason: "termiņš", problem: "Termiņš ir apdraudēts", options: ["Pagarināt", "Samazināt apjomu"], recommend: 2, impact: "+2 darba dienas" });
	assert.ok(ok.ok);
	if (ok.ok) assert.deepEqual(parseEscalation(renderEscalation(ok.value)), ok.value);
	assert.equal(parseEscalation("kāds cits teksts"), null);
	assert.deepEqual(parseEveryone("@visi sagatavojiet statusu"), { text: "sagatavojiet statusu" });
	assert.deepEqual(parseEveryone("  @All, status?"), { text: "status?" });
	assert.deepEqual(parseEveryone("@visiem lūdzu"), { text: "lūdzu" });
	assert.equal(parseEveryone("@visparigais x"), null, "an agent whose name starts with the word is not everyone");
	assert.equal(parseEveryone("sveiki @visi"), null, "only at the start");
	assert.match(toEveryoneText("x"), /assign_task/);
});

// ---- pause ---------------------------------------------------------------------------------------------------------------------------------

test("pause state: an agent, a department, everything; resuming everything leaves what was paused by itself; saved and read back", () => {
	let s = applyPause(NOTHING_HELD, { kind: "agent", id: "ar" }, true);
	s = applyPause(s, { kind: "department", id: "inzeniertikli" }, true);
	assert.equal(heldBy(s, "ar", TEAM), "agent");
	assert.equal(heldBy(s, "avk", [spec("avk")]), "department", "avk is in inženiertīkli by default");
	assert.equal(heldBy(s, "bk", TEAM), null);
	const all = applyPause(s, { kind: "all" }, true);
	assert.equal(heldBy(all, "bk", TEAM), "all");
	assert.equal(heldBy(all, "lead", TEAM), "all", "a full stop holds the lead too");
	const back = applyPause(all, { kind: "all" }, false);
	assert.equal(heldBy(back, "ar", TEAM), "agent", "resume everything leaves the agent paused by itself paused");
	assert.match(refusalText("agent", "AR"), /Atsāc/);
	assert.match(refusalText("department", "AR", "Arhitektūra"), /Arhitektūra/);
	const file = join(tmp("holds-"), "paused.json");
	const h = new Holds(file);
	const r = h.set({ kind: "department", id: "inzeniertikli" }, true, ["lead", "ar", "uk", "avk"], [spec("ar"), spec("uk"), spec("avk")]);
	assert.deepEqual(r.newlyHeld.sort(), ["avk", "uk"]);
	assert.deepEqual(new Holds(file).view().departments, ["inzeniertikli"], "kept across a restart");
});

// ---- the coordinator: a paused agent starts nothing; a silent run is a stall -------------------------------------------------------------------

function rig(o: { incidents?: IncidentStore } = {}) {
	const dir = tmp("coord-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `threads-${p ?? "_"}`))), stores.get(p)!);
	const started: { agent: string; text: string; abort: AbortSignal; finish: (ok: boolean, error?: string) => void }[] = [];
	const runner = {
		run: (i: { thread: { agent: string }; text: string; signal: AbortSignal; emit: (e: any) => void }) =>
			new Promise<{ ok: boolean; answer: string; confirmedBatches: number }>((resolve) => {
				const entry = {
					agent: i.thread.agent, text: i.text, abort: i.signal,
					finish: (ok: boolean, error?: string) => {
						if (error) i.emit({ type: "error", engine: "pi", message: error });
						resolve({ ok, answer: ok ? "gatavs" : "", confirmedBatches: 0 });
					},
				};
				started.push(entry);
				i.signal.addEventListener("abort", () => resolve({ ok: false, answer: "", confirmedBatches: 0 }));
			}),
	};
	const specs = TEAM;
	const holds = new Holds();
	const incidents = o.incidents ?? new IncidentStore();
	const waiting: number[] = [];
	const c = new Coordinator({ runner: runner as never, threads, settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }), emit: () => undefined, queueFile: join(dir, "queue.json"), specs: () => specs, holds, incidents, departments: () => DEPTS, onWaiting: (w) => void waiting.push(w.length) });
	const open = (agent: string) => threads("P1").create({ projectId: "P1", agent, title: agent, startedBy: "user" });
	return { c, open, started, incidents, holds, threads };
}
const start = (r: ReturnType<typeof rig>, agent: string, text = "darbs") => r.c.start({ threadId: r.open(agent).id, projectId: "P1", text, focus: [], cause: { by: "user" } });

test("pause an agent: its run stops, a new message is refused with the reason, others go on; Resume lets it start", async () => {
	const r = rig();
	await start(r, "ar");
	await start(r, "bk");
	assert.equal(r.started.length, 2);
	const out = r.c.setHold({ kind: "agent", id: "ar" }, true);
	assert.equal(out.stopped, 1);
	assert.equal(r.started[0].abort.aborted, true, "the paused agent's run was stopped");
	assert.equal(r.started[1].abort.aborted, false, "another agent's run was not");
	await assert.rejects(start(r, "ar"), /ir apturēts/);
	assert.match(r.c.handoffRefusal("ar") ?? "", /Nemēģini vēlreiz/);
	assert.equal(r.c.handoffRefusal("bk"), null);
	assert.deepEqual(r.c.view().held.agents, ["ar"], "the window's view says who is paused");
	r.c.setHold({ kind: "agent", id: "ar" }, false);
	await start(r, "ar");
	assert.equal(r.started.length, 3, "after Resume it starts work again");
	r.started[1].finish(true);
});

test("pause a department: its agents are held, other departments are not; an unknown one is refused", async () => {
	const r = rig();
	r.c.setHold({ kind: "department", id: "inzeniertikli" }, true);
	await assert.rejects(start(r, "uk"), /Nodaļa/);
	await assert.rejects(start(r, "avk"), /apturēta/);
	await start(r, "ar");
	assert.equal(r.started.length, 1);
	assert.throws(() => r.c.setHold({ kind: "department", id: "nav-tadas" }, true), /Nav nodaļas/);
	assert.throws(() => r.c.setHold({ kind: "agent", id: "nav-tada" }, true), /Nav aģenta/);
});

test("full stop: every run is stopped, the queue is dropped, and nothing starts until everything is resumed", async () => {
	const r = rig();
	await start(r, "ar");
	await start(r, "bk");
	const out = r.c.setHold({ kind: "all" }, true);
	assert.equal(out.stopped, 2);
	assert.ok(r.started.every((s) => s.abort.aborted));
	await assert.rejects(start(r, "uk"), /Viss ir apturēts/);
	assert.equal(r.c.view().held.all, true);
	r.c.setHold({ kind: "all" }, false);
	await start(r, "uk");
	assert.equal(r.started.length, 3);
});

test("a queued item of a paused agent waits and starts on Resume", async () => {
	const r = rig();
	// the cap is 4: queue behind a held agent by pausing first, then a message start from an agent (not the user) is held in the queue
	const t = r.open("ar");
	r.c.setHold({ kind: "agent", id: "ar" }, true);
	const res = await r.c.start({ threadId: t.id, projectId: "P1", text: "x", focus: [], cause: { by: "message", ids: ["m1"] } });
	assert.equal(res.queued, true, "held: it waits in the queue");
	assert.equal(r.started.length, 0);
	r.c.setHold({ kind: "agent", id: "ar" }, false);
	assert.equal(r.started.length, 1, "Resume starts what waited");
	r.started[0].finish(true);
});

test("incidents: a failed run is listed with its request; a run the user stopped is not; a stalled run is stopped and listed; a run that works clears it", async () => {
	const r = rig();
	await start(r, "ar", "Pārbaudi sienas");
	r.started[0].finish(false, "engine exited with code 1");
	await new Promise((res) => setTimeout(res, 20));
	let list = r.incidents.list();
	assert.equal(list.length, 1);
	assert.equal(list[0].what, "failed");
	assert.match(list[0].detail, /engine exited/);
	assert.match(list[0].request, /Pārbaudi sienas/);
	assert.equal(list[0].agent, "ar");
	assert.equal(r.c.waiting().filter((w) => w.kind === "incident").length, 1, "it shows in Gaida tevi");

	// the user's own Stop is no incident
	const t = r.open("bk");
	const run = await r.c.start({ threadId: t.id, projectId: "P1", text: "x", focus: [], cause: { by: "user" } });
	assert.ok(run.runId);
	r.c.stopThread(t.id);
	await new Promise((res) => setTimeout(res, 20));
	assert.equal(r.incidents.list().length, 1);

	// silent for 20 minutes: the watchdog stops it
	await start(r, "uk");
	const last = r.started.length - 1;
	assert.equal(r.c.sweep(Date.now() + 5 * 60_000), 0, "5 minutes is not a stall");
	assert.equal(r.c.sweep(Date.now() + STALL_MS + 1000), 1);
	assert.equal(r.started[last].abort.aborted, true);
	list = r.incidents.list();
	assert.ok(list.some((i) => i.agent === "uk" && i.what === "stalled"));

	// Retry starts the thread again and takes the incident off the list; Dismiss only takes it off
	const inc = list.find((i) => i.agent === "ar")!;
	const retried = r.c.retryIncident(inc.id);
	assert.ok(retried.runId);
	assert.equal(r.incidents.get(inc.id), undefined);
	assert.match(r.started[r.started.length - 1].text, /Iepriekšējais gājiens/);
	const stall = r.incidents.list().find((i) => i.what === "stalled")!;
	r.c.dismissIncident(stall.id);
	assert.equal(r.incidents.get(stall.id), undefined);
	assert.throws(() => r.c.dismissIncident(stall.id), /nav sarakstā/);
	// the retried run works: nothing is left for that thread
	r.started[r.started.length - 1].finish(true);
});

test("incidents: Retry is offered twice an hour, the third incident says fix the cause, the sixth is muted; a parked run never stalls", () => {
	let now = 1_000_000;
	const ledger = new IncidentLedger({ now: () => now });
	const seen = [1, 2, 3, 4, 5, 6].map(() => ledger.note("th"));
	assert.deepEqual(seen.map((c) => c.mayRetry), [true, true, false, false, false, false]);
	assert.equal(seen[INCIDENT_HARD_LIMIT - 1].muted, false);
	assert.equal(seen[INCIDENT_HARD_LIMIT].muted, true);
	now += 61 * 60_000;
	assert.equal(ledger.note("th").count, 1, "the hour passed");
	assert.equal(isStalled(0, STALL_MS, false), true);
	assert.equal(isStalled(0, STALL_MS - 1, false), false);
	assert.equal(isStalled(0, STALL_MS * 3, true), false, "waiting for the user is not a stall");
	const file = join(tmp("inc-"), "incidents.json");
	const store = new IncidentStore(file, new IncidentLedger());
	const a = store.add({ projectId: "P1", threadId: "t1", agent: "ar", what: "failed", detail: "x", request: "y" })!;
	assert.equal(new IncidentStore(file).get(a.id)?.agent, "ar", "kept across a restart");
	assert.equal(store.settled("t1"), true);
	assert.equal(new IncidentStore(file).list().length, 0);
});

// ---- check before done -------------------------------------------------------------------------------------------------------------------

test("check before done: the verdict is the first line only; 3 checks and 2 fixes, never more; a failure leaves the answer as it is", () => {
	assert.deepEqual(readVerdict("pass"), { kind: "pass" });
	assert.deepEqual(readVerdict("**Pass**\nviss kārtībā"), { kind: "pass" });
	assert.deepEqual(readVerdict("issues: 2\n1. ..."), { kind: "issues", count: 2 });
	assert.deepEqual(readVerdict("issues: 0"), { kind: "pass" });
	assert.deepEqual(readVerdict("cannot check: PDF nav nolasāms"), { kind: "cannot", reason: "PDF nav nolasāms" });
	assert.deepEqual(readVerdict("Es domāju, ka viss ir labi. pass"), { kind: "unclear" }, "a pass later in the text is never a pass");
	// the loop: every round finds issues
	let fixes = 0;
	let checks = 0;
	for (let round = 1; round <= CHECK_ROUNDS + 5; round++) {
		checks++;
		const next = afterCheck({ kind: "issues", count: 1 }, round, CHECK_ROUNDS);
		if (next.do === "end") {
			assert.equal(next.outcome, "open", "the last check's issues stay open");
			break;
		}
		fixes++;
	}
	assert.equal(checks, 3);
	assert.equal(fixes, 2);
	assert.deepEqual(afterCheck({ kind: "pass" }, 1, 3), { do: "end", outcome: "passed" });
	assert.equal(afterCheck({ kind: "cannot", reason: "" }, 1, 3).do, "end");
	assert.equal(afterCheck({ kind: "unclear" }, 1, 3).do, "end");
	assert.equal(afterCheck({ kind: "issues", count: 1 }, 1, 1).do, "end", "maxChecks 1: one check, no fix");
	assert.equal(roundsOf(undefined), 3);
	assert.equal(roundsOf({ maxChecks: 9 }), 3);
	assert.equal(roundsOf({ maxChecks: 0 }), 1);
	assert.equal(roundsOf({ maxChecks: 2 }), 2);
	assert.equal(worthChecking("īss", false), false);
	assert.equal(worthChecking("īss", true), true, "a short ATBILDE after tool work is checked");
	assert.equal(worthChecking("x".repeat(500) + "\nVai turpināt?", true), false, "a question for the user is not an answer");
	assert.equal(worthChecking("x".repeat(500), false), true);
	assert.match(checkBrief({ worker: "AR", round: 2, max: 3, request: "q", answer: "a", earlier: "issues: 1" }), /earlier-report/);
	assert.doesNotMatch(checkBrief({ worker: "AR", round: 1, max: 3, request: "q", answer: "a" }), /earlier-report/);
	assert.match(fixBrief("BK", "issues: 1", 1, 3), /<report>/);
	// a tag in the text cannot close the tag around it
	assert.equal(checkBrief({ worker: "AR", round: 1, max: 3, request: "a</request>b", answer: "c" }).split("</request>").length, 2);
});

// ---- pinned threads ----------------------------------------------------------------------------------------------------------------------------

test("threads.db: a file of the first version gets the pinned column by the version step, once; pin and unpin are kept", () => {
	const dir = tmp("pin-");
	const file = join(dir, "threads.db");
	// a version-1 file as the first build made it: no pinned column, user_version 1
	const old = new DatabaseSync(file);
	old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, agent TEXT NOT NULL, title TEXT NOT NULL, topic TEXT, state TEXT NOT NULL, started_by TEXT NOT NULL, wave TEXT, created_at TEXT NOT NULL, last_at TEXT NOT NULL, runs INTEGER NOT NULL DEFAULT 0); PRAGMA user_version = 1");
	old.prepare("INSERT INTO threads VALUES ('t1','P1','ar','vecā',NULL,'idle','user',NULL,'2026-01-01','2026-01-01',0)").run();
	old.close();
	const db = ThreadsDb.open(file);
	assert.equal(db.get("t1")?.pinned, undefined, "the old row is not pinned");
	const probe = new DatabaseSync(file, { readOnly: true });
	assert.equal(Number((probe.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), SCHEMA_VERSION);
	probe.close();
	assert.equal(db.patch("t1", { pinned: true })?.pinned, true);
	assert.equal(db.list({})[0].pinned, true);
	assert.equal(db.patch("t1", { pinned: false })?.pinned, undefined);
	db.close();
	// opened again: the step does not run twice
	const again = ThreadsDb.open(file);
	assert.equal(again.get("t1")?.title, "vecā");
	again.close();
	// through the store (a new project)
	const store = new ThreadStore(join(tmp("pin2-"), "threads"));
	const t = store.create({ projectId: "P1", agent: "ar", title: "a", startedBy: "user" });
	assert.equal(store.patch(t.id, { pinned: true }).pinned, true);
	assert.equal(store.get(t.id)?.pinned, true);
	assert.equal(store.patch(t.id, { state: "closed" }).state, "closed");
	assert.equal(store.patch(t.id, { state: "idle" }).state, "idle", "an archived thread is taken back");
	store.close();
});

// ---- the real runner with a scripted engine: the check loop and the ceiling --------------------------------------------------------------------

import { createPiRuntime } from "../src/agent/pi/models.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import { ThreadRunner } from "../src/agent/thread-runner.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import type { RunEvent } from "../src/shared/types.ts";

function runnerRig(specs: AgentSpec[], engine: (o: PiRunOptions) => Promise<void>) {
	const dir = tmp("runner-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `th-${p ?? "_"}`))), stores.get(p)!);
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => specs,
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: engine as never,
		threads,
		locks: new LockRegistry(),
	});
	const thread = threads(null).create({ projectId: null, agent: specs[0].id, title: "t", startedBy: "user" });
	const go = async (spec: AgentSpec, text: string, extra: { levelCap?: "run" | "confirm" } = {}) => {
		const events: RunEvent[] = [];
		const r = await runner.run({ runId: "r1", thread, spec, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async () => false, ...extra });
		return { r, events, transcript: threads(null).transcript(thread.id) };
	};
	return { go, threads, thread, dir };
}

test("check before done: the checker finds an issue, the agent fixes it in a full turn of its own, the second check passes; the card gets each check and one done with the fixed answer", async () => {
	const seen: string[] = [];
	const engine = async (o: PiRunOptions) => {
		const prompt = o.prompt;
		const isCheck = (o.systemPrompt ?? "").includes("You check another agent's finished work");
		const kind = isCheck ? "check" : prompt.includes("<report>") ? "fix" : "work";
		seen.push(kind);
		const checks = seen.filter((k) => k === "check").length;
		const text = kind === "work" ? `Pirmā versija. ${"x".repeat(450)}` : kind === "fix" ? `Labotā versija. ${"y".repeat(450)}` : checks === 1 ? "issues: 1\n1. Trūkst lappuses atsauces." : "pass";
		o.onEvent({ type: "usage", input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null });
		o.onEvent({ type: "done", text });
	};
	const ar = spec("ar", { check: { maxChecks: 3 } });
	const k = runnerRig([ar], engine);
	const { r, events, transcript } = await k.go(ar, "Sagatavo sienu sarakstu");
	assert.deepEqual(seen, ["work", "check", "fix", "check"], "one check, one fix, one check; no more");
	assert.equal(r.ok, true);
	assert.match(r.answer, /^Labotā versija/);
	const checks = events.filter((e): e is Extract<RunEvent, { type: "check" }> => e.type === "check");
	assert.deepEqual(checks.map((c) => `${c.n}:${c.phase}:${c.verdict ?? ""}`), ["1:start:", "1:end:issues", "1:fix:", "1:fixed:", "2:start:", "2:end:pass", "2:total:"]);
	assert.equal(checks[1].count, 1);
	assert.match(checks[1].report ?? "", /lappuses atsauces/);
	const done = events.filter((e) => e.type === "done");
	assert.equal(done.length, 1, "one done, with the last answer");
	assert.match((done[0] as { text: string }).text, /^Labotā/);
	assert.ok(events.filter((e) => e.type === "usage").length >= 4, "the check and fix turns' tokens are counted in the run");
	// the transcript: request, first answer, the fix request, the fixed answer
	assert.deepEqual(transcript.map((t) => t.role), ["user", "assistant", "user", "assistant"]);
});

test("check before done: each check and fix line carries its own tokens and price, the last line the totals, and the usage log has them under the model that really worked", async () => {
	// work 1.0 cent, check 0.2 cent (the checker is on another provider), fix 0.4 cent; the second check has no price
	const engine = async (o: PiRunOptions) => {
		const isCheck = (o.systemPrompt ?? "").includes("You check another agent's finished work");
		const kind = isCheck ? "check" : o.prompt.includes("<report>") ? "fix" : "work";
		const first = !seenChecks.length || kind !== "check";
		if (kind === "check") seenChecks.push(1);
		const u = kind === "work" ? { input: 1000, output: 200, cost: 0.01 } : kind === "fix" ? { input: 2000, output: 300, cost: 0.004 } : first ? { input: 500, output: 40, cost: 0.002 } : { input: 700, output: 10, cost: null };
		o.onEvent({ type: "usage", input: u.input, output: u.output, cacheRead: 0, cacheWrite: 0, cost: u.cost });
		o.onEvent({ type: "done", text: kind === "work" ? `Pirmā versija. ${"x".repeat(450)}` : kind === "fix" ? `Labotā versija. ${"y".repeat(450)}` : first ? "issues: 1\n1. Trūkst." : "pass" });
	};
	const seenChecks: number[] = [];
	const ar = spec("ar", { check: { maxChecks: 3, provider: "openai", model: "gpt-5" } });
	const k = runnerRig([ar], engine);
	const { events } = await k.go(ar, "Sagatavo sienu sarakstu");
	// the events: usage per turn on end / fixed, and one total
	const ev = events.filter((e): e is Extract<RunEvent, { type: "check" }> => e.type === "check");
	const end1 = ev.find((e) => e.phase === "end" && e.n === 1)!;
	assert.deepEqual([end1.usage?.input, end1.usage?.output, end1.usage?.cost], [500, 40, 0.002]);
	const fixed = ev.find((e) => e.phase === "fixed")!;
	assert.deepEqual([fixed.usage?.input, fixed.usage?.output, fixed.usage?.cost], [2000, 300, 0.004]);
	const end2 = ev.find((e) => e.phase === "end" && e.n === 2)!;
	assert.equal(end2.usage?.cost, null, "a check with no catalogue price shows tokens only");
	const total = ev.filter((e) => e.phase === "total");
	assert.equal(total.length, 1);
	assert.deepEqual([total[0].checks, total[0].fixes, total[0].usage?.input, total[0].usage?.output], [2, 1, 3200, 350]);
	assert.ok(Math.abs((total[0].usage?.cost ?? 0) - 0.006) < 1e-9, "the work turn's price is not in the checks' total");
	// the run card's lines
	const sent: { step?: string; text: string }[] = [];
	const log = new ActivityLog({ send: (a) => sent.push(a), sources: () => [], levelOf: () => "read", templates: [] });
	for (const e of events) log.event("r1", e);
	const line = (step: string) => [...sent].reverse().find((l) => l.step === step)?.text ?? "";
	assert.match(line("check-1"), /1 problēma, labo · 500 ievade · 40 izvade · \$0\.002$/);
	assert.match(line("check-1-fix"), /^Labots pēc pārbaudes 1\/3 · 2\.0K ievade · 300 izvade · \$0\.004$/);
	assert.match(line("check-2"), /kļūdu nav · 700 ievade · 10 izvade · cena nav zināma$/);
	assert.equal(line("check-total"), "Pārbaudes kopā: 2 pārbaudes, 1 labojums — 3.5K tokeni, $0.006 (no 2 no 3 piegājieniem)");
	// the usage totals: the checks are logged under the checker's provider, the work and the fix under the agent's own model
	const rows = readUsage(join(k.dir, "usage.jsonl"));
	assert.equal(rows.length, 4);
	assert.deepEqual(rows.filter((r) => r.model.startsWith("openai/")).map((r) => r.input), [500, 700], "the check turns are counted under the checker's provider");
	assert.equal(rows.filter((r) => !r.model.startsWith("openai/")).length, 2);
});

test("check before done: every check finds issues -> 3 checks and 2 fixes, then the answer stays with the issues open; a checker that cannot work leaves the answer as it is", async () => {
	const seen: string[] = [];
	const engine = async (o: PiRunOptions) => {
		const isCheck = (o.systemPrompt ?? "").includes("You check another agent's finished work");
		seen.push(isCheck ? "check" : o.prompt.includes("<report>") ? "fix" : "work");
		o.onEvent({ type: "done", text: isCheck ? "issues: 2\n1. a\n2. b" : `Atbilde ${seen.length}. ${"z".repeat(450)}` });
	};
	const ar = spec("ar", { check: {} });
	const k = runnerRig([ar], engine);
	const { events } = await k.go(ar, "x");
	assert.deepEqual(seen, ["work", "check", "fix", "check", "fix", "check"]);
	const ends = events.filter((e): e is Extract<RunEvent, { type: "check" }> => e.type === "check" && e.phase === "end");
	assert.equal(ends.length, 3);
	assert.ok(ends.every((e) => e.verdict === "issues"));
	// a checker that says nothing usable: not checked, the answer is delivered as it is
	const seen2: string[] = [];
	const engine2 = async (o: PiRunOptions) => {
		const isCheck = (o.systemPrompt ?? "").includes("You check another agent's finished work");
		seen2.push(isCheck ? "check" : "work");
		o.onEvent({ type: "done", text: isCheck ? "Izskatās labi." : `Atbilde. ${"z".repeat(450)}` });
	};
	const k2 = runnerRig([ar], engine2);
	const out = await k2.go(ar, "x");
	assert.deepEqual(seen2, ["work", "check"]);
	assert.equal(out.events.filter((e) => e.type === "check" && e.phase === "end" && e.verdict === "unclear").length, 1);
	assert.match(out.r.answer, /^Atbilde\./);
	assert.equal(out.events.filter((e) => e.type === "done").length, 1);
});

test("an agent with no check setting runs one turn and announces done itself; a short answer after no tool work is not checked", async () => {
	const seen: string[] = [];
	const engine = async (o: PiRunOptions) => {
		seen.push("turn");
		o.onEvent({ type: "done", text: "īsi" });
	};
	const plain = spec("ar");
	const out = await runnerRig([plain], engine).go(plain, "x");
	assert.deepEqual(seen, ["turn"]);
	assert.equal(out.events.filter((e) => e.type === "done").length, 1);
	const checked = spec("bk", { check: {} });
	seen.length = 0;
	const short = await runnerRig([checked], engine).go(checked, "x");
	assert.deepEqual(seen, ["turn"], "too short to be worth a check");
	assert.equal(short.events.filter((e) => e.type === "done").length, 1, "the held done still goes out");
});

test("the ceiling a task brings lowers the agent's own: a confirm-level agent under a run-level Chief is offered no confirm tool", async () => {
	const offered: string[][] = [];
	const engine = async (o: PiRunOptions) => {
		offered.push(Object.values(o.mcp).flatMap((m) => [...m.allow]));
		o.onEvent({ type: "done", text: "ok" });
	};
	const ar = spec("ar", { maxLevel: "confirm", tools: ["draw_sketch", "set_fact"] });
	const { allTools } = await import("../src/agent/tools/defs.ts");
	const confirmTool = allTools().find((t) => t.level === "confirm")?.name;
	assert.ok(confirmTool, "the app has a confirm-level tool to test with");
	const withTool = spec("ar", { maxLevel: "confirm", tools: [confirmTool!] });
	await runnerRig([withTool], engine).go(withTool, "x");
	await runnerRig([withTool], engine).go(withTool, "x", { levelCap: "run" });
	assert.ok(offered[0].includes(confirmTool!), "on its own it has the confirm tool");
	assert.ok(!offered[1].includes(confirmTool!), "under a run-level Chief it does not");
	void ar;
});

// ---- BPV and a department lead retry a stuck agent's thread -----------------------------------------------------------------------------------

test("mayHandleIncidentOf: BPV for every agent but Kvalitāte; a lead inside its department only; never eks, never one's own", () => {
	assert.deepEqual(mayHandleIncidentOf("bpv", "ar", TEAM, DEPTS), { ok: true, as: "bpv" });
	assert.equal(mayHandleIncidentOf("bpv", "eks", TEAM, DEPTS).ok, false);
	assert.equal(mayHandleIncidentOf("bpv", "bpv", TEAM, DEPTS).ok, false);
	assert.deepEqual(mayHandleIncidentOf("uk", "avk", TEAM, DEPTS), { ok: true, as: "lead" });
	const other = mayHandleIncidentOf("uk", "ar", TEAM, DEPTS);
	assert.equal(other.ok, false);
	assert.match(other.ok ? "" : other.reason, /To dara BPV/);
	assert.equal(mayHandleIncidentOf("ar", "bk", TEAM, DEPTS).ok, false, "an agent that leads nothing retries nothing");
});

const failedOn = async (r: ReturnType<typeof rig>, thread: { id: string }, message = "engine exited with code 1") => {
	const at = r.started.length;
	await r.c.start({ threadId: thread.id, projectId: "P1", text: "darbs", focus: [], cause: { by: "user" } });
	r.started[at].finish(false, message);
	await new Promise((res) => setTimeout(res, 20));
};

test("retry_thread / list_incidents: the user's Retry done by an agent: authority, pause, the limit shared with the user, and who retried", async () => {
	const r = rig();
	const k = kit("bpv");
	const wire = (agent: string): MailDeps => ({
		...k.deps(agent, k.mine.id),
		incidents: () => r.c.listIncidents("P1"),
		retryIncident: (id) => r.c.retryIncident(id, { agent, projectId: "P1" }),
	});
	const bpv = wire("bpv");
	const list = toolOf(bpv, "list_incidents");
	const retry = toolOf(bpv, "retry_thread");
	assert.match((await k.run(list, {})).text, /Atvērtu incidentu nav/);
	assert.equal((await k.run(retry, {})).error, true, "needs an incident or a thread");

	const ar = r.open("ar");
	const eks = r.open("eks");
	const avk = r.open("avk");
	await failedOn(r, ar);
	await failedOn(r, eks);
	await failedOn(r, avk);
	const inc = (agent: string) => r.incidents.list().find((i) => i.agent === agent)!;

	// BPV sees ar and avk, not eks; the line carries agent, thread, kind and what the run said
	const seen = (await k.run(list, {})).text;
	assert.match(seen, new RegExp(`${inc("ar").id} · ar · saruna ${ar.id} · neizdevās`));
	assert.match(seen, /engine exited/);
	assert.match(seen, /avk/);
	assert.doesNotMatch(seen, /· eks ·/, "the expert is not BPV's to manage");
	// a department lead sees its own department only
	const uk = wire("uk");
	const leadSees = (await k.run(toolOf(uk, "list_incidents"), {})).text;
	assert.match(leadSees, /· avk ·/);
	assert.doesNotMatch(leadSees, /· ar ·/);

	// outside its authority: refused, the incident stays
	const outside = await k.run(toolOf(uk, "retry_thread"), { incident: inc("ar").id });
	assert.equal(outside.error, true);
	assert.match(outside.text, /To dara BPV/);
	const expert = await k.run(retry, { incident: inc("eks").id });
	assert.match(expert.text, /Kvalitātes nodaļā/);
	assert.ok(r.incidents.get(inc("ar").id) && r.incidents.get(inc("eks").id));

	// paused: refused with the pause's own words, nothing started, the incident stays
	r.c.setHold({ kind: "agent", id: "ar" }, true);
	const before = r.started.length;
	const paused = await k.run(retry, { incident: inc("ar").id });
	assert.equal(paused.error, true);
	assert.match(paused.text, /ir apturēts/);
	assert.equal(r.started.length, before);
	assert.ok(r.incidents.get(inc("ar").id));
	r.c.setHold({ kind: "agent", id: "ar" }, false);

	// a lead retries inside its department; by thread id works as well
	const ok = await k.run(toolOf(uk, "retry_thread"), { thread: avk.id });
	assert.equal(ok.error, false, ok.text);
	assert.match(r.started[r.started.length - 1].text, /UK atkārtoja/);
	r.started[r.started.length - 1].finish(true);
	await new Promise((res) => setTimeout(res, 20));
	assert.equal(r.incidents.list().some((i) => i.agent === "avk"), false, "the retried thread worked: no incident is left");

	// BPV retries ar: the same text the user's Retry sends, plus who did it
	const first = await k.run(retry, { incident: inc("ar").id });
	assert.equal(first.error, false, first.text);
	const text = r.started[r.started.length - 1].text;
	assert.match(text, /Iepriekšējais gājiens/);
	assert.match(text, /BPV atkārtoja/);
	assert.equal(r.incidents.get(inc("ar")?.id ?? ""), undefined);
	// it fails again: the new incident says who retried it
	r.started[r.started.length - 1].finish(false, "engine exited again");
	await new Promise((res) => setTimeout(res, 20));
	assert.equal(inc("ar").retriedBy, "BPV");
	assert.match((await k.run(list, {})).text, /atkārtots 1× \(BPV atkārtoja\)/);

	// the limit is the user's: a second retry, by the user this time, uses up the allowance; BPV is refused the third
	assert.ok(r.c.retryIncident(inc("ar").id).runId);
	r.started[r.started.length - 1].finish(false, "and again");
	await new Promise((res) => setTimeout(res, 20));
	assert.equal(inc("ar").mayRetry, false);
	assert.equal(inc("ar").retriedBy, undefined, "the user retried last");
	const third = await k.run(retry, { incident: inc("ar").id });
	assert.equal(third.error, true);
	assert.match(third.text, /atkārtota divreiz/);
	assert.ok(r.incidents.get(inc("ar").id), "a refused retry leaves the incident where it was");
	assert.match((await k.run(list, {})).text, /atkārtot vairs nedrīkst, eskalē/);
});

test("retry_thread: an incident of another project is refused; the Chief's tools carry the incident line in the standing text", async () => {
	const r = rig();
	const ar = r.threads("P2").create({ projectId: "P2", agent: "ar", title: "ar", startedBy: "user" });
	await r.c.start({ threadId: ar.id, projectId: "P2", text: "x", focus: [], cause: { by: "user" } });
	r.started[0].finish(false, "boom");
	await new Promise((res) => setTimeout(res, 20));
	const inc = r.incidents.list()[0];
	assert.equal(r.c.listIncidents("P1").length, 0);
	assert.throws(() => r.c.retryIncident(inc.id, { agent: "bpv", projectId: "P1" }), /citā projektā/);
	assert.ok(r.incidents.get(inc.id));
	const text = standingFor(null, { appDir: tmp("st-"), userName: "B", specs: TEAM, skills: [], knowledge: "" });
	assert.doesNotMatch(text, /list_incidents/, "the lead's own text is unchanged");
	const bpvText = standingFor(TEAM[0], { appDir: tmp("st-"), userName: "B", specs: TEAM, skills: [], knowledge: "", chief: true });
	assert.match(bpvText, /list_incidents, vienreiz retry_thread, ja atkal neizdodas, escalate/);
	assert.doesNotMatch(standingFor(TEAM[1], { appDir: tmp("st-"), userName: "B", specs: TEAM, skills: [], knowledge: "" }), /retry_thread/);
});
