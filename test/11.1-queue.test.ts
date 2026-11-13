import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadQueue, pickNext, saveQueue, type QueueItem, type Running } from "../src/core/queue.ts";
import { tmp } from "./helpers.ts";

const item = (id: string, over: Partial<QueueItem> = {}): QueueItem => ({
	id, threadId: `t-${id}`, agent: "ar", projectId: "p1", wave: "w1", at: "2026-01-01T00:00:00Z", state: "queued",
	input: { text: "x", focus: [], cause: { by: "user" } },
	...over,
});
const run = (threadId: string, over: Partial<Running> = {}): Running => ({
	runId: `r-${threadId}`, threadId, agent: "other", projectId: "p1", wave: "w1", waitingConfirm: false, ...over,
});

test("pickNext: oldest first", () => {
	assert.equal(pickNext([item("a"), item("b", { agent: "x" })], [], 2, false)?.id, "a");
});
test("pickNext: skips an item whose thread runs", () => {
	const q = [item("a", { threadId: "T" }), item("b", { agent: "x" })];
	assert.equal(pickNext(q, [run("T", { agent: "zzz" })], 3, false)?.id, "b");
});
test("pickNext: same agent same project skipped, other project taken", () => {
	const r = [run("t9", { agent: "ar", projectId: "p1" })];
	assert.equal(pickNext([item("a"), item("b", { projectId: "p2" })], r, 3, false)?.id, "b");
	assert.equal(pickNext([item("a")], r, 3, false), null);
	// null project is a project of its own
	assert.equal(pickNext([item("a", { projectId: null })], r, 3, false)?.id, "a");
});
test("pickNext: cap counts only runs not waiting for a confirmation", () => {
	const three = [run("1", { agent: "a" }), run("2", { agent: "b" }), run("3", { agent: "c" })];
	assert.equal(pickNext([item("n", { agent: "d" })], three, 3, false), null);
	three[2].waitingConfirm = true;
	assert.equal(pickNext([item("n", { agent: "d" })], three, 3, false)?.id, "n");
});
test("pickNext: cap below 1 counts as 1", () => {
	assert.equal(pickNext([item("a")], [], 0, false)?.id, "a");
	assert.equal(pickNext([item("a")], [run("1", { agent: "b" })], 0, false), null);
});
test("pickNext: paused gives null, stopped never picked", () => {
	assert.equal(pickNext([item("a")], [], 2, true), null);
	assert.equal(pickNext([item("a", { state: "stopped" }), item("b")], [], 2, false)?.id, "b");
});

test("saveQueue / loadQueue round trip, creates the folder, leaves no temp file", () => {
	const dir = join(tmp(), "sub", "deeper");
	const file = join(dir, "queue.json");
	const q = { items: [item("a"), item("b", { state: "stopped" })], paused: true };
	saveQueue(file, q);
	assert.deepEqual(loadQueue(file), q);
	assert.deepEqual(readdirSync(dir), ["queue.json"]);
});
test("loadQueue: missing file is empty and not paused", () => {
	assert.deepEqual(loadQueue(join(tmp(), "none.json")), { items: [], paused: false });
});
test("loadQueue: damaged or wrong-shaped file is empty and paused, never throws", () => {
	const d = tmp();
	for (const [n, body] of [["cut", '{"items":[{"id":"a","thr'], ["arr", "[1,2]"], ["null", "null"], ["bad", '{"items":"x","paused":false}'], ["empty", ""]]) {
		const f = join(d, `${n}.json`);
		writeFileSync(f, body);
		assert.deepEqual(loadQueue(f), { items: [], paused: true }, n);
	}
	assert.ok(existsSync(d));
});
test("loadQueue: items that fail the shape check are dropped, the rest kept", () => {
	const f = join(tmp(), "q.json");
	writeFileSync(f, JSON.stringify({ items: [item("a"), { id: "b" }, null, item("c", { state: "weird" as never })], paused: false }));
	const q = loadQueue(f);
	assert.deepEqual(q.items.map((i) => i.id), ["a"]);
	assert.equal(q.paused, false);
});
