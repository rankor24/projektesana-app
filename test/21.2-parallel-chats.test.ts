// Two conversations of one agent run side by side (the second Lead agent chat no longer waits behind the first); what still waits says why.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { Holds } from "../src/core/holds.ts";
import { IncidentStore } from "../src/core/incidents.ts";
import { pickNext, waitReason, type QueueItem, type Running } from "../src/core/queue.ts";
import { ThreadStore } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_DEPARTMENTS } from "../src/shared/departments.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const item = (id: string, threadId: string, agent = "lead"): QueueItem => ({ id, threadId, agent, projectId: "P1", wave: "w", at: "t", state: "queued", input: { text: "x", focus: [], cause: { by: "user" } } });
const run = (threadId: string, agent = "lead", waitingConfirm = false): Running => ({ runId: `r-${threadId}`, threadId, agent, projectId: "P1", wave: "w", waitingConfirm });

test("pickNext: a second conversation of the same agent in the same project starts while the first runs", () => {
	assert.equal(pickNext([item("q1", "t2")], [run("t1")], 3, false)?.id, "q1");
});

test("pickNext: the conversation that is still answering waits; the next one is taken", () => {
	assert.equal(pickNext([item("q1", "t1"), item("q2", "t2")], [run("t1")], 3, false)?.id, "q2");
	assert.equal(pickNext([item("q1", "t1")], [run("t1")], 3, false), null);
});

test("pickNext: the slot limit and a pause still hold; a run parked on a confirmation holds no slot", () => {
	const three = [run("a"), run("b"), run("c")];
	assert.equal(pickNext([item("q", "d")], three, 3, false), null);
	assert.equal(pickNext([item("q", "d")], [run("a"), run("b"), run("c", "lead", true)], 3, false)?.id, "q");
	assert.equal(pickNext([item("q", "d")], [], 3, true), null);
});

test("waitReason: says what holds an item, in the order the pick checks", () => {
	assert.deepEqual(waitReason(item("q", "t1"), [run("t1")], 3, true), { kind: "paused" });
	assert.deepEqual(waitReason(item("q", "t2"), [], 3, false, () => "held"), { kind: "held" });
	assert.deepEqual(waitReason(item("q", "t2"), [], 3, false, () => "wave"), { kind: "wave" });
	assert.deepEqual(waitReason(item("q", "t1"), [run("t1")], 3, false), { kind: "thread" });
	assert.deepEqual(waitReason(item("q", "t9"), [run("a"), run("b"), run("c")], 3, false), { kind: "cap", active: 3, cap: 3 });
	assert.equal(waitReason(item("q", "t9"), [run("a")], 3, false), null, "nothing holds it");
});

function rig(cap: number) {
	const dir = tmp("par-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `threads-${p ?? "_"}`))), stores.get(p)!);
	const started: { threadId: string; finish: () => void; abort: AbortSignal }[] = [];
	const events: { type: string; message?: string }[] = [];
	const stubborn = { on: false };
	const runner = {
		run: (i: { thread: { id: string }; signal: AbortSignal }) =>
			new Promise<{ ok: boolean; answer: string; confirmedBatches: number }>((resolve) => {
				started.push({ threadId: i.thread.id, abort: i.signal, finish: () => resolve({ ok: true, answer: "gatavs", confirmedBatches: 0 }) });
				// an engine that is slow to wind down (a tool server that will not close) never answers the abort
				if (!stubborn.on) i.signal.addEventListener("abort", () => resolve({ ok: false, answer: "", confirmedBatches: 0 }));
			}),
	};
	const specs: AgentSpec[] = [];
	const c = new Coordinator({ runner: runner as never, threads, settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: cap }), emit: (_id: string, e: { type: string; message?: string }) => void events.push(e), queueFile: join(dir, "queue.json"), specs: () => specs, holds: new Holds(), incidents: new IncidentStore(), departments: () => DEFAULT_DEPARTMENTS });
	const open = (title: string) => threads("P1").create({ projectId: "P1", agent: "lead", title, startedBy: "user" });
	const send = (id: string) => c.start({ threadId: id, projectId: "P1", text: "darbs", focus: [], cause: { by: "user" } });
	return { c, open, send, started, events, stubborn };
}

test("coordinator: two Lead agent conversations run at the same time and each stops on its own", async () => {
	const r = rig(3);
	const a = r.open("Saruna 15:47");
	const b = r.open("Saruna 16:01");
	assert.equal((await r.send(a.id)).queued, false);
	const second = await r.send(b.id);
	assert.equal(second.queued, false, "the second chat starts at once");
	assert.equal(r.started.length, 2);
	assert.deepEqual(r.c.view().running.map((x) => x.agent), ["lead", "lead"]);
	r.c.stopThread(a.id);
	assert.equal(r.started[0].abort.aborted, true);
	assert.equal(r.started[1].abort.aborted, false, "the other chat goes on");
	r.started[1].finish();
});

test("coordinator: a start over the slot limit waits and the view says why; it starts when a slot frees", async () => {
	const r = rig(1);
	const a = r.open("A");
	const b = r.open("B");
	await r.send(a.id);
	const second = await r.send(b.id);
	assert.equal(second.queued, true);
	const v = r.c.view();
	assert.equal(v.queued.length, 1);
	assert.deepEqual(v.why[v.queued[0].id], { kind: "cap", active: 1, cap: 1 });
	r.started[0].finish();
	await new Promise((res) => setTimeout(res, 20));
	assert.equal(r.started.length, 2, "the waiting chat started");
	assert.deepEqual(r.c.view().why, {});
	r.started[1].finish();
});

test("coordinator: a message to a conversation that is still answering is refused for the user, not queued unseen", async () => {
	const r = rig(3);
	const a = r.open("A");
	await r.send(a.id);
	await assert.rejects(r.send(a.id));
	r.started[0].finish();
});

test("coordinator: Stop all ends the runs at once even when the engine does not answer the abort", async () => {
	const r = rig(3);
	r.stubborn.on = true;
	const a = r.open("A");
	const b = r.open("B");
	await r.send(a.id);
	await r.send(b.id);
	assert.equal(r.c.view().running.length, 2);
	r.c.stopAll();
	assert.equal(r.started.every((s) => s.abort.aborted), true, "both signals fired");
	assert.equal(r.c.view().running.length, 0, "the list stops showing them in the same call");
	assert.equal(r.events.filter((e) => e.type === "error" && e.message === "aborted").length, 2, "the window is told each run ended");
	await new Promise((res) => setTimeout(res, 1800));
	assert.equal(r.c.threadBusy(a.id), false, "after the grace the thread is free though the engine never ended");
	assert.equal(r.c.threadBusy(b.id), false);
});
