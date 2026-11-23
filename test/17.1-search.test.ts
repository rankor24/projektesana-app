// 17.1 project search: cutting text into pieces, the index built step by step in a project's threads.db (incremental, resumable,
// one model at a time), hybrid search with Reciprocal Rank Fusion, the migration that adds the tables, the background worker, and the
// agent's search_project. No model is loaded: a stub embedder gives each word a fixed direction, so texts that share words point the
// same way (enough to see the merge and the bookkeeping work; how good the real models are is measured separately, see embedder.ts).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { ThreadsDb } from "../src/core/threads-db.ts";
import { chunkText, CHUNK_MIN, tidy } from "../src/search/chunk.ts";
import type { Embedder } from "../src/search/embedder.ts";
import { adoptModel, embedPending, indexStatus, pendingCount, resetIndex, syncMessages, syncSources } from "../src/search/index.ts";
import { SearchIndexer } from "../src/search/manager.ts";
import { searchDbFile } from "../src/search/query.ts";
import { ensureSearchSchema, hasSearchSchema, INDEX_SCHEMA_VERSION } from "../src/search/schema.ts";
import { ftsAny, rrf, searchProject } from "../src/search/search.ts";
import type { Thread } from "../src/shared/thread-types.ts";
import { tmp } from "./helpers.ts";

/** Each word gets a fixed direction in 32 dimensions; a text is the sum of its words, made unit length. */
function stub(model = "stub-1"): Embedder & { calls: string[][] } {
	const calls: string[][] = [];
	const word = (w: string) => {
		let h = 2166136261;
		for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
		return Math.abs(h) % 32;
	};
	return {
		model,
		dims: 32,
		calls,
		async embed(texts) {
			calls.push(texts);
			return texts.map((t) => {
				const v = new Float32Array(32);
				for (const w of t.toLowerCase().match(/\p{L}+|\d+/gu) ?? []) v[word(w)] += 1;
				const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
				return v.map((x) => x / n);
			});
		},
	};
}

const thread = (id: string, title: string): Thread => ({ id, projectId: "BD999", agent: "lead", title, topic: null, state: "idle", startedBy: "user", wave: null, createdAt: "2026-11-01T08:00:00.000Z", lastAt: "2026-11-02T08:00:00.000Z", runs: 1 });

function project() {
	const dir = tmp();
	const file = join(dir, "threads.db");
	const tdb = ThreadsDb.open(file);
	const raw = new DatabaseSync(file);
	raw.exec("PRAGMA journal_mode = WAL");
	return { dir, file, tdb, raw };
}

const PAGES: Record<string, string[]> = {
	aaa: ["Zemes vienības kadastra apzīmējums ir 01000170062, kopējā platība 2.1628 ha.", "Siltumapgādes piederības robeža ir siltumkameras ārējā siena."],
	bbb: ["Apdrošināšanas polises jāiesniedz 14 dienu laikā pēc līguma spēkā stāšanās.\n\nProjektēšanas termiņš ir divi mēneši."],
};
const sources = [
	{ id: "s_1", title: "Zemes robežu plāns", sha: "aaa" },
	{ id: "s_2", title: "Apdrošināšanas prasības", sha: "bbb" },
];
const read = (sha: string) => PAGES[sha] ?? null;

test("chunkText: a long page is cut at sentence ends with a little overlap, short scraps are dropped, spaces are folded", () => {
	assert.equal(tidy("a  b\t\tc\r\n\n\n d"), "a b c\nd");
	assert.deepEqual(chunkText("kurzs"), []);
	assert.equal(chunkText("x".repeat(CHUNK_MIN - 1)).length, 0);
	const sentence = "Būvprojekta daļu izstrādā atbilstoši tehniskajai specifikācijai. ";
	const page = sentence.repeat(60);
	const pieces = chunkText(page, 500, 80);
	assert.ok(pieces.length > 4);
	for (const p of pieces) assert.ok(p.length <= 500, `piece of ${p.length}`);
	for (const p of pieces.slice(0, -1)) assert.match(p, /\.$/, "cut at a sentence end");
	// the overlap: each piece starts with words that ended the one before
	const tail = pieces[0].slice(-60);
	assert.ok(pieces[1].includes(tail.split(" ").slice(-3).join(" ")), "the next piece repeats the end of the one before");
	// nothing lost: every sentence is whole in at least one piece
	assert.ok(pieces.some((p) => p.includes(sentence.trim())));
});

test("ftsAny: the question's content words, ORed, each quoted; question words and short words dropped; codes exact", () => {
	assert.equal(ftsAny("Kāds ir zemes vienības kadastra apzīmējums?"), '"zeme"* OR "vienīb"* OR "kadast"* OR "apzīmēju"*');
	assert.equal(ftsAny("Kāds ir iepirkuma numurs AK-41?"), '"iepirku"* OR "numu"* OR "AK-41"');
	assert.equal(ftsAny("kas ir"), null);
	assert.equal(ftsAny('NOT "x" AND *'), '"NOT"', "operators are words, not syntax: nothing is left to break the query");
});

test("rrf: a passage both lists rank beats one that only a single list ranks; the merge uses ranks only", () => {
	const s = rrf([
		["a", "b", "c"],
		["c", "b", "d"],
	]);
	const order = [...s.entries()].sort((x, y) => y[1] - x[1]).map((e) => e[0]);
	// c: 3rd of one list and 1st of the other; b: 2nd of both (a hair less); a and d appear in one list each
	assert.deepEqual(order, ["c", "b", "a", "d"]);
	assert.ok(Math.abs(s.get("a")! - 1 / 61) < 1e-12);
	assert.ok(Math.abs(s.get("b")! - (1 / 62 + 1 / 62)) < 1e-12);
	assert.equal(rrf([[], []]).size, 0);
	// a weight scales one list's share: the 1st of a half-weight list is worth less than the 1st of a full one
	const w = rrf([["x"], ["y"]], 60, [1, 0.5]);
	assert.ok(w.get("x")! > w.get("y")!);
	assert.ok(Math.abs(w.get("y")! - 0.5 / 61) < 1e-12);
});

test("migration: adds the columns and tables once, never lowers user_version, is safe to run again and on an older file", () => {
	const dir = tmp();
	const file = join(dir, "old.db");
	// a database as the previous version left it: chunks without the new columns, user_version 1
	const old = new DatabaseSync(file);
	old.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER, thread_id TEXT, kind TEXT NOT NULL, source TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO chunks(kind, text, created_at) VALUES ('source', 'veca rinda', 'x'); PRAGMA user_version = 1;");
	assert.equal(hasSearchSchema(old), false);
	ensureSearchSchema(old);
	ensureSearchSchema(old);
	assert.equal(hasSearchSchema(old), true);
	assert.equal((old.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, INDEX_SCHEMA_VERSION);
	assert.equal((old.prepare("SELECT COUNT(*) n FROM chunks_fts WHERE chunks_fts MATCH 'veca'").get() as { n: number }).n, 1, "rows that were there are in the new full-text index");
	// another feature moved the version further: this migration leaves it
	old.exec("PRAGMA user_version = 9");
	ensureSearchSchema(old);
	assert.equal((old.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 9);
	old.close();
	// the app's own open does the same, and a conversation database keeps working
	const p = project();
	assert.equal(hasSearchSchema(p.raw), true);
	assert.ok(Number((p.raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version) >= INDEX_SCHEMA_VERSION);
	p.tdb.close();
	p.raw.close();
});

test("index: sources and messages become pieces and vectors; a second pass does no work; only what is new is embedded", async () => {
	const p = project();
	p.tdb.insert(thread("t1", "Zemes dokumenti"));
	p.tdb.append("t1", { role: "user", text: "Kāds ir zemes kadastra apzīmējums?", at: "2026-11-02T08:00:00.000Z" });
	p.tdb.append("t1", { role: "assistant", text: "Zemes vienības kadastra apzīmējums ir 01000170062.", at: "2026-11-02T08:00:05.000Z" });
	const e = stub();

	const r1 = syncSources(p.raw, sources, read);
	assert.equal(r1.added, 2);
	assert.equal(syncMessages(p.raw), 2);
	assert.equal(pendingCount(p.raw), 5);
	const done = await embedPending(p.raw, e, { batch: 2 });
	assert.deepEqual(done, { done: 5, left: 0 });
	assert.deepEqual(e.calls.map((c) => c.length), [2, 2, 1], "small batches, committed one by one");
	const st = indexStatus(p.raw);
	assert.equal(st.model, "stub-1");
	assert.deepEqual([st.chunks, st.embedded, st.sources.files, st.messages.chunks], [5, 5, 2, 2]);

	// nothing changed: nothing is cut again, nothing is embedded
	e.calls.length = 0;
	assert.equal(syncSources(p.raw, sources, read).added, 0);
	assert.equal(syncMessages(p.raw), 0);
	assert.deepEqual(await embedPending(p.raw, e), { done: 0, left: 0 });
	assert.equal(e.calls.length, 0);

	// a turn: one new message, one new piece, one embedding call with just that text
	p.tdb.append("t1", { role: "user", text: "Un kāda ir siltumapgādes piederības robeža?", at: "2026-11-02T09:00:00.000Z" });
	assert.equal(syncMessages(p.raw), 1);
	await embedPending(p.raw, e);
	assert.equal(e.calls.length, 1);
	assert.deepEqual(e.calls[0], ["Un kāda ir siltumapgādes piederības robeža?"]);
	p.tdb.close();
	p.raw.close();
});

test("index: changed text is cut again, a renamed source keeps its vectors, a source that is gone takes its pieces and vectors with it", async () => {
	const p = project();
	const e = stub();
	syncSources(p.raw, sources, read);
	await embedPending(p.raw, e);
	const before = indexStatus(p.raw);
	// a rename: the same text, a new title (the citation follows, no new vectors)
	syncSources(p.raw, [{ ...sources[0], title: "Zemes robežu plāns (2013)" }, sources[1]], read);
	assert.equal(pendingCount(p.raw), 0);
	assert.equal((p.raw.prepare("SELECT label FROM chunks WHERE sha = 'aaa' LIMIT 1").get() as { label: string }).label, "Zemes robežu plāns (2013)");
	// OCR finished for a page: the text of that hash changed, its pieces are made again, only those are embedded
	const changed = { ...PAGES, aaa: [...PAGES.aaa, "Trešā lapa: jauns teksts par ūdensvadu un kanalizāciju."] };
	assert.equal(syncSources(p.raw, sources, (s) => changed[s] ?? null).added, 1);
	assert.ok(pendingCount(p.raw) >= 1);
	e.calls.length = 0;
	await embedPending(p.raw, e);
	assert.ok(e.calls.flat().every((t) => /\p{L}/u.test(t)));
	// a source that is no longer in the project
	const gone = syncSources(p.raw, [sources[1]], read);
	assert.equal(gone.removed, 1);
	assert.equal(indexStatus(p.raw).sources.files, 1);
	assert.equal(Number((p.raw.prepare("SELECT COUNT(*) n FROM chunk_vectors").get() as { n: number }).n), indexStatus(p.raw).chunks, "no vector without its piece");
	assert.ok(before.chunks > indexStatus(p.raw).chunks - 5);
	p.tdb.close();
	p.raw.close();
});

test("index: a stopped run resumes where it stopped; another model throws the old vectors away; reset empties the index", async () => {
	const p = project();
	syncSources(p.raw, sources, read);
	const e = stub();
	let batches = 0;
	const first = await embedPending(p.raw, e, { batch: 1, stop: () => batches++ >= 2 });
	assert.equal(first.done, 2);
	assert.equal(first.left, 1);
	const second = await embedPending(p.raw, e, { batch: 1 });
	assert.deepEqual(second, { done: 1, left: 0 });
	assert.equal(e.calls.flat().length, 3, "each piece was embedded exactly once");
	// the model changes: its vectors are not comparable, so all are made again
	assert.equal(adoptModel(p.raw, "stub-2"), true);
	assert.equal(pendingCount(p.raw), 3);
	await embedPending(p.raw, stub("stub-2"));
	assert.equal(indexStatus(p.raw).model, "stub-2");
	assert.equal(indexStatus(p.raw).embedded, 3);
	resetIndex(p.raw);
	assert.deepEqual([indexStatus(p.raw).chunks, indexStatus(p.raw).model], [0, null]);
	p.tdb.close();
	p.raw.close();
});

test("search: words and meaning merge; a passage names its source and page, a message its thread and day; kinds filter; no model = words only", async () => {
	const p = project();
	p.tdb.insert(thread("t1", "Zemes dokumenti"));
	p.tdb.append("t1", { role: "assistant", text: "Zemes vienības kadastra apzīmējums ir 01000170062.", at: "2026-11-02T08:00:05.000Z" });
	p.tdb.append("t1", { role: "user", text: "Paldies, un kā ar apdrošināšanu?", at: "2026-11-02T08:01:00.000Z" });
	syncSources(p.raw, sources, read);
	syncMessages(p.raw);
	const e = stub();
	await embedPending(p.raw, e);

	const all = await searchProject(p.raw, { query: "Kāds ir zemes vienības kadastra apzīmējums?", embedder: e });
	assert.equal(all.mode, "hybrid");
	assert.equal(all.hits[0].via.length, 2, "found by the words and by the meaning");
	const src = all.hits.find((h) => h.kind === "source")!;
	assert.equal(src.citation, "Zemes robežu plāns, lpp. 1");
	assert.equal(src.sourceId, "s_1");
	assert.match(src.text, /01000170062/);
	const msg = all.hits.find((h) => h.kind === "conversation")!;
	assert.equal(msg.citation, "Zemes dokumenti, 2026-11-02 (lead)");
	assert.equal(msg.threadId, "t1");

	const onlySources = await searchProject(p.raw, { query: "apdrošināšanas polises", kind: "sources", embedder: e });
	assert.ok(onlySources.hits.length > 0 && onlySources.hits.every((h) => h.kind === "source"));
	assert.equal(onlySources.hits[0].citation, "Apdrošināšanas prasības, lpp. 1");
	const onlyChat = await searchProject(p.raw, { query: "apdrošināšanu", kind: "conversations", embedder: e });
	assert.ok(onlyChat.hits.length > 0 && onlyChat.hits.every((h) => h.kind === "conversation"));

	// an exact code that the meaning side cannot weigh is found by the words
	const code = await searchProject(p.raw, { query: "01000170062", kind: "sources", embedder: e });
	assert.equal(code.hits[0].sourceId, "s_1");
	assert.ok(code.hits[0].via.includes("keyword"));

	// no model: keywords only, said so in the note
	const words = await searchProject(p.raw, { query: "piederības robeža", embedder: null, embedderNote: "modelis nav lejupielādēts" });
	assert.equal(words.mode, "keyword");
	assert.match(words.note ?? "", /nav lejupielādēts/);
	assert.match(words.hits[0].text, /robeža/);
	// vectors made by another model are not mixed in
	const other = await searchProject(p.raw, { query: "piederības robeža", embedder: stub("stub-9") });
	assert.equal(other.mode, "keyword");
	p.tdb.close();
	p.raw.close();
});

test("searchDbFile and the search_project tool: read-only, citations, and an honest answer before anything is indexed", async () => {
	const p = project();
	syncSources(p.raw, sources, read);
	p.tdb.close();
	p.raw.close();
	const direct = await searchDbFile(p.file, join(p.dir, "models"), { query: "robeža siltumkameras" }, async () => null);
	assert.equal(direct!.mode, "keyword");
	assert.equal(direct!.hits[0].citation, "Zemes robežu plāns, lpp. 2");
	assert.equal(await searchDbFile(join(p.dir, "none.db"), p.dir, { query: "x" }, async () => null), null);

	// the tool, the way the tools server runs it: threads.db sits at <projects>\<id>\threads.db
	const appDir = tmp();
	const projectsDir = join(appDir, "projects");
	mkdirSync(join(projectsDir, "BD999"), { recursive: true });
	const ctx = { appDir, projectsDir, projectId: "BD999", dataDir: appDir, runDir: null, agent: null, thread: null } as ToolCtx;
	const t = allTools().find((x) => x.name === "search_project")!;
	assert.equal(t.level, "read");
	assert.ok(t.description.length < 260, "a short description");
	assert.match(String(await t.run(ctx, { query: "zemes kadastra" })), /^no data/, "no database yet");
	const db2 = ThreadsDb.open(join(projectsDir, "BD999", "threads.db"));
	const raw = new DatabaseSync(join(projectsDir, "BD999", "threads.db"));
	syncSources(raw, sources, read);
	raw.close();
	db2.close();
	const out = (await t.run(ctx, { query: "kadastra apzīmējums zemes vienības" })) as { note?: string; passages: { citation: string; text: string; source?: string; page?: number }[] };
	assert.equal(out.passages[0].citation, "Zemes robežu plāns, lpp. 1");
	assert.equal(out.passages[0].source, "s_1");
	assert.match(out.note ?? "", /atslēgvārdiem/, "says it fell back to the words");
	assert.match(String(await t.run(ctx, { query: "ķirbis tomāts" })), /^no data: nekas neatbilst/);
});

test("the background worker builds the pieces of a project and reports idle (no model needed when there is nothing to embed)", async () => {
	const appDir = tmp();
	const projectsDir = join(appDir, "projects");
	mkdirSync(join(projectsDir, "BD999", "text"), { recursive: true });
	// one source whose text file has no readable text: pieces are made from nothing, so no model is asked for
	writeFileSync(join(projectsDir, "BD999", "text", "eee.json"), JSON.stringify({ pages: ["."], state: "ok" }));
	const seen: string[] = [];
	const ix = new SearchIndexer({ appDir, projectsDir, sources: () => [{ id: "s_9", title: "Tukšs", sha: "eee" }], emit: (s) => seen.push(`${s.state}${s.phase ? `:${s.phase}` : ""}`), log: () => {}, delayMs: 0 });
	ix.request("BD999", "update", 0);
	const t0 = Date.now();
	while (!(seen.includes("running:pieces") && seen[seen.length - 1] === "idle") && Date.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 50));
	assert.ok(seen.includes("running:pieces"), seen.join(","));
	assert.equal(seen[seen.length - 1], "idle");
	const s = ix.status("BD999");
	assert.equal(s.state, "idle");
	assert.equal(s.error, undefined);
	assert.equal(s.index?.chunks, 0);
	assert.equal(s.model.downloaded, false);
	await ix.dispose();
});
