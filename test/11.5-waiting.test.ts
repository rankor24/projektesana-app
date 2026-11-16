// 11.5 Gaida tevi: one list of everything that waits for the user, across projects. The agent loop is scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { DEFAULT_AGENTS, validateSpec } from "../src/agent/subagents.ts";
import type { ThreadRunner } from "../src/agent/thread-runner.ts";
import { saveQueue } from "../src/core/queue.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { threadHandlers } from "../src/main/handlers/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { parseMention } from "../src/shared/mention.ts";
import { LEAD_ID, type WaitingItem } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { waitingItems } from "../src/shared/waiting.ts";
import { tmp } from "./helpers.ts";

type RunIn = Parameters<ThreadRunner["run"]>[0];
const tick = () => new Promise((r) => setTimeout(r, 5));
const batch = (id: string, tool = "revit_set") => ({ id, batch: [{ tool, input: { n: 1 } }] }) as never;

// ---- the pure list -----------------------------------------------------------------------------------------------------------

test("11.5 waitingItems: confirmations, then gates, questions, pauses, interrupted", () => {
	const confirm: WaitingItem = { kind: "confirm", id: "c1", threadId: "t1", agent: "lead", projectId: "p1", tool: "revit_set", batch: "[]" };
	const gate: WaitingItem = { kind: "gate", gate: "g1", projectId: "p1", noteId: "n1" };
	const question: WaitingItem = { kind: "question", noteId: "n2", projectId: "p1", from: "ar", title: "Kas?" };
	const paused: WaitingItem = { kind: "wave-paused", wave: "w1", projectId: null, reason: "cost" };
	const items = waitingItems({ confirms: [confirm], gates: [gate], questions: [question], paused: [paused], restore: { interrupted: 2, queued: 1 } });
	assert.deepEqual(items.map((i) => i.kind), ["confirm", "gate", "question", "wave-paused", "interrupted"]);
	assert.deepEqual(items.at(-1), { kind: "interrupted", interrupted: 2, queued: 1 });
	assert.deepEqual(waitingItems({ confirms: [], gates: [], questions: [], paused: [], restore: null }), [], "nothing waits");
});

// ---- the coordinator ---------------------------------------------------------------------------------------------------------

/** a data folder with a store per project; every run asks one confirmation, named after its agent, and goes on with the answer */
function setup() {
	const dir = tmp();
	const stores = new Map<string | null, ThreadStore>();
	const store = (p: string | null) => {
		let s = stores.get(p);
		if (!s) stores.set(p, (s = new ThreadStore(join(dir, p ?? "_", "threads"))));
		return s;
	};
	const answers = new Map<string, boolean>();
	const sent: WaitingItem[][] = [];
	const queueFile = join(dir, "queue.json");
	const c = new Coordinator({
		runner: {
			run: async (i: RunIn) => {
				if (i.text === "ask") answers.set(i.thread.id, await i.ask(batch(`c-${i.thread.projectId}-${i.thread.agent}`, `tool_${i.thread.agent}`)));
				else await new Promise<void>((r) => i.signal.addEventListener("abort", () => r()));
				return { ok: true, answer: "", confirmedBatches: 0 };
			},
		} as unknown as ThreadRunner,
		threads: store,
		projects: () => [...stores.keys()],
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 3 }),
		emit: () => undefined,
		onWaiting: (items) => sent.push(items),
		queueFile,
	});
	const go = async (projectId: string | null, agent: string, text = "ask") => {
		const t = store(projectId).create({ projectId, agent, title: agent, startedBy: "user" });
		await c.start({ threadId: t.id, projectId, text, focus: [], cause: { by: "user" } });
		await tick();
		return t;
	};
	return { c, store, go, answers, sent, queueFile };
}

test("11.5 confirmations of runs in two projects are both listed with their project while a third is the open one", async () => {
	const t = setup();
	const a = await t.go("p1", "lead");
	const b = await t.go("p2", "ekspertize");
	// the user looks at p3: it has no run, and the list does not depend on which project is open
	assert.deepEqual(t.c.waiting(), [
		{ kind: "confirm", id: "c-p1-lead", threadId: a.id, agent: "lead", projectId: "p1", tool: "tool_lead", batch: JSON.stringify([{ tool: "tool_lead", input: { n: 1 } }]) },
		{ kind: "confirm", id: "c-p2-ekspertize", threadId: b.id, agent: "ekspertize", projectId: "p2", tool: "tool_ekspertize", batch: JSON.stringify([{ tool: "tool_ekspertize", input: { n: 1 } }]) },
	]);
	assert.equal(t.sent.length, 2, "waiting.changed after each opened confirmation");
	assert.deepEqual(t.sent.at(-1)!.map((i) => (i.kind === "confirm" ? i.projectId : i.kind)), ["p1", "p2"]);
	t.c.stopAll();
	await t.c.shutdown();
});

test("11.5 an answered confirmation leaves the list and the list is sent", async () => {
	const t = setup();
	await go2(t);
	t.c.confirm("c-p1-lead", true);
	await tick();
	assert.deepEqual(t.c.waiting().map((i) => (i.kind === "confirm" ? i.id : i.kind)), ["c-p2-ekspertize"]);
	assert.deepEqual(t.sent.at(-1)!.map((i) => (i.kind === "confirm" ? i.id : i.kind)), ["c-p2-ekspertize"]);
	assert.deepEqual([...t.answers.values()], [true], "the answered run got its answer");
	t.c.confirm("c-p2-ekspertize", false);
	await tick();
	assert.deepEqual(t.c.waiting(), []);
	assert.deepEqual(t.sent.at(-1), []);
	assert.throws(() => t.c.confirm("c-p2-ekspertize", true), /vairs negaida/);
	await t.c.shutdown();
});

test("11.5 a stopped run's confirmation leaves the list too", async () => {
	const t = setup();
	const a = await t.go("p1", "lead");
	assert.equal(t.c.waiting().length, 1);
	t.c.stopThread(a.id);
	await tick();
	assert.deepEqual(t.c.waiting(), []);
	assert.deepEqual(t.sent.at(-1), []);
	await t.c.shutdown();
});

async function go2(t: ReturnType<typeof setup>) {
	await t.go("p1", "lead");
	await t.go("p2", "ekspertize");
	assert.equal(t.c.waiting().length, 2);
}

test("11.5 the restart item is listed until the user answers it, then it goes and the list is sent", async () => {
	for (const answer of ["resumeInterrupted", "discardInterrupted"] as const) {
		const t = setup();
		const old = t.store("p1").create({ projectId: "p1", agent: "lead", title: "x", startedBy: "user" });
		t.store("p1").patch(old.id, { state: "running" });
		saveQueue(t.queueFile, { items: [], paused: false });
		assert.deepEqual(t.c.restore(), { interrupted: 1, queued: 0 });
		assert.deepEqual(t.c.waiting(), [{ kind: "interrupted", interrupted: 1, queued: 0 }], "same content as queue.restored");
		t.c[answer]();
		assert.deepEqual(t.c.waiting(), []);
		assert.deepEqual(t.sent.at(-1), [], `${answer} sends the list`);
		await t.c.shutdown();
	}
	// a clean start has nothing to ask
	const clean = setup();
	clean.c.restore();
	assert.deepEqual(clean.c.waiting(), []);
});

test("11.5 waiting.list returns the session's items of every project", () => {
	const items: WaitingItem[] = [{ kind: "interrupted", interrupted: 1, queued: 2 }];
	const h = threadHandlers({ session: { waiting: () => items } as never });
	assert.deepEqual(h["waiting.list"](), items);
});

// ---- the two small fixes of the 11.4 review ----------------------------------------------------------------------------------

const SPECS: AgentSpec[] = [
	{ id: "ar", name: "Arhitektūras daļa", description: "", prompt: "You read the AR part.", tools: [] },
	{ id: "bk", name: "Būvkonstrukcijas", description: "", prompt: "You read the structure.", tools: [] },
	{ id: "dokumenti", name: "Dokumentu autors", description: "", prompt: "You write documents.", tools: [] },
];

test("11.5 parseMention: a loose (prefix) match needs three characters after @; exact ids and names match at any length", () => {
	assert.equal(parseMention("@d sienas", SPECS), null, "one character picks nobody");
	assert.equal(parseMention("@a sienas", SPECS), null);
	assert.equal(parseMention("@do sienas", SPECS), null, "two characters are not enough for a prefix");
	assert.equal(parseMention("@dok sienas", SPECS)?.agent, "dokumenti", "three characters may be a prefix");
	assert.deepEqual(parseMention("@ar sienas", SPECS), { agent: "ar", text: "sienas" }, "an exact two-character id");
	assert.equal(parseMention("@bk sienas", SPECS)?.agent, "bk");
	assert.equal(parseMention("@Būvkonstrukcijas sienas", SPECS)?.agent, "bk", "an exact name");
	assert.equal(parseMention("@arh sienas", SPECS)?.agent, "ar");
});

test("11.5 validateSpec: the id lead is reserved for the main agent", () => {
	const levelOf = (() => "read") as never;
	const ok = { id: "dokumenti", name: "Dokumenti", description: "", prompt: "You write documents.", tools: [] };
	assert.ok(validateSpec(ok, levelOf, []).ok);
	const v = validateSpec({ ...ok, id: LEAD_ID }, levelOf, []);
	assert.deepEqual(v, { ok: false, error: "Identifikators lead ir rezervēts galvenajam aģentam." });
	assert.ok(DEFAULT_AGENTS.every((a) => a.id !== LEAD_ID));
});
