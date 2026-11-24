// 21.0 the agent log (Žurnāls): every event of a run and what it started with become entries in order, written to the run's folder and
// told to the window; a streamed answer is one growing entry; a tool's whole arguments and answer come from the engines' `input` / `full`;
// keys, tokens and passwords never reach the file or the window; a log read in a later session still shows the run, and a run the
// process no longer holds as running was stopped. Invented runs; no model is called.
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { newPiState, piEvents } from "../src/agent/pi/events.ts";
import { AgentLog } from "../src/core/agent-log.ts";
import { MAX_BODY, forWindow, groupOf, matches, redact, type LogEntry, type LogGroup, type LogNotice } from "../src/shared/agent-log.ts";
import type { RunMeta } from "../src/shared/thread-types.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const META: RunMeta = { threadId: "t1", agent: "lead", projectId: "BD999", wave: "w1" };
const START = { provider: "anthropic", model: "claude-x", engine: "pi", system: "You are the lead.", prompt: "Read the sources.\nThen list the rooms.", tools: ["list_sources", "set_fact"], history: 0 };

/** A clock that moves 10 ms per call, so durations are known. */
function clock() {
	let t = 1_700_000_000_000;
	return () => (t += 10);
}

function setup() {
	const runsDir = tmp();
	const notices: LogNotice[] = [];
	const log = new AgentLog({ runsDir, send: (n) => notices.push(n), now: clock() });
	return { runsDir, notices, log };
}

const feed = (log: AgentLog, runId: string, events: RunEvent[], lane?: { id: string; label: string }) => {
	for (const e of events) log.event(runId, e, META, lane);
};

test("a run becomes ordered entries: model, system text, prompt, reasoning, answer, tool call and answer, usage, done", () => {
	const { log, runsDir, notices } = setup();
	log.start("r1", META, START);
	feed(log, "r1", [
		{ type: "turn", n: 1 },
		{ type: "thinking", text: "I should list " },
		{ type: "thinking", text: "the sources first." },
		{ type: "text", text: "Looking " },
		{ type: "text", text: "now." },
		{ type: "tool", name: "list_sources", id: "c1", detail: '{"role":"tn"}' },
		{ type: "tool_result", name: "list_sources", id: "c1", ok: true, output: "3 sources", chars: 9 },
		{ type: "usage", input: 1200, output: 80, cacheRead: 1000, cacheWrite: 0, cost: 0.0123 },
		{ type: "done", text: "Looking now." },
	]);
	const entries = log.read("r1");
	assert.deepEqual(entries.map((e) => e.kind), ["run", "system", "prompt", "note", "thinking", "text", "tool", "result", "usage", "run"]);
	assert.deepEqual(entries.map((e) => e.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	assert.match(entries[0].text!, /tools offered \(2\): list_sources, set_fact/);
	assert.equal(entries[1].text, "You are the lead.");
	assert.equal(entries[2].text, "Read the sources.\nThen list the rooms.");
	assert.equal(entries[2].title, "Read the sources.");
	assert.equal(entries[4].text, "I should list the sources first.", "the deltas are one entry");
	assert.equal(entries[5].text, "Looking now.");
	assert.equal(entries[6].text, JSON.stringify({ role: "tn" }, null, 2), "arguments shown as JSON");
	assert.equal(entries[7].ok, true);
	assert.equal(entries[7].id, "c1");
	assert.ok((entries[7].ms ?? 0) > 0, "the result says how long the call took");
	assert.equal(entries[8].usage?.cost, 0.0123);
	const runs = log.runs();
	assert.equal(runs.length, 1);
	assert.deepEqual({ status: runs[0].status, tools: runs[0].tools, errors: runs[0].errors, model: runs[0].model, title: runs[0].title }, { status: "ok", tools: 1, errors: 0, model: "anthropic/claude-x", title: "Read the sources." });
	assert.deepEqual(runs[0].usage, { turns: 1, input: 1200, output: 80, cacheRead: 1000, cacheWrite: 0, cost: 0.0123 });
	// on disk: one JSON line per finished entry, and the small meta file
	assert.ok(existsSync(join(runsDir, "r1", "log.json")));
	assert.equal(readFileSync(join(runsDir, "r1", "log.jsonl"), "utf8").trim().split("\n").length, 10);
	// the window was told for every entry, the streamed ones too
	assert.ok(notices.length >= 10);
	assert.equal(notices.at(-1)!.run.status, "ok");
});

test("the tool's whole arguments and answer are kept when the engine cut them for the dock", () => {
	const { log } = setup();
	const big = "x".repeat(5000);
	// the events come out of the engine's mapper: cut copies for the dock, the whole text in input / full
	const st = newPiState();
	const out = [
		...piEvents({ type: "tool_execution_start", toolCallId: "c9", toolName: "read_page", args: { text: big } } as never, st),
		...piEvents({ type: "tool_execution_end", toolCallId: "c9", toolName: "read_page", isError: false, result: { content: [{ type: "text", text: big }] } } as never, st),
	];
	const [call, result] = out as [Extract<RunEvent, { type: "tool" }>, Extract<RunEvent, { type: "tool_result" }>];
	assert.equal(call.detail!.length, 600);
	assert.equal(call.input!.length, JSON.stringify({ text: big }).length);
	assert.equal(result.output!.length, 2000);
	assert.equal(result.full!.length, 5000);
	assert.equal(result.chars, 5000);
	// a short call and answer carry no extra copy
	const short = [...piEvents({ type: "tool_execution_start", toolCallId: "c1", toolName: "t", args: { a: 1 } } as never, newPiState())];
	assert.equal((short[0] as { input?: string }).input, undefined);
	// the window never sees the whole copies
	assert.equal("input" in forWindow(call), false);
	assert.equal("full" in forWindow(result), false);
	assert.equal(forWindow(call).type, "tool");
	// the log does
	feed(log, "r2", [call, result]);
	const [t, r] = log.read("r2");
	assert.equal(JSON.parse(t.text!).text.length, 5000);
	assert.equal(r.text!.length, 5000);
	assert.equal(r.chars, 5000);
	assert.equal(r.cut, undefined);
});

test("keys, tokens and passwords are masked in what is kept, written and sent", () => {
	const { log, runsDir, notices } = setup();
	const key = "sk-ant-api03-AbCdEf0123456789AbCdEf0123456789";
	log.start("r3", META, { ...START, system: `Use the key ${key} for calls.`, prompt: "ok" });
	feed(log, "r3", [
		{ type: "tool", name: "http", id: "c1", detail: JSON.stringify({ url: "https://x", headers: { Authorization: "Bearer abcdefghijklmnop1234" }, api_key: "hunter2hunter2" }) },
		{ type: "tool_result", name: "http", id: "c1", ok: false, detail: "CLAUDE_CODE_OAUTH_TOKEN=tok_1234567890abcdef failed", output: "CLAUDE_CODE_OAUTH_TOKEN=tok_1234567890abcdef failed" },
		{ type: "text", text: "The password: correcthorsebattery was wrong" },
		{ type: "done", text: "" },
	]);
	const disk = readFileSync(join(runsDir, "r3", "log.jsonl"), "utf8");
	const shown = JSON.stringify(notices);
	const memory = JSON.stringify(log.read("r3"));
	for (const text of [disk, shown, memory]) {
		for (const secret of [key, "abcdefghijklmnop1234", "hunter2hunter2", "tok_1234567890abcdef", "correcthorsebattery"]) assert.equal(text.includes(secret), false, `${secret} leaked`);
		assert.ok(text.includes("[***]"));
	}
	// ordinary text stays
	assert.equal(redact("Telpa 1-7, platība 12,5 m², sk. LBN 202-18"), "Telpa 1-7, platība 12,5 m², sk. LBN 202-18");
	assert.equal(redact('{"token_count": 5}'), '{"token_count": 5}');
});

test("an error ends the run as failed; 'aborted' as stopped; usage of a failed call counts as an error", () => {
	const { log } = setup();
	feed(log, "r4", [{ type: "tool", name: "t", id: "c1", detail: "{}" }, { type: "tool_result", name: "t", id: "c1", ok: false, detail: "boom", output: "boom" }, { type: "error", engine: "pi", message: "429 rate limit\nretry later", hint: { kind: "usage_limit", scope: "provider" } }]);
	feed(log, "r5", [{ type: "error", engine: "pi", message: "aborted" }]);
	const byId = Object.fromEntries(log.runs().map((r) => [r.runId, r]));
	assert.equal(byId.r4.status, "failed");
	assert.equal(byId.r4.errors, 2);
	assert.equal(byId.r5.status, "stopped");
	const e = log.read("r4").at(-1)!;
	assert.equal(e.kind, "error");
	assert.equal(e.title, "429 rate limit");
	assert.match(e.text!, /retry later[\s\S]*usage_limit/);
	// a later "aborted" after done does not turn a finished run into a stopped one
	feed(log, "r6", [{ type: "done", text: "x" }, { type: "error", engine: "pi", message: "aborted" }]);
	assert.equal(log.runs().find((r) => r.runId === "r6")!.status, "ok");
});

test("a helper's own events carry its lane, and its text does not mix with the run's", () => {
	const { log } = setup();
	const lane = { id: "j1", label: "Read TN", agent: "helper" };
	feed(log, "r7", [{ type: "text", text: "main " }, { type: "tool", name: "delegate", id: "d1", detail: "{}" }]);
	log.start("r7", META, { ...START, prompt: "Read TN" }, lane);
	feed(log, "r7", [{ type: "text", text: "lane says hi" }, { type: "tool", name: "read_source", id: "L1", detail: '{"id":"A"}' }], lane);
	feed(log, "r7", [{ type: "tool_result", name: "delegate", id: "d1", ok: true, output: "ok" }, { type: "text", text: "run goes on" }, { type: "lane", id: "j1", label: "Read TN", agent: "helper", phase: "end", ok: true, report: "done: 3 pages" }]);
	const es = log.read("r7");
	const texts = es.filter((e) => e.kind === "text");
	assert.deepEqual(texts.map((e) => [e.text, e.lane?.id ?? null]), [["main ", null], ["lane says hi", "j1"], ["run goes on", null]]);
	assert.equal(es.find((e) => e.kind === "tool" && e.name === "read_source")!.lane?.label, "Read TN");
	const end = es.find((e) => e.kind === "lane")!;
	assert.equal(end.text, "done: 3 pages");
	assert.equal(end.lane?.agent, "helper");
	// a lane's own done / error does not end the run
	feed(log, "r7", [{ type: "done", text: "lane report" }], lane);
	assert.equal(log.runs().find((r) => r.runId === "r7")!.status, "running");
});

test("a streamed block that is still open is read as it is now, and is flushed when it ends", () => {
	const { log, notices } = setup();
	feed(log, "r8", [{ type: "text", text: "partial " }]);
	const open = log.read("r8");
	assert.equal(open.length, 1);
	assert.equal(open[0].text, "partial ");
	assert.equal(open[0].open, true);
	feed(log, "r8", [{ type: "text", text: "answer" }, { type: "tool", name: "t", id: "c", detail: "{}" }]);
	const after = log.read("r8");
	assert.deepEqual(after.map((e) => [e.kind, e.text ?? null, e.open ?? false]), [["text", "partial answer", false], ["tool", null, false]]);
	// the window's copy of the same entry is replaced by number
	const numbers = notices.filter((n) => n.entry?.kind === "text").map((n) => n.entry!.n);
	assert.ok(numbers.every((n) => n === 1));
});

test("a body over the limit is cut and marked; a blank block leaves nothing in the file", () => {
	const { log, runsDir } = setup();
	feed(log, "r9", [{ type: "tool_result", name: "t", id: "c", ok: true, output: "short", full: "y".repeat(MAX_BODY + 50), chars: MAX_BODY + 50 }, { type: "thinking", text: "  " }, { type: "done", text: "" }]);
	const es = log.read("r9");
	assert.equal(es[0].text!.length, MAX_BODY);
	assert.equal(es[0].cut, true);
	assert.equal(es[0].chars, MAX_BODY + 50);
	assert.equal(es.some((e) => e.kind === "thinking"), false);
	assert.equal(readFileSync(join(runsDir, "r9", "log.jsonl"), "utf8").includes('"thinking"'), false);
});

test("a later session reads the finished run from disk; a run left running by the old process is listed as stopped; old logs are removed, their folder stays", () => {
	const runsDir = tmp();
	let now = 1_700_000_000_000;
	const a = new AgentLog({ runsDir, now: () => (now += 10) });
	a.start("done1", META, START);
	feed(a, "done1", [{ type: "text", text: "hello" }, { type: "done", text: "hello" }]);
	a.start("cut1", { ...META, projectId: "BD111" }, START);
	feed(a, "cut1", [{ type: "text", text: "half" }, { type: "tool", name: "t", id: "c", detail: "{}" }]);
	// the app restarts: a fresh recorder reads the same folder
	const b = new AgentLog({ runsDir, now: () => (now += 10) });
	const runs = b.runs();
	assert.deepEqual(runs.map((r) => [r.runId, r.status]).sort(), [["cut1", "stopped"], ["done1", "ok"]]);
	assert.deepEqual(b.read("done1").map((e) => e.kind), ["run", "system", "prompt", "text", "run"]);
	// the project filter
	assert.deepEqual(b.runs({ projectId: "BD111" }).map((r) => r.runId), ["cut1"]);
	assert.deepEqual(b.runs({ projectId: null }).map((r) => r.runId), []);
	// a new event of a run an older process began goes on numbering where it stopped
	feed(b, "done1", [{ type: "text", text: "late note" }]);
	feed(b, "done1", [{ type: "tool", name: "t2", id: "z", detail: "{}" }]);
	const ns = b.read("done1").map((e) => e.n);
	assert.deepEqual(ns, [...new Set(ns)].sort((x, y) => x - y), "no number is used twice");
	// pruning: a log last written 31 days ago is gone at the next start, the folder is not; a recent one stays
	const old = new Date(Date.now() - 31 * 86_400_000);
	utimesSync(join(runsDir, "done1", "log.json"), old, old);
	new AgentLog({ runsDir });
	assert.equal(existsSync(join(runsDir, "cut1", "log.json")), true);
	assert.equal(existsSync(join(runsDir, "done1", "log.json")), false);
	assert.equal(existsSync(join(runsDir, "done1", "log.jsonl")), false);
	assert.equal(existsSync(join(runsDir, "done1")), true);
});

test("export: Markdown for a person, JSONL for a tool; the file name is safe", () => {
	const { log } = setup();
	log.start("r10", { ...META, agent: "a/b:c" }, START);
	feed(log, "r10", [{ type: "tool", name: "t", id: "c", detail: '{"a":1}' }, { type: "tool_result", name: "t", id: "c", ok: true, output: "fine" }, { type: "done", text: "" }]);
	const md = log.export("r10", "md");
	assert.match(md.fileName, /^[^\\/:*?"<>|]+\.md$/);
	assert.equal(md.mime, "text/markdown");
	assert.match(md.text, /^# a\/b:c · /);
	assert.match(md.text, /## \+\d[^\n]* · tool · t\n/);
	assert.match(md.text, /fine/);
	const jl = log.export("r10", "jsonl");
	assert.ok(jl.fileName.endsWith(".jsonl"));
	const rows = jl.text.trim().split("\n").map((l) => JSON.parse(l) as LogEntry);
	assert.equal(rows.length, log.read("r10").length);
	assert.throws(() => log.export("nope", "md"), /nav atrasts/);
});

test("filters: the kinds fall into the user's groups, and the search finds text, tool names and titles", () => {
	const all = new Set<LogGroup>(["prompt", "reasoning", "answer", "tool", "error", "info"]);
	const e = (kind: LogEntry["kind"], more: Partial<LogEntry> = {}): LogEntry => ({ n: 1, at: 0, kind, title: "", ...more });
	assert.deepEqual((["system", "prompt", "thinking", "text", "tool", "result", "error", "retry", "usage", "run", "lane", "check", "compact", "confirm", "note"] as const).map(groupOf), ["prompt", "prompt", "reasoning", "answer", "tool", "tool", "error", "error", "info", "info", "info", "info", "info", "info", "info"]);
	assert.equal(matches(e("tool", { name: "set_fact" }), all, "SET_fact"), true);
	assert.equal(matches(e("text", { text: "Telpa 1-7" }), all, "telpa"), true);
	assert.equal(matches(e("text", { text: "Telpa 1-7" }), all, "durvis"), false);
	assert.equal(matches(e("thinking", { text: "x" }), new Set<LogGroup>(["tool"]), ""), false);
});
