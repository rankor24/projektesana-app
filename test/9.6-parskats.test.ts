// 9.6 Pārskats, the project's page: tiles and the todo list from an invented project with a fixed today (Fri 2026-11-13), the
// stage timeline from deliveries and clocks, a todo row becoming a task, the findings history appended per check run, read back
// with a damaged line skipped, and "no data" before two runs. Nothing here is a second copy: it all comes from the stores.
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { runChecks } from "../src/checks/run.ts";
import { appendHistory, HISTORY_FILE, pointOf, readHistory } from "../src/core/history.ts";
import type { Delivery, Fact, Finding } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { projectDashboard } from "../src/core/summary.ts";
import { addTask } from "../src/core/tasks.ts";
import { clockOf, type ClockItem } from "../src/rules/clocks.ts";
import { factGrid, historySeries, stageTimeline } from "../src/shared/dashboard.ts";
import { tmp } from "./helpers.ts";

const TODAY = "2026-11-13";
const ev = { kind: "test", by: "test" };
const finding = (id: string, checkId: string, severity: Finding["severity"], state: Finding["state"] = "open"): Finding => ({ id, checkId, requirementId: null, severity, where: {}, message: id, key: id, state, firstSeen: TODAY, lastSeen: TODAY });
const del = (id: string, planned: string | null, submitted: string | null = null, stage: Delivery["stage"] = "Skice", kind: Delivery["kind"] = "MBP"): Delivery => ({ id, stage, kind, label: `${kind} ${id}`, plannedDate: planned, submittedDate: submitted, folder: null, items: [], checksRun: [] });
const clock = (id: string, requestedOn: string, receivedOn: string | null = null): ClockItem => ({ id, kind: "tn", issuer: `Izd ${id}`, issuerKind: "state_municipal", requestedOn, extended: false, receivedOn, sourceId: null, by: "user" });
const fact = (key: string, value: string, state: Fact["state"], at = "2026-11-10T10:00:00Z"): Fact => ({ id: `f_${key}_${value}`, key: `profile.${key}`, value, source: { name: "", at } as never, state, by: "agent", at });

function project(o: { findings?: Finding[]; deliveries?: Delivery[]; clocks?: ClockItem[]; facts?: Fact[]; reference?: boolean; folders?: boolean }) {
	const s = ProjectStore.open(tmp(), { id: "BD940", name: "Testa māja", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
	if (o.findings) s.write("findings", o.findings, ev);
	if (o.deliveries) s.write("deliveries", o.deliveries, ev);
	if (o.clocks) s.writeMeta("clocks", o.clocks, ev);
	if (o.facts) s.write("facts", o.facts, ev);
	if (o.reference) s.writeMeta("coordination", { basePoint: {} }, ev);
	s.writeMeta("scan", { at: "2026-11-12T09:00:00.000Z", ...(o.folders ? { folders: [{ folderKey: "1.1.1", name: "Izejas dati", files: 12 }, { folderKey: "1.2", name: "Projekta daļas", files: 3 }] } : {}) }, ev);
	return s;
}

test("the tiles: findings by severity, the next delivery, the closest clock, coordination and rooms from their checks, each opening its page", () => {
	const s = project({
		findings: [finding("a", "completeness", "error"), finding("b", "coordination", "warning"), finding("c", "coordination", "error"), finding("d", "rooms", "warning"), finding("e", "coordination", "info"), finding("f", "rooms", "warning", "overridden")],
		deliveries: [del("a", "2026-11-18"), del("old", "2026-01-01", "2026-02-01", "Koncept")],
		clocks: [clock("x", "2026-11-12")],
		reference: true,
	});
	const d = projectDashboard(s, TODAY);
	const t = Object.fromEntries(d.tiles.map((x) => [x.id, x]));
	assert.deepEqual(d.tiles.map((x) => x.id), ["findings", "delivery", "deadline", "coordination", "rooms"]);
	assert.deepEqual([t.findings.value, t.findings.tone, t.findings.sub, t.findings.open], ["4", "bad", "2 kļūdas · 2 brīdinājumi · 1 info", { panel: "prasibas", filter: "findings" }]);
	assert.deepEqual([t.delivery.value, t.delivery.sub, t.delivery.tone, t.delivery.open], ["MBP a", "2026-11-18 · pēc 5 d.", "warn", { panel: "nodevumi", filter: "a" }]);
	assert.equal(t.deadline.value, "TN: Izd x");
	assert.equal(t.deadline.open.panel, "nodevumi");
	assert.deepEqual([t.coordination.value, t.coordination.tone, t.coordination.open.panel], ["2", "warn", "koordinacija"], "open errors and warnings of the coordination check, not info");
	assert.deepEqual([t.rooms.value, t.rooms.open.panel], ["1", "telpas"], "an overridden one is not a difference any more");
	assert.deepEqual([d.id, d.name, d.stage, d.lastScan, d.missing], ["BD940", "Testa māja", "Koncept", "2026-11-12T09:00:00.000Z", false]);
});

test("a project with nothing: the tiles say so, coordination says no data without a reference, nothing is invented", () => {
	const d = projectDashboard(project({}), TODAY);
	const t = Object.fromEntries(d.tiles.map((x) => [x.id, x]));
	assert.deepEqual([t.findings.value, t.findings.tone], ["0", "ok"]);
	assert.deepEqual([t.delivery.value, t.delivery.tone], ["nav plānots", "dim"]);
	assert.deepEqual([t.deadline.value, t.deadline.tone], ["nav gaidāmu", "dim"]);
	assert.deepEqual([t.coordination.value, t.coordination.sub], ["no data", "nav atsauces"]);
	assert.equal(t.rooms.value, "0");
	assert.deepEqual([d.todo, d.recent.filter((r) => r.kind !== "data"), d.folders, d.history], [[], [], [], { state: "no data", runs: 0 }], "only the app's own data log of the day, no invented rows");
	assert.equal(d.stage, null);
});

test("the stage timeline: deliveries as marks on one axis, a late one flagged, clocks as bars under Skice, today a line, undated left off", () => {
	const ds = [del("a", "2026-11-10"), del("b", "2026-11-27", null, "Tehniskais", "PP"), del("c", null), del("d", "2026-10-01", "2026-10-05", "Koncept", "PU")];
	const cs = [clock("x", "2026-11-02"), clock("done", "2026-10-20", "2026-10-30")].map((c) => clockOf(c, TODAY));
	const tl = stageTimeline(ds, cs, TODAY, "Koncept", new Set(["Koncept", "Skice"]));
	assert.deepEqual(tl.stages.map((s) => [s.stage, s.inContract, s.current]), [["Koncept", true, true], ["Skice", true, false], ["Tehniskais", false, false], ["Detalizācijas", false, false], ["Būvniecība", false, false], ["As-Built", false, false]]);
	assert.equal(tl.from, "2026-10-05", "the earliest date on the axis: the sent delivery sits at its submitted date, not its planned one");
	assert.equal(tl.to, "2026-11-27");
	const skice = tl.stages[1];
	assert.deepEqual(skice.marks.map((m) => [m.id, m.date, m.late, m.sent]), [["a", "2026-11-10", true, false]], "planned and unsent before today: late; the undated one has no mark");
	assert.deepEqual(tl.stages[0].marks.map((m) => [m.id, m.date, m.sent, m.late]), [["d", "2026-10-05", true, false]], "a sent delivery sits at its submitted date");
	assert.equal(tl.stages[2].marks[0].pos, 100);
	assert.equal(tl.stages[0].marks[0].pos, 0);
	assert.equal(tl.todayPos, Math.round((39 / 53) * 1000) / 10);
	assert.deepEqual(skice.bars.map((b) => [b.id, b.from, b.late, b.done]), [["x", "2026-11-02", false, false], ["done", "2026-10-20", false, true]]);
	assert.ok(skice.bars[0].toPos > skice.bars[0].fromPos);
	assert.deepEqual(tl.stages.filter((s) => s.stage !== "Skice").map((s) => s.bars.length), [0, 0, 0, 0, 0]);
	const late = stageTimeline([], [clockOf(clock("l", "2026-09-01"), TODAY)], TODAY, null, new Set());
	assert.equal(late.stages[1].bars[0].late, true, "a clock past its end is red");
	// no dates at all: the axis is two weeks wide and today is on it
	const empty = stageTimeline([], [], TODAY, null, new Set());
	assert.deepEqual([empty.from, empty.to, empty.todayPos], ["2026-11-13", "2026-11-27", 0]);
});

test("Jāizdara: the project's attention, worst first; a row opens its page and makes a task with one click", () => {
	const s = project({ findings: [finding("a", "completeness", "error")], deliveries: [del("a", "2026-11-10")], clocks: [clock("late", "2026-09-01")] });
	const d = projectDashboard(s, TODAY);
	assert.equal(d.todo[0].level, "bad");
	assert.ok(d.todo.length >= 3);
	const row = d.todo.find((r) => r.text.startsWith("Nodevums"))!;
	assert.deepEqual(row.open, { panel: "nodevumi", filter: "a" });
	assert.equal(row.task.note, "BD940: no Pārskata saraksta Jāizdara");
	const t = addTask(s, { title: row.task.title, note: row.task.note }, "user");
	assert.deepEqual([t.title, t.state, t.note], [row.text, "open", row.task.note]);
	assert.equal(s.read("tasks").length, 1);
});

test("Fakti: the 14 keys as a grid, confirmed over proposed, several stages joined, rejected ones ignored", () => {
	const g = factGrid([
		fact("workType", "Jaunbūve", "confirmed"),
		fact("group", "2", "proposed"),
		fact("group", "3", "proposed", "2026-11-11T10:00:00Z"),
		fact("funding", "ES", "rejected"),
		fact("stagesInContract", "Koncept", "confirmed"),
		fact("stagesInContract", "Skice", "confirmed", "2026-11-11T10:00:00Z"),
		fact("sections", "AR", "proposed"),
		fact("use", "Dzīvojamā", "confirmed", "2026-11-01T00:00:00Z"),
		fact("use", "Biroju", "proposed", "2026-11-12T00:00:00Z"),
	]);
	assert.equal(g.length, 14);
	const by = Object.fromEntries(g.map((c) => [c.key, c]));
	assert.deepEqual([by.workType.value, by.workType.state, by.workType.proposals], ["Jaunbūve", "confirmed", 0]);
	assert.deepEqual([by.group.value, by.group.state, by.group.proposals, by.group.factId], ["3", "proposed", 2, "f_group_3"], "the newest proposal, and how many wait");
	assert.deepEqual([by.funding.value, by.funding.state], [null, "none"]);
	assert.equal(by.stagesInContract.value, "Skice, Koncept", "newest first, both confirmed");
	assert.deepEqual([by.sections.value, by.sections.state], ["AR", "proposed"]);
	assert.deepEqual([by.use.value, by.use.state, by.use.proposals], ["Dzīvojamā", "confirmed", 1], "a confirmed value wins over a newer proposal, which still waits");
	assert.equal(by.workType.label, "Būvniecības veids");
});

test("the recent changes: the last 30 days of versions, newest first, at most 12, with where to open them", () => {
	const s = project({});
	const src = (n: number, mtime: string) => ({ id: `s${n}`, kind: "pdf", folderKey: "1.1.1", paths: [`a${n}.pdf`], title: `Dok ${n}`, role: "Izejas dati", roleFrom: "folder", versions: [{ sha256: `x${n}`, mtime, seenAt: mtime, size: 1 }], signers: [] });
	s.write("sources", [src(1, "2026-11-10T08:00:00Z"), src(2, "2026-10-01T08:00:00Z"), src(3, "2026-11-12T08:00:00Z"), ...Array.from({ length: 12 }, (_, i) => src(10 + i, `2026-11-0${(i % 9) + 1}T08:00:00Z`))] as never, ev);
	const d = projectDashboard(s, TODAY);
	assert.equal(d.recent.length, 12);
	const srcRows = d.recent.filter((r) => r.kind === "source");
	assert.deepEqual(srcRows.slice(0, 2).map((r) => r.label.split(" — ")[0]), ["Dok 3", "Dok 1"]);
	assert.ok(!d.recent.some((r) => r.label.startsWith("Dok 2 —")), "two months ago is out");
	assert.deepEqual(srcRows[0].open, { sourceId: "s3" });
	assert.ok(d.recent.every((r, i) => i === 0 || d.recent[i - 1].at >= r.at), "newest first");
	assert.ok(d.recent.every((r) => !("compare" in r)), "the page row carries no compare data");
});

test("the folders of the last scan, with their counts", () => {
	const d = projectDashboard(project({ folders: true }), TODAY);
	assert.deepEqual(d.folders, [{ key: "1.1.1", name: "Izejas dati", files: 12 }, { key: "1.2", name: "Projekta daļas", files: 3 }]);
});

test("the findings history: each check run appends its open counts; a damaged line is skipped; no data before two runs", async () => {
	const s = project({});
	assert.deepEqual(readHistory(s), []);
	assert.deepEqual(historySeries([]), { state: "no data", runs: 0 });
	let n = 0;
	registerCheck({ id: "t-hist", title: "t", on: ["manual"], run: () => ({ results: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, severity: i === 0 ? ("error" as const) : ("warning" as const), message: `m${i}`, where: {} })) }) });
	try {
		n = 2;
		await runChecks(s, "manual", { dataDir: tmp(), today: TODAY, only: ["t-hist"] });
		assert.equal(readHistory(s).length, 1);
		assert.deepEqual(historySeries(readHistory(s)), { state: "no data", runs: 1 }, "one run: still no chart");
		assert.equal(projectDashboard(s, TODAY).history.state, "no data");
		n = 3;
		await runChecks(s, "manual", { dataDir: tmp(), today: TODAY, only: ["t-hist"] });
		const h = readHistory(s);
		assert.deepEqual(h.map((p) => [p.error, p.warning, p.info]), [[1, 1, 0], [1, 2, 0]]);
		const dash = projectDashboard(s, TODAY);
		assert.equal(dash.history.state, "ok");
		assert.equal(dash.history.state === "ok" && dash.history.points.length, 2);
		// a half-written line and a line that is not a point are skipped, the good ones read
		appendFileSync(join(s.dir, HISTORY_FILE), '{"at":"2026-11-13T10:00:00Z","error":1,"warn\n{"at":5}\nnot json\n', "utf8");
		appendHistory(s, pointOf([finding("z", "c", "error")], "2026-11-13T11:00:00Z"));
		assert.equal(readHistory(s).length, 3);
		assert.deepEqual(readHistory(s).at(-1), { at: "2026-11-13T11:00:00Z", error: 1, warning: 0, info: 0 });
	} finally {
		unregisterCheck("t-hist");
	}
	// a run that ran nothing leaves no line
	const before = readHistory(s).length;
	await runChecks(s, "manual", { dataDir: tmp(), today: TODAY, only: ["t-hist"] });
	assert.equal(readHistory(s).length, before);
});

test("the history file is capped to the newest 500 points and counts only open findings", () => {
	const s = project({});
	writeFileSync(join(s.dir, HISTORY_FILE), Array.from({ length: 520 }, (_, i) => JSON.stringify({ at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`, error: i, warning: 0, info: 0 })).join("\n") + "\n", "utf8");
	const h = readHistory(s);
	assert.equal(h.length, 500);
	assert.equal(h[0].error, 20, "the oldest 20 dropped");
	assert.deepEqual(pointOf([finding("a", "c", "error"), finding("b", "c", "warning", "closed"), finding("c", "c", "info"), finding("d", "c", "error", "overridden")], "t"), { at: "t", error: 1, warning: 0, info: 1 });
});
