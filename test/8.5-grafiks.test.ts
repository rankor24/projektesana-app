// 8.5 the grafiks and tasks: calendar maths (weeks start on Monday), the user's tasks and what the agent may do with them,
// what falls on each day from deliveries, clocks and tasks, and the agent's task tools. Invented projects; today is Fri 2026-11-13.
import assert from "node:assert/strict";
import { test } from "node:test";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { grafikItems } from "../src/core/grafiks.ts";
import type { Delivery } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { addTask, removeTask, updateTask } from "../src/core/tasks.ts";
import { addDays, mondayOf, monthGrid, taskOrder, weekDays } from "../src/shared/calendar.ts";
import { tmp } from "./helpers.ts";

const TODAY = "2026-11-13";
const ev = { kind: "test", by: "test" };
const mk = () => ProjectStore.open(tmp(), { id: "BD930", name: "BD930", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });

test("weeks start on Monday: the Monday of any day, and a week's seven days", () => {
	assert.equal(mondayOf("2026-11-13"), "2026-11-09"); // Friday
	assert.equal(mondayOf("2026-11-09"), "2026-11-09"); // Monday itself
	assert.equal(mondayOf("2026-11-15"), "2026-11-09"); // Sunday belongs to the week before Monday
	assert.deepEqual(weekDays("2026-11-13"), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
	assert.equal(addDays("2026-03-01", -1), "2026-02-28");
	assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("a month grid is whole Monday-first weeks that hold the month, with the outside days marked", () => {
	const nov = monthGrid(2026, 11); // Nov 1 2026 is a Sunday
	assert.equal(nov.length, 6);
	assert.deepEqual(nov[0].map((d) => d.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
	assert.deepEqual(nov[0].map((d) => d.inMonth), [false, false, false, false, false, false, true]);
	assert.equal(nov.at(-1)![6].date, "2026-12-06");
	assert.ok(nov.every((w) => w.length === 7));
	const feb = monthGrid(2027, 2); // Feb 1 2027 is a Monday, 28 days: exactly four weeks
	assert.equal(feb.length, 4);
	assert.equal(feb[0][0].date, "2027-02-01");
	assert.ok(feb.flat().every((d) => d.inMonth));
	assert.equal(monthGrid(2028, 2).flat().filter((d) => d.inMonth).length, 29, "leap year");
});

test("a user's task is open; the agent's is proposed; the title and the date are checked", () => {
	const s = mk();
	const a = addTask(s, { title: " Piezvanīt pasūtītājam ", due: "2026-11-16" }, "user");
	assert.deepEqual([a.title, a.state, a.due, a.by], ["Piezvanīt pasūtītājam", "open", "2026-11-16", "user"]);
	assert.equal(addTask(s, { title: "Pārbaudīt TN" }, "agent").state, "proposed");
	assert.equal(addTask(s, { title: "Bez datuma" }, "user").due, null);
	assert.throws(() => addTask(s, { title: "x" }, "user"), /nosaukumu/);
	for (const bad of ["16.11.2026", "2026-13-01", "2026-02-30", "rīt"]) assert.throws(() => addTask(s, { title: "Labi", due: bad }, "user"), /GGGG-MM-DD/, bad);
	assert.equal(s.read("tasks").length, 3);
});

test("the agent edits what a task says and when, never its state; only the user accepts, finishes, drops", () => {
	const s = mk();
	const p = addTask(s, { title: "Sagatavot MBP", due: "2026-11-20" }, "agent");
	assert.equal(updateTask(s, p.id, { due: "2026-11-18", note: "TN vēl nav" }, "agent").due, "2026-11-18");
	assert.throws(() => updateTask(s, p.id, { state: "open" }, "agent"), /tikai lietotājs/);
	assert.throws(() => removeTask(s, p.id, "agent"), /tikai lietotājs/);
	const open = updateTask(s, p.id, { state: "open" }, "user");
	assert.equal(open.state, "open");
	const done = updateTask(s, p.id, { state: "done" }, "user", "2026-11-14T08:00:00.000Z");
	assert.deepEqual([done.state, done.doneAt], ["done", "2026-11-14T08:00:00.000Z"]);
	assert.throws(() => updateTask(s, p.id, { title: "cits" }, "agent"), /Pabeigtu uzdevumu/);
	assert.equal(updateTask(s, p.id, { state: "open" }, "user").doneAt, undefined, "reopened: no finish time");
	removeTask(s, p.id, "user");
	assert.deepEqual(s.read("tasks"), []);
	assert.throws(() => updateTask(s, "t_nav", { title: "xx" }, "user"), /nav atrasts/);
});

test("proposed tasks first, then open by due date with undated last, then done newest first", () => {
	const s = mk();
	const a = addTask(s, { title: "bez datuma" }, "user");
	const b = addTask(s, { title: "agrāk", due: "2026-11-14" }, "user");
	const c = addTask(s, { title: "vēlāk", due: "2026-11-30" }, "user");
	const d = addTask(s, { title: "piedāvāts" }, "agent");
	const e = addTask(s, { title: "pabeigts 1" }, "user");
	const f = addTask(s, { title: "pabeigts 2" }, "user");
	updateTask(s, e.id, { state: "done" }, "user", "2026-11-10T00:00:00.000Z");
	updateTask(s, f.id, { state: "done" }, "user", "2026-11-12T00:00:00.000Z");
	assert.deepEqual(taskOrder(s.read("tasks")).map((t) => t.title), ["piedāvāts", "agrāk", "vēlāk", "bez datuma", "pabeigts 2", "pabeigts 1"]);
	void [a, b, c, d];
});

const del = (id: string, planned: string | null, submitted: string | null = null, plannedFrom?: "bip" | "user"): Delivery => ({ id, stage: "Skice", kind: "MBP", label: `MBP ${id}`, plannedDate: planned, submittedDate: submitted, folder: null, items: [], checksRun: [], ...(plannedFrom ? { plannedFrom } : {}) });

test("a day holds the planned and sent deliveries, clock ends and tasks of the project, in date order", () => {
	const s = mk();
	s.write("deliveries", [del("a", "2026-11-10", null, "bip"), del("b", "2026-11-18", null, "user"), del("c", "2026-11-02", "2026-11-03"), del("far", "2027-03-01")], ev);
	// requested Fri 2026-10-30, 11 working days: due Mon 2026-11-16
	s.writeMeta("clocks", [{ id: "c1", kind: "tn", issuer: "Ūdens", issuerKind: "network_owner", requestedOn: "2026-10-30", extended: false, receivedOn: null, sourceId: null, by: "user" }, { id: "c2", kind: "tn", issuer: "Gaisma", issuerKind: "network_owner", requestedOn: "2026-10-01", extended: false, receivedOn: "2026-10-10", sourceId: null, by: "user" }], ev);
	addTask(s, { title: "Zvanīt", due: "2026-11-13" }, "user");
	addTask(s, { title: "Pārskatīt BIP", due: "2026-11-12" }, "agent");
	const out = addTask(s, { title: "Pabeigts", due: "2026-11-11" }, "user");
	updateTask(s, out.id, { state: "done" }, "user");
	const items = grafikItems(s, "2026-11-01", "2026-11-30", TODAY);
	const by = (id: string) => items.find((i) => i.id === id)!;
	assert.deepEqual(items.map((i) => i.date), [...items.map((i) => i.date)].sort(), "date order");
	assert.equal(by("d:a:plan").title, "MBP a (BIP grafiks)");
	assert.equal(by("d:a:plan").level, "bad", "planned date passed and not sent");
	assert.equal(by("d:b:plan").level, undefined);
	assert.deepEqual([by("d:c:sent").date, by("d:c:sent").done, by("d:c:sent").title], ["2026-11-03", true, "MBP c nosūtīts"]);
	assert.equal(items.some((i) => i.id === "d:c:plan"), false, "a sent delivery is not also planned");
	assert.equal(items.some((i) => i.id.startsWith("d:far")), false, "outside the range");
	assert.equal(by("c:c1").date, "2026-11-16");
	assert.equal(by("c:c1").level, "warn", "one working day left");
	assert.equal(items.some((i) => i.id === "c:c2"), false, "a received clock is done");
	assert.deepEqual([by(items.find((i) => i.title === "Zvanīt")!.id).level, by(items.find((i) => i.title === "Pārskatīt BIP")!.id).proposed], [undefined, true]);
	assert.equal(items.find((i) => i.title === "Pabeigts")!.done, true);
	assert.equal(items.find((i) => i.title === "Zvanīt")!.taskId?.startsWith("t_"), true);
	// a narrower range keeps only its days
	assert.deepEqual(grafikItems(s, "2026-11-13", "2026-11-13", TODAY).map((i) => i.title), ["Zvanīt"]);
});

test("an open task past its date is red", () => {
	const s = mk();
	addTask(s, { title: "Nokavēts", due: "2026-11-10" }, "user");
	assert.equal(grafikItems(s, "2026-11-01", "2026-11-30", TODAY)[0].level, "bad");
});

function ctxOf(store: ProjectStore): ToolCtx {
	return { projectsDir: store.projectsDir, projectId: store.project.id, dataDir: tmp(), appDir: tmp(), runDir: null };
}
const tool = (name: string) => allTools().find((t) => t.name === name)!;

test("the agent's task tools: read lists, create proposes, update never changes the state; levels say so", async () => {
	assert.deepEqual([appLevels().list_tasks, appLevels().create_task, appLevels().update_task], ["read", "propose", "propose"]);
	assert.equal(allTools().some((t) => /delete_task|remove_task|complete_task|finish_task|accept_task/.test(t.name)), false, "no tool drops, finishes or accepts a task");
	const s = mk();
	const c = ctxOf(s);
	assert.match(String(await tool("list_tasks").run(c, {} as never)), /no data/);
	const made = (await tool("create_task").run(c, { title: "Sagatavot MBP", due: "2026-11-20", findingId: "f1" } as never)) as { ok: boolean; task: string };
	assert.equal(made.ok, true);
	const t = s.read("tasks")[0];
	assert.deepEqual([t.state, t.by, t.refs], ["proposed", "agent", { findingId: "f1" }]);
	await tool("update_task").run(c, { taskId: t.id, due: "2026-11-19" } as never);
	assert.equal(s.read("tasks")[0].due, "2026-11-19");
	await assert.rejects(async () => tool("update_task").run(c, { taskId: "t_nav", title: "xx" } as never), /nav atrasts/);
	const listed = (await tool("list_tasks").run(c, { state: "proposed" } as never)) as { title: string }[];
	assert.deepEqual(listed.map((x) => x.title), ["Sagatavot MBP"]);
	assert.match(String(await tool("list_tasks").run(c, { state: "done" } as never)), /no data/);
});
