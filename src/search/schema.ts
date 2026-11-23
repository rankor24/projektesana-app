// The tables the search index adds to a project's threads.db, as a migration of its own.
// Why here and not in threads-db.ts's big SCHEMA string: the conversations schema is another feature's, and a second feature
// (pinned threads) adds columns to it too. A migration that checks what is already there (table_info, sqlite_master) instead of
// trusting a version number cannot be undone or skipped by the other one, whatever order they ran in. `user_version` is only
// ever raised (to INDEX_SCHEMA_VERSION when it is lower), never set back, so a database another version moved further keeps its number.
//
// What is added next to the existing `chunks` table (which was reserved for exactly this, see threads-db.ts):
//   chunks.page / ord / sha / label   where a piece of a source came from: its page, its number on the page, the text-cache hash of
//                                     the version it was cut from, and the source's title (for the citation)
//   chunks_fts                        full-text index over chunks.text, same tokenizer as messages_fts (diacritics folded)
//   chunk_vectors                     one row per piece: the model that made it, its size, and the vector as raw Float32 bytes
// Triggers keep chunks_fts in step and remove a piece's vector with the piece.
// The sqlite-vec copy of the vectors (table chunk_vec, vec0) is not made here: it needs the extension, which this connection may not
// have loaded. src/search/vec.ts creates and fills it (index worker), and a search that cannot use it scans chunk_vectors.
import type { DatabaseSync } from "node:sqlite";

export const INDEX_SCHEMA_VERSION = 2;

const COLUMNS: [string, string][] = [
	["page", "INTEGER"],
	["ord", "INTEGER"],
	["sha", "TEXT"],
	["label", "TEXT"],
];

export function ensureSearchSchema(db: DatabaseSync): void {
	const has = (name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name) !== undefined;
	const cols = new Set((db.prepare("PRAGMA table_info(chunks)").all() as { name: string }[]).map((c) => c.name));
	for (const [name, type] of COLUMNS) {
		if (cols.has(name)) continue;
		try {
			db.exec(`ALTER TABLE chunks ADD COLUMN ${name} ${type}`);
		} catch (e) {
			// the app and the index worker open the same file; whichever got there second finds the column already added
			if (!/duplicate column/i.test(String((e as Error).message))) throw e;
		}
	}
	const fresh = !has("chunks_fts");
	db.exec(`
		CREATE INDEX IF NOT EXISTS chunks_sha ON chunks(sha);
		CREATE INDEX IF NOT EXISTS chunks_kind ON chunks(kind, id);
		CREATE TABLE IF NOT EXISTS chunk_vectors (
			chunk_id INTEGER PRIMARY KEY,
			model TEXT NOT NULL,
			dims INTEGER NOT NULL,
			vec BLOB NOT NULL
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
		CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
			INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
		END;
		CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
			INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
			DELETE FROM chunk_vectors WHERE chunk_id = old.id;
		END;
		CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
			INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
			INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
		END;
	`);
	// an index created over a table that already has rows must be filled once
	if (fresh && (db.prepare("SELECT 1 FROM chunks LIMIT 1").get() as unknown) !== undefined) db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
	const v = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
	if (v < INDEX_SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${INDEX_SCHEMA_VERSION}`);
}

/** True when the tables exist: a database opened read-only by an older build, or one the app has not opened since the update, has none. */
export function hasSearchSchema(db: DatabaseSync): boolean {
	return db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vectors'").get() !== undefined && db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chunks_fts'").get() !== undefined;
}
