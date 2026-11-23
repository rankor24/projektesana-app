// 17.3 sqlite-vec: the vector side of the project search runs in a vec0 table when the extension loads, and finds the same pieces as
// the plain scan of the stored vectors. A stub embedder (each word a fixed direction) builds a small index; the tests compare the
// top pieces of the two engines, the migration that fills the vec0 table from vectors stored before it existed, and the fallback
// when the extension path is wrong.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ThreadsDb } from "../src/core/threads-db.ts";
import type { Embedder } from "../src/search/embedder.ts";
import { embedPending, indexStatus, syncUnits } from "../src/search/index.ts";
import { searchDbFile } from "../src/search/query.ts";
import { ensureSearchSchema } from "../src/search/schema.ts";
import { nearest, searchProject } from "../src/search/search.ts";
import { loadVec, openWithVec, syncVec, vecDims, vecLoaded, vecNearest, vecUsable } from "../src/search/vec.ts";
import { tmp } from "./helpers.ts";

function stub(): Embedder {
	const word = (w: string) => {
		let h = 2166136261;
		for (const ch of w) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
		return Math.abs(h) % 32;
	};
	return {
		model: "stub-1",
		dims: 32,
		async embed(texts) {
			return texts.map((t) => {
				const v = new Float32Array(32);
				for (const w of t.toLowerCase().match(/\p{L}+|\d+/gu) ?? []) v[word(w)] += 1;
				const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
				return v.map((x) => x / n);
			});
		},
	};
}

const TEXTS = ["betona siena un jumta plāksne", "ugunsdrošības prasības evakuācijas ceļiem", "ventilācijas gaisa vads un skaņas slāpētājs", "kāpņu telpa ar dūmu vārstu", "apkures caurules un siltummezgls", "durvju kontrolieris un piekļuves sistēma", "elektrības sadalne un kabeļu trases", "ugunsdrošas durvis kāpņu telpā"];

/** A project database with eight memory pieces and one decision, vectors made by the stub, the extension loaded when `withVec`. */
async function index(withVec: boolean) {
	const file = join(tmp(), "threads.db");
	ThreadsDb.open(file).close();
	const db = withVec ? openWithVec(file) : new DatabaseSync(file);
	ensureSearchSchema(db);
	syncUnits(
		db,
		"memory",
		TEXTS.map((text, i) => ({ key: `m${i}`, sha: `s${i}`, label: `Atmiņa ${i}`, text })),
	);
	syncUnits(db, "decision", [{ key: "d1", sha: "d1", label: "Lēmums", text: "ugunsdrošības durvis kāpņu telpā" }]);
	await embedPending(db, stub(), {});
	return { file, db };
}

test("sqlite-vec loads in this Node, and vec0 holds one row per stored vector", async () => {
	const { db } = await index(true);
	assert.equal(vecLoaded(db), true, "the extension did not load");
	syncVec(db);
	assert.equal(vecDims(db), 32);
	assert.equal(vecUsable(db, 32), true);
	assert.equal(indexStatus(db).vector.engine, "sqlite-vec");
	db.close();
});

test("vec0 and the plain scan give the same top pieces, kind by kind", async () => {
	const { db } = await index(true);
	const q = (await stub().embed(["ugunsdrošas durvis kāpņu telpā"], "query"))[0];
	for (const kind of [["memory"], ["decision", "question"], ["memory", "decision"]]) {
		const fast = nearest(db, q, "stub-1", kind, 5, true);
		const scan = nearest(db, q, "stub-1", kind, 5, false);
		assert.deepEqual(
			fast.map((r) => r.id),
			scan.map((r) => r.id),
			`kinds ${kind}`,
		);
		fast.forEach((r, i) => assert.ok(Math.abs(r.sim - scan[i].sim) < 1e-4, "the similarity is the same cosine"));
	}
	assert.ok(vecNearest(db, q, ["memory"], 3), "vec0 answered");
	const hybrid = await searchProject(db, { query: "ugunsdrošas durvis", kind: "memory", limit: 5, embedder: stub() });
	const js = await searchProject(db, { query: "ugunsdrošas durvis", kind: "memory", limit: 5, embedder: stub(), engine: "js" });
	assert.equal(hybrid.engine, "sqlite-vec");
	assert.equal(js.engine, "js");
	assert.deepEqual(
		hybrid.hits.map((h) => h.text),
		js.hits.map((h) => h.text),
	);
	db.close();
});

test("a project indexed before sqlite-vec is migrated: vec0 is filled from the BLOBs, and a removed piece leaves it", async () => {
	const { file, db } = await index(false);
	db.close();
	const d = openWithVec(file);
	assert.equal(vecDims(d), null, "no vec0 table yet");
	assert.equal(indexStatus(d).vector.engine, "js");
	assert.equal(syncVec(d), 9);
	assert.equal(vecUsable(d, 32), true);
	assert.equal(syncVec(d), 0, "a second run adds nothing");
	// a piece deleted without the extension leaves a row behind; syncVec drops it, and until then the search does not trust the copy
	const plain = new DatabaseSync(file);
	plain.exec("DELETE FROM chunks WHERE id = (SELECT MIN(id) FROM chunks)");
	plain.close();
	assert.equal(vecUsable(d, 32), false);
	syncVec(d);
	assert.equal(vecUsable(d, 32), true);
	d.close();
});

test("a wrong extension path: the connection opens, the reason is kept, the search answers by the scan", async () => {
	const { file } = await index(true);
	const db = new DatabaseSync(file, { allowExtension: true } as ConstructorParameters<typeof DatabaseSync>[1]);
	const why = loadVec(db, join(tmp(), "nav-tāda-vec0.dll"));
	assert.ok(why, "the failure is reported");
	assert.equal(vecLoaded(db), false);
	assert.equal(syncVec(db), 0, "nothing is written to the copy");
	assert.equal(indexStatus(db).vector.engine, "js");
	assert.match(indexStatus(db).vector.note ?? "", /nav/);
	db.close();
	process.env.PROJEKTESANA_VEC_EXTENSION = join(tmp(), "nav-tāda-vec0.dll");
	try {
		const r = await searchDbFile(file, tmp(), { query: "ugunsdrošas durvis", kind: "memory", limit: 3 }, async () => stub());
		assert.ok(r && r.hits.length > 0, "keyword and scan still find pieces");
		assert.equal(r.engine, "js");
	} finally {
		delete process.env.PROJEKTESANA_VEC_EXTENSION;
	}
});

test("the read-only connection of a search loads the extension and answers from vec0", async () => {
	const { file, db } = await index(true);
	db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('search.model', 'stub-1')").run();
	db.close();
	const r = await searchDbFile(file, tmp(), { query: "ugunsdrošas durvis", kind: "memory", limit: 3 }, async () => stub());
	assert.ok(r && r.hits.length > 0);
	assert.equal(r.mode, "hybrid");
	assert.equal(r.engine, "sqlite-vec");
});
