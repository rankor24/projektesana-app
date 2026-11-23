// Memory as Markdown, routines, self-improvement and the app problem log (plan rows 17, 18 and §10):
//   cron reader: fields, names, L and MON#2, daylight-saving gap and repeated hour, the words of a user turned into an expression;
//   routines: what is due after downtime (the newest runs late within 12 hours, older ones are counted as missed), start once, retry, finish;
//   memory files: one writer per file, the department lead, the office keeper, the budget and its order, expiry, the department wins;
//   self changes: role text, skill draft (never active), memory; each logged with before and after and undone;
//   the problem log.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cronFromWords, describeCron, nextRuns, parseCron, runsBetween, wallText } from "../src/core/cron.ts";
import { CATCH_UP_MS, editRoutine, newRoutine, occurrencesIn, planDue, readRoutines, readTiming, routinesFile, setPaused, updateRoutines, type Routine } from "../src/core/routines.ts";
import { ProjectStore } from "../src/core/store.ts";
import { RoutineService, type RoutineDeps } from "../src/main/routines-scheduler.ts";
import { listIssues, reportIssue, setIssueStatus } from "../src/agent/app-issues.ts";
import { AGENT_BUDGET, addEntry, findEntries, forgetEntry, hashText, keeperOf, memoryText, readMemory, writeMemory, writeRefusal, listMemoryFiles, select } from "../src/agent/memory-md.ts";
import { changeOwnRole, draftSkill, undoChange } from "../src/agent/self-changes.ts";
import { listChanges } from "../src/agent/self-journal.ts";
import { listSkills, officeSkillsDir } from "../src/agent/skills.ts";
import { standingFor } from "../src/agent/agents.ts";
import { ownTools, specialistTools } from "../src/agent/subagents.ts";
import { appLevels, allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { makeLevelOf, offered } from "../src/agent/tools/levels.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import type { Thread } from "../src/shared/thread-types.ts";
import { tmp } from "./helpers.ts";

const iso = (s: string) => Date.parse(s);
const RIGA = "Europe/Riga";
const at = (cron: string, after: string, n = 3, tz = RIGA) => {
	const p = parseCron(cron);
	assert.ok(p.ok, cron);
	return nextRuns(p.cron, tz, iso(after), n).map((t) => wallText(t, tz));
};

// ---- cron -----------------------------------------------------------------------------------------------------------------------------

test("cron: refusals say which field and why; seconds, macros and out-of-range values are not accepted", () => {
	for (const bad of ["0 9 1 *", "0 9 1 * * *", "61 9 * * *", "0 25 * * *", "0 9 32 * *", "0 9 * 13 *", "0 9 * * 9", "@daily", "*/0 * * * *", "0 9 L-1 * *"]) assert.equal(parseCron(bad).ok, false, bad);
	const six = parseCron("0 0 9 * * *");
	assert.ok(!six.ok && /5 laukus/.test(six.error));
	assert.ok(parseCron("*/15 9-16 * * MON-FRI").ok);
	assert.ok(parseCron("0 9,17 * jan,mar mon").ok);
});

test("cron: next runs of the common shapes, on the calendar of the zone", () => {
	assert.deepEqual(at("0 9 1 * *", "2026-11-23T10:00:00Z"), ["2026-12-01 09:00", "2027-01-01 09:00", "2027-02-01 09:00"]);
	assert.deepEqual(at("0 9 * * 1", "2026-11-23T10:00:00Z"), ["2026-11-30 09:00", "2026-12-07 09:00", "2026-12-14 09:00"]);
	assert.deepEqual(at("0 9 L * *", "2026-11-23T10:00:00Z", 3), ["2026-11-30 09:00", "2026-12-31 09:00", "2027-01-31 09:00"]);
	assert.deepEqual(at("0 10 * * MON#2", "2026-11-23T10:00:00Z", 2), ["2026-12-14 10:00", "2027-01-11 10:00"]);
	assert.deepEqual(at("0 16 * * FRIL", "2026-11-23T10:00:00Z", 2), ["2026-11-27 16:00", "2026-12-25 16:00"]);
	assert.deepEqual(at("0 9,17 * * 1-5", "2026-11-27T10:00:00Z", 3), ["2026-11-27 17:00", "2026-11-30 09:00", "2026-11-30 17:00"]);
	// 31 skips the months that have none; 30 February never comes
	assert.deepEqual(at("0 9 31 * *", "2026-11-23T10:00:00Z", 3), ["2026-12-31 09:00", "2027-01-31 09:00", "2027-03-31 09:00"]);
	const never = parseCron("0 9 30 2 *");
	assert.ok(never.ok && nextRuns(never.cron, RIGA, iso("2026-11-23T10:00:00Z"), 1).length === 0);
	// both day-of-month and weekday restricted: either may match (standard cron)
	assert.deepEqual(at("0 9 15 * 1", "2026-11-23T10:00:00Z", 3), ["2026-11-30 09:00", "2026-12-07 09:00", "2026-12-14 09:00"]);
});

test("cron: a clock change never moves a routine - a time in the gap goes forward, a repeated hour runs once", () => {
	// Riga: clocks go 03:00 → 04:00 on 2027-03-28 and 04:00 → 03:00 on 2026-10-25
	const gap = at("30 3 * * *", "2027-03-27T00:00:00Z", 3);
	assert.deepEqual(gap.slice(0, 1), ["2027-03-27 03:30"]);
	assert.equal(gap[1], "2027-03-28 04:30", "03:30 does not exist that day: the run moves forward through the gap");
	assert.equal(gap[2], "2027-03-29 03:30");
	const twice = at("30 3 * * *", "2026-10-24T00:00:00Z", 4);
	assert.deepEqual(twice, ["2026-10-24 03:30", "2026-10-25 03:30", "2026-10-26 03:30", "2026-10-27 03:30"], "03:30 happens twice on 25 October and runs once");
});

test("cron: timing in words, Latvian and English, becomes an expression; a raw expression passes; what is not understood is refused", () => {
	const ok = (words: string, cron: string) => assert.deepEqual(cronFromWords(words), { ok: true, cron }, words);
	ok("katru pirmdienu 9:00", "0 9 * * 1");
	ok("katru pirmdienu plkst. 9", "0 9 * * 1");
	ok("first of every month at 9", "0 9 1 * *");
	ok("katra mēneša 1. datumā 9:00", "0 9 1 * *");
	ok("katra mēneša pēdējā dienā plkst. 17:00", "0 17 L * *");
	ok("darba dienās 8:30", "30 8 * * 1-5");
	ok("every weekday at 8:30", "30 8 * * 1-5");
	ok("katru dienu 7.30", "30 7 * * *");
	ok("katru ceturtdienu un piektdienu 12:00", "0 12 * * 4,5");
	ok("otrā pirmdiena katrā mēnesī 10:00", "0 10 * * MON#2");
	ok("last friday of the month at 4pm", "0 16 * * FRIL");
	ok("every 15 minutes", "*/15 * * * *");
	ok("1. janvārī plkst. 9", "0 9 1 1 *");
	ok("0 9 1 * *", "0 9 1 * *");
	assert.equal(cronFromWords("kaut kad").ok, false);
	assert.equal(cronFromWords("").ok, false);
	assert.match(describeCron("0 9 * * 1"), /Katru pirmdienu plkst\. 9:00/);
	assert.match(describeCron("0 9 1 * *"), /1\. datumā/);
	assert.match(describeCron("5 4 * * 2,4"), /otrdienu, ceturtdienu/);
});

test("cron: runs between two instants, in order, capped", () => {
	const p = parseCron("0 9 * * *");
	assert.ok(p.ok);
	const days = runsBetween(p.cron, RIGA, iso("2026-11-01T00:00:00Z"), iso("2026-11-11T00:00:00Z"));
	assert.equal(days.length, 10);
	assert.deepEqual([...days].sort((a, b) => a - b), days);
	const min = parseCron("* * * * *");
	assert.ok(min.ok);
	assert.equal(runsBetween(min.cron, RIGA, iso("2026-11-01T00:00:00Z"), iso("2026-12-01T00:00:00Z"), 100).length, 100);
});

// ---- routines -------------------------------------------------------------------------------------------------------------------------

const KNOWN = ["lead", "ar", "bpv"];
const mk = (when = "katru dienu 9:00", now = iso("2026-11-23T00:00:00Z"), by = "user") => newRoutine({ name: "Rīta pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when }, by, KNOWN, now);

test("routine: a new one is checked (name, agent, instruction, timing, zone); an agent's waits for the user", () => {
	assert.throws(() => newRoutine({ name: "x", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" }, "user", KNOWN), /nosaukums/);
	assert.throws(() => newRoutine({ name: "Pārskats", agent: "nav", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" }, "user", KNOWN), /Nav aģenta/);
	assert.throws(() => newRoutine({ name: "Pārskats", agent: "ar", instruction: "ok", when: "katru dienu 9:00" }, "user", KNOWN), /Norādījums/);
	assert.throws(() => mk("kaut kad"), /Trūkst laika/);
	assert.throws(() => readTiming("katru dienu 9:00", "Mars/Olympus"), /josla/);
	const r = mk();
	assert.equal(r.cron, "0 9 * * *");
	assert.equal(r.proposed, false);
	assert.equal(r.words, "katru dienu 9:00");
	assert.equal(mk("katru dienu 9:00", iso("2026-11-23T00:00:00Z"), "ar").proposed, true);
	assert.equal(mk("0 9 * * *").words, undefined, "a typed expression keeps no words");
});

test("routine: after downtime the newest occurrence runs late within 12 hours, older ones are counted as missed, none is run twice", () => {
	const r = mk("katru dienu 9:00", iso("2026-11-23T00:00:00Z"));
	// 09:00 Riga = 07:00Z
	assert.equal(planDue(r, iso("2026-11-23T06:59:00Z")), null, "not due yet");
	const on = planDue(r, iso("2026-11-23T07:00:30Z"))!;
	assert.equal(on.fire?.late, false);
	assert.equal(on.missed, 0);
	// the app was closed from before 24 November until 17:00Z on the 25th: 24th 09:00 is 34 hours old, 25th 09:00 is 10 hours old
	const late = planDue(r, iso("2026-11-25T17:00:00Z"))!;
	assert.equal(late.fire?.late, true);
	assert.equal(wallText(late.fire!.at, RIGA), "2026-11-25 09:00");
	assert.equal(late.missed, 2, "23rd and 24th are counted as missed");
	// even the newest is older than 12 hours: nothing runs, all are missed
	const old = planDue(r, iso("2026-11-25T22:00:00Z"))!;
	assert.equal(old.fire, null);
	assert.equal(old.missed, 3);
	assert.ok(now(r, old.cursor) === null, "after the cursor moved, the same occurrences are not found again");
	assert.ok(CATCH_UP_MS === 12 * 60 * 60_000);
});
const now = (r: Routine, cursor: number) => planDue({ ...r, cursor: new Date(cursor).toISOString() }, cursor + 1000);

test("routine: paused and proposed ones never come due; resuming does not replay what was missed", () => {
	const r = mk();
	assert.equal(planDue(setPaused(r, true), iso("2026-11-30T00:00:00Z")), null);
	assert.equal(planDue(mk("katru dienu 9:00", iso("2026-11-23T00:00:00Z"), "ar"), iso("2026-11-30T00:00:00Z")), null);
	const resumed = setPaused(setPaused(r, true), false, iso("2026-11-30T12:00:00Z"));
	assert.equal(planDue(resumed, iso("2026-11-30T12:30:00Z")), null);
	assert.ok(planDue(resumed, iso("2026-12-01T07:00:30Z"))?.fire, "the next 09:00 after resuming runs");
	// an edit that changes the timing starts from now too
	const edited = editRoutine(r, { name: r.name, agent: "ar", instruction: r.instruction, when: "darba dienās 8:30" }, KNOWN, iso("2026-11-30T12:00:00Z"));
	assert.equal(edited.cron, "30 8 * * 1-5");
	assert.equal(edited.cursor, "2026-11-30T12:00:00.000Z");
});

test("routine: the days a routine runs, for the calendar (project and whole-app files are apart)", () => {
	const dir = tmp();
	mkdirSync(join(dir, "projects", "BD1"), { recursive: true });
	const proj = routinesFile({ appDir: dir, projectsDir: join(dir, "projects"), projectId: "BD1" });
	const app = routinesFile({ appDir: dir, projectsDir: join(dir, "projects"), projectId: null });
	assert.notEqual(proj, app);
	updateRoutines(proj, (l) => void l.push(mk("katru pirmdienu 9:00")));
	assert.equal(readRoutines(app).length, 0);
	const r = readRoutines(proj)[0];
	const occ = occurrencesIn(r, "BD1", "2026-11-23", "2026-12-06");
	assert.deepEqual(occ.map((o) => `${o.date} ${o.time}`), ["2026-11-23 09:00", "2026-11-30 09:00"]);
	assert.equal(occ[0].projectId, "BD1");
});

// ---- the scheduler --------------------------------------------------------------------------------------------------------------------

function rig(opts: { agents?: string[] } = {}) {
	const dir = tmp();
	const projectsDir = join(dir, "projects");
	const store = ProjectStore.open(projectsDir, { id: "BD1", name: "BD1 Testa iela", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
	let clock = iso("2026-11-23T05:00:00Z");
	const sent: { thread: string; text: string }[] = [];
	const live = new Set<string>();
	let refuse: string | null = null;
	let answer = "Visi termiņi kārtībā.";
	let opened = 0;
	const changed: string[] = [];
	const d: RoutineDeps = {
		appDir: dir,
		projectsDir,
		projectIds: () => ["BD1"],
		agents: () => (opts.agents ?? ["ar"]).map((id) => ({ id })),
		session: {
			openThread: (projectId, agent, title) => ({ id: `th${++opened}`, projectId, agent, title: title ?? "", state: "idle", startedBy: "user" }) as unknown as Thread,
			sendToThread: async (thread, _p, text) => {
				if (refuse) throw new Error(refuse);
				sent.push({ thread, text });
				live.add(thread);
				return { runId: `run${sent.length}`, queued: false };
			},
			queueView: () => ({ running: [...live].map((threadId) => ({ runId: "r", threadId, agent: "ar", projectId: "BD1", wave: "w", waitingConfirm: false })), queued: [], paused: false, waves: [] }),
			threadHistory: () => [{ role: "assistant", text: answer, at: new Date(clock).toISOString() }],
		},
		store: () => store,
		changed: (_p, what) => void changed.push(...what),
		now: () => clock,
	};
	const svc = new RoutineService(d);
	return { svc, dir, store, sent, live, changed, at: (t: string) => void (clock = iso(t)), refuse: (m: string | null) => void (refuse = m), answer: (a: string) => void (answer = a), file: () => join(projectsDir, "BD1", "routines.json") };
}

test("scheduler: a routine that comes due starts its agent once, in a thread of its own; the answer lands in the task note", async () => {
	const t = rig();
	const saved = t.svc.save("BD1", { name: "Rīta pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00", taskMode: "task-result" });
	assert.equal(saved.cron, "0 9 * * *");
	assert.equal(saved.next.length, 3);
	t.at("2026-11-23T07:00:40Z");
	await t.svc.tick();
	await t.svc.tick();
	assert.equal(t.sent.length, 1, "the occurrence starts once, however many ticks look at it");
	assert.match(t.sent[0].text, /Rutīna «Rīta pārskats»/);
	assert.match(t.sent[0].text, /uzdevuma piezīmē/);
	const task = t.store.read("tasks")[0];
	assert.equal(task.title, "Rutīna: Rīta pārskats");
	assert.equal(task.due, "2026-11-23");
	let row = t.svc.list("BD1")[0].runs[0];
	assert.equal(row.state, "running");
	assert.equal(row.late, undefined);
	// the run leaves the queue: the last answer is the result
	t.live.clear();
	t.at("2026-11-23T07:05:00Z");
	await t.svc.tick();
	row = t.svc.list("BD1")[0].runs[0];
	assert.equal(row.state, "ran");
	assert.match(row.note ?? "", /Visi termiņi kārtībā/);
	assert.match(t.store.read("tasks")[0].note ?? "", /Visi termiņi kārtībā/);
});

test("scheduler: started late after the app was closed it says so; what is older than 12 hours is one missed row", async () => {
	const t = rig();
	t.svc.save("BD1", { name: "Rīta pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" });
	t.at("2026-11-26T05:00:00Z");
	// the app was off from 05:00Z on the 23rd to 05:00Z on the 26th: 09:00 Riga on the 26th (07:00Z) has not come yet; 25th 09:00 is 22 hours old
	await t.svc.tick();
	assert.equal(t.sent.length, 0);
	let row = t.svc.list("BD1")[0].runs[0];
	assert.equal(row.state, "missed");
	assert.equal(row.count, 3);
	// off again, back at 17:00Z on the 27th: the 27th at 09:00 was 10 hours ago and still runs, late
	t.at("2026-11-27T17:00:00Z");
	await t.svc.tick();
	assert.equal(t.sent.length, 1);
	assert.match(t.sent[0].text, /novēloti/);
	row = t.svc.list("BD1")[0].runs.find((r) => r.state === "running")!;
	assert.equal(row.late, true);
});

test("scheduler: a refused start is tried again each minute, then goes through; run now reports a refusal at once", async () => {
	const t = rig();
	t.svc.save("BD1", { name: "Rīta pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" });
	t.refuse("Aģents ir aizņemts.");
	t.at("2026-11-23T07:00:10Z");
	await t.svc.tick();
	let row = t.svc.list("BD1")[0].runs[0];
	assert.equal(row.state, "pending");
	assert.match(row.note ?? "", /gaida: Aģents ir aizņemts/);
	t.at("2026-11-23T07:00:30Z");
	await t.svc.tick();
	assert.equal(t.svc.list("BD1")[0].runs[0].tries, 1, "not tried again before its minute is up");
	t.refuse(null);
	t.at("2026-11-23T07:01:20Z");
	await t.svc.tick();
	row = t.svc.list("BD1")[0].runs[0];
	assert.equal(row.state, "running");
	assert.equal(t.sent.length, 1);
	// run now with a refusal: an error for the user, and the row closed as failed
	t.refuse("nav pieslēgts");
	await assert.rejects(t.svc.runNow("BD1", t.svc.list("BD1")[0].id), /nav pieslēgts/);
	assert.equal(t.svc.list("BD1")[0].runs[0].state, "failed");
});

test("scheduler: a paused routine does not run; an agent that is gone fails the run with a line", async () => {
	const t = rig();
	const r = t.svc.save("BD1", { name: "Rīta pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" });
	t.svc.setPaused("BD1", r.id, true);
	t.at("2026-11-23T07:00:40Z");
	await t.svc.tick();
	assert.equal(t.sent.length, 0);
	t.svc.setPaused("BD1", r.id, false);
	const g = rig({ agents: [] });
	assert.throws(() => g.svc.save("BD1", { name: "Pārskats", agent: "ar", instruction: "Pārbaudi termiņus", when: "katru dienu 9:00" }), /Nav aģenta/);
});

// ---- memory files ---------------------------------------------------------------------------------------------------------------------

const setup = (agents: object[] = [{ id: "bpv" }, { id: "ar" }, { id: "bk" }, { id: "ud" }], departments?: object[]) => {
	const dir = tmp();
	writeFileSync(join(dir, "agents.json"), JSON.stringify(agents));
	if (departments) writeFileSync(join(dir, "departments.json"), JSON.stringify({ departments }));
	return dir;
};
const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, description: "", prompt: "x".repeat(20), tools: [], ...extra });

test("memory: one writer per file - the agent its own, the department's lead (else BPV) its department's, BPV the office", () => {
	const dir = setup(undefined, [{ id: "arhitektura", name: "Arhitektūra" }, { id: "konstrukcijas", name: "Konstrukcijas", lead: "bk" }]);
	assert.equal(keeperOf(dir, { kind: "agent", id: "ar" }), "ar");
	assert.equal(keeperOf(dir, { kind: "department", id: "arhitektura" }), "bpv", "no lead set: BPV keeps it");
	assert.equal(keeperOf(dir, { kind: "department", id: "konstrukcijas" }), "bk");
	assert.equal(keeperOf(dir, { kind: "office", id: "office" }), "bpv");
	assert.equal(writeRefusal(dir, { kind: "agent", id: "ar" }, "ar"), null);
	assert.match(writeRefusal(dir, { kind: "agent", id: "ar" }, "bk") ?? "", /tikai aģents ar/);
	assert.equal(writeRefusal(dir, { kind: "department", id: "konstrukcijas" }, "bk"), null);
	assert.match(writeRefusal(dir, { kind: "department", id: "konstrukcijas" }, "bpv") ?? "", /vadītājs \(bk\)/, "BPV does not write a department that has its own lead");
	assert.match(writeRefusal(dir, { kind: "office", id: "office" }, "ar") ?? "", /tikai bpv/);
	assert.throws(() => writeMemory(dir, { kind: "office", id: "office" }, "x", { by: "agent", agent: "ar" }), /tikai bpv/);
	// an office with no bpv agent (the shipped three) is kept by the main agent
	const bare = setup([{ id: "dokumenti" }]);
	assert.equal(keeperOf(bare, { kind: "office", id: "office" }), "lead");
	// ids cannot leave the folder
	assert.throws(() => readMemory(dir, { kind: "agent", id: "../x" }), /Nederīgs/);
});

test("memory: a write keeps the old text (versions) and a journal line with before and after, redacts secrets, and the user may always edit", () => {
	const dir = setup();
	const ref = { kind: "agent" as const, id: "ar" };
	addEntry(dir, ref, "Klienta vēstules sūtām ar pavadrakstu.", { by: "agent", agent: "ar" });
	const r = addEntry(dir, ref, "api_key: sk-abcdefghijklmnop1234567890 nav jāglabā", { by: "agent", agent: "ar" });
	const text = readMemory(dir, ref);
	assert.match(text, /^- \d{4}-\d{2}-\d{2} · Klienta vēstules/m);
	assert.doesNotMatch(text, /sk-abcdefgh/);
	assert.match(text, /«redacted \d+ chars»/);
	const ch = listChanges(dir);
	assert.equal(ch.length, 2);
	assert.equal(ch[0].kind, "memory");
	assert.equal(ch[0].target, "memory/agents/ar.md");
	assert.ok(ch[0].before && ch[0].after.length > ch[0].before.length);
	assert.ok(r.change);
	assert.ok(existsSync(join(dir, "memory", "versions")));
	// the user's edit with a stale hash is refused; with the right one it passes
	assert.throws(() => writeMemory(dir, ref, "mans teksts", { by: "user", expectedHash: "0000" }), /mainījies/);
	writeMemory(dir, ref, "mans teksts\n", { by: "user", expectedHash: hashText(text) });
	assert.equal(readMemory(dir, ref), "mans teksts\n");
	assert.equal(listChanges(dir)[0].by, "user");
});

test("memory: forget strikes one entry through (nothing deleted); an ambiguous or missing one is refused; an old dated entry moves to the archive when the file is full", () => {
	const dir = setup();
	const ref = { kind: "agent" as const, id: "ar" };
	const o = { by: "agent" as const, agent: "ar" };
	addEntry(dir, ref, "Termiņš TN ir 30 dienas", o);
	addEntry(dir, ref, "Termiņš pārskatam ir 10 dienas", o);
	assert.throws(() => forgetEntry(dir, ref, "termiņš", o), /atbilst 2/);
	assert.throws(() => forgetEntry(dir, ref, "nav tāda", o), /nav/);
	forgetEntry(dir, ref, "TN ir 30", o);
	assert.match(readMemory(dir, ref), /~~Termiņš TN ir 30 dienas~~ · superseded/);
	// a file over its size cap moves the oldest dated entries to memory\archive and keeps the pinned heading
	let big = "# Mana atmiņa\n";
	for (let i = 0; i < 70; i++) big += `- 2026-01-${String((i % 28) + 1).padStart(2, "0")} · ${"ieraksts ".repeat(60)}${i}\n`;
	writeMemory(dir, ref, big, { by: "user" });
	const kept = readMemory(dir, ref);
	assert.ok(kept.length <= 24_000);
	assert.match(kept, /^# Mana atmiņa/);
	assert.ok(existsSync(join(dir, "memory", "archive", "agent-ar.md")));
});

test("memory: a run starts with the files within their budget, newest first, expired and struck-through entries left out, the rest named", () => {
	const dir = setup();
	const ref = { kind: "agent" as const, id: "ar" };
	const lines = ["# Mana atmiņa", "- 2026-11-20 · jauns un svarīgs", "- 2026-10-01 · vecs", "- 2026-11-01 · beidzies · until 2026-11-10", "- 2026-11-02 · ~~atcelts~~ · superseded 2026-11-03"];
	for (let i = 0; i < 60; i++) lines.push(`- 2026-09-${String((i % 28) + 1).padStart(2, "0")} · piepildījums ${"x".repeat(80)} ${i}`);
	mkdirSync(join(dir, "memory", "agents"), { recursive: true });
	writeFileSync(join(dir, "memory", "agents", "ar.md"), `${lines.join("\n")}\n`);
	const now = iso("2026-11-23T10:00:00Z");
	const s = select(dir, ref, AGENT_BUDGET, now);
	assert.ok(s.text.length <= AGENT_BUDGET);
	assert.match(s.text, /^# Mana atmiņa/);
	assert.match(s.text, /jauns un svarīgs/);
	assert.doesNotMatch(s.text, /beidzies/);
	assert.doesNotMatch(s.text, /atcelts/);
	assert.ok(s.hidden > 0, "the oldest filler does not fit");
	assert.doesNotMatch(s.text, /piepildījums.* 0$/m, "an old filler line is among the hidden");
	const full = memoryText(spec("ar"), dir, now);
	assert.match(full, /Tava atmiņa/);
	assert.match(full, /vēl \d+ ieraksti nav parādīti: memory_read/);
});

test("memory: the department's memory goes in too and wins over the agent's own, and the text says so; the pointer line is always there", () => {
	const dir = setup();
	const o = { by: "agent" as const, agent: "bpv" };
	// ar is in Arhitektūra by default; its file is kept by BPV (no lead set)
	addEntry(dir, { kind: "department", id: "arhitektura" }, "Lodžiju margas rāda ar 1:50 mērogu", o);
	addEntry(dir, { kind: "agent", id: "ar" }, "Lodžiju margas rāda ar 1:100", { by: "agent", agent: "ar" });
	addEntry(dir, { kind: "office", id: "office" }, "Birojs: faili ar BD kodu sākumā", o);
	const t = memoryText(spec("ar"), dir);
	assert.match(t, /Biroja atmiņa/);
	assert.match(t, /Nodaļas atmiņa: Arhitektūra/);
	assert.match(t, /1:50/);
	assert.match(t, /Tava atmiņa/);
	assert.match(t, /uzvar nodaļas atmiņa/);
	assert.match(t, /report_app_issue/);
	// an agent with no file still gets the pointer line; nothing else
	const bare = memoryText(spec("bk"), setup());
	assert.match(bare, /memory_read un memory_write/);
	assert.doesNotMatch(bare, /###/);
	// the one call standingFor makes: the memory is at the end of the standing text
	const standing = standingFor(spec("ar"), { appDir: dir, userName: "", specs: [spec("ar")], skills: [], knowledge: "" });
	assert.ok(standing.endsWith(t) || standing.includes("Tava atmiņa"));
	assert.ok(standing.indexOf("Tava atmiņa") > standing.indexOf("x".repeat(20)), "after the role text");
	assert.deepEqual(listMemoryFiles(dir, [{ id: "ar", name: "Arhitekts" }]).filter((f) => f.exists).map((f) => `${f.kind}/${f.id}`).sort(), ["agent/ar", "department/arhitektura", "office/office"]);
});

test("memory: entries read with find count as use, so a note the agent keeps reading outranks a newer one", () => {
	const dir = setup();
	const ref = { kind: "agent" as const, id: "ar" };
	mkdirSync(join(dir, "memory", "agents"), { recursive: true });
	writeFileSync(join(dir, "memory", "agents", "ar.md"), "- 2026-11-01 · vecs bet noderīgs: LBN 201-15\n- 2026-11-20 · jauns A\n- 2026-11-21 · jauns B\n");
	const now = iso("2026-11-23T10:00:00Z");
	const order = (budget: number) => select(dir, ref, budget, now).text;
	// no room for the old one beside the new ones: the newest win
	assert.match(order(50), /jauns B/);
	assert.doesNotMatch(order(50), /LBN 201-15/);
	for (let i = 0; i < 3; i++) assert.equal(findEntries(dir, ref, "LBN 201-15").length, 1);
	assert.match(order(50), /LBN 201-15/, "three uses are worth 21 days of freshness");
	assert.doesNotMatch(order(50), /jauns B/);
});

// ---- self changes ---------------------------------------------------------------------------------------------------------------------

test("self: an agent's own role text is appended to, logged with before and after, and undone; no role file, or a rewrite far shorter, is refused", () => {
	const dir = setup();
	mkdirSync(join(dir, "agents"), { recursive: true });
	writeFileSync(join(dir, "agents", "ar.md"), `${"Tu esi arhitekts. ".repeat(10)}\n`);
	assert.throws(() => changeOwnRole(dir, { id: "ar", roleFile: false }, "append", "Jauna mācība par lodžijām.", "tests"), /Iestatījumos/);
	const before = readFileSync(join(dir, "agents", "ar.md"), "utf8");
	const c = changeOwnRole(dir, { id: "ar", roleFile: true }, "append", "Lodžiju margas vienmēr 1:50.", "nodaļas lēmums");
	assert.match(readFileSync(join(dir, "agents", "ar.md"), "utf8"), /## Mācība \(\d{4}-\d{2}-\d{2}\)\nLodžiju margas vienmēr 1:50\./);
	assert.equal(c.before, before);
	assert.ok(existsSync(join(dir, "agents", "versions")), "the role write path keeps the old text");
	assert.throws(() => changeOwnRole(dir, { id: "ar", roleFile: true }, "replace", "Īss teksts, kas nomaina visu lomu.", "x"), /uz pusi īsāks/);
	assert.match(undoChange(dir, "", c.id), /atgriezts/);
	assert.equal(readFileSync(join(dir, "agents", "ar.md"), "utf8"), before);
	assert.equal(listChanges(dir)[0].undone, true);
	assert.throws(() => undoChange(dir, "", c.id), /jau ir atsaukta/);
});

test("self: a skill draft is never active; the agent may rewrite its own draft only; undoing a new one moves its folder aside", () => {
	const dir = setup();
	const synced = tmp();
	const d = { name: "lodzijas-marges", description: "Kā zīmēt lodžiju margas nodevumā.", body: "1. Atver plānu.\n2. Pārbaudi margas augstumu un mērogu 1:50." };
	const c = draftSkill(dir, synced, "ar", d, "atkārtots uzdevums");
	const s = listSkills(synced, officeSkillsDir(dir)).find((x) => x.name === "lodzijas-marges")!;
	assert.equal(s.origin, "office");
	assert.equal(s.state, "draft", "waits for the user's click (marked tested) before any agent is told about it");
	assert.equal(c.before, null);
	assert.throws(() => draftSkill(dir, synced, "bk", d, "cits aģents"), /cita melnraksts/);
	const again = draftSkill(dir, synced, "ar", { ...d, body: `${d.body}\n3. Saglabā.` }, "papildinājums");
	assert.ok(again.before?.includes("Pārbaudi margas"));
	assert.throws(() => draftSkill(dir, synced, "ar", { ...d, name: "../x" }, "slikts nosaukums"), /nosaukums/);
	// undo the second change: the first text is back; undo the first: the folder moves to skills\versions
	undoChange(dir, synced, again.id);
	assert.doesNotMatch(readFileSync(join(officeSkillsDir(dir), "lodzijas-marges", "SKILL.md"), "utf8"), /Saglabā/);
	undoChange(dir, synced, c.id);
	assert.equal(listSkills(synced, officeSkillsDir(dir)).some((x) => x.name === "lodzijas-marges"), false);
	assert.ok(existsSync(join(officeSkillsDir(dir), "versions")));
});

test("self: undoing a memory change puts the text back; the journal keeps both lines", () => {
	const dir = setup();
	const ref = { kind: "agent" as const, id: "ar" };
	addEntry(dir, ref, "pirmais ieraksts", { by: "agent", agent: "ar" });
	const second = addEntry(dir, ref, "otrais ieraksts", { by: "agent", agent: "ar" });
	undoChange(dir, "", second.change!);
	const t = readMemory(dir, ref);
	assert.match(t, /pirmais/);
	assert.doesNotMatch(t, /otrais/);
	// the undo itself is a change of the user's, which can be undone in turn
	const log = listChanges(dir);
	assert.equal(log[0].by, "user");
	assert.equal(log.find((c) => c.id === second.change)?.undone, true);
});

// ---- the problem log ------------------------------------------------------------------------------------------------------------------

test("app problems: a report goes to the log with its place, a repeat of an open one is not written twice, status changes are kept, secrets are removed", () => {
	const dir = setup();
	const a = reportIssue(dir, { agent: "ar", title: "Trūkst rīka telpu eksportam", details: "Mēģināju eksportēt, token: abcdef123456789 nav", where: "Telpas panelis" });
	assert.equal(a.duplicate, false);
	assert.doesNotMatch(a.issue.details, /abcdef123456789/);
	assert.equal(reportIssue(dir, { agent: "bk", title: "trūkst rīka telpu eksportam", details: "vēlreiz", where: "telpas panelis" }).duplicate, true);
	assert.equal(listIssues(dir).length, 1);
	assert.throws(() => reportIssue(dir, { agent: "ar", title: "ok", details: "", where: "" }), /vismaz 5/);
	setIssueStatus(dir, a.issue.id, "fixed");
	assert.equal(listIssues(dir)[0].status, "fixed");
	assert.equal(reportIssue(dir, { agent: "ar", title: "Trūkst rīka telpu eksportam", details: "atkal", where: "Telpas panelis" }).duplicate, false, "a fixed one that comes back is a new report");
	assert.equal(listIssues(dir).length, 2);
	assert.throws(() => setIssueStatus(dir, "nav", "open"), /nav atrasta/);
});

// ---- the tools ------------------------------------------------------------------------------------------------------------------------

const ctxOf = (dir: string, agent: string | null, projectId: string | null = null): ToolCtx => ({ projectsDir: join(dir, "projects"), projectId, dataDir: dir, appDir: dir, runDir: null, agent, thread: null });
const toolOf = (name: string) => allTools().find((t) => t.name === name)!;

test("tools: every agent has memory_read and report_app_issue; the write tools are its own thread's, never a lane's; the office write is confirm", async () => {
	const levelOf = makeLevelOf(appLevels());
	const listed = offered(allTools().map((t) => t.name), levelOf);
	const sp = spec("ar");
	const own = ownTools(listed, levelOf, new Set(), sp);
	for (const n of ["memory_read", "memory_write", "memory_write_office", "edit_own_role", "draft_skill", "report_app_issue", "routine_list", "routine_create", "routine_change"]) assert.ok(own.includes(n), `${n} in the agent's own thread`);
	const lane = specialistTools(listed, levelOf, new Set(), sp).filter((n) => /^(memory_write|edit_own_role|draft_skill|routine_create|routine_change)/.test(n));
	assert.deepEqual(lane, [], "a delegate lane gets none of the self tools");
	assert.equal(toolOf("memory_write_office").level, "confirm");
	assert.equal(toolOf("memory_write").level, "run");
	assert.equal(toolOf("memory_read").level, "read");
	assert.equal(toolOf("report_app_issue").level, "read");
	assert.ok(toolOf("routine_create").description.length < 520);
});

test("tools: memory_write enforces the keeper; a department lead writes its department; the office write is BPV's", async () => {
	const dir = setup(undefined, [{ id: "arhitektura", name: "Arhitektūra" }, { id: "konstrukcijas", name: "Konstrukcijas", lead: "bk" }]);
	const w = toolOf("memory_write");
	const r = toolOf("memory_read");
	// ar writes its own, reads it back; is refused for its department (BPV keeps it)
	await w.run(ctxOf(dir, "ar"), { scope: "own", action: "add", text: "Mans pirmais ieraksts" });
	assert.match(String(await r.run(ctxOf(dir, "ar"), { scope: "own" })), /Mans pirmais ieraksts/);
	await assert.rejects(async () => w.run(ctxOf(dir, "ar"), { scope: "department", action: "add", text: "Nodaļas ieraksts" }), /tikai tās vadītājs \(bpv\)/);
	// bpv has no department of its own except "vadiba"; it writes that one
	await w.run(ctxOf(dir, "bpv"), { scope: "department", action: "add", text: "Vadības ieraksts" });
	assert.match(readMemory(dir, { kind: "department", id: "vadiba" }), /Vadības ieraksts/);
	// bk leads Konstrukcijas
	await w.run(ctxOf(dir, "bk"), { scope: "department", action: "add", text: "Betona klase C30/37" });
	assert.match(readMemory(dir, { kind: "department", id: "konstrukcijas" }), /C30\/37/);
	const o = toolOf("memory_write_office");
	await assert.rejects(async () => o.run(ctxOf(dir, "bk"), { action: "add", text: "Biroja noteikums" }), /tikai bpv/);
	await o.run(ctxOf(dir, "bpv"), { action: "add", text: "Biroja noteikums" });
	assert.match(readMemory(dir, { kind: "office", id: "office" }), /Biroja noteikums/);
	// find counts a use and answers only the matching entries
	assert.match(String(await r.run(ctxOf(dir, "ar"), { scope: "own", find: "pirmais" })), /Mans pirmais/);
	assert.match(String(await r.run(ctxOf(dir, "ar"), { scope: "own", find: "nav tāda" })), /Nekas neatbilst/);
});

test("tools: report_app_issue, edit_own_role and routine_create work through the tools; an agent's routine waits for the user and cannot be started by it", async () => {
	const dir = setup();
	mkdirSync(join(dir, "agents"), { recursive: true });
	writeFileSync(join(dir, "agents", "ar.md"), "Tu esi arhitekts. ".repeat(10));
	writeFileSync(join(dir, "agents.json"), JSON.stringify([{ id: "bpv" }, { id: "ar", roleFile: true }]));
	const ctx = ctxOf(dir, "ar");
	const issue = (await toolOf("report_app_issue").run(ctx, { title: "Nepareizs nolasījums", details: "Lapa 3 nolasīta kā tukša", where: "read_source" })) as { ok: boolean };
	assert.equal(issue.ok, true);
	assert.equal(listIssues(dir)[0].agent, "ar");
	const role = (await toolOf("edit_own_role").run(ctx, { mode: "append", text: "Vienmēr norādi lapas numuru.", reason: "kļūdas dēļ" })) as { change: string };
	assert.ok(role.change);
	await assert.rejects(async () => toolOf("edit_own_role").run(ctxOf(dir, "lead"), { mode: "append", text: "Vienmēr norādi lapas numuru.", reason: "kļūdas dēļ" }), /Jautā lietotājam/);
	const made = (await toolOf("routine_create").run(ctx, { name: "Nedēļas kopsavilkums", agent: "ar", instruction: "Sagatavo kopsavilkumu par nedēļu", when: "0 9 * * 1", wholeApp: true })) as { routine: string; nextRuns: string[]; schedule: string };
	assert.equal(made.nextRuns.length, 3);
	assert.match(made.schedule, /pirmdienu/);
	const stored = readRoutines(routinesFile({ appDir: dir, projectsDir: join(dir, "projects"), projectId: null }))[0];
	assert.equal(stored.proposed, true);
	assert.equal(planDue(stored, iso("2030-01-01T00:00:00Z")), null, "it does not run until the user starts it");
	await assert.rejects(async () => toolOf("routine_create").run(ctx, { name: "Slikts", agent: "ar", instruction: "Sagatavo kopsavilkumu", when: "kaut kad", wholeApp: true }), /Trūkst laika/);
	await assert.rejects(async () => toolOf("routine_change").run(ctxOf(dir, "bpv"), { id: stored.id, action: "delete" }), /dzēš tikai lietotājs/);
	await toolOf("routine_change").run(ctx, { id: stored.id, action: "delete" });
	assert.equal(readRoutines(routinesFile({ appDir: dir, projectsDir: join(dir, "projects"), projectId: null })).length, 0);
});
