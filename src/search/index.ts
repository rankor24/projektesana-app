// Building the index inside one project's threads.db: cut the text into pieces, give each piece a vector, keep both up to date.
// Three steps that can each stop at any moment and be run again without redoing finished work:
//   1. syncSources   every source's page text (the scan keeps it per page in text\<sha>.json) becomes pieces, once per text-cache
//                    hash. A source whose text changed (OCR finished, a new issue replaced it) is re-cut; one that is no longer
//                    current is dropped with its vectors. Cheap: text only, no model.
//   2. syncMessages  every conversation message not seen before becomes pieces. A high-water mark (the largest message id seen)
//                    means a turn costs one query, not a pass over the whole history.
//   3. embedPending  every piece without a vector of the CURRENT model gets one, a small batch at a time, committed as it goes.
//                    Killing the app in the middle loses at most one batch; the next run picks up at the first piece without a vector.
// These are plain functions over an open connection, so the worker thread runs them in the background and a test runs them on a
// temporary database with a stub embedder.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { chunkText } from "./chunk.js";
import type { IndexStatus } from "../shared/search-types.js";
import type { Embedder } from "./embedder.js";

/** Raise when chunkText changes: every source is then re-cut on the next pass. */
export const CHUNK_VERSION = 1;

const metaGet = (db: DatabaseSync, key: string): string | null => {
	const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
	return r ? r.value : null;
};
const metaSet = (db: DatabaseSync, key: string, value: string): void => {
	db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

/** All or nothing, taking the write lock first (the app's own connection writes to the same file). */
function transaction<T>(db: DatabaseSync, fn: () => T): T {
	db.exec("BEGIN IMMEDIATE");
	try {
		const r = fn();
		db.exec("COMMIT");
		return r;
	} catch (e) {
		try {
			db.exec("ROLLBACK");
		} catch {
			// the failure already ended it
		}
		throw e;
	}
}

export interface SourceRef {
	id: string;
	title: string;
	/** the text-cache hash of the source's newest version */
	sha: string;
}

export interface SyncReport {
	added: number;
	removed: number;
	chunks: number;
}

const SRC = "search.src.";

/** Page text → pieces, for every current source. `readPages(sha)` gives the pages of one text cache, or null when there is none (no text layer, not read yet). */
export function syncSources(db: DatabaseSync, sources: SourceRef[], readPages: (sha: string) => string[] | null, now = new Date()): SyncReport {
	const rep: SyncReport = { added: 0, removed: 0, chunks: 0 };
	const live = new Map<string, SourceRef>();
	for (const s of sources) if (s.sha && !live.has(s.sha)) live.set(s.sha, s);
	const known = new Map<string, string>();
	for (const r of db.prepare("SELECT key, value FROM meta WHERE key LIKE ?").all(`${SRC}%`) as { key: string; value: string }[]) known.set(r.key.slice(SRC.length), r.value);

	for (const sha of known.keys()) {
		if (live.has(sha)) continue;
		transaction(db, () => {
			db.prepare("DELETE FROM chunks WHERE kind = 'source' AND sha = ?").run(sha);
			db.prepare("DELETE FROM meta WHERE key = ?").run(SRC + sha);
		});
		rep.removed++;
	}

	const insert = db.prepare("INSERT INTO chunks (kind, source, text, created_at, page, ord, sha, label) VALUES ('source', ?, ?, ?, ?, ?, ?, ?)");
	for (const [sha, s] of live) {
		const pages = readPages(sha);
		if (!pages) continue;
		const fp = `${CHUNK_VERSION}:${createHash("sha1").update(pages.join("\u0000")).digest("hex")}`;
		if (known.get(sha) === fp) {
			// same text: only a renamed source needs its title refreshed
			db.prepare("UPDATE chunks SET label = ?, source = ? WHERE kind = 'source' AND sha = ? AND (label IS NOT ? OR source IS NOT ?)").run(s.title, s.id, sha, s.title, s.id);
			continue;
		}
		transaction(db, () => {
			db.prepare("DELETE FROM chunks WHERE kind = 'source' AND sha = ?").run(sha);
			let n = 0;
			pages.forEach((text, i) => {
				chunkText(text).forEach((piece, ord) => {
					insert.run(s.id, piece, now.toISOString(), i + 1, ord, sha, s.title);
					n++;
				});
			});
			metaSet(db, SRC + sha, fp);
			rep.chunks += n;
		});
		rep.added++;
	}
	if (rep.added || rep.removed) metaSet(db, "search.updated_at", now.toISOString());
	return rep;
}

/** Messages written since the last pass → pieces. Returns how many pieces were made. */
export function syncMessages(db: DatabaseSync, now = new Date()): number {
	let hwm = Number(metaGet(db, "search.msg_hwm") ?? 0);
	let made = 0;
	const insert = db.prepare("INSERT INTO chunks (kind, message_id, thread_id, text, created_at, ord) VALUES ('message', ?, ?, ?, ?, ?)");
	for (;;) {
		const rows = db.prepare("SELECT id, thread_id, kind, text FROM messages WHERE id > ? ORDER BY id LIMIT 500").all(hwm) as { id: number; thread_id: string; kind: string; text: string }[];
		if (!rows.length) break;
		transaction(db, () => {
			for (const m of rows) {
				// a compaction note is the app's, not something anyone said
				if (m.kind !== "text") continue;
				chunkText(m.text).forEach((piece, ord) => {
					insert.run(m.id, m.thread_id, piece, now.toISOString(), ord);
					made++;
				});
			}
			hwm = rows[rows.length - 1].id;
			metaSet(db, "search.msg_hwm", String(hwm));
		});
	}
	if (made) metaSet(db, "search.updated_at", now.toISOString());
	return made;
}

const f32 = (v: Float32Array): Uint8Array => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

/** The vector a row holds, copied out aligned (the row's bytes may start anywhere in a bigger buffer). */
export function vectorOf(blob: Uint8Array): Float32Array {
	return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export interface EmbedOptions {
	/** pieces per model call and per commit */
	batch?: number;
	/** after each batch: done so far (this run) and what was waiting when the run started */
	onProgress?: (done: number, total: number) => void;
	/** checked between batches: true ends the run early (the rest waits for the next one) */
	stop?: () => boolean;
	/** a pause after each batch, as a share of the time the batch took: 0.3 means the CPU is busy about three quarters of the time */
	rest?: number;
}

export function pendingCount(db: DatabaseSync): number {
	return Number((db.prepare("SELECT COUNT(*) n FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL").get() as { n: number }).n);
}

/** Vectors made by another model are thrown away, and the index now belongs to `modelId`: two models' numbers cannot be compared. True when something had to go. */
export function adoptModel(db: DatabaseSync, modelId: string): boolean {
	const had = metaGet(db, "search.model");
	if (had === modelId) return false;
	transaction(db, () => {
		db.exec("DELETE FROM chunk_vectors");
		metaSet(db, "search.model", modelId);
	});
	return had !== null;
}

/** Vectors for every piece that has none. */
export async function embedPending(db: DatabaseSync, emb: Embedder, o: EmbedOptions = {}): Promise<{ done: number; left: number }> {
	adoptModel(db, emb.model);
	const batch = o.batch ?? 16;
	const total = pendingCount(db);
	let done = 0;
	const next = db.prepare("SELECT c.id AS id, c.text AS text FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL ORDER BY CASE c.kind WHEN 'message' THEN 0 ELSE 1 END, c.id LIMIT ?");
	const put = db.prepare("INSERT OR REPLACE INTO chunk_vectors (chunk_id, model, dims, vec) VALUES (?, ?, ?, ?)");
	while (!o.stop?.()) {
		const rows = next.all(batch) as { id: number; text: string }[];
		if (!rows.length) break;
		const t0 = Date.now();
		const vs = await emb.embed(
			rows.map((r) => r.text),
			"doc",
		);
		transaction(db, () => rows.forEach((r, i) => put.run(r.id, emb.model, vs[i].length, f32(vs[i]))));
		done += rows.length;
		metaSet(db, "search.updated_at", new Date().toISOString());
		o.onProgress?.(done, total);
		if (o.rest) await new Promise((r) => setTimeout(r, (Date.now() - t0) * o.rest!));
	}
	return { done, left: pendingCount(db) };
}

export function indexStatus(db: DatabaseSync): IndexStatus {
	const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
	const model = metaGet(db, "search.model");
	const emb = (kind: string) => n(`SELECT COUNT(*) n FROM chunks c JOIN chunk_vectors v ON v.chunk_id = c.id WHERE c.kind = '${kind}'`);
	const count = (kind: string) => n(`SELECT COUNT(*) n FROM chunks WHERE kind = '${kind}'`);
	const s = { chunks: count("source"), embedded: emb("source"), files: n("SELECT COUNT(DISTINCT sha) n FROM chunks WHERE kind = 'source'") };
	const m = { chunks: count("message"), embedded: emb("message") };
	return { model, chunks: s.chunks + m.chunks, embedded: s.embedded + m.embedded, sources: s, messages: m, updatedAt: metaGet(db, "search.updated_at") };
}

/** Throws every piece and vector away and forgets what was seen: the next run builds it all again (the Reindex button). Conversations themselves are untouched. */
export function resetIndex(db: DatabaseSync): void {
	transaction(db, () => {
		db.exec("DELETE FROM chunks");
		db.exec("DELETE FROM chunk_vectors");
		db.exec("DELETE FROM meta WHERE key LIKE 'search.%'");
	});
}
