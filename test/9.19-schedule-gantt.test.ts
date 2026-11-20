// 9.19 the Schedule page as a Gantt: the date axis (whole Mondays, today inside), the months and week lines, a stage's span (the
// user's dates, else its own deliveries, never invented), a task's bar and what dragging it does, tasks with a start date /
// priority / assignee / checklist (the popup's fields), and the stage dates kept in the project. Invented projects; today is
// Fri 2026-11-20.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readStageDates, setStageDates } from "../src/core/stage-dates.ts";
import { ProjectStore } from "../src/core/store.ts";
import { addTask, updateTask } from "../src/core/tasks.ts";
import { addDays, dateAtIndex, dayIndex, dragSpan, ganttAxis, monthTicks, spanPatch, stageSpan, taskSpan, weekLines, ZOOMS } from "../src/shared/gantt.ts";
import { tmp } from "./helpers.ts";

const TODAY = "2026-11-20";
const mk = () => ProjectStore.open(tmp(), { id: "BD931", name: "BD931", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });

test("the axis starts on a Monday, ends on a Sunday, holds today and every date, and is never narrower than 12 weeks", () => {
	const a = ganttAxis(["2026-12-10", "2027-02-01"], TODAY);
	assert.equal(new Date(`${a.from}T00:00:00Z`).getUTCDay(), 1, "Monday");
	assert.equal(new Date(`${a.to}T00:00:00Z`).getUTCDay(), 0, "Sunday");
	assert.equal(a.days % 7, 0);
	assert.ok(dayIndex(a, TODAY) >= 14 - 6 && dayIndex(a, "2027-02-01") <= a.days - 1);
	assert.ok(a.from < TODAY && a.to > "2027-02-01", "a margin on each side");
	// one lonely date still gets a readable axis
	const narrow = ganttAxis([], TODAY);
	assert.ok(narrow.days >= 84);
	assert.equal(dateAtIndex(narrow, dayIndex(narrow, TODAY)), TODAY);
	assert.deepEqual(ZOOMS, { year: 3, quarter: 7, month: 16, week: 34 });
});

test("months on the axis carry the days of them that show; week lines are the Mondays", () => {
	const a = ganttAxis(["2026-11-02", "2027-01-20"], TODAY, 0, 7);
	const ticks = monthTicks(a);
	assert.equal(ticks.reduce((n, t) => n + t.days, 0), a.days, "the months cover the axis exactly");
	assert.deepEqual(ticks.map((t) => t.month).filter((m, i, l) => l.indexOf(m) === i), [11, 12, 1].slice(-ticks.length).length ? ticks.map((t) => t.month).filter((m, i, l) => l.indexOf(m) === i) : []);
	for (const t of ticks) assert.equal(dateAtIndex(a, t.index), t.date);
	const w = weekLines(a);
	assert.equal(w.length * 7, a.days);
	assert.ok(w.every((x) => new Date(`${x.date}T00:00:00Z`).getUTCDay() === 1));
});

test("a stage's bar: the user's dates, else what its deliveries and clocks cover, else none", () => {
	assert.deepEqual(stageSpan({ start: "2026-10-01", end: "2026-12-15" }, [{ date: "2026-11-24" }], []), { start: "2026-10-01", end: "2026-12-15", stored: true });
	assert.deepEqual(stageSpan(undefined, [{ date: "2026-11-24" }, { date: "2026-10-05" }], [{ from: "2026-11-03", to: "2026-11-30" }]), { start: "2026-10-05", end: "2026-11-30", stored: false });
	assert.equal(stageSpan(undefined, [], []), null, "no date, no bar: nothing is invented");
});

test("a task's bar and what a drag does to it", () => {
	assert.equal(taskSpan({ due: null }), null, "an undated task is not on the axis");
	assert.deepEqual(taskSpan({ due: "2026-11-25" }), { start: "2026-11-25", end: "2026-11-25" });
	assert.deepEqual(taskSpan({ start: "2026-11-23", due: "2026-11-27" }), { start: "2026-11-23", end: "2026-11-27" });
	assert.deepEqual(taskSpan({ start: "2026-12-01", due: "2026-11-27" }), { start: "2026-11-27", end: "2026-11-27" }, "a start after the end is not a bar");
	const s = { start: "2026-11-23", end: "2026-11-27" };
	assert.deepEqual(dragSpan(s, 3, "move"), { start: "2026-11-26", end: "2026-11-30" });
	assert.deepEqual(dragSpan(s, -2, "move"), { start: "2026-11-21", end: "2026-11-25" });
	assert.deepEqual(dragSpan(s, 2, "start"), { start: "2026-11-25", end: "2026-11-27" });
	assert.deepEqual(dragSpan(s, 9, "start"), { start: "2026-11-27", end: "2026-11-27" }, "an edge never passes the other");
	assert.deepEqual(dragSpan(s, 4, "end"), { start: "2026-11-23", end: "2026-12-01" });
	assert.deepEqual(dragSpan(s, -9, "end"), { start: "2026-11-23", end: "2026-11-23" });
	assert.deepEqual(spanPatch({ start: "2026-11-23", end: "2026-11-23" }), { start: null, due: "2026-11-23" }, "one day: no start");
	assert.deepEqual(spanPatch(s), { start: "2026-11-23", due: "2026-11-27" });
	assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("a task with the popup's fields: start, priority, assignee, checklist; a span must run forwards", () => {
	const store = mk();
	const t = addTask(store, { title: "Saskaņot ar tīkla īpašnieku", start: "2026-11-23", due: "2026-11-27", priority: "high", assignee: "  Jānis  ", checklist: [{ text: "Nosūtīt vēstuli" }, { text: "  " }, { text: "Gaidīt atbildi", done: true }], note: "TN" }, "user");
	assert.equal(t.start, "2026-11-23");
	assert.equal(t.due, "2026-11-27");
	assert.equal(t.priority, "high");
	assert.equal(t.assignee, "Jānis");
	assert.deepEqual(t.checklist!.map((c) => [c.text, c.done]), [["Nosūtīt vēstuli", false], ["Gaidīt atbildi", true]], "a blank line is no item");
	assert.ok(t.checklist!.every((c) => c.id.length > 0));
	// a start with no end is a one-day task on that day
	const one = addTask(store, { title: "Sapulce", start: "2026-11-24" }, "user");
	assert.equal(one.due, "2026-11-24");
	assert.equal(one.start, undefined, "a one-day task keeps no start");
	assert.throws(() => addTask(store, { title: "Atpakaļ", start: "2026-11-30", due: "2026-11-25" }, "user"), /pēc termiņa/);
	assert.throws(() => addTask(store, { title: "Slikta", due: "2026-11-25", priority: "urgent" as never }, "user"), /Prioritāte/);
	assert.throws(() => addTask(store, { title: "Daudz", checklist: Array.from({ length: 41 }, (_, i) => ({ text: `p${i}` })) }, "user"), /līdz 40/);

	// the popup edits one field at a time
	const moved = updateTask(store, t.id, { start: "2026-11-25", due: "2026-11-30" }, "user");
	assert.deepEqual([moved.start, moved.due], ["2026-11-25", "2026-11-30"]);
	assert.equal(updateTask(store, t.id, { start: null }, "user").start, undefined, "start cleared: one day again");
	assert.equal(updateTask(store, t.id, { assignee: null }, "user").assignee, undefined);
	assert.equal(updateTask(store, t.id, { priority: "low" }, "user").priority, "low");
	const done = updateTask(store, t.id, { checklist: [{ id: "c1", text: "Viens", done: true }] }, "user");
	assert.deepEqual(done.checklist, [{ id: "c1", text: "Viens", done: true }]);
	assert.equal(updateTask(store, t.id, { checklist: [] }, "user").checklist, undefined);
	// an end moved before the start is refused; a start moved onto the end leaves a one-day task
	const span = updateTask(store, t.id, { start: "2026-11-26", due: "2026-12-02" }, "user");
	assert.throws(() => updateTask(store, t.id, { due: "2026-11-20" }, "user"), /pēc termiņa/);
	assert.equal(updateTask(store, span.id, { start: "2026-12-02" }, "user").start, undefined);
	// what the agent proposes is a plain task and stays one
	const prop = addTask(store, { title: "Pārbaudīt TN termiņus", due: "2026-11-25" }, "agent");
	assert.equal(prop.state, "proposed");
	assert.equal(prop.priority, undefined);
});

test("stage dates are kept in the project, repaired on reading, and cleared by null", () => {
	const store = mk();
	assert.deepEqual(readStageDates(store), {});
	const set = setStageDates(store, "Skice", { start: "2026-10-01", end: "2026-12-15" }, "user");
	assert.deepEqual(set, { Skice: { start: "2026-10-01", end: "2026-12-15" } });
	assert.deepEqual(readStageDates(store), set, "read back from the file");
	assert.throws(() => setStageDates(store, "Skice", { start: "2026-12-20", end: "2026-12-01" }, "user"), /pēc beigām/);
	assert.throws(() => setStageDates(store, "Skice", { start: "2026-13-01", end: "2026-12-01" }, "user"), /GGGG-MM-DD/);
	assert.throws(() => setStageDates(store, "Nezināma" as never, null, "user"), /Nezināma stadija/);
	// a damaged file gives only what is valid
	store.writeMeta("stage-dates", { Skice: { start: "2026-10-01", end: "2026-12-15" }, Tehniskais: { start: "x", end: "y" }, Foo: { start: "2026-01-01", end: "2026-02-01" } });
	assert.deepEqual(readStageDates(store), { Skice: { start: "2026-10-01", end: "2026-12-15" } });
	assert.deepEqual(setStageDates(store, "Skice", null, "user"), {});
});
