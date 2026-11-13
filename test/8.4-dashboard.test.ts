// 8.4 the projects dashboard: per project the stage, next delivery, open findings by severity, closest clock, last scan and
// why it needs attention, computed from the project's own stores; the cross-project list puts the worst and most urgent first.
// Invented projects. Today is fixed: Friday 2026-11-13.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Delivery, Finding } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { attentionAcross, closestClock, daysBetween, nextDelivery, openCounts, projectSummary, stageOf } from "../src/core/summary.ts";
import { clockOf, type ClockItem } from "../src/rules/clocks.ts";
import { tmp } from "./helpers.ts";

const TODAY = "2026-11-13";
const open = (id: string, severity: Finding["severity"], state: Finding["state"] = "open"): Finding => ({ id, checkId: "c", requirementId: null, severity, where: {}, message: id, key: id, state, firstSeen: TODAY, lastSeen: TODAY });
const del = (id: string, planned: string | null, submitted: string | null = null, stage: Delivery["stage"] = "Skice"): Delivery => ({ id, stage, kind: "MBP", label: `MBP ${id}`, plannedDate: planned, submittedDate: submitted, folder: null, items: [], checksRun: [] });
const clock = (id: string, requestedOn: string, receivedOn: string | null = null): ClockItem => ({ id, kind: "tn", issuer: `Izdevējs ${id}`, issuerKind: "state_municipal", requestedOn, extended: false, receivedOn, sourceId: null, by: "user" });
const ev = { kind: "test", by: "test" };

function project(id: string, o: { findings?: Finding[]; deliveries?: Delivery[]; clocks?: ClockItem[]; scan?: boolean }) {
	const s = ProjectStore.open(tmp(), { id, name: id, root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
	if (o.findings) s.write("findings", o.findings, ev);
	if (o.deliveries) s.write("deliveries", o.deliveries, ev);
	if (o.clocks) s.writeMeta("clocks", o.clocks, ev);
	if (o.scan !== false) s.writeMeta("scan", { at: "2026-11-12T09:00:00.000Z" }, ev);
	return s;
}

test("calendar days between ISO dates, either order", () => {
	assert.equal(daysBetween("2026-11-13", "2026-11-20"), 7);
	assert.equal(daysBetween("2026-11-13", "2026-11-10"), -3);
	assert.equal(daysBetween("2026-11-13", "2026-11-13T23:00:00Z"), 0);
	assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("open findings are counted by severity; closed and overridden are not", () => {
	assert.deepEqual(openCounts([open("a", "error"), open("b", "error"), open("c", "warning"), open("d", "info"), open("e", "error", "closed"), open("f", "warning", "overridden")]), { error: 2, warning: 1, info: 1 });
});

test("the stage is the last delivery marked sent; the next delivery is the earliest unsent one with a date", () => {
	const ds = [del("a", "2026-11-10"), del("b", "2026-11-18"), del("c", null), del("d", "2026-01-01", "2026-10-01", "Skice"), del("e", "2026-02-01", "2026-10-20", "Tehniskais")];
	assert.equal(stageOf(ds), "Tehniskais");
	assert.deepEqual(nextDelivery(ds, TODAY), { id: "a", label: "MBP a", date: "2026-11-10", daysLeft: -3 });
	assert.equal(nextDelivery([del("x", null)], TODAY), null, "no planned date, no next delivery");
	assert.equal(stageOf([del("a", "2026-11-10")]), null);
});

test("the closest clock is the one nearest its end that is still waiting or late; received clocks are done", () => {
	const cs = [clock("late", "2026-09-01"), clock("done", "2026-10-01", "2026-10-10"), clock("fresh", "2026-11-12")].map((c) => clockOf(c, TODAY));
	const c = closestClock(cs)!;
	assert.equal(c.state, "kavē");
	assert.equal(c.label, "TN: Izdevējs late");
	assert.ok(c.daysLeft < 0);
	assert.equal(closestClock([clockOf(clock("done", "2026-10-01", "2026-10-10"), TODAY)]), null);
});

test("an overdue delivery, a late clock and open errors are red; a soon delivery and warnings are amber; red first", () => {
	const s = projectSummary(project("BD901", { findings: [open("a", "error"), open("b", "warning"), open("c", "info")], deliveries: [del("a", "2026-11-10"), del("b", "2026-11-18")], clocks: [clock("late", "2026-09-01")] }), TODAY);
	const text = s.attention.map((a) => `${a.level}:${a.text}`);
	assert.deepEqual(text.slice(0, 3).map((t) => t.split(":")[0]), ["bad", "bad", "bad"]);
	assert.ok(text.includes("bad:1 atvērtas kļūdas"));
	assert.ok(text.includes("bad:Nodevums MBP a kavējas 3 d."));
	assert.ok(text.some((t) => /^bad:TN: Izdevējs late kavējas \d+ darba d\.$/.test(t)));
	assert.ok(text.includes("warn:1 brīdinājumi"));
	assert.equal(s.attention.at(-1)!.level, "warn");
	assert.deepEqual(s.attention.find((a) => a.text.startsWith("Nodevums"))!.open, { panel: "nodevumi", filter: "a" });
	assert.equal(s.next!.daysLeft, -3);
	assert.equal(s.lastScan, "2026-11-12T09:00:00.000Z");
});

test("a delivery within 7 days and a clock ending in 3 working days are amber, with the days said", () => {
	// requested Fri 2026-10-30, 11 working days: due Mon 2026-11-16, one working day from today
	const s = projectSummary(project("BD902", { deliveries: [del("b", "2026-11-18")], clocks: [clock("soon", "2026-10-30")] }), TODAY);
	assert.deepEqual(s.attention.map((a) => a.level), ["warn", "warn"]);
	assert.match(s.attention[0].text, /TN: Izdevējs soon: atlikušas 1 darba d\./);
	assert.equal(s.attention[1].text, "Nodevums MBP b pēc 5 d.");
});

test("a project with nothing wrong has nothing to attend to; an unscanned or missing one says so", () => {
	assert.deepEqual(projectSummary(project("BD903", { deliveries: [del("far", "2026-12-31")] }), TODAY).attention, []);
	assert.deepEqual(projectSummary(project("BD904", { scan: false }), TODAY).attention.map((a) => a.text), ["Projekts vēl nav nolasīts"]);
	const missing = projectSummary(project("BD905", { scan: false }), TODAY, true);
	assert.deepEqual(missing.attention.map((a) => a.text), ["Projekta mape nav pieejama"]);
	assert.equal(missing.attention[0].level, "bad");
});

test("across projects: red before amber, then the most urgent, then by project", () => {
	const a = projectSummary(project("BD910", { deliveries: [del("x", "2026-11-18")] }), TODAY); // amber, 5 days
	const b = projectSummary(project("BD911", { deliveries: [del("y", "2026-11-12")] }), TODAY); // red, 1 day late
	const c = projectSummary(project("BD912", { deliveries: [del("z", "2026-11-01")] }), TODAY); // red, 12 days late
	const rows = attentionAcross([a, b, c]);
	assert.deepEqual(rows.map((r) => [r.projectId, r.level]), [["BD912", "bad"], ["BD911", "bad"], ["BD910", "warn"]]);
});
