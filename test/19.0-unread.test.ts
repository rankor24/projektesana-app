// 19.0 unread conversations: a thread is unread while the assistant has written something after the last time the user had it open (the seen mark);
// the user's own lines and compaction notes do not count; a file made before the column existed counts as read; opening the thread clears it.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { FileThreads, ThreadStore, threadsDir } from "../src/core/threads.ts";
import { ThreadsDb, SCHEMA_VERSION } from "../src/core/threads-db.ts";
import type { ChatEntry } from "../src/shared/api.ts";
import { tmp } from "./helpers.ts";

const line = (role: ChatEntry["role"], text: string, more: Partial<ChatEntry> = {}): ChatEntry => ({ role, text, at: "2026-11-02T10:00:00.000Z", ...more });

test("unread: assistant lines after the seen mark count; the user's lines and compaction notes do not; seen clears it", () => {
	const store = new ThreadStore(join(tmp("unread-"), "threads"));
	const t = store.create({ projectId: "P1", agent: "ar", title: "a", startedBy: "user" });
	assert.equal(store.get(t.id)?.unread, undefined, "a new thread has nothing unread");
	store.append(t.id, line("user", "sveiki"));
	assert.equal(store.get(t.id)?.unread, undefined, "the user's own line is not unread");
	store.append(t.id, line("assistant", "atbilde 1"));
	store.append(t.id, line("assistant", "kopsavilkums", { kind: "compaction" }));
	store.append(t.id, line("assistant", "atbilde 2"));
	assert.equal(store.get(t.id)?.unread, 2, "two answers, the compaction note is not counted");
	assert.equal(store.list({ open: true })[0].unread, 2, "the list carries it too (threads.changed sends the same thread)");
	// an ordinary state write keeps the count
	assert.equal(store.patch(t.id, { state: "idle", runs: 1 }).unread, 2);
	assert.equal(store.patch(t.id, { seen: true }).unread, undefined, "the thread is opened: read");
	assert.equal(store.get(t.id)?.unread, undefined);
	store.append(t.id, line("assistant", "atbilde 3"));
	assert.equal(store.get(t.id)?.unread, 1, "only what came after the mark");
	store.close();
});

test("unread: the mark survives a reopen of the same project folder", () => {
	const dir = join(tmp("unread2-"), "threads");
	const a = new ThreadStore(dir);
	const t = a.create({ projectId: "P1", agent: "ar", title: "a", startedBy: "user" });
	a.append(t.id, line("assistant", "x"));
	a.patch(t.id, { seen: true });
	a.append(t.id, line("assistant", "y"));
	a.close();
	const b = new ThreadStore(dir);
	assert.equal(b.get(t.id)?.unread, 1);
	b.patch(t.id, { seen: true });
	assert.equal(b.get(t.id)?.unread, undefined);
	b.close();
});

test("unread: a file made before the seen column existed gets it by migrate(), and what it held counts as read", () => {
	const dir = tmp("unread3-");
	const file = join(dir, "threads.db");
	const old = new DatabaseSync(file);
	// a version-2 file as the previous build made it: pinned there, no seen_msg
	old.exec(
		"CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE threads (id TEXT PRIMARY KEY, project_id TEXT, agent TEXT NOT NULL, title TEXT NOT NULL, topic TEXT, state TEXT NOT NULL, started_by TEXT NOT NULL, wave TEXT, created_at TEXT NOT NULL, last_at TEXT NOT NULL, runs INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0);" +
			"CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, at TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', text TEXT NOT NULL, json TEXT NOT NULL); PRAGMA user_version = 2",
	);
	old.prepare("INSERT INTO threads VALUES ('t1','P1','ar','vecā',NULL,'idle','user',NULL,'2026-01-01','2026-01-01',1,0)").run();
	old.prepare("INSERT INTO messages (thread_id, at, role, kind, text, json) VALUES ('t1','x','assistant','text','sena atbilde','{}')").run();
	old.close();
	const db = ThreadsDb.open(file);
	assert.equal(db.get("t1")?.unread, undefined, "the old answer is not unread");
	db.append("t1", line("assistant", "jauna"));
	assert.equal(db.get("t1")?.unread, 1, "a new one is");
	db.close();
	const probe = new DatabaseSync(file, { readOnly: true });
	assert.equal(Number((probe.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), SCHEMA_VERSION);
	probe.close();
	// opened again: the step does not run twice and does not mark the new answer as seen
	const again = ThreadsDb.open(file);
	assert.equal(again.get("t1")?.unread, 1);
	again.close();
});

test("unread: threads copied from the old thread folders count as read", () => {
	const root = tmp("unread4-");
	const dir = threadsDir(root, join(root, "projects"), "BD1");
	mkdirSync(join(dir, "th_a"), { recursive: true });
	const t = { id: "th_a", projectId: "BD1", agent: "ar", title: "Vecā", topic: null, state: "idle", startedBy: "user", wave: null, createdAt: "2026-11-01T08:00:00.000Z", lastAt: "2026-11-01T09:00:00.000Z", runs: 1 };
	writeFileSync(join(dir, "th_a", "thread.json"), JSON.stringify(t));
	writeFileSync(join(dir, "th_a", "chat.jsonl"), [line("user", "q"), line("assistant", "a")].map((l) => JSON.stringify(l)).join("\n") + "\n");
	const store = new ThreadStore(dir);
	assert.equal(store.get("th_a")?.unread, undefined, "read long ago");
	store.append("th_a", line("assistant", "b"));
	assert.equal(store.get("th_a")?.unread, 1);
	store.close();
});

test("unread: the old file store (the fallback) keeps the number of lines seen as its mark", () => {
	const files = new FileThreads(join(tmp("unread5-"), "threads"));
	const t = { id: "th_f", projectId: "BD1", agent: "ar", title: "F", topic: null, state: "idle" as const, startedBy: "user", wave: null, createdAt: "2026-11-01T08:00:00.000Z", lastAt: "2026-11-01T09:00:00.000Z", runs: 0 };
	files.insert(t, (chatFile) => writeFileSync(chatFile, JSON.stringify(line("assistant", "senā")) + "\n"));
	assert.equal(files.get("th_f")?.unread, undefined, "what a new thread starts with is read");
	files.append("th_f", line("assistant", "a"));
	files.append("th_f", line("user", "q"));
	files.append("th_f", line("assistant", "kopsavilkums", { kind: "compaction" }));
	assert.equal(files.get("th_f")?.unread, 1);
	assert.equal(files.list({})[0].unread, 1);
	assert.equal(files.patch("th_f", { pinned: true }).unread, 1, "an ordinary patch keeps the mark");
	assert.equal(files.patch("th_f", { seen: true }).unread, undefined);
	files.append("th_f", line("assistant", "b"));
	assert.equal(files.get("th_f")?.unread, 1);
});
