// 10.5 coordinator: one run at a time, the confirmations, Stop, and the envelope on every event. The agent loop is scripted.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { ThreadRunner } from "../src/agent/thread-runner.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { ActivityLog } from "../src/main/activity.ts";
import type { Activity } from "../src/shared/activity.ts";
import { LEAD_ID, type RunMeta, type Thread } from "../src/shared/thread-types.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

type Run = (o: PiRunOptions) => Promise<void>;
const REFUSAL = "Aģents jau strādā. Aptur vai pagaidi.";

function sessionSetup(runAgent: Run) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const emitted: { runId: string; event: RunEvent; meta?: RunMeta }[] = [];
	const changed: Thread[] = [];
	const lines: Activity[] = [];
	const act = new ActivityLog({ send: (a) => lines.push(a), sources: () => [], levelOf: () => "run", templates: [] });
	let finish!: () => void;
	let finished = new Promise<void>((r) => (finish = r));
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: (runId, event, meta) => {
			emitted.push({ runId, event, meta });
			act.event(runId, event, meta);
			if (event.type === "done" || event.type === "error") finish();
		},
		onThread: (t) => changed.push(t),
		runAgent,
	});
	return { s, dir, emitted, changed, lines, finished: () => finished, rearm: () => (finished = new Promise<void>((r) => (finish = r))) };
}

/** a stub runner: the coordinator only calls run(), so confirmations and stop can be driven by hand */
function stubSetup(run: (i: Parameters<ThreadRunner["run"]>[0]) => Promise<void>) {
	const dir = tmp();
	const store = new ThreadStore(join(dir, "threads"));
	const thread = store.create({ projectId: "p1", agent: LEAD_ID, title: "Galvenā", startedBy: "user" });
	const emitted: { runId: string; event: RunEvent; meta: RunMeta }[] = [];
	const changed: Thread[] = [];
	const c = new Coordinator({
		runner: { run: async (i: Parameters<ThreadRunner["run"]>[0]) => (await run(i), { ok: true, answer: "", confirmedBatches: 0 }) } as unknown as ThreadRunner,
		threads: () => store,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		emit: (runId, event, meta) => emitted.push({ runId, event, meta }),
		onThread: (t) => changed.push(t),
	});
	const start = (extra = {}) => c.start({ threadId: thread.id, projectId: "p1", text: "sveiki", focus: [], cause: { by: "user" }, ...extra });
	return { c, store, thread, emitted, changed, start };
}

const batch = { id: "c1", batch: [{ tool: "revit_set", input: {} }] } as never;
const tick = () => new Promise((r) => setTimeout(r, 5));

test("start twice: the second is refused with today's text, and a stop frees the slot", async () => {
	let release!: () => void;
	const t = stubSetup(() => new Promise<void>((r) => (release = r)));
	await t.start();
	await assert.rejects(t.start(), { message: REFUSAL });
	release();
	await tick();
	await t.start();
	t.c.stopAll();
	release();
	await t.c.shutdown();
});

test("every event of a session run carries thread, agent, project and wave, and the threads change for running and idle", async () => {
	const t = sessionSetup(async (o) => {
		o.onEvent({ type: "tool", name: "read_source" });
		o.onEvent({ type: "done", text: "gatavs" });
	});
	await t.s.send("p9", "sveiki", []);
	await t.finished();
	await t.s.shutdown();
	assert.ok(t.emitted.length >= 2);
	const waves = new Set(t.emitted.map((e) => e.meta?.wave));
	assert.equal(waves.size, 1);
	assert.match([...waves][0]!, /^w[0-9a-z]+$/);
	for (const e of t.emitted) {
		assert.ok(e.meta?.threadId, "thread id");
		assert.equal(e.meta?.agent, "lead");
		assert.equal(e.meta?.projectId, "p9");
	}
	assert.deepEqual(t.changed.map((x) => x.state), ["running", "idle"]);
	assert.equal(t.changed[0]!.runs, 1);
	assert.equal(t.changed[0]!.wave, [...waves][0]);
	// a second user start opens a new wave
	t.rearm();
	await t.s.send("p9", "vēlreiz", []);
	await t.finished();
	await t.s.shutdown();
	assert.notEqual(t.emitted.at(-1)!.meta?.wave, [...waves][0]);
});

test("the activity lines of a run carry the agent and the thread", async () => {
	const t = sessionSetup(async (o) => {
		o.onEvent({ type: "tool", name: "read_source" });
		o.onEvent({ type: "done", text: "gatavs" });
	});
	await t.s.send(null, "sveiki", []);
	await t.finished();
	await t.s.shutdown();
	const own = t.lines.filter((l) => l.who === "agent");
	assert.ok(own.length >= 2);
	for (const l of own) {
		assert.equal(l.agent, "lead");
		assert.ok(l.thread);
	}
});

test("an open confirmation puts the thread in waiting-confirm; answering returns it to running; the end makes it idle", async () => {
	let answer!: Promise<boolean>;
	let release!: () => void;
	const t = stubSetup(async (i) => {
		answer = i.ask(batch);
		await answer;
		await new Promise<void>((r) => (release = r));
	});
	await t.start();
	await tick();
	assert.equal(t.store.get(t.thread.id)!.state, "waiting-confirm");
	assert.equal(t.emitted.find((e) => e.event.type === "confirm")!.meta.threadId, t.thread.id);
	t.c.confirm("c1", true);
	assert.equal(await answer, true);
	assert.equal(t.store.get(t.thread.id)!.state, "running");
	assert.throws(() => t.c.confirm("c1", true), { message: "Šis apstiprinājums vairs negaida." });
	release();
	await t.c.shutdown();
	assert.equal(t.store.get(t.thread.id)!.state, "idle");
	assert.deepEqual(t.changed.map((x) => x.state), ["running", "waiting-confirm", "running", "idle"]);
});

test("stopAll aborts the run and answers an open confirmation with no", async () => {
	let answer!: Promise<boolean>;
	let aborted = false;
	const t = stubSetup(async (i) => {
		i.signal.addEventListener("abort", () => (aborted = true));
		answer = i.ask(batch);
		await answer;
	});
	await t.start();
	await tick();
	t.c.stopAll();
	assert.equal(await answer, false);
	await t.c.shutdown();
	assert.ok(aborted);
	assert.equal(t.store.get(t.thread.id)!.state, "idle");
});
