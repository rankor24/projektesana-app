// 10.1 thread store: threads and their transcripts on disk, one folder per thread.
import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatEntry } from "../src/shared/api.ts";
import { LEAD_ID } from "../src/shared/thread-types.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import { tmp } from "./helpers.ts";

const mk = () => new ThreadStore(join(tmp(), "threads"));
const entry = (text: string, o: Partial<ChatEntry> = {}): ChatEntry => ({ role: "user", text, at: "2026-11-13T10:00:00.000Z", ...o });

test("create, get and list round-trip; open leaves out closed; newest lastAt first", () => {
	const s = mk();
	const a = s.create({ projectId: "p1", agent: "rooms", title: "A", startedBy: "user" });
	const b = s.create({ projectId: "p1", agent: "checks", title: "B", topic: "tp1", startedBy: LEAD_ID });
	const c = s.create({ projectId: "p1", agent: "rooms", title: "C", startedBy: "user" });
	assert.deepEqual(s.get(a.id), a);
	assert.equal(s.get("nope"), null);
	assert.equal(b.topic, "tp1");
	assert.equal(a.state, "idle");
	assert.equal(a.runs, 0);
	s.patch(a.id, { lastAt: "2026-11-13T12:00:00.000Z" });
	s.patch(b.id, { lastAt: "2026-11-13T11:00:00.000Z" });
	s.patch(c.id, { lastAt: "2026-11-13T09:00:00.000Z", state: "closed" });
	assert.deepEqual(s.list().map((t) => t.title), ["A", "B", "C"]);
	assert.deepEqual(s.list({ open: true }).map((t) => t.title), ["A", "B"]);
	assert.deepEqual(s.list({ agent: "rooms" }).map((t) => t.title), ["A", "C"]);
	assert.throws(() => s.patch("nope", { runs: 1 }), /Saruna nope nav atrasta\./);
});

test("append and transcript keep every ChatEntry field, compaction entries included", () => {
	const s = mk();
	const t = s.create({ projectId: null, agent: "rooms", title: "A", startedBy: "user" });
	const es: ChatEntry[] = [
		entry("sveiki", { attachments: [{ name: "a.pdf", path: "x/a.pdf" } as never] }),
		{ role: "assistant", text: "kopsavilkums", at: "2026-11-13T10:01:00.000Z", kind: "compaction", tokens: { before: 900, after: 100 } as never },
	];
	for (const e of es) s.append(t.id, e);
	assert.deepEqual(s.transcript(t.id), es);
	assert.deepEqual(s.transcript("nope"), []);
});

test("lead() twice gives the same thread; a legacy chat is copied once and kept", () => {
	const dir = tmp();
	const legacy = join(dir, "p1.jsonl");
	writeFileSync(legacy, [entry("1"), entry("2"), entry("3")].map((e) => JSON.stringify(e)).join("\n") + "\n");
	const s = new ThreadStore(join(dir, "threads"));
	const t = s.lead("p1", legacy);
	assert.equal(t.title, "Saruna");
	assert.equal(t.agent, LEAD_ID);
	assert.equal(s.lead("p1", legacy).id, t.id);
	assert.equal(s.transcript(t.id).length, 3);
	assert.ok(existsSync(legacy));
	assert.equal(s.list().length, 1);
	// closed -> the next call opens a new thread; the legacy lines are not copied again
	s.patch(t.id, { state: "closed" });
	const t2 = s.lead("p1", legacy);
	assert.notEqual(t2.id, t.id);
	assert.deepEqual(s.transcript(t2.id), []);
});

test("lead() with no legacy file starts an empty thread", () => {
	const s = mk();
	const t = s.lead(null, join(tmp(), "missing.jsonl"));
	assert.deepEqual(s.transcript(t.id), []);
});

test("Review Focus 1: a torn last line and a stray temp file lose nothing", () => {
	const dir = join(tmp(), "threads");
	const s = new ThreadStore(dir);
	const t = s.create({ projectId: "p1", agent: "rooms", title: "A", startedBy: "user" });
	s.append(t.id, entry("viens"));
	s.append(t.id, entry("divi"));
	appendFileSync(join(dir, t.id, "chat.jsonl"), '{"role":"user","text":"cut of');
	assert.deepEqual(s.transcript(t.id).map((e) => e.text), ["viens", "divi"]);
	// the next append is not glued to the torn line
	s.append(t.id, entry("trīs"));
	assert.deepEqual(s.transcript(t.id).map((e) => e.text), ["viens", "divi", "trīs"]);
	writeFileSync(join(dir, t.id, `thread.json.${process.pid}.tmp`), '{"id":"half');
	assert.deepEqual(s.get(t.id), t);
	assert.equal(s.patch(t.id, { runs: 2 }).runs, 2);
	assert.equal(s.list().length, 1);
});

test("list skips a folder whose thread.json is missing or unreadable", () => {
	const dir = join(tmp(), "threads");
	const s = new ThreadStore(dir);
	const ok = s.create({ projectId: null, agent: "rooms", title: "A", startedBy: "user" });
	mkdirSync(join(dir, "th_half"), { recursive: true });
	mkdirSync(join(dir, "th_bad"), { recursive: true });
	writeFileSync(join(dir, "th_bad", "thread.json"), "{not json");
	assert.deepEqual(s.list().map((t) => t.id), [ok.id]);
	assert.ok(readdirSync(dir).length === 3);
	assert.deepEqual(new ThreadStore(join(dir, "none")).list(), []);
});

test("threadsDir: inside the project folder, or <appDir>\\threads\\_", () => {
	assert.equal(threadsDir("app", "proj", "p1"), join("proj", "p1", "threads"));
	assert.equal(threadsDir("app", "proj", null), join("app", "threads", "_"));
});
