// 7.1 Activity feed: the agent's RunEvents and the folder scan as lines a person reads (shared/activity.ts,
// main/activity.ts). Driven with the event shapes agent/pi/events.ts sends, including its cut tool input.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addActivity, changesText, factOf, field, groupRuns, isRunning, taskTitle, toolLine, type Activity } from "../src/shared/activity.ts";
import { ActivityLog, type SourceRow } from "../src/main/activity.ts";
import { TASKS } from "../src/agent/tasks.ts";

const SOURCES: SourceRow[] = [
	{ id: "s1", title: "PU_2024.pdf", role: "PU" },
	{ id: "s2", title: "Zemesgrāmata.pdf", role: "Īpašuma dokumenti" },
	{ id: "s3", title: "TN_Sadales_tikls.pdf", role: "Tehniskie noteikumi" },
];

function harness(opts: { sources?: SourceRow[]; levels?: Record<string, string> } = {}) {
	const sent: Activity[] = [];
	let t = Date.parse("2026-11-09T10:00:00Z");
	const log = new ActivityLog({
		send: (a) => sent.push(a),
		sources: () => opts.sources ?? SOURCES,
		levelOf: (tool) => opts.levels?.[tool] ?? "read",
		templates: TASKS,
		now: () => t,
	});
	return { log, sent, tick: (ms: number) => (t += ms), lines: () => log.recent() };
}

test("a cut tool input still gives its fields; an unfinished string ends with …", () => {
	const full = JSON.stringify({ key: "profile.cadastralNo", value: "0100 012 0345", sourceId: "s2", page: 2, quote: "kadastra apzīmējums 0100 012 0345" });
	assert.equal(field(full, "page"), 2);
	const cut = full.slice(0, full.indexOf("apzīmējums") + 4);
	assert.throws(() => JSON.parse(cut));
	assert.equal(field(cut, "key"), "profile.cadastralNo");
	assert.equal(field(cut, "page"), 2);
	assert.equal(field(cut, "quote"), "kadastra apzī…");
	assert.deepEqual(factOf(cut), { key: "profile.cadastralNo", value: "0100 012 0345", sourceId: "s2", page: 2, quote: "kadastra apzī…" });
	assert.equal(factOf('{"value":"x"}'), null);
});

test("tool lines are in words and name the source by its title", () => {
	const title = (id: string) => SOURCES.find((s) => s.id === id)?.title ?? null;
	assert.deepEqual(toolLine("read_source", JSON.stringify({ id: "s1", pages: "1-3" }), title), { text: "Lasa avotu: PU_2024.pdf · lpp. 1-3", kind: "read" });
	assert.deepEqual(toolLine("extract_candidates", JSON.stringify({ id: "zz" }), title), { text: "Meklē kandidātus: zz", kind: "search" });
	assert.equal(toolLine("set_fact", JSON.stringify({ key: "profile.address", value: "Brīvības iela 1", sourceId: "s1", page: 1, quote: "q" }), title).text, "Iesaka faktu: profile.address = Brīvības iela 1");
	assert.equal(toolLine("search_law", JSON.stringify({ q: "evakuācijas ceļš" }), title).text, "Meklē normatīvos: «evakuācijas ceļš»");
	assert.deepEqual(toolLine("get_current_view_info", "{}", title), { text: "Revit: get_current_view_info", kind: "revit" });
});

test("a run from a task template is titled with the template's label", () => {
	assert.equal(taskTitle(TASKS[0].text, TASKS), TASKS[0].label);
	assert.equal(taskTitle("  Cik stāvu ir ēkai?\nun vēl", TASKS), "Cik stāvu ir ēkai?");
});

test("extraction run: start, a call that changes in place, source chips, facts counted, done", () => {
	const h = harness({ levels: { set_fact: "propose" } });
	h.log.begin("p1", TASKS[0].text);
	// the run's first event comes before agent.send returns: it takes the pending prompt
	h.log.event("r1", { type: "tool", name: "list_sources", id: "c1", detail: "{}" });
	h.log.bind("r1");
	h.log.event("r1", { type: "tool_result", name: "list_sources", id: "c1", ok: true, output: "[…]", chars: 900 });
	h.log.event("r1", { type: "tool", name: "read_source", id: "c2", detail: JSON.stringify({ id: "s2" }) });
	h.log.event("r1", { type: "tool_result", name: "read_source", id: "c2", ok: true, output: "--- lpp. 1 ---" });
	h.log.event("r1", { type: "tool", name: "set_fact", id: "c3", detail: JSON.stringify({ key: "profile.cadastralNo", value: "0100 012 0345", sourceId: "s2", page: 2, quote: "kadastra apzīmējums 0100 012 0345" }) });
	h.log.event("r1", { type: "tool_result", name: "set_fact", id: "c3", ok: true, output: "ok" });
	// a fact whose quote the code refused: shown as failed, not counted
	h.log.event("r1", { type: "tool", name: "set_fact", id: "c4", detail: JSON.stringify({ key: "profile.use", value: "x", sourceId: "s2", page: 9, quote: "nav" }) });
	h.log.event("r1", { type: "tool_result", name: "set_fact", id: "c4", ok: false, detail: "citāts nav lapā" });
	h.log.event("r1", { type: "tool", name: "read_source", id: "c5", detail: JSON.stringify({ id: "s3" }) });
	h.log.event("r1", { type: "done", text: "Atrasts…" });

	const lines = h.lines();
	assert.equal(groupRuns(lines).length, 1);
	assert.equal(isRunning(lines), false);
	const start = lines.find((l) => l.kind === "start")!;
	assert.equal(start.text, TASKS[0].label);
	assert.equal(start.project, "p1");
	assert.equal(lines.filter((l) => l.kind === "start").length, 1, "bind after the first event opens nothing new");

	const tools = lines.filter((l) => l.kind === "tool");
	assert.equal(tools.length, 5, "one line per call: the result replaced the running line");
	assert.deepEqual(tools.map((l) => l.status), ["ok", "ok", "ok", "failed", "stopped"]);
	assert.equal(tools[0].chars, 900);
	assert.equal(tools[1].text, "Lasa avotu: Zemesgrāmata.pdf");
	assert.deepEqual(tools[2].fact, { key: "profile.cadastralNo", value: "0100 012 0345", sourceId: "s2", page: 2, quote: "kadastra apzīmējums 0100 012 0345" });
	assert.deepEqual(tools[2].source, { id: "s2", page: 2 });
	assert.match(tools[3].text, /neizdevās$/);
	assert.match(tools[3].detail!, /citāts nav lapā/);

	const summaries = lines.filter((l) => l.kind === "summary");
	assert.equal(summaries.length, 1, "the summary replaces itself");
	const s = summaries[0].summary!;
	assert.equal(s.steps, 5);
	assert.equal(s.listed, 3);
	assert.equal(s.changes.facts, 1);
	assert.deepEqual(
		s.sources.map((x) => [x.title, x.state, x.facts]),
		[
			["Zemesgrāmata.pdf", "read", 1],
			["TN_Sadales_tikls.pdf", "read", 0],
		],
	);
	assert.equal(lines[lines.length - 1].kind, "done");
	// every line was also sent as it was made
	assert.ok(h.sent.length > lines.length);
});

test("list_sources with a role counts only that role; an error ends the run and marks sources being read as failed", () => {
	const h = harness();
	h.log.begin("p1", "Izlasi TN");
	h.log.bind("r2");
	h.log.event("r2", { type: "tool", name: "list_sources", id: "a", detail: JSON.stringify({ role: "Tehniskie noteikumi" }) });
	h.log.event("r2", { type: "tool_result", name: "list_sources", id: "a", ok: true, output: "[]" });
	h.log.event("r2", { type: "tool", name: "read_source", id: "b", detail: JSON.stringify({ id: "s3" }) });
	h.log.event("r2", { type: "error", engine: "pi", message: "aborted" });
	const s = h.lines().filter((l) => l.kind === "summary").pop()!.summary!;
	assert.equal(s.listed, 1);
	assert.equal(s.sources[0].state, "failed");
	assert.equal(h.lines().pop()!.kind, "error");
});

test("thinking grows in one line, sent at most once a second and flushed when a tool starts", () => {
	const h = harness();
	h.log.bind("r3");
	h.log.event("r3", { type: "thinking", text: "Vispirms " });
	h.tick(200);
	h.log.event("r3", { type: "thinking", text: "jāapskata PU." });
	assert.equal(h.sent.filter((l) => l.kind === "thinking").length, 1, "the second piece came within a second");
	h.log.event("r3", { type: "tool", name: "get_profile", id: "x", detail: "{}" });
	const think = h.lines().filter((l) => l.kind === "thinking");
	assert.equal(think.length, 1);
	assert.equal(think[0].detail, "Vispirms jāapskata PU.");
	assert.equal(think[0].text, "Vispirms jāapskata PU.");
});

test("Revit batches: a confirm line is answered in place, and a successful confirm-level tool counts as a Revit change", () => {
	const h = harness({ levels: { create_level: "confirm" } });
	h.log.bind("r4");
	h.log.event("r4", { type: "confirm", id: "k1", tool: "create_level", batch: "[]" });
	h.log.confirmed("k1", true);
	h.log.event("r4", { type: "tool", name: "create_level", id: "t", detail: "{}" });
	h.log.event("r4", { type: "tool_result", name: "create_level", id: "t", ok: true, output: "ok" });
	h.log.event("r4", { type: "done", text: "" });
	// after the run, the app's own revision note
	h.log.event("r4", { type: "text", text: "\n[lietotne] revīzija rv3" });
	const conf = h.lines().filter((l) => l.kind === "confirm");
	assert.equal(conf.length, 1);
	assert.equal(conf[0].status, "ok");
	assert.equal(conf[0].text, "Atļauts: create_level");
	assert.equal(h.lines().filter((l) => l.kind === "summary").pop()!.summary!.changes.revit, 1);
	const note = h.lines().pop()!;
	assert.equal(note.kind, "note");
	assert.equal(note.text, "revīzija rv3");
	assert.equal(h.lines().filter((l) => l.kind === "answer").length, 0);
});

test("the folder scan is an app run: one line that counts up (a few times a second), then done", () => {
	const h = harness();
	h.log.scan({ projectId: "p1", phase: "walk", done: 0, total: 0 });
	for (let i = 1; i <= 50; i++) {
		h.tick(10);
		h.log.scan({ projectId: "p1", phase: "text", done: i, total: 50, current: `f${i}.pdf` });
	}
	const sentScan = h.sent.filter((l) => l.kind === "tool").length;
	assert.ok(sentScan < 10, `scan lines sent: ${sentScan}`);
	h.log.scan({ projectId: "p1", phase: "done", done: 50, total: 50 });
	const lines = h.lines();
	assert.deepEqual(
		lines.map((l) => l.kind),
		["start", "tool", "done"],
	);
	assert.equal(lines[0].who, "app");
	assert.equal(lines[1].status, "ok");
	assert.equal(lines[1].text, "Avoti nolasīti: 50");
	// a done with no scan going is nothing
	h.log.scan({ projectId: "p2", phase: "done", done: 0, total: 0 });
	assert.equal(h.lines().length, 3);
});

test("the buffer keeps the newest lines; changes read as Latvian plurals", () => {
	let list: Activity[] = [];
	for (let i = 0; i < 10; i++) list = addActivity(list, { run: "r", project: null, who: "agent", at: "", kind: "note", text: String(i) }, 4);
	assert.deepEqual(list.map((l) => l.text), ["6", "7", "8", "9"]);
	assert.equal(changesText({ facts: 4, requirements: 1, pins: 0, notes: 0, revit: 2 }), "4 fakti ieteikti · 1 prasība · 2 Revit partijas");
	assert.equal(changesText({ facts: 0, requirements: 0, pins: 0, notes: 0, revit: 0 }), "");
});
