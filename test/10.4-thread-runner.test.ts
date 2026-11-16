// 10.4 thread runner: one run of one thread. The agent loop and the model are scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { ThreadRunner, type RunInput } from "../src/agent/thread-runner.ts";
import { SUMMARY_HEADER } from "../src/agent/compact.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { LEAD_ID, type Thread } from "../src/shared/thread-types.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

type Run = (o: PiRunOptions) => Promise<void>;

const U = (text: string, ts: number) => ({ role: "user", content: [{ type: "text", text }], timestamp: ts }) as AgentMessage;
const A = (text: string, ts: number) => ({ role: "assistant", content: [{ type: "text", text }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: ts }) as unknown as AgentMessage;
const SYS = { role: "system", content: "prompts", timestamp: 0 } as unknown as AgentMessage;
const turns = (n: number, tokens: number): AgentMessage[] => [SYS, ...Array.from({ length: n }, (_, i) => [U(`jautājums ${i} ${"v".repeat(Math.floor(tokens * 3.5))}`, 10 + i * 10), A(`atbilde ${i}`, 11 + i * 10)]).flat()];
const reply = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 1 }) as unknown as AssistantMessage;

function setup(runAgent: Run, o: { revit?: boolean; afterBatch?: (p: string, s: string) => Promise<string>; locks?: LockRegistry } = {}) {
	const dir = tmp();
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const store = new ThreadStore(join(dir, "threads"));
	const locks = o.locks ?? new LockRegistry();
	const envs: Record<string, string>[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: (env) => (envs.push(env), { command: "node", args: [], env: {} }),
		revit: () => (o.revit ? { command: "node", args: [], env: {}, tools: ["revit_set", "revit_edit"], levels: { revit_set: "confirm", revit_edit: "run" } } : null),
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		complete: async () => reply("## Mērķis\nTelpu pārbaude"),
		runAgent,
		afterBatch: o.afterBatch,
		agents: () => [{ id: "rv", name: "Revit", description: "", prompt: "p".repeat(12), tools: ["revit_edit"] }],
		threads: () => store,
		locks,
	});
	let n = 0;
	const run = (thread: Thread, text: string, extra: Partial<RunInput> = {}) =>
		runner.run({ runId: `r${++n}`, thread, spec: null, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => true, ...extra });
	return { dir, store, runner, locks, run, envs };
}

const ctxFor = (name: string, id: string, others: string[] = []) =>
	({ toolCall: { id, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [name, ...others].map((n, i) => ({ type: "toolCall", id: `${id}${i}`, name: n, arguments: {} })) }, context: {} }) as unknown as BeforeToolCallContext;

test("two threads of one project keep separate histories, each in its own transcript", async () => {
	const seen: AgentMessage[][] = [];
	const t = setup(async (o) => {
		const h = o.history ?? [];
		seen.push(h);
		const who = o.prompt.includes("pirmais A") || o.prompt.includes("otrais A") ? "A" : "B";
		o.onMessages?.([...h, U(o.prompt, 1), A(`atbilde ${who}`, 2)]);
		o.onEvent({ type: "done", text: `atbilde ${who}` });
	});
	const a = t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" });
	const b = t.store.create({ projectId: null, agent: LEAD_ID, title: "B", startedBy: "user" });
	await t.run(a, "pirmais A");
	await t.run(b, "pirmais B");
	const r = await t.run(a, "otrais A");
	assert.deepEqual(r, { ok: true, answer: "atbilde A", confirmedBatches: 0 });
	assert.equal(seen[0].length, 0);
	assert.equal(seen[1].length, 0, "B does not see A");
	const last = JSON.stringify(seen[2]);
	assert.ok(last.includes("atbilde A") && !last.includes("atbilde B"));
	assert.deepEqual(t.store.transcript(a.id).map((e) => e.text), ["pirmais A", "atbilde A", "otrais A", "atbilde A"]);
	assert.deepEqual(t.store.transcript(b.id).map((e) => e.text), ["pirmais B", "atbilde B"]);
	assert.match(readFileSync(join(t.dir, "threads", a.id, "chat.jsonl"), "utf8"), /pirmais A/);
	t.runner.reset(a.id);
	await t.run(a, "trešais A");
	assert.equal(seen[3].length, 0, "reset forgets only that thread's memory");
});

test("the tools server env carries the agent and the thread; a specialist thread carries its own id", async () => {
	const t = setup(async (o) => o.onEvent({ type: "done", text: "ok" }));
	const a = t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" });
	await t.run(a, "sveiki");
	assert.equal(t.envs[0].PROJEKTESANA_AGENT, LEAD_ID);
	assert.equal(t.envs[0].PROJEKTESANA_THREAD, a.id);
	const b = t.store.create({ projectId: null, agent: "s", title: "B", startedBy: "user" });
	await t.run(b, "x", { spec: { id: "s", name: "S", description: "", prompt: "p".repeat(12), tools: [] } });
	assert.equal(t.envs[1].PROJEKTESANA_AGENT, "s");
	assert.equal(t.envs[1].PROJEKTESANA_THREAD, b.id);
});

test("a write tool of the lead holds the project's data while it runs and frees it after; reads and delegate take nothing", async () => {
	const locks = new LockRegistry({ waitMs: 30 });
	const probes: boolean[] = [];
	const t = setup(
		async (o) => {
			const other = async (c: string) => (await locks.acquire(null, "store", "other", c, undefined, "cits")).ok;
			assert.equal(await o.beforeToolCall!(ctxFor("read_source", "c1")), undefined);
			probes.push(await other("p0")); // a read holds nothing
			locks.release("p0");
			assert.equal(await o.beforeToolCall!(ctxFor("delegate", "c2")), undefined);
			probes.push(await other("p1")); // delegate holds nothing (its lanes take their own)
			locks.release("p1");
			assert.equal(await o.beforeToolCall!(ctxFor("run_check", "c3")), undefined);
			probes.push(await other("p2")); // the write holds store
			await o.afterToolCall!({ toolCall: { id: "c3" } } as never);
			probes.push(await other("p3")); // freed
			locks.release("p3");
			// a call that never got its afterToolCall is freed by the run's end
			await o.beforeToolCall!(ctxFor("run_check", "c4"));
			o.onEvent({ type: "done", text: "ok" });
		},
		{ locks },
	);
	await t.run(t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" }), "raksti");
	assert.deepEqual(probes, [true, true, false, true]);
	assert.equal((await locks.acquire(null, "store", "after", "z")).ok, true, "the run's end released c4");
});

test("a confirmed Revit batch holds Revit until after afterBatch; a refused one holds nothing", async () => {
	const locks = new LockRegistry({ waitMs: 30 });
	const held: (string | null)[] = [];
	const t = setup(
		async (o) => {
			held.push(locks.revitHeldBy());
			assert.equal(await o.beforeToolCall!(ctxFor("revit_set", "c1")), undefined);
			held.push(locks.revitHeldBy()); // during the batch
			await o.afterToolCall!({ toolCall: { id: "c1" } } as never);
			held.push(locks.revitHeldBy()); // the call is done, the batch is not
			o.onEvent({ type: "done", text: "gatavs" });
		},
		{ revit: true, locks, afterBatch: async () => (held.push(locks.revitHeldBy()), "revīzija") },
	);
	const th = t.store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" });
	const r = await t.run(th, "izmaini");
	assert.equal(r.confirmedBatches, 1);
	assert.deepEqual(held, [null, "run:r1", "run:r1", "run:r1"]);
	assert.equal(locks.revitHeldBy(), null, "ended after afterBatch");
	// refused: no batch, no hold
	const t2 = setup(
		async (o) => {
			const b = await o.beforeToolCall!(ctxFor("revit_set", "c1"));
			assert.equal(b?.block, true);
			assert.equal(locks.revitHeldBy(), null);
			o.onEvent({ type: "done", text: "ok" });
		},
		{ revit: true, locks },
	);
	const r2 = await t2.run(t2.store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" }), "izmaini", { ask: async () => false });
	assert.equal(r2.confirmedBatches, 0);
});

test("a thread over the compaction line compacts into its own transcript; the other thread is untouched", async () => {
	let got: AgentMessage[] = [];
	const t = setup(async (o) => {
		got = o.history ?? [];
		o.onMessages?.([...got, U("x", 1)]);
		o.onEvent({ type: "done", text: "gatavs" });
	});
	const a = t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" });
	const b = t.store.create({ projectId: null, agent: LEAD_ID, title: "B", startedBy: "user" });
	t.store.append(b.id, { role: "user", text: "B vecā rinda", at: "2026-11-13T10:00:00.000Z" });
	const key = `${DEFAULT_SETTINGS.provider}/${DEFAULT_SETTINGS.model}`;
	t.runner.conversations.set(a.id, { key, messages: turns(7, 30_000), lastAdded: null });
	t.runner.conversations.set(b.id, { key, messages: turns(2, 1000), lastAdded: null });
	const events: RunEvent[] = [];
	await t.run(a, "turpini", { emit: (e) => events.push(e) });
	assert.deepEqual(events.filter((e) => e.type === "compact").map((e) => (e as { phase: string }).phase), ["start", "done"]);
	assert.ok(JSON.stringify(got[1]).includes(SUMMARY_HEADER));
	const kinds = (id: string) => t.store.transcript(id).map((e) => e.kind ?? "chat");
	assert.deepEqual(kinds(a.id), ["chat", "compaction", "chat"], "the question, the summary made before the request, the answer");
	assert.deepEqual(kinds(b.id), ["chat"], "B's transcript has no compaction");
	assert.equal(t.runner.conversations.get(b.id)!.messages.length, 5, "B's memory is untouched");
	// a compacted thread knows its summary after a restart: seeded from its own transcript
	let sys = "";
	const t2 = setup(async (o) => ((sys = o.systemPrompt ?? ""), o.onEvent({ type: "done", text: "ok" })));
	const th2 = t2.store.create({ projectId: null, agent: LEAD_ID, title: "C", startedBy: "user" });
	t2.store.append(th2.id, { role: "assistant", kind: "compaction", text: "Atvērtā tēma tp7", at: "2026-11-13T10:00:00.000Z" });
	await t2.run(th2, "turpini");
	assert.match(sys, /Atvērtā tēma tp7/);
});

test("ThreadStore.get: a parseable thread.json of the wrong shape is no thread, and list() skips it", () => {
	const dir = join(tmp(), "threads");
	const s = new ThreadStore(dir);
	const ok = s.create({ projectId: null, agent: "rooms", title: "A", startedBy: "user" });
	mkdirSync(join(dir, "odd"), { recursive: true });
	writeFileSync(join(dir, "odd", "thread.json"), "null");
	mkdirSync(join(dir, "odd2"), { recursive: true });
	writeFileSync(join(dir, "odd2", "thread.json"), JSON.stringify({ id: 5, agent: "x" }));
	assert.equal(s.get("odd"), null);
	assert.equal(s.get("odd2"), null);
	assert.deepEqual(s.list().map((t) => t.id), [ok.id]);
});

test("a lane of the run shares its confirmed Revit batch; another owner still waits", async () => {
	const locks = new LockRegistry({ waitMs: 60 });
	const got: Record<string, boolean | undefined> = {};
	const t = setup(
		async (o) => {
			if (o.extraTools) {
				assert.equal(await o.beforeToolCall!(ctxFor("revit_set", "c1")), undefined);
				await o.afterToolCall!({ toolCall: { id: "c1" } } as never);
				got.other = (await locks.acquire("p1", "revit", "other", "x1", undefined, "cits")).ok;
				const r = await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "rv", task: "t" }] }, o.signal);
				got.lane = !r.isError;
				o.onEvent({ type: "done", text: "gatavs" });
				return;
			}
			// the lane's own run: a Revit write passes the batch gate at once (a wait would be refused after 60 ms)
			const b = await o.beforeToolCall!(ctxFor("revit_edit", "l1"));
			got.laneWrite = b === undefined;
			await o.afterToolCall!({ toolCall: { id: "l1" } } as never);
			o.onEvent({ type: "done", text: "lane" });
		},
		{ revit: true, locks },
	);
	await t.run(t.store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" }), "izmaini");
	assert.equal(got.other, false, "another owner waits for the batch");
	assert.equal(got.laneWrite, true, "the run's lane writes inside the batch");
	assert.equal(got.lane, true);
	locks.beginBatch("run:q", "galvenais aģents");
	assert.equal((await locks.acquire("p1", "revit", "run:qq", "y2")).ok, false, "a longer owner name is not a lane of it");
	locks.endBatch("run:q");
});

test("a run that fails after a confirmed Revit batch leaves nothing held", async () => {
	const locks = new LockRegistry({ waitMs: 30 });
	const t = setup(
		async (o) => {
			assert.equal(await o.beforeToolCall!(ctxFor("revit_set", "c1")), undefined);
			throw new Error("modelis nokrita");
		},
		{ revit: true, locks },
	);
	const r = await t.run(t.store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" }), "izmaini");
	assert.equal(r.ok, false);
	assert.equal(locks.revitHeldBy(), null);
	assert.equal((await locks.acquire("p1", "revit", "next", "n1")).ok, true);
});

test("a batch refused because another batch is open is not counted", async () => {
	const locks = new LockRegistry({ waitMs: 30 });
	locks.beginBatch("run:other", "cits");
	let revisions = 0;
	const t = setup(async (o) => {
		const b = await o.beforeToolCall!(ctxFor("revit_set", "c1"));
		assert.equal(b?.block, true);
		o.onEvent({ type: "done", text: "ok" });
	}, { revit: true, locks, afterBatch: async () => (revisions++, "x") });
	const r = await t.run(t.store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" }), "izmaini");
	assert.equal(r.confirmedBatches, 0);
	assert.equal(revisions, 0);
});

test("ThreadStore.lead: a failed legacy copy leaves no lead thread, and the next call copies again", () => {
	const dir = tmp();
	const s = new ThreadStore(join(dir, "threads"));
	const legacy = join(dir, "p1.jsonl");
	mkdirSync(legacy); // a directory: copyFileSync throws
	assert.throws(() => s.lead("p1", legacy));
	assert.deepEqual(s.list(), []);
	rmSync(legacy, { recursive: true });
	writeFileSync(legacy, JSON.stringify({ role: "user", text: "vecā", at: "2026-11-13T10:00:00.000Z" }) + "\n");
	const t = s.lead("p1", legacy);
	assert.deepEqual(s.transcript(t.id).map((e) => e.text), ["vecā"]);
});
