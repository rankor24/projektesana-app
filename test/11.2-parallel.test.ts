// 11.2 coordinator: runs side by side under a cap, the queue behind them, Stop for all and for one, pause. The agent loop is scripted.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import type { ThreadRunner } from "../src/agent/thread-runner.ts";
import { loadQueue } from "../src/core/queue.ts";
import { ThreadStore } from "../src/core/threads.ts";
import type { QueueView } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

type RunIn = Parameters<ThreadRunner["run"]>[0];
const REFUSAL = "Aģents jau strādā. Aptur vai pagaidi.";
const tick = () => new Promise((r) => setTimeout(r, 5));
const batch = (id: string) => ({ id, batch: [{ tool: "revit_set", input: {} }] }) as never;

/** every run waits on its own promise that the test resolves by thread id (or ends when its signal aborts) */
function setup(cap = 2) {
	const dir = tmp();
	const store = new ThreadStore(join(dir, "threads"));
	const mk = (agent: string, n: string) => store.create({ projectId: "p1", agent, title: n, startedBy: "user" });
	const gates = new Map<string, () => void>();
	const started: string[] = [];
	const asked = new Map<string, Promise<boolean>>();
	const locks = new LockRegistry();
	const views: QueueView[] = [];
	const queueFile = join(dir, "queue.json");
	const c = new Coordinator({
		runner: {
			run: async (i: RunIn) => {
				started.push(i.thread.id);
				try {
					await new Promise<void>((resolve) => {
						gates.set(i.thread.id, resolve);
						i.signal.addEventListener("abort", () => resolve());
					});
					return { ok: true, answer: "", confirmedBatches: 0 };
				} finally {
					locks.releaseOwner(`run:${i.runId}`);
				}
			},
		} as unknown as ThreadRunner,
		threads: () => store,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: cap }),
		emit: () => undefined,
		onQueue: (v) => views.push(v),
		queueFile,
	});
	const start = (threadId: string, extra = {}) => c.start({ threadId, projectId: "p1", text: "x", focus: [], cause: { by: "user" }, ...extra });
	const end = async (threadId: string) => {
		gates.get(threadId)!();
		await tick();
	};
	return { c, store, mk, start, end, gates, started, asked, locks, views, queueFile };
}

test("cap 2, three threads of three agents: two run, one queues, and it starts when one ends", async () => {
	const t = setup(2);
	const [a, b, d] = [t.mk("lead", "a"), t.mk("ekspertize", "b"), t.mk("bim", "c")];
	const ra = await t.start(a.id);
	const rb = await t.start(b.id);
	const rd = await t.start(d.id);
	assert.ok(ra.runId && !ra.queued);
	assert.ok(rb.runId && !rb.queued);
	assert.deepEqual(rd, { runId: null, queued: true });
	assert.equal(t.store.get(d.id)!.state, "queued");
	assert.equal(t.c.view().running.length, 2);
	assert.equal(t.c.view().queued.length, 1);
	assert.equal(loadQueue(t.queueFile).items[0]!.threadId, d.id, "the queue is saved");
	await t.end(a.id);
	assert.deepEqual(t.started, [a.id, b.id, d.id]);
	assert.equal(t.store.get(d.id)!.state, "running");
	assert.equal(t.c.view().queued.length, 0);
	assert.equal(t.views.at(-1)!.running.length, 2, "queue.changed was sent");
	assert.deepEqual(t.views.at(-1)!.waves, []);
	t.c.stopAll();
	await t.c.shutdown();
});

test("a second user start on a running thread, or on a queued one, is refused with today's text", async () => {
	const t = setup(1);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	await assert.rejects(t.start(a.id), { message: REFUSAL });
	assert.deepEqual(await t.start(b.id), { runId: null, queued: true });
	await assert.rejects(t.start(b.id), { message: REFUSAL });
	t.c.stopAll();
	await t.c.shutdown();
});

test("two threads of one agent in one project: the second queues behind the first although the cap has room", async () => {
	const t = setup(3);
	const [a, b] = [t.mk("ekspertize", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	assert.deepEqual(await t.start(b.id), { runId: null, queued: true });
	assert.deepEqual(t.started, [a.id]);
	await t.end(a.id);
	assert.deepEqual(t.started, [a.id, b.id]);
	t.c.stopAll();
	await t.c.shutdown();
});

test("stopThread ends one run and the other goes on", async () => {
	const t = setup(2);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	await t.start(b.id);
	t.c.stopThread(a.id);
	await tick();
	assert.deepEqual(t.c.view().running.map((r) => r.threadId), [b.id]);
	assert.equal(t.store.get(a.id)!.state, "idle");
	assert.equal(t.store.get(b.id)!.state, "running");
	t.c.stopAll();
	await t.c.shutdown();
});

test("stopThread on a queued thread marks its item stopped and the thread idle", async () => {
	const t = setup(1);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	await t.start(b.id);
	t.c.stopThread(b.id);
	assert.equal(t.c.view().queued[0]!.state, "stopped");
	assert.equal(t.store.get(b.id)!.state, "idle");
	t.c.stopAll();
	await t.c.shutdown();
});

test("stopAll leaves nothing running, queued items stopped (kept), and no lock held", async () => {
	const t = setup(1);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	const ra = await t.start(a.id);
	await t.start(b.id);
	assert.equal((await t.locks.acquire("p1", "revit", `run:${ra.runId}`, "c1")).ok, true);
	t.c.stopAll();
	await tick();
	assert.equal(t.c.view().running.length, 0);
	assert.deepEqual(t.c.view().queued.map((q) => q.state), ["stopped"]);
	assert.deepEqual(loadQueue(t.queueFile).items.map((q) => q.state), ["stopped"], "saved, not deleted");
	assert.equal(t.locks.revitHeldBy(), null);
	const again = await Promise.race([t.locks.acquire("p1", "revit", "someone", "c2"), tick().then(() => "waited")]);
	assert.deepEqual(again, { ok: true });
	assert.deepEqual(t.started, [a.id], "the stopped item never started");
});

test("stopAll with a wave stops only that wave's runs and queued items", async () => {
	const t = setup(2);
	const [a, b, d] = [t.mk("lead", "a"), t.mk("ekspertize", "b"), t.mk("bim", "c")];
	await t.start(a.id, { wave: "wA" });
	await t.start(b.id, { wave: "wB" });
	await t.start(d.id, { wave: "wB" });
	t.c.stopAll("wB");
	await tick();
	assert.deepEqual(t.c.view().running.map((r) => r.threadId), [a.id]);
	assert.deepEqual(t.c.view().queued.map((q) => q.state), ["stopped"]);
	t.c.stopAll();
	await t.c.shutdown();
});

test("pause lets running runs finish and starts nothing; resume starts the queue", async () => {
	const t = setup(1);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	await t.start(b.id);
	t.c.pause();
	assert.equal(t.c.view().paused, true);
	assert.equal(loadQueue(t.queueFile).paused, true);
	await t.end(a.id);
	assert.deepEqual(t.started, [a.id]);
	assert.equal(t.c.view().queued.length, 1);
	t.c.resume();
	assert.deepEqual(t.started, [a.id, b.id]);
	t.c.stopAll();
	await t.c.shutdown();
});

test("confirmations of two runs are answered separately by id; a waiting run frees its slot", async () => {
	const dir = tmp();
	const store = new ThreadStore(join(dir, "threads"));
	const [a, b, d] = [store.create({ projectId: "p1", agent: "lead", title: "a", startedBy: "user" }), store.create({ projectId: "p1", agent: "ekspertize", title: "b", startedBy: "user" }), store.create({ projectId: "p1", agent: "bim", title: "c", startedBy: "user" })];
	const answers = new Map<string, boolean>();
	const started: string[] = [];
	const c = new Coordinator({
		runner: {
			run: async (i: RunIn) => {
				started.push(i.thread.id);
				if (i.thread.id === d.id) return { ok: true, answer: "", confirmedBatches: 0 };
				answers.set(i.thread.id, await i.ask(batch(`c-${i.thread.agent}`)));
				return { ok: true, answer: "", confirmedBatches: 0 };
			},
		} as unknown as ThreadRunner,
		threads: () => store,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 2 }),
		emit: () => undefined,
		queueFile: join(dir, "queue.json"),
	});
	const go = (id: string) => c.start({ threadId: id, projectId: "p1", text: "x", focus: [], cause: { by: "user" } });
	await go(a.id);
	await go(b.id);
	await tick();
	assert.equal(store.get(a.id)!.state, "waiting-confirm");
	// both runs wait on a confirmation, so neither holds a slot: a third start runs at once
	assert.equal((await go(d.id)).queued, false);
	assert.ok(started.includes(d.id));
	c.confirm("c-ekspertize", false);
	await tick();
	assert.equal(answers.get(b.id), false);
	assert.equal(answers.has(a.id), false, "the other confirmation is still open");
	c.confirm("c-lead", true);
	await c.shutdown();
	assert.equal(answers.get(a.id), true);
});

test("the saved queue item never carries attachments", async () => {
	const t = setup(1);
	const [a, b] = [t.mk("lead", "a"), t.mk("ekspertize", "b")];
	await t.start(a.id);
	await t.start(b.id, { files: { images: [{ type: "image", data: "AAAA", mimeType: "image/png" }], text: "secret", refs: [] } });
	assert.equal(existsSync(t.queueFile), true);
	const raw = JSON.stringify(loadQueue(t.queueFile));
	assert.ok(!raw.includes("secret") && !raw.includes("AAAA"));
	t.c.stopAll();
	await t.c.shutdown();
});
