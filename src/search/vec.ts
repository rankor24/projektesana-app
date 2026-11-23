// sqlite-vec: the nearest-neighbour search for the project's vectors, run inside SQLite instead of in a loop over every vector in JS.
// The search keeps working without it. The BLOBs in chunk_vectors stay the truth (a plain scan of them is the fallback in search.ts);
// the `chunk_vec` table made here is a copy of them in the form sqlite-vec reads, so every piece of code that cannot load the
// extension (an old build, a wrong path, another platform) still finds the same pieces, only slower.
//
// How the copy is kept in step with the BLOBs:
//   - a vector is written to both in the same transaction (embedPending), and a piece is removed from both before its row in
//     `chunks` goes (syncSources, syncUnits, resetIndex, adoptModel). Not by a trigger: a trigger that touches a vec0 table fails on
//     every connection that has not loaded the extension, and the app's own connection writes to this file too.
//   - `syncVec` makes the copy right whatever happened before: it creates the table, fills it from the BLOBs that have no row yet
//     (the migration for a project indexed before sqlite-vec was used) and drops rows whose piece is gone. The index worker runs it
//     at the start and the end of every run.
//   - a search checks that both hold the same number of rows before it trusts the copy; if not (a run was cut short on a connection
//     without the extension), it scans the BLOBs instead.
// The table is `vec0` with the vector size taken from the vectors themselves (a model with other dimensions replaces the table), cosine
// distance, and a partition key `grp` (source / message / memory / log): a question asks for the nearest pieces of one group, and the
// partition makes sqlite-vec search that group only, so no over-fetching and filtering afterwards.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TABLE = "chunk_vec";
/** Rows moved per transaction when the copy is filled. */
const FILL_BATCH = 500;

/** The kinds of `chunks` that one sqlite-vec group holds: decision and question notes are searched together as "log". */
export function groupOf(kind: string): string {
	return kind === "decision" || kind === "question" ? "log" : kind;
}

/** null = the extension is loaded in this connection; text = why it is not. */
const state = new WeakMap<DatabaseSync, string | null>();

/** The library file: sqlite-vec's own loader gives the path, and in the installed app (inside app.asar) the unpacked copy next to it, since a native library cannot be loaded from an asar. PROJEKTESANA_VEC_EXTENSION replaces the path (a copy somewhere else; the tests use it for a wrong one). */
export function vecLibraryPath(): string {
	const forced = process.env.PROJEKTESANA_VEC_EXTENSION;
	if (forced) return forced;
	const path = (createRequire(import.meta.url)("sqlite-vec") as { getLoadablePath(): string }).getLoadablePath();
	return path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
}

/** Loads sqlite-vec into an open connection (opened with `allowExtension: true`). Never throws: the answer is null (loaded) or the reason it did not. */
export function loadVec(db: DatabaseSync, path?: string): string | null {
	let reason: string | null = null;
	try {
		const file = path ?? vecLibraryPath();
		if (!existsSync(file)) throw new Error(`faila nav: ${file}`);
		db.loadExtension(file);
		db.prepare("SELECT vec_version()").get();
	} catch (e) {
		reason = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);
	}
	try {
		// loading is done: the SQL function load_extension() is not wanted on this connection
		db.enableLoadExtension(false);
	} catch {
		// the connection was not opened with allowExtension
	}
	state.set(db, reason);
	return reason;
}

/** Opens a database file with sqlite-vec loaded when it can be; the file opens either way. */
export function openWithVec(file: string, options: Record<string, unknown> = {}): DatabaseSync {
	const db = new DatabaseSync(file, { ...options, allowExtension: true } as ConstructorParameters<typeof DatabaseSync>[1]);
	loadVec(db);
	return db;
}

/** Why sqlite-vec is not loaded in this connection, or null when it is; undefined when loading was never tried. */
export function vecReason(db: DatabaseSync): string | null | undefined {
	return state.get(db);
}

export const vecLoaded = (db: DatabaseSync): boolean => state.get(db) === null;

/** The vector size of the table, or null when there is none. */
export function vecDims(db: DatabaseSync): number | null {
	const r = db.prepare("SELECT sql FROM sqlite_master WHERE name = ? AND type = 'table'").get(TABLE) as { sql: string } | undefined;
	const m = r ? /float\[(\d+)\]/.exec(r.sql) : null;
	return m ? Number(m[1]) : null;
}

/** A vector as the raw Float32 bytes the BLOB column and sqlite-vec take. */
export const f32 = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** The vector a row holds, copied out aligned (the row's bytes may start anywhere in a bigger buffer). */
export function vectorOf(blob: Uint8Array): Float32Array {
	return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

/** The table for vectors of `dims` numbers: made when missing, made again when it holds another size. */
function ensureTable(db: DatabaseSync, dims: number): void {
	const have = vecDims(db);
	if (have === dims) return;
	if (have !== null) db.exec(`DROP TABLE ${TABLE}`);
	db.exec(`CREATE VIRTUAL TABLE ${TABLE} USING vec0(grp text partition key, embedding float[${dims}] distance_metric=cosine)`);
}

/** Runs a write to the copy. A failure switches sqlite-vec off for this connection (with the reason) instead of stopping the indexing: the BLOBs are the truth, and the next run's syncVec repairs the copy. */
function guard(db: DatabaseSync, write: () => void): void {
	if (!vecLoaded(db)) return;
	try {
		write();
	} catch (e) {
		state.set(db, `vec0 rakstīšana neizdevās: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 160)}`);
	}
}

/** A vector into the copy, next to its BLOB (call inside the same transaction). No-op where the extension is not loaded. */
export function vecPut(db: DatabaseSync, chunkId: number, kind: string, vec: Float32Array): void {
	guard(db, () => {
		ensureTable(db, vec.length);
		// vec0 takes the row id as a BigInt only, and does not replace: the old row goes first
		db.prepare(`DELETE FROM ${TABLE} WHERE rowid = ?`).run(BigInt(chunkId));
		db.prepare(`INSERT INTO ${TABLE}(rowid, embedding, grp) VALUES (?, ?, ?)`).run(BigInt(chunkId), f32(vec), groupOf(kind));
	});
}

/** Removes the copies of the pieces `where` selects from `chunks` (call before the pieces themselves are deleted). */
export function vecDropWhere(db: DatabaseSync, where: string, ...params: (string | number)[]): void {
	guard(db, () => {
		if (vecDims(db) !== null) db.prepare(`DELETE FROM ${TABLE} WHERE rowid IN (SELECT id FROM chunks WHERE ${where})`).run(...params);
	});
}

/** Empties the copy (the BLOBs are being emptied too). */
export function vecClear(db: DatabaseSync): void {
	guard(db, () => {
		if (vecDims(db) !== null) db.exec(`DELETE FROM ${TABLE}`);
	});
}

/** Makes the copy equal to the BLOBs: creates the table, adds the vectors that have no row, drops the rows whose vector is gone. Returns how many rows were added. */
export function syncVec(db: DatabaseSync): number {
	if (!vecLoaded(db)) return 0;
	const first = db.prepare("SELECT dims FROM chunk_vectors LIMIT 1").get() as { dims: number } | undefined;
	if (!first) {
		if (vecDims(db) !== null) db.exec(`DELETE FROM ${TABLE}`);
		return 0;
	}
	let added = 0;
	db.exec("BEGIN IMMEDIATE");
	try {
		ensureTable(db, Number(first.dims));
		db.exec(`DELETE FROM ${TABLE} WHERE rowid NOT IN (SELECT chunk_id FROM chunk_vectors)`);
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
	const missing = db.prepare(`SELECT v.chunk_id AS id, v.vec AS vec, c.kind AS kind FROM chunk_vectors v JOIN chunks c ON c.id = v.chunk_id WHERE v.dims = ? AND v.chunk_id NOT IN (SELECT rowid FROM ${TABLE}_rowids) LIMIT ?`);
	for (;;) {
		const rows = missing.all(Number(first.dims), FILL_BATCH) as { id: number; vec: Uint8Array; kind: string }[];
		if (!rows.length) break;
		db.exec("BEGIN IMMEDIATE");
		try {
			for (const r of rows) vecPut(db, Number(r.id), r.kind, vectorOf(r.vec));
			db.exec("COMMIT");
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
		added += rows.length;
	}
	return added;
}

const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);

/** Whether a search may use the copy: the extension is loaded, the table is there for this vector size, and it holds a row for each BLOB. */
export function vecUsable(db: DatabaseSync, dims: number): boolean {
	if (!vecLoaded(db) || vecDims(db) !== dims) return false;
	try {
		return count(db, `SELECT COUNT(*) n FROM ${TABLE}_rowids`) === count(db, "SELECT COUNT(*) n FROM chunk_vectors");
	} catch {
		return false;
	}
}

/** The nearest pieces of the given kinds to `q`, best first, with their cosine similarity; null when the copy cannot be used (the caller scans the BLOBs). */
export function vecNearest(db: DatabaseSync, q: Float32Array, kinds: string[], limit: number): { id: number; sim: number }[] | null {
	if (!vecUsable(db, q.length)) return null;
	try {
		const knn = db.prepare(`SELECT rowid AS id, distance FROM ${TABLE} WHERE embedding MATCH ? AND k = ? AND grp = ?`);
		const out: { id: number; sim: number }[] = [];
		for (const g of new Set(kinds.map(groupOf))) for (const r of knn.all(f32(q), limit, g) as { id: number; distance: number }[]) out.push({ id: Number(r.id), sim: 1 - Number(r.distance) });
		return out.sort((a, b) => b.sim - a.sim).slice(0, limit);
	} catch {
		return null;
	}
}

/** What the Avoti page says about the search: which engine answers, and why not sqlite-vec when it is not. */
export function vecEngine(db: DatabaseSync): { engine: "sqlite-vec" | "js"; note?: string } {
	const why = state.get(db);
	if (why === undefined) return { engine: "js", note: "nav mēģināts ielādēt" };
	if (why !== null) return { engine: "js", note: why };
	const dims = vecDims(db);
	if (dims === null) return { engine: "js", note: "vec0 tabula vēl nav uzbūvēta" };
	return vecUsable(db, dims) ? { engine: "sqlite-vec" } : { engine: "js", note: "vec0 tabula vēl nav sinhronizēta ar vektoriem" };
}
