// 8.15 sub-agents and delegate: the write locks, the level caps, the specialists, the lanes (scripted agent loops: nothing leaves the
// machine) and the session handing the two tools to a run. Invented names only.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentTool, BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { WriteLocks, lockKeyOf } from "../src/agent/locks.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOL_LEVELS, SPECIALIST_CAP, SUBAGENT_CAP, findSpec, laneTools, rosterText, subagentTools, validateSpec, type LaneDeps } from "../src/agent/subagents.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import { makeLevelOf, offered } from "../src/agent/tools/levels.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";
import { ActivityLog } from "../src/main/activity.ts";
import type { Activity } from "../src/shared/activity.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
const appNames = allTools().map((t) => t.name);
const revitNames = Object.keys(REVIT_LEVELS);
const listed = [...offered(appNames, levelOf), ...offered(revitNames, levelOf)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- locks ------------------------------------------------------------------------------------------------------------------

test("8.15 locks: what needs a lock — reads none; staging, project data and Revit each their own", () => {
	assert.equal(lockKeyOf("read_source", "read"), null);
	assert.equal(lockKeyOf("docx_apply", "run"), "staging");
	assert.equal(lockKeyOf("write_document", "run"), "staging");
	assert.equal(lockKeyOf("rename_staged", "run"), "staging");
	assert.equal(lockKeyOf("set_fact", "propose"), "store");
	assert.equal(lockKeyOf("expert_add", "propose"), "store");
	assert.equal(lockKeyOf("revit_create_sheet", "confirm"), "revit");
	assert.equal(lockKeyOf("anything", "run", new Set(["anything"])), "revit");
	assert.equal(lockKeyOf("x", "never"), null);
});

test("8.15 locks: writers on one key take turns in order; another key is free at once", async () => {
	const l = new WriteLocks();
	assert.deepEqual(await l.acquire("staging", "a", "c1"), { ok: true });
	const order: string[] = [];
	const b = l.acquire("staging", "b", "c2").then((r) => (order.push("b"), r));
	const c = l.acquire("staging", "c", "c3").then((r) => (order.push("c"), r));
	assert.deepEqual(await l.acquire("store", "b", "c4"), { ok: true }, "another key does not wait");
	await sleep(10);
	assert.deepEqual(order, [], "b and c are waiting for a");
	assert.equal(l.heldBy("staging"), "a");
	l.release("c1");
	assert.deepEqual(await b, { ok: true });
	assert.deepEqual(order, ["b"], "c still waits for b");
	l.release("c2");
	assert.deepEqual(await c, { ok: true });
	assert.deepEqual(order, ["b", "c"]);
	l.release("c3");
	assert.equal(l.heldBy("staging"), null);
	l.release("never-held");
});

test("8.15 locks: a wait ends with a reason when it times out or Stop is pressed; a lane that ends frees what it held and cancels its waits", async () => {
	const l = new WriteLocks({ waitMs: 30 });
	await l.acquire("staging", "Dokumenti", "h1");
	const late = await l.acquire("staging", "Cits", "w1");
	assert.equal(late.ok, false);
	assert.match((late as { reason: string }).reason, /Nodevuma mapi šobrīd maina Dokumenti/);
	const ac = new AbortController();
	const l2 = new WriteLocks();
	await l2.acquire("store", "a", "x1");
	const waiting = l2.acquire("store", "b", "x2", ac.signal);
	ac.abort();
	assert.match(((await waiting) as { reason: string }).reason, /Apturēts/);
	assert.equal((await l2.acquire("store", "c", "x3", ac.signal)).ok, false, "already stopped: no wait at all");
	// the holder's lane ends: the lock goes on to the next, and a waiter of the ended lane is told no
	const l3 = new WriteLocks();
	await l3.acquire("revit", "lane:a", "y1");
	const next = l3.acquire("revit", "lane:b", "y2");
	const ghost = l3.acquire("revit", "lane:c", "y3");
	l3.releaseOwner("lane:c");
	assert.match(((await ghost) as { reason: string }).reason, /beidza darbu/);
	l3.releaseOwner("lane:a");
	assert.deepEqual(await next, { ok: true });
	assert.equal(l3.heldBy("revit"), "lane:b");
});

// ---- levels and specialists ---------------------------------------------------------------------------------------------------

test("8.15 levels: a helper is offered nothing above read, a specialist nothing above run; never the two tools themselves; never more than the main agent has", () => {
	const sub = laneTools(listed, levelOf, SUBAGENT_CAP);
	assert.ok(sub.length > 10);
	for (const n of sub) assert.equal(levelOf(n), "read", n);
	const spec = laneTools(listed, levelOf, SPECIALIST_CAP);
	for (const n of spec) assert.ok(LEVEL_RANK[levelOf(n)] <= LEVEL_RANK.run, n);
	assert.ok(spec.includes("write_document") && spec.includes("set_fact") && spec.includes("expert_add"), "propose and run tools can be given to a specialist");
	// what needs the user's batch confirmation is out, whatever a specialist asks for
	for (const n of listed.filter((x) => levelOf(x) === "confirm")) assert.ok(!spec.includes(n), n);
	assert.ok(listed.some((x) => levelOf(x) === "confirm"), "the check is not empty: there are confirm tools");
	for (const n of ["run_subagent", "delegate"]) assert.ok(!sub.includes(n) && !spec.includes(n), `${n} would let a lane start lanes`);
	// the lane's tools are a subset of what the main agent was offered
	for (const n of [...sub, ...spec]) assert.ok(listed.includes(n));
	assert.deepEqual(laneTools(["read_source", "set_fact", "nav-tāda"], levelOf, "run", ["set_fact"]), ["set_fact"]);
	assert.equal(levelOf("run_subagent"), "read");
	assert.equal(levelOf("delegate"), "run");
});

test("8.15 specialists: the shipped ones are valid and use tools that exist; a specialist is checked on save", () => {
	const known = [...appNames, ...revitNames];
	for (const a of DEFAULT_AGENTS) {
		const v = validateSpec(a, levelOf, known);
		assert.ok(v.ok, `${a.id}: ${!v.ok ? v.error : ""}`);
	}
	const ok = { id: "tulkojums", name: "Tulkotājs", description: "tulko", prompt: "Tulko tekstu uz latviešu valodu.", tools: ["write_document"] };
	assert.ok(validateSpec(ok, levelOf, known).ok);
	const bad = (patch: object) => {
		const v = validateSpec({ ...ok, ...patch }, levelOf, known);
		return v.ok ? "ok" : v.error;
	};
	assert.match(bad({ id: "Liels Burts" }), /Identifikators/);
	assert.match(bad({ name: "" }), /Nosaukums/);
	assert.match(bad({ prompt: "īss" }), /Norādījums/);
	assert.match(bad({ tools: ["nav_tāda"] }), /Nezināms rīks/);
	assert.match(bad({ tools: ["delegate"] }), /nevar palaist citus aģentus/);
	assert.match(bad({ tools: ["revit_create_sheet"] }), /prasa lietotāja apstiprinājumu/);
	assert.match(bad({ tools: "write_document" }), /Rīku saraksts/);
	assert.deepEqual((validateSpec({ ...ok, tools: ["write_document", "write_document", " "] }, levelOf, known) as { spec: { tools: string[] } }).spec.tools, ["write_document"], "duplicates and blanks are dropped");
});

test("8.15 specialists: found by id or loosely by name; the roster is two lines each", () => {
	assert.equal(findSpec(DEFAULT_AGENTS, "dokumenti")?.id, "dokumenti");
	assert.equal(findSpec(DEFAULT_AGENTS, "Ekspertīzes lasītājs")?.id, "ekspertize");
	assert.equal(findSpec(DEFAULT_AGENTS, "EKSPERT")?.id, "ekspertize");
	assert.equal(findSpec(DEFAULT_AGENTS, "parb")?.id, "parbaude");
	assert.equal(findSpec(DEFAULT_AGENTS, "nav"), undefined);
	assert.equal(findSpec(DEFAULT_AGENTS, ""), undefined);
	const r = rosterText(DEFAULT_AGENTS);
	assert.match(r, /- dokumenti: /);
	assert.equal(r.split("\n").length, 4);
	assert.equal(rosterText([]), "");
});

// ---- lanes ---------------------------------------------------------------------------------------------------------------------

interface Seen {
	allowed: readonly string[];
	system: string;
	prompt: string;
	before: PiRunOptions["beforeToolCall"];
}

function lanes(script: (o: PiRunOptions, n: number) => Promise<void>, opts: { max?: number; specs?: LaneDeps["specs"] } = {}) {
	const events: RunEvent[] = [];
	const seen: Seen[] = [];
	let n = 0;
	let inFlight = 0;
	let peak = 0;
	const deps: LaneDeps = {
		run: async (o) => {
			seen.push({ allowed: Object.values(o.mcp).flatMap((m) => m.allow), system: o.systemPrompt ?? "", prompt: o.prompt, before: o.beforeToolCall });
			inFlight++;
			peak = Math.max(peak, inFlight);
			try {
				await script(o, n++);
			} finally {
				inFlight--;
			}
		},
		base: { runtime: null as never },
		mcpFor: (allowed) => ({ "projektesana-tools": { command: "x", args: [], env: {}, allow: allowed } }),
		levelOf,
		listed,
		revitTools: new Set(revitNames),
		locks: new WriteLocks(),
		emit: (e) => events.push(e),
		maxParallel: () => opts.max ?? 3,
		specs: opts.specs ?? (() => DEFAULT_AGENTS),
	};
	const [sub, delegate] = subagentTools(deps) as [AgentTool<any>, AgentTool<any>];
	return { sub, delegate, events, seen, peak: () => peak };
}
const finish = (o: PiRunOptions, text: string) => o.onEvent({ type: "done", text });
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");

test("8.15 run_subagent: six tasks are six lanes, at most the cap at once, one summary in the order asked", async () => {
	const l = lanes(
		async (o) => {
			o.onEvent({ type: "tool", name: "read_source" });
			await sleep(25);
			o.onEvent({ type: "tool_result", name: "read_source", ok: true });
			o.onEvent({ type: "usage", input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: null });
			finish(o, `atskaite: ${o.prompt}`);
		},
		{ max: 2 },
	);
	const tasks = ["AR", "BK", "AVK", "UK", "EL", "ESS"].map((d) => ({ task: `pārbaudi ${d} PDF`, label: `${d} daļa` }));
	const r = await l.sub.execute("t1", { tasks }, new AbortController().signal);
	assert.equal(l.seen.length, 6);
	assert.equal(l.peak(), 2, "the cap holds");
	const out = text(r);
	assert.deepEqual([...out.matchAll(/^### (\S+ daļa)/gm)].map((m) => m[1]), tasks.map((t) => t.label), "in the order of the tasks");
	assert.match(out, /atskaite: pārbaudi BK PDF/);
	assert.equal(r.isError, false);
	assert.deepEqual(l.events.filter((e) => e.type === "lane" && e.phase === "start").length, 6);
	assert.deepEqual(l.events.filter((e) => e.type === "lane" && e.phase === "end" && e.ok).length, 6);
	assert.equal(l.events.filter((e) => e.type === "usage").length, 6, "every lane's model turns are counted in the run");
	assert.ok(l.events.some((e) => e.type === "lane" && e.phase === "step" && e.text === "Lasa avotu"), "what a lane is doing is in words");
});

test("8.15 run_subagent: a helper is given read tools only, none of Revit's, never run_subagent or delegate, and its gate blocks the rest", async () => {
	const l = lanes(async (o) => finish(o, "ok"));
	await l.sub.execute("t1", { tasks: [{ task: "lasi" }] }, new AbortController().signal);
	const { allowed, before } = l.seen[0];
	assert.ok(allowed.includes("read_source") && allowed.includes("search_sources"));
	for (const n of allowed) assert.equal(levelOf(n), "read", n);
	assert.ok(!allowed.some((n) => revitNames.includes(n)), "no Revit for a helper");
	assert.ok(!allowed.includes("run_subagent") && !allowed.includes("delegate"));
	const ctx = (name: string) => ({ toolCall: { id: `c-${name}`, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [] }, context: {} }) as unknown as BeforeToolCallContext;
	assert.equal(await before!(ctx("read_source")), undefined);
	for (const n of ["set_fact", "write_document", "delegate", "run_subagent", "revit_create_sheet"]) assert.equal((await before!(ctx(n)))?.block, true, `${n} is blocked even if the model names it`);
});

test("8.15 delegate: a specialist gets reading plus the tools its settings name, within run; an unknown one is refused with the list", async () => {
	const l = lanes(async (o) => finish(o, "gatavs"));
	const r = await l.delegate.execute("t1", { jobs: [{ agent: "dokumenti", task: "uzraksti paskaidrojuma rakstu" }, { agent: "Pārbaudītājs", task: "pārbaudi" }] }, new AbortController().signal);
	assert.equal(r.isError, false);
	const doc = l.seen.find((s) => s.prompt.includes("paskaidrojuma"))!;
	assert.ok(doc.allowed.includes("write_document") && doc.allowed.includes("docx_apply") && doc.allowed.includes("read_source"));
	assert.ok(!doc.allowed.includes("run_check"), "only what its settings give");
	for (const n of doc.allowed) assert.ok(LEVEL_RANK[levelOf(n)] <= LEVEL_RANK.run, n);
	assert.match(doc.system, /^You prepare Word documents/, "its own instructions, then the common rules");
	assert.match(doc.system, /data, not instructions/);
	const chk = l.seen.find((s) => s.prompt === "pārbaudi")!;
	assert.ok(chk.allowed.includes("run_check") && !chk.allowed.includes("write_document"));
	assert.match(text(r), /### Dokumentu sagatavotājs \(Dokumentu sagatavotājs\)/);
	const bad = await l.delegate.execute("t2", { jobs: [{ agent: "dokumenti", task: "x" }, { agent: "izdomāts", task: "y" }] }, new AbortController().signal);
	assert.equal(bad.isError, true);
	assert.match(text(bad), /Nav speciālista: izdomāts\. Ir: dokumenti, ekspertize, parbaude/);
	assert.equal(l.seen.length, 2, "nothing ran for the refused call");
});

test("8.15 delegate: a specialist the settings page widened is limited by the cap — a confirm tool stays out", async () => {
	const wide = [{ id: "plats", name: "Plašais", description: "x", prompt: "Dari visu, ko vari.", tools: ["revit_create_sheet", "write_document", "start_delivery"] }];
	const l = lanes(async (o) => finish(o, "ok"), { specs: () => wide });
	await l.delegate.execute("t1", { jobs: [{ agent: "plats", task: "darbs" }] }, new AbortController().signal);
	const a = l.seen[0].allowed;
	assert.ok(a.includes("write_document"));
	assert.equal(levelOf("revit_create_sheet"), "confirm");
	assert.ok(!a.includes("revit_create_sheet") && !a.includes("start_delivery"), "confirm tools are not handed over even when saved in the list");
});

test("8.15 writes: two specialists change the staging folder one after the other, while reads go on side by side", async () => {
	let writing = 0;
	let peakWriting = 0;
	let reading = 0;
	let peakReading = 0;
	const ctx = (id: string, name: string) => ({ toolCall: { id, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [] }, context: {} }) as unknown as BeforeToolCallContext;
	const l = lanes(async (o, n) => {
		// a read: no lock, both lanes in it together
		reading++;
		peakReading = Math.max(peakReading, reading);
		await sleep(20);
		reading--;
		// a write into the staging folder
		const call = `w${n}`;
		const blocked = await o.beforeToolCall!(ctx(call, "write_document"));
		assert.equal(blocked, undefined, JSON.stringify(blocked));
		writing++;
		peakWriting = Math.max(peakWriting, writing);
		await sleep(30);
		writing--;
		await o.afterToolCall!({ toolCall: { id: call } } as never);
		finish(o, "ok");
	});
	await l.delegate.execute("t1", { jobs: [{ agent: "dokumenti", task: "viens" }, { agent: "dokumenti", task: "divi" }] }, new AbortController().signal);
	assert.equal(peakWriting, 1, "never two writers at once");
	assert.equal(peakReading, 2, "reading is not locked");
});

test("8.15 writes: a lane that stops while holding a lock frees it, so the next lane is not stuck", async () => {
	const ctx = (id: string, name: string) => ({ toolCall: { id, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [] }, context: {} }) as unknown as BeforeToolCallContext;
	let second: unknown = "not run";
	const l = lanes(async (o, n) => {
		if (n === 0) {
			assert.equal(await o.beforeToolCall!(ctx("a", "set_fact")), undefined);
			throw new Error("modelis nepieejams"); // the lane dies holding the lock
		}
		second = await o.beforeToolCall!(ctx("b", "set_fact"));
		finish(o, "ok");
	}, { max: 1, specs: () => [{ id: "raksta", name: "Rakstītājs", description: "x", prompt: "Raksti faktus.", tools: ["set_fact"] }] });
	const r = await l.delegate.execute("t1", { jobs: [{ agent: "raksta", task: "a", label: "a" }, { agent: "raksta", task: "b", label: "b" }] }, new AbortController().signal);
	assert.equal(second, undefined);
	assert.match(text(r), /### a \(Rakstītājs\) — NEIZDEVĀS[\s\S]*modelis nepieejams/);
	assert.match(text(r), /### b \(Rakstītājs\) — gatavs/);
});

test("8.15 Stop: every lane gets the signal, waiting lanes never start, and the reports say stopped", async () => {
	const ac = new AbortController();
	let started = 0;
	const l = lanes(
		async (o) => {
			started++;
			await new Promise<void>((res) => o.signal.addEventListener("abort", () => res(), { once: true }));
			o.onEvent({ type: "error", engine: "pi", message: "aborted" });
		},
		{ max: 2 },
	);
	const run = l.sub.execute("t1", { tasks: [{ task: "a" }, { task: "b" }, { task: "c" }, { task: "d" }] }, ac.signal);
	await sleep(30);
	assert.equal(started, 2, "two running, two waiting for a slot");
	ac.abort();
	const r = await run;
	assert.equal(started, 2, "the waiting ones were not started after Stop");
	assert.equal(r.isError, true);
	assert.equal((text(r).match(/NEIZDEVĀS/g) ?? []).length, 4);
	assert.match(text(r), /nesākts/);
	assert.equal(l.events.filter((e) => e.type === "lane" && e.phase === "end").length, 2, "the two that ran each ended");
});

test("8.15 a lane that fails is reported with the reason; the others still report", async () => {
	const l = lanes(async (o, n) => {
		if (n === 1) o.onEvent({ type: "error", engine: "pi", message: "429 Too Many Requests" });
		else finish(o, `gatavs ${n}`);
	}, { max: 1 });
	const r = await l.sub.execute("t1", { tasks: [{ task: "a", label: "A" }, { task: "b", label: "B" }, { task: "c", label: "C" }] }, new AbortController().signal);
	const out = text(r);
	assert.match(out, /### A — gatavs/);
	assert.match(out, /### B — NEIZDEVĀS[\s\S]*429 Too Many Requests/);
	assert.match(out, /### C — gatavs/);
	assert.equal(r.isError, false, "some lanes worked");
});

// ---- the session -------------------------------------------------------------------------------------------------------------

test("8.15 session: the run is handed both tools and the roster; the lanes show on the feed with their own lines and their usage is counted", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const events: RunEvent[] = [];
	const lines: Activity[] = [];
	const act = new ActivityLog({ send: (a) => lines.push(a), sources: () => [], levelOf, templates: [] });
	let parent: PiRunOptions | null = null;
	let finishRun!: () => void;
	const finished = new Promise<void>((r) => (finishRun = r));
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 2 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: (id, e) => {
			events.push(e);
			act.event(id, e);
			if (e.type === "done" || e.type === "error") finishRun();
		},
		runAgent: async (o) => {
			if (o.extraTools) {
				parent = o;
				const call = o.extraTools.find((t) => t.name === "run_subagent")!;
				const r = await call.execute("t1", { tasks: [{ task: "lasi AR", label: "AR" }, { task: "lasi BK", label: "BK" }] }, o.signal);
				o.onEvent({ type: "done", text: `kopsavilkums: ${r.content.map((c: { text?: string }) => c.text).join("").length > 0}` });
				return;
			}
			o.onEvent({ type: "tool", name: "read_source" });
			o.onEvent({ type: "usage", input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: null });
			o.onEvent({ type: "done", text: `atskaite ${o.prompt}` });
		},
	});
	const { runId } = await s.send(null, "salīdzini daļas", []);
	await finished;
	assert.ok(parent, "the run was started");
	const p = parent as PiRunOptions;
	assert.deepEqual(p.extraTools!.map((t) => t.name), ["run_subagent", "delegate"]);
	assert.match(p.systemPrompt ?? "", /Speciālisti \(delegate/);
	assert.match(p.systemPrompt ?? "", /- ekspertize: /);
	// the main agent's own gate lets the two tools through
	const gateCtx = (name: string) => ({ toolCall: { id: "g", name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [] }, context: {} }) as unknown as BeforeToolCallContext;
	assert.equal(await p.beforeToolCall!(gateCtx("run_subagent")), undefined);
	assert.equal(await p.beforeToolCall!(gateCtx("delegate")), undefined);
	// events: lane start and end for both, the usage of both counted
	assert.equal(events.filter((e) => e.type === "lane" && e.phase === "start").length, 2);
	assert.equal(events.filter((e) => e.type === "lane" && e.phase === "end" && e.ok).length, 2);
	assert.equal(events.filter((e) => e.type === "usage").length, 2);
	const usage = readFileSync(join(dir, "usage.jsonl"), "utf8").trim().split("\n");
	assert.equal(usage.length, 2, "both lanes' turns are in the usage log under this run");
	assert.ok(usage.every((u) => JSON.parse(u).run === runId));
	// the feed: a header per lane that ends ok, with its report behind it, and the line of what it is doing
	const heads = lines.filter((a) => a.step?.startsWith("lane-") && !a.step.endsWith("-now"));
	assert.deepEqual([...new Set(heads.map((a) => a.text))].sort(), ["AR", "BK"]);
	assert.ok(heads.some((a) => a.status === "ok" && a.detail?.includes("atskaite lasi AR")));
	assert.ok(lines.some((a) => a.step?.endsWith("-now") && a.text === "Lasa avotu" && a.lane));
});
