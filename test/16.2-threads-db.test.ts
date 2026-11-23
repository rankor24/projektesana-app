// 16.2 conversations in one SQLite file per project: the store's API, the one-time copy of the old thread folders (which stay
// untouched), full-text search with Latvian diacritics folded, the agent's search tool, export, and a damaged database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { exportThread, safeFileName } from "../src/core/thread-export.ts";
import { ThreadStore, knownProjects, threadsDir } from "../src/core/threads.ts";
import { ThreadsDb, ThreadsDbError, ftsMatch } from "../src/core/threads-db.ts";
import type { ChatEntry } from "../src/shared/api.ts";
import type { Thread } from "../src/shared/thread-types.ts";
import { tmp } from "./helpers.ts";

const entry = (role: ChatEntry["role"], text: string, at: string, more: Partial<ChatEntry> = {}): ChatEntry => ({ role, text, at, ...more });

/** A project folder set the way the app lays it out: <appDir>, <projectsDir>\<id>. */
function layout() {
	const appDir = tmp();
	const projectsDir = join(appDir, "projects");
	mkdirSync(join(projectsDir, "BD999"), { recursive: true });
	return { appDir, projectsDir, dir: threadsDir(appDir, projectsDir, "BD999"), dbFile: join(projectsDir, "BD999", "threads.db") };
}

/** A thread folder as the old store wrote it. */
function oldThread(dir: string, t: Thread, lines: (ChatEntry | string)[]) {
	const folder = join(dir, t.id);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "thread.json"), JSON.stringify(t, null, 1));
	writeFileSync(join(folder, "chat.jsonl"), lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
}
const thread = (id: string, agent: string, title: string, lastAt: string, state: Thread["state"] = "idle"): Thread => ({ id, projectId: "BD999", agent, title, topic: null, state, startedBy: "user", wave: null, createdAt: "2026-11-01T08:00:00.000Z", lastAt, runs: 2 });

/** Every file under a folder with its hash and mtime: proof the old files were not touched. */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else out[p] = `${createHash("sha256").update(readFileSync(p)).digest("hex")}@${statSync(p).mtimeMs}`;
		}
	};
	if (existsSync(dir) && statSync(dir).isFile()) out[dir] = `${createHash("sha256").update(readFileSync(dir)).digest("hex")}@${statSync(dir).mtimeMs}`;
	else if (existsSync(dir)) walk(dir);
	return out;
}

test("FTS5 with the diacritics-folding tokenizer exists in this Node", () => {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
	db.prepare("INSERT INTO t VALUES (?)").run("Šķērsgriezums");
	assert.equal(db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH ?").get("skersgriezums")?.n, 1);
});

test("write and read through the store; the file is <project>\\threads.db and survives a reopen", () => {
	const L = layout();
	const s = new ThreadStore(L.dir);
	assert.deepEqual(s.list(), [], "nothing yet");
	assert.equal(existsSync(L.dbFile), false, "a read of an empty project makes no file");
	const a = s.create({ projectId: "BD999", agent: "lead", title: "Saruna", startedBy: "user" });
	const b = s.create({ projectId: "BD999", agent: "ARH", title: "Plāni", topic: "t1", startedBy: "lead" });
	assert.ok(existsSync(L.dbFile));
	assert.equal(existsSync(L.dir), false, "no thread folders are made any more");
	s.append(a.id, entry("user", "Sveiki", "2026-11-02T10:00:00.000Z"));
	s.append(a.id, entry("assistant", "Labdien", "2026-11-02T10:00:05.000Z", { attachments: [{ name: "a.pdf", kind: "document" }], tokens: { before: 5, after: 3 } }));
	s.append(b.id, entry("user", "cits", "2026-11-02T10:01:00.000Z"));
	s.patch(a.id, { lastAt: "2099-01-01T00:00:00.000Z", state: "running", runs: 1 });
	s.patch(b.id, { state: "closed", wave: "w1" });
	assert.deepEqual(s.get(b.id), { ...b, state: "closed", wave: "w1" });
	assert.deepEqual(s.list().map((t) => t.id), [a.id, b.id], "newest lastAt first");
	assert.deepEqual(s.list({ agent: "ARH" }).map((t) => t.id), [b.id]);
	assert.deepEqual(s.list({ open: true }).map((t) => t.id), [a.id]);
	assert.deepEqual(s.transcript(a.id).map((e) => e.text), ["Sveiki", "Labdien"]);
	assert.deepEqual(s.transcript(a.id)[1].attachments, [{ name: "a.pdf", kind: "document" }]);
	assert.deepEqual(s.transcript(a.id)[1].tokens, { before: 5, after: 3 });
	assert.throws(() => s.patch("th_nope", { title: "x" }), /nav atrasta/);
	assert.equal(s.get("th_nope"), null);
	assert.deepEqual(s.transcript("th_nope"), []);
	s.close();
	const again = new ThreadStore(L.dir);
	assert.deepEqual(again.list().map((t) => t.id), [a.id, b.id]);
	assert.equal(again.transcript(a.id).length, 2);
	assert.deepEqual(knownProjects(L.appDir, L.projectsDir), ["BD999"], "a project with only threads.db is known");
	assert.equal(again.health().kind, "db");
});

test("the lead thread takes the legacy chat file once and keeps it", () => {
	const L = layout();
	const legacy = join(L.appDir, "BD999.jsonl");
	writeFileSync(legacy, [entry("user", "vecā saruna", "2026-10-01T09:00:00.000Z"), entry("assistant", "vecā atbilde", "2026-10-01T09:00:03.000Z")].map((e) => JSON.stringify(e)).join("\n") + "\n");
	const before = snapshot(legacy);
	const s = new ThreadStore(L.dir);
	const lead = s.lead("BD999", legacy);
	assert.deepEqual(s.transcript(lead.id).map((e) => e.text), ["vecā saruna", "vecā atbilde"]);
	assert.equal(s.lead("BD999", legacy).id, lead.id, "the same open thread");
	assert.deepEqual(snapshot(legacy), before);
	s.patch(lead.id, { state: "closed" });
	const second = s.lead("BD999", legacy);
	assert.notEqual(second.id, lead.id);
	assert.deepEqual(s.transcript(second.id), [], "a later lead thread starts empty");
});

test("migration: old thread folders are copied in once; the old files are untouched", () => {
	const L = layout();
	oldThread(L.dir, thread("th_a", "lead", "Saruna", "2026-11-05T10:00:00.000Z"), [entry("user", "Cik stāvu ir ēkai?", "2026-11-05T09:00:00.000Z"), '{"role":"assistant","text":"torn li', entry("assistant", "Trīs stāvi", "2026-11-05T09:00:09.000Z")]);
	oldThread(L.dir, thread("th_b", "ARH", "Fasādes", "2026-11-04T10:00:00.000Z", "closed"), [entry("user", "fasāde", "2026-11-04T09:00:00.000Z")]);
	mkdirSync(join(L.dir, "th_half"), { recursive: true }); // a half-made thread: no thread.json
	writeFileSync(join(L.dir, "th_half", "chat.jsonl"), "{}\n");
	const before = snapshot(L.dir);

	const s = new ThreadStore(L.dir);
	assert.deepEqual(s.list().map((t) => t.id), ["th_a", "th_b"]);
	assert.deepEqual(s.get("th_b")?.state, "closed");
	assert.deepEqual(s.transcript("th_a").map((e) => e.text), ["Cik stāvu ir ēkai?", "Trīs stāvi"], "the torn line is skipped, as before");
	assert.deepEqual(snapshot(L.dir), before, "old files byte for byte and mtime the same");
	s.append("th_a", entry("user", "jauns", "2026-11-06T09:00:00.000Z"));
	assert.deepEqual(snapshot(L.dir), before, "new writes go to the database, not the old files");
	assert.equal(s.search({ query: "stāvi" }).length >= 1, true);

	// a second store, and a second start: no duplicates, nothing re-read
	s.close();
	const again = new ThreadStore(L.dir);
	assert.equal(again.list().length, 2);
	assert.equal(again.transcript("th_a").length, 3);
	writeFileSync(join(L.dir, "th_a", "chat.jsonl"), "");
	assert.equal(new ThreadStore(L.dir).transcript("th_a").length, 3, "the marker says migrated: the files are not read again");
	const marker = new DatabaseSync(L.dbFile, { readOnly: true }).prepare("SELECT value FROM meta WHERE key = 'migrated_from_files'").get() as { value: string };
	assert.equal(JSON.parse(marker.value).threads, 2);
});

test("migration that fails leaves the old files in use, and is tried again later", () => {
	const L = layout();
	oldThread(L.dir, thread("th_a", "lead", "Saruna", "2026-11-05T10:00:00.000Z"), [entry("user", "vecs", "2026-11-05T09:00:00.000Z")]);
	// make every insert into messages fail: a database whose copy cannot be written
	ThreadsDb.open(L.dbFile).close();
	const poison = new DatabaseSync(L.dbFile);
	poison.exec("CREATE TRIGGER boom BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'boom'); END");
	poison.close();
	const before = snapshot(L.dir);

	const s = new ThreadStore(L.dir);
	assert.deepEqual(s.list().map((t) => t.id), ["th_a"], "read from the old files");
	assert.equal(s.health().kind, "files");
	assert.match(s.health().text ?? "", /boom/);
	assert.deepEqual(snapshot(L.dir), before);
	const fresh = s.create({ projectId: "BD999", agent: "lead", title: "Jauna", startedBy: "user" });
	s.append(fresh.id, entry("user", "failos", "2026-11-06T09:00:00.000Z"));
	assert.ok(existsSync(join(L.dir, fresh.id, "thread.json")), "written the old way while the copy cannot be made");
	const check = new DatabaseSync(L.dbFile, { readOnly: true });
	assert.equal(check.prepare("SELECT count(*) AS n FROM threads").get()?.n, 0, "nothing half-copied");
	check.close();

	// the cause is gone: the next start copies everything, including what was written meanwhile
	s.close();
	const fix = new DatabaseSync(L.dbFile);
	fix.exec("DROP TRIGGER boom");
	fix.close();
	const later = new ThreadStore(L.dir);
	assert.equal(later.health().kind, "db");
	assert.deepEqual(later.list().map((t) => t.id).sort(), ["th_a", fresh.id].sort());
	assert.equal(later.transcript(fresh.id)[0].text, "failos");
});

test("full-text search folds Latvian diacritics, matches word beginnings, filters, and cannot be broken by operators", () => {
	const L = layout();
	const s = new ThreadStore(L.dir);
	const a = s.create({ projectId: "BD999", agent: "lead", title: "Būvniecības ieceres saruna", startedBy: "user" });
	const b = s.create({ projectId: "BD999", agent: "ARH", title: "Šķērsgriezumi", startedBy: "user" });
	s.append(a.id, entry("user", "Vai būvniecības iecere ir iesniegta?", "2026-11-02T10:00:00.000Z"));
	s.append(a.id, entry("assistant", "Jā, iesniegta 2026. gada oktobrī, BK-3 daļa kopā ar AND OR NOT *.", "2026-11-02T10:00:20.000Z"));
	s.append(b.id, entry("user", "Vajag ŠĶĒRSGRIEZUMU pa asi C, ūdens novadīšanai.", "2026-11-20T08:30:00.000Z"));
	s.append(b.id, entry("assistant", "Kopsavilkums: šķērsgriezumi sagatavoti.", "2026-11-21T08:30:00.000Z", { kind: "compaction" }));

	const hit = (q: string, more: Record<string, unknown> = {}) => s.search({ query: q, ...more });
	assert.equal(hit("buvniecibas").length, 1, "plain letters match ā, ī");
	assert.equal(hit("BŪVNIECĪBAS").length, 1, "with diacritics and capitals too");
	assert.equal(hit("skersgriezumu")[0].threadId, b.id);
	assert.equal(hit("udens")[0].title, "Šķērsgriezumi");
	assert.equal(hit("buvniec").length, 1, "a word beginning");
	assert.equal(hit("iesniegta").length, 2, "two messages say it");
	assert.match(hit("udens")[0].snippet, /\[ūdens\]/);
	assert.ok(hit("udens")[0].snippet.length < 160, "a short snippet");
	assert.equal(hit("kopsavilkums").length, 0, "a compaction summary is not a message");
	assert.equal(hit("bk-3").length, 1, "punctuation inside a word");
	for (const q of ["AND", "OR NOT", "*", '"', "a:b", "( )", "NEAR(", "-", "iecere AND"]) assert.doesNotThrow(() => hit(q), q);
	assert.equal(hit("iecere", { agent: "ARH" }).length, 0);
	assert.equal(hit("iecere", { agent: "lead" }).length, 1);
	assert.equal(hit("iecere", { threadId: b.id }).length, 0);
	assert.equal(hit("vajag", { from: "2026-11-20", to: "2026-11-20" }).length, 1, "to is the whole day");
	assert.equal(hit("vajag", { from: "2026-11-21" }).length, 0);
	assert.equal(hit("vajag", { to: "2026-11-19" }).length, 0);
	assert.equal(ftsMatch("  - "), null);

	// the tools server is another process: it reads the file without writing it, while the store holds it open
	const ctx: ToolCtx = { projectsDir: L.projectsDir, projectId: "BD999", dataDir: "", appDir: L.appDir, runDir: null, agent: "lead", thread: null };
	const tool = allTools().find((t) => t.name === "search_conversations");
	assert.ok(tool);
	assert.equal(tool.level, "read");
	assert.ok(tool.description.length < 200);
	const rows = tool.run(ctx, { query: "skersgriezums" }) as { thread: string; title: string; agent: string; at: string; snippet: string }[];
	assert.equal(rows[0].title, "Šķērsgriezumi");
	assert.equal(rows[0].agent, "ARH");
	assert.equal(rows[0].at, "2026-11-20T08:30:00.000Z");
	assert.match(String(tool.run(ctx, { query: "nekas tāds nav" })), /^no data/);
	assert.match(String(tool.run({ ...ctx, projectId: "BD000" }, { query: "iecere" })), /^no data/, "a project without a database");
});

test("export: JSONL round-trips, Markdown reads, the file name is safe", () => {
	const t = thread("th_x", "ARH", 'Plāni: 1/2 "A*"?', "2026-11-05T10:00:00.000Z");
	const entries = [entry("user", "Sveiki\notrā rinda", "2026-11-05T09:00:00.000Z", { attachments: [{ name: "plans.pdf", kind: "document" }] }), entry("assistant", "Atbilde", "2026-11-05T09:00:10.000Z"), entry("assistant", "Kopsavilkums", "2026-11-05T09:30:00.000Z", { kind: "compaction", tokens: { before: 9, after: 2 } })];
	const j = exportThread(t, entries, "jsonl");
	assert.match(j.fileName, /^[^\\/:*?"<>|]+\.jsonl$/);
	assert.deepEqual(j.text.trimEnd().split("\n").map((l) => JSON.parse(l)), entries);
	const m = exportThread(t, entries, "md");
	assert.ok(m.fileName.endsWith(".md") && m.fileName.includes("2026-11-01"));
	assert.match(m.text, /^# Plāni/);
	assert.match(m.text, /## Lietotājs · 2026-11-05 09:00 UTC/);
	assert.match(m.text, /## ARH · /);
	assert.match(m.text, /Pielikumi: plans\.pdf/);
	assert.match(m.text, /Saspiestās sarunas kopsavilkums/);
	assert.equal(exportThread(t, [], "jsonl").text, "");
	assert.equal(safeFileName("  ..  "), "saruna");
});

test("a damaged database is reported and never rewritten; the old files are not used in its place", () => {
	const L = layout();
	oldThread(L.dir, thread("th_a", "lead", "Saruna", "2026-11-05T10:00:00.000Z"), [entry("user", "vecs", "2026-11-05T09:00:00.000Z")]);
	const junk = Buffer.alloc(8192, 0x5a);
	writeFileSync(L.dbFile, junk);
	const old = snapshot(L.dir);

	const s = new ThreadStore(L.dir);
	assert.equal(s.health().kind, "damaged");
	assert.match(s.health().text ?? "", /bojāta/);
	assert.deepEqual(s.list(), [], "the app starts; the list is empty");
	assert.throws(() => s.transcript("th_a"), (e: unknown) => e instanceof ThreadsDbError && e.kind === "damaged");
	assert.throws(() => s.create({ projectId: "BD999", agent: "lead", title: "x", startedBy: "user" }), /bojāta/);
	assert.throws(() => s.append("th_a", entry("user", "x", "2026-11-06T00:00:00.000Z")), /bojāta/);
	assert.deepEqual(readFileSync(L.dbFile), junk, "the damaged file is byte for byte as it was");
	assert.deepEqual(snapshot(L.dir), old, "and nothing was written to the old files instead");
	assert.equal(existsSync(`${L.dbFile}-wal`), false);
});

test("a database with a broken page is damaged too (SQLite's own check says so)", () => {
	const L = layout();
	const s = new ThreadStore(L.dir);
	const t = s.create({ projectId: "BD999", agent: "lead", title: "Saruna", startedBy: "user" });
	for (let i = 0; i < 400; i++) s.append(t.id, entry("user", `ziņa ${i} ${"teksts ".repeat(20)}`, "2026-11-05T09:00:00.000Z"));
	s.close();
	for (const f of [`${L.dbFile}-wal`, `${L.dbFile}-shm`]) assert.equal(existsSync(f), false, "a clean close folds the log in");
	const bytes = readFileSync(L.dbFile);
	assert.ok(bytes.length > 3 * 4096);
	// overwrite pages 2 and 3 (table and index b-trees) with junk
	bytes.fill(0xff, 4096, 3 * 4096);
	writeFileSync(L.dbFile, bytes);
	const hurt = readFileSync(L.dbFile);

	const again = new ThreadStore(L.dir);
	assert.equal(again.health().kind, "damaged");
	assert.throws(() => again.append(t.id, entry("user", "x", "2026-11-06T00:00:00.000Z")), /bojāta/);
	assert.deepEqual(readFileSync(L.dbFile), hurt, "never rewritten");
});
