// 11.3 restart: after the app dies, nothing runs by itself. Threads that were in flight are `interrupted`, the saved queue loads paused,
// and the user decides: resume or discard. The agent loop is scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import type { ThreadRunner } from "../src/agent/thread-runner.ts";
import { loadQueue, saveQueue, type QueueItem } from "../src/core/queue.ts";
import { ThreadStore, knownProjects, threadsDir } from "../src/core/threads.ts";
import type { QueueView, Thread } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

type RunIn = Parameters<ThreadRunner["run"]>[0];
const tick = () => new Promise((r) => setTimeout(r, 5));
const NOTE = "[pielikumi pēc restartēšanas netika saglabāti]";

/** a data folder with a store per project; a "previous process" is just a queue file and thread states written beforehand */
function setup(cap = 3) {
	const dir = tmp();
	const stores = new Map<string | null, ThreadStore>();
	const store = (p: string | null) => {
		let s = stores.get(p);
		if (!s) stores.set(p, (s = new ThreadStore(join(dir, p ?? "_", "threads"))));
		return s;
	};
	const mk = (p: string | null, agent: string, state?: Thread["state"]) => {
		const t = store(p).create({ projectId: p, agent, title: agent, startedBy: "user" });
		return state ? store(p).patch(t.id, { state }) : t;
	};
	const item = (t: Thread, over: Partial<QueueItem> = {}): QueueItem => ({
		id: `q-${t.id}`, threadId: t.id, agent: t.agent, projectId: t.projectId, wave: "w1", at: "2026-01-01T00:00:00Z", state: "queued",
		input: { text: `hello ${t.agent}`, focus: [], cause: { by: "user" } },
		...over,
	});
	const queueFile = join(dir, "queue.json");
	const texts = new Map<string, string>();
	const views: QueueView[] = [];
	const gates: (() => void)[] = [];
	const c = new Coordinator({
		runner: {
			run: async (i: RunIn) => {
				texts.set(i.thread.id, i.text);
				await new Promise<void>((resolve) => {
					gates.push(resolve);
					i.signal.addEventListener("abort", () => resolve());
				});
				return { ok: true, answer: "", confirmedBatches: 0 };
			},
		} as unknown as ThreadRunner,
		threads: (p) => {
			if (p === "bad") throw new Error("EPERM");
			return store(p);
		},
		projects: () => [...stores.keys(), "bad"],
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: cap }),
		emit: () => undefined,
		onQueue: (v) => views.push(v),
		queueFile,
	});
	const finish = async () => {
		c.stopAll();
		await c.shutdown();
	};
	return { dir, store, mk, item, queueFile, c, texts, views, finish };
}

test("a running thread and two queued items: after restore nothing runs, the thread is interrupted, the queue is paused", async () => {
	const t = setup();
	const dead = t.mk("p1", "ar", "running");
	const a = t.mk("p1", "bim");
	const b = t.mk("p1", "ekspertize");
	saveQueue(t.queueFile, { items: [t.item(a), t.item(b)], paused: false });
	const r = t.c.restore();
	assert.deepEqual(r, { interrupted: 1, queued: 2 });
	assert.equal(t.store("p1").get(dead.id)!.state, "interrupted");
	assert.deepEqual(t.c.view().running, []);
	assert.equal(t.c.view().paused, true);
	assert.equal(t.c.view().queued.length, 2);
	await tick();
	assert.equal(t.texts.size, 0, "no run started by itself");
	await t.finish();
});

test("every thread in running, queued or waiting-confirm is interrupted, in every project and in the project-less folder", async () => {
	const t = setup();
	const x = t.mk("p1", "a", "queued");
	const y = t.mk("p2", "b", "waiting-confirm");
	const z = t.mk(null, "c", "running");
	const idle = t.mk("p1", "d", "idle");
	const closed = t.mk("p2", "e", "closed");
	assert.deepEqual(t.c.restore(), { interrupted: 3, queued: 0 });
	for (const [p, th] of [["p1", x], ["p2", y], [null, z]] as const) assert.equal(t.store(p).get(th.id)!.state, "interrupted");
	assert.equal(t.store("p1").get(idle.id)!.state, "idle");
	assert.equal(t.store("p2").get(closed.id)!.state, "closed");
	await t.finish();
});

test("a project whose thread folder cannot be read is skipped, never fatal", async () => {
	const t = setup();
	t.mk("p1", "a", "running");
	// the "bad" project makes threads() throw (see setup); restore still handles the others
	assert.deepEqual(t.c.restore(), { interrupted: 1, queued: 0 });
	await t.finish();
});

test("resume: the queued items start, interrupted threads with an item become queued then run, the rest idle", async () => {
	const t = setup();
	const dead = t.mk("p1", "ar", "running");
	const a = t.mk("p1", "bim", "queued");
	const b = t.mk("p2", "ekspertize");
	saveQueue(t.queueFile, { items: [t.item(a), t.item(b)], paused: false });
	assert.deepEqual(t.c.restore(), { interrupted: 2, queued: 2 });
	t.views.length = 0;
	t.c.resumeInterrupted();
	await tick();
	assert.equal(t.c.view().paused, false);
	assert.deepEqual([...t.texts.keys()].sort(), [a.id, b.id].sort());
	assert.equal(t.store("p1").get(a.id)!.state, "running");
	assert.equal(t.store("p1").get(dead.id)!.state, "idle");
	assert.ok(t.views.length > 0, "onQueue was called");
	assert.equal(loadQueue(t.queueFile).paused, false);
	await t.finish();
});

test("resume: an interrupted thread whose item waits behind the cap is queued, not idle", async () => {
	const t = setup(1);
	const a = t.mk("p1", "bim", "running");
	const b = t.mk("p1", "ar", "running");
	saveQueue(t.queueFile, { items: [t.item(a), t.item(b)], paused: false });
	t.c.restore();
	t.c.resumeInterrupted();
	await tick();
	assert.equal(t.store("p1").get(a.id)!.state, "running");
	assert.equal(t.store("p1").get(b.id)!.state, "queued");
	await t.finish();
});

test("discard: the queued items are kept as stopped, the threads are idle, nothing runs, the queue is not paused", async () => {
	const t = setup();
	const dead = t.mk("p1", "ar", "running");
	const a = t.mk("p1", "bim", "queued");
	saveQueue(t.queueFile, { items: [t.item(a), t.item(dead, { state: "stopped" })], paused: false });
	t.c.restore();
	t.views.length = 0;
	t.c.discardInterrupted();
	await tick();
	assert.equal(t.texts.size, 0);
	assert.equal(t.store("p1").get(dead.id)!.state, "idle");
	assert.equal(t.store("p1").get(a.id)!.state, "idle");
	assert.deepEqual(t.c.view().queued.map((q) => q.state), ["stopped", "stopped"]);
	assert.equal(t.c.view().paused, false);
	assert.ok(t.views.length > 0, "onQueue was called");
	const saved = loadQueue(t.queueFile);
	assert.equal(saved.items.length, 2, "kept, not deleted");
	assert.ok(saved.items.every((q) => q.state === "stopped"));
	await t.finish();
});

test("a queue file cut mid-write: no throw, interrupted counted, nothing queued, paused", async () => {
	const t = setup();
	t.mk("p1", "ar", "running");
	writeFileSync(t.queueFile, '{"items":[{"id":"q1","threadId":"th');
	let r: { interrupted: number; queued: number } | undefined;
	assert.doesNotThrow(() => (r = t.c.restore()));
	assert.deepEqual(r, { interrupted: 1, queued: 0 });
	assert.equal(t.c.view().paused, true);
	await t.finish();
});

test("a partly damaged queue file loads paused even though the file said not paused", async () => {
	const t = setup();
	const a = t.mk("p1", "bim");
	writeFileSync(t.queueFile, JSON.stringify({ items: [t.item(a), { id: "broken" }], paused: false }));
	assert.deepEqual(t.c.restore(), { interrupted: 0, queued: 1 });
	assert.equal(t.c.view().paused, true);
	await t.finish();
});

test("a clean start (no queue file, nothing in flight) stays unpaused, so the first message runs", async () => {
	const t = setup();
	const a = t.mk("p1", "bim");
	assert.deepEqual(t.c.restore(), { interrupted: 0, queued: 0 });
	assert.equal(t.c.view().paused, false);
	const r = await t.c.start({ threadId: a.id, projectId: "p1", text: "x", focus: [], cause: { by: "user" } });
	assert.ok(r.runId);
	await t.finish();
});

test("an item that had attachments starts without them, with one line saying so", async () => {
	const t = setup();
	const a = t.mk("p1", "bim");
	const b = t.mk("p1", "ar");
	const files = { images: [], text: "dokuments", refs: [{ name: "a.pdf" }] } as never;
	// a start with prepared files saves the flag; the files themselves stay out of the file
	t.c.pause();
	await t.c.start({ threadId: a.id, projectId: "p1", text: "ar failu", focus: [], cause: { by: "user" }, files });
	await t.c.start({ threadId: b.id, projectId: "p1", text: "bez faila", focus: [], cause: { by: "user" } });
	const saved = loadQueue(t.queueFile).items;
	assert.equal(saved.find((q) => q.threadId === a.id)!.hadFiles, true);
	assert.equal(saved.find((q) => q.threadId === b.id)!.hadFiles, undefined);
	assert.ok(!readFileSync(t.queueFile, "utf8").includes("dokuments"), "no file content in queue.json");
	await t.finish();

	// the next process: restore, resume
	const t2 = setup();
	t2.mk("p1", "bim");
	const a2 = t2.store("p1").list()[0]!;
	saveQueue(t2.queueFile, { items: [t2.item(a2, { hadFiles: true, input: { text: "ar failu", focus: [], cause: { by: "user" } } })], paused: false });
	t2.c.restore();
	t2.c.resumeInterrupted();
	await tick();
	assert.equal(t2.texts.get(a2.id), `ar failu\n${NOTE}`);
	await t2.finish();
});

test("an item without the flag keeps its text as it was", async () => {
	const t = setup();
	const a = t.mk("p1", "bim");
	saveQueue(t.queueFile, { items: [t.item(a)], paused: false });
	t.c.restore();
	t.c.resumeInterrupted();
	await tick();
	assert.equal(t.texts.get(a.id), "hello bim");
	await t.finish();
});

test("knownProjects: the project folders that have threads, plus the project-less one", () => {
	const dir = tmp();
	const appDir = join(dir, "app");
	const projectsDir = join(dir, "projects");
	for (const p of ["p1", "p2"]) mkdirSync(threadsDir(appDir, projectsDir, p), { recursive: true });
	mkdirSync(join(projectsDir, "p3"), { recursive: true }); // a project that never had a thread
	writeFileSync(join(projectsDir, "stray.txt"), "not a project");
	mkdirSync(threadsDir(appDir, projectsDir, null), { recursive: true });
	assert.deepEqual(knownProjects(appDir, projectsDir).sort((x, y) => String(x).localeCompare(String(y))), [null, "p1", "p2"]);
	assert.deepEqual(knownProjects(join(dir, "none"), join(dir, "none2")), []);
});
