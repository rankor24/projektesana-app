// One project's conversations in one SQLite file (threads.db), with a full-text index over the message text.
// Why: a folder per thread with a transcript file each cannot be searched across threads, and a list of hundreds of threads
// meant reading hundreds of small files. One file is one thing to back up, and its write-ahead log keeps it sound when the
// app dies mid-write. Project state (registers, logs, facts, deliveries) stays in files; only conversations live here.
//
// Ported from OpenMausBot (Apache-2.0), adapted logically:
//   server/message-db.ts            open(): WAL + synchronous NORMAL, one `messages` table, `messages_fts` kept in step by
//                                   triggers, snippet()/bm25() search, every query token quoted so FTS5 never parses operators
//   server/doctor/checks/messages-db.ts  quickCheck(): SQLite's own verdict, read-only; only CORRUPT / NOTADB mean "damaged",
//                                   a file that cannot be opened is "not checked"; a damaged file is reported, never rewritten;
//                                   no check above START_CHECK_MAX_BYTES at start
// Left out: server/cjk-search.ts (Chinese/Japanese word splitting, not needed for Latvian), the write-ahead-log checkpoint fix,
// thread_state / followups / notification tables. Changed: the tokenizer is `unicode61 remove_diacritics 2`, so ā, š, ž, ķ ...
// match the plain letters; and a plain word is searched by its beginning, because Latvian endings change
// (būvniecība, būvniecības, būvniecību): see ftsMatch.
//
// What is not built yet (D10): embeddings. The `chunks` table is the place for them: one row per piece of text that gets a
// vector later (a message, a memory, a source page), keyed to its message; the vectors themselves go in a table of their own
// next to it, so nothing here changes when they arrive.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { ChatEntry } from "../shared/api.js";
import type { Thread } from "../shared/thread-types.js";

/** Above this size the check at open is skipped: it reads the whole file, and the app waits on it. */
export const START_CHECK_MAX_BYTES = 256 * 1024 * 1024;
const BUSY_TIMEOUT_MS = 5000;
/** SQLITE_CORRUPT and SQLITE_NOTADB: the only result codes that say the file itself is damaged. */
const DAMAGED_CODES = new Set([11, 26]);

/** The folder a thread's old files live in is `<project>\threads`; the database sits beside it. The project-less store keeps its old folder `threads\_` and the database inside it. */
export function threadsDbFile(dir: string): string {
	return basename(dir) === "threads" ? join(dirname(dir), "threads.db") : join(dir, "threads.db");
}

/** A database the app cannot use. `damaged`: SQLite itself says the file is broken. `unavailable`: it could not be opened (locked, no permission, no FTS5). Never rewritten either way. */
export class ThreadsDbError extends Error {
	constructor(
		readonly kind: "damaged" | "unavailable",
		readonly file: string,
		detail: string,
	) {
		super(
			kind === "damaged"
				? `Sarunu datubāze ${file} ir bojāta (${detail}). Programma to nepārraksta. Atjaunojiet failu no rezerves kopijas, vai pārvietojiet to malā: tad sarunas tiks pārņemtas no vecajiem failiem.`
				: `Sarunu datubāzi ${file} nevar atvērt (${detail}). Pārbaudiet, vai neviena cita programma to neaiztiek un vai failam ir piekļuve.`,
		);
		this.name = "ThreadsDbError";
	}
}

/** SQLite's own answer from a first look: sound, damaged, or not looked at because the file could not be opened (which says nothing about the file). */
export type Verdict = { kind: "ok" } | { kind: "damaged"; text: string } | { kind: "unchecked"; reason: string };

export function quickCheck(file: string, busyTimeoutMs = BUSY_TIMEOUT_MS): Verdict {
	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(file, { readOnly: true, timeout: busyTimeoutMs } as ConstructorParameters<typeof DatabaseSync>[1]);
		// the integrity check without the slow comparison of every index with its table
		const rows = db.prepare("PRAGMA quick_check(20)").all() as Record<string, unknown>[];
		const lines = rows.map((r) => String(Object.values(r)[0]));
		return lines.length === 1 && lines[0] === "ok" ? { kind: "ok" } : { kind: "damaged", text: `${lines.length} problem${lines.length === 1 ? "" : "s"} (first: ${lines[0]?.slice(0, 160) ?? "unknown"})` };
	} catch (e) {
		const text = e instanceof Error ? e.message.slice(0, 160) : String(e);
		return isDamagedCode(e) ? { kind: "damaged", text } : { kind: "unchecked", reason: text };
	} finally {
		try {
			db?.close();
		} catch {
			// nothing to close
		}
	}
}

function isDamagedCode(e: unknown): boolean {
	const code = (e as { errcode?: unknown }).errcode;
	return typeof code === "number" && DAMAGED_CODES.has(code & 0xff);
}

const size = (file: string) => {
	try {
		return statSync(file).size;
	} catch {
		return 0;
	}
};

/** The lines of a chat.jsonl as entries; a torn or unparseable line is skipped. */
export function parseTranscript(text: string): ChatEntry[] {
	const out: ChatEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line);
			if (e && typeof e === "object") out.push(e as ChatEntry);
		} catch {
			// a torn line is skipped
		}
	}
	return out;
}

/** Where the old conversations are read from, once, when the database is first opened. */
export interface LegacySource {
	threads(): Thread[];
	transcript(id: string): ChatEntry[];
}

export interface SearchQuery {
	query: string;
	agent?: string;
	threadId?: string;
	/** YYYY-MM-DD, inclusive (UTC, as the stored times are) */
	from?: string;
	to?: string;
	limit?: number;
}
export interface ConversationHit {
	threadId: string;
	title: string;
	agent: string;
	at: string;
	role: string;
	/** a short piece of the message with the matching words in [brackets] */
	snippet: string;
}

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS threads (
		id TEXT PRIMARY KEY,
		project_id TEXT,
		agent TEXT NOT NULL,
		title TEXT NOT NULL,
		topic TEXT,
		state TEXT NOT NULL,
		started_by TEXT NOT NULL,
		wave TEXT,
		created_at TEXT NOT NULL,
		last_at TEXT NOT NULL,
		runs INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX IF NOT EXISTS threads_last ON threads(last_at);
	CREATE INDEX IF NOT EXISTS threads_agent ON threads(agent, last_at);
	-- No foreign key on thread_id: an entry appended to a thread that is not (yet) there stays invisible, as a chat file without a thread.json did.
	-- json is the whole entry as written, so a field this version does not know survives a round trip.
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		thread_id TEXT NOT NULL,
		at TEXT NOT NULL,
		role TEXT NOT NULL,
		kind TEXT NOT NULL DEFAULT 'text',
		text TEXT NOT NULL,
		json TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, id);
	CREATE INDEX IF NOT EXISTS messages_at ON messages(at);
	-- The full-text index: an external-content table over messages.text (the text is stored once), kept in step by triggers.
	CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
	CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
	END;
	CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
	END;
	CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
		INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
	END;
	-- Room for embeddings (D10), empty until they are built: a piece of text that gets a vector, where it came from
	-- (kind: message, memory, source-page ...; source: its id or path) and, for a message, which one.
	CREATE TABLE IF NOT EXISTS chunks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER,
		thread_id TEXT,
		kind TEXT NOT NULL,
		source TEXT,
		text TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS chunks_message ON chunks(message_id);
	PRAGMA user_version = 1;
`;

const MIGRATED = "migrated_from_files";

/** Every query token quoted, so FTS5 reads `AND`, `NOT`, `*`, `:` as words and not as syntax. A plain word of four letters or more is searched by its beginning without its last one or two letters (six or more: two), so an ending does not hide it: skersgriezums finds skersgriezumu, būvniecība finds būvniecības. A token with a digit or a sign in it (BK-3, 2026, 201-15) is searched exactly, so codes and numbers do not turn into prefixes. Null when nothing searchable is left. */
export function ftsMatch(query: string): string | null {
	const terms: string[] = [];
	for (const raw of query.split(/\s+/)) {
		const token = raw.replace(/"/g, "").trim();
		if (!/[\p{L}\p{N}]/u.test(token)) continue;
		if (/^\p{L}{4,}$/u.test(token)) {
			const letters = [...token];
			terms.push(`"${letters.slice(0, letters.length - (letters.length >= 6 ? 2 : 1)).join("")}"*`);
		} else terms.push(`"${token}"`);
	}
	return terms.length ? terms.join(" ") : null;
}

const dayEnd = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59.999Z` : d);

/** The search itself, on any open connection (the app's, or the read-only one the agent's tools server opens). */
export function searchIn(db: DatabaseSync, q: SearchQuery): ConversationHit[] {
	const match = ftsMatch(q.query);
	if (!match) return [];
	const where = ["messages_fts MATCH ?", "m.kind = 'text'"];
	const args: (string | number)[] = [match];
	if (q.agent) (where.push("t.agent = ?"), args.push(q.agent));
	if (q.threadId) (where.push("m.thread_id = ?"), args.push(q.threadId));
	if (q.from) (where.push("m.at >= ?"), args.push(q.from));
	if (q.to) (where.push("m.at <= ?"), args.push(dayEnd(q.to)));
	args.push(Math.max(1, Math.min(q.limit ?? 8, 50)));
	const rows = db
		.prepare(
			"SELECT m.thread_id AS threadId, t.title AS title, t.agent AS agent, m.at AS at, m.role AS role, snippet(messages_fts, 0, '[', ']', '…', 14) AS snippet " +
				"FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid JOIN threads t ON t.id = m.thread_id " +
				`WHERE ${where.join(" AND ")} ORDER BY bm25(messages_fts), m.at DESC LIMIT ?`,
		)
		.all(...args) as unknown as ConversationHit[];
	return rows.map((r) => ({ ...r, snippet: r.snippet.replace(/\s+/g, " ").trim() }));
}

/** Search a database file without opening it for writing: the tools server runs in another process than the app. Null: there is no database, or its conversations were not moved into it yet. */
export function searchFile(file: string, q: SearchQuery): ConversationHit[] | null {
	if (!existsSync(file)) return null;
	const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 } as ConstructorParameters<typeof DatabaseSync>[1]);
	try {
		const marker = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get() ? db.prepare("SELECT value FROM meta WHERE key = ?").get(MIGRATED) : undefined;
		return marker ? searchIn(db, q) : null;
	} finally {
		db.close();
	}
}

interface ThreadRow {
	id: string;
	project_id: string | null;
	agent: string;
	title: string;
	topic: string | null;
	state: string;
	started_by: string;
	wave: string | null;
	created_at: string;
	last_at: string;
	runs: number;
}
const toThread = (r: ThreadRow): Thread => ({ id: r.id, projectId: r.project_id, agent: r.agent, title: r.title, topic: r.topic, state: r.state as Thread["state"], startedBy: r.started_by, wave: r.wave, createdAt: r.created_at, lastAt: r.last_at, runs: Number(r.runs) });

export class ThreadsDb {
	private cache = new Map<string, StatementSync>();

	private constructor(
		readonly file: string,
		private readonly db: DatabaseSync,
	) {}

	/** Opens (making it if there is none) and checks the file first; a damaged one is never opened for writing. Throws ThreadsDbError. */
	static open(file: string): ThreadsDb {
		mkdirSync(dirname(file), { recursive: true });
		if (existsSync(file) && size(file) + size(`${file}-wal`) <= START_CHECK_MAX_BYTES) {
			const v = quickCheck(file);
			if (v.kind === "damaged") throw new ThreadsDbError("damaged", file, v.text);
			// "unchecked" says nothing about the file: the real open below says why it cannot be used
		}
		let db: DatabaseSync | null = null;
		try {
			db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS } as ConstructorParameters<typeof DatabaseSync>[1]);
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA synchronous = NORMAL");
			db.exec(SCHEMA);
			return new ThreadsDb(file, db);
		} catch (e) {
			try {
				db?.close();
			} catch {
				// already closed
			}
			const text = e instanceof Error ? e.message.slice(0, 200) : String(e);
			if (isDamagedCode(e)) throw new ThreadsDbError("damaged", file, text);
			// FTS5 is built into Node 24 and Electron 43; a build without it cannot keep this file
			throw new ThreadsDbError("unavailable", file, /no such module:\s*fts5/i.test(text) ? `šis SQLite nav ar FTS5 (${text})` : text);
		}
	}

	close(): void {
		this.cache.clear();
		try {
			this.db.close();
		} catch {
			// already closed
		}
	}

	private stmt(sql: string): StatementSync {
		let s = this.cache.get(sql);
		if (!s) this.cache.set(sql, (s = this.db.prepare(sql)));
		return s;
	}

	/** All or nothing: BEGIN IMMEDIATE takes the write lock first, so two stores migrating the same project take turns. */
	private transaction<T>(fn: () => T): T {
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const r = fn();
			this.db.exec("COMMIT");
			return r;
		} catch (e) {
			try {
				this.db.exec("ROLLBACK");
			} catch {
				// the failure already ended the transaction
			}
			throw e;
		}
	}

	// ---- the one-time move of the old thread folders ----

	migrated(): boolean {
		return this.stmt("SELECT 1 FROM meta WHERE key = ?").get(MIGRATED) !== undefined;
	}

	/** Reads every old thread and transcript into the database in one transaction and sets the marker. The old files are only read. A thread already in the database is left as it is, so running it twice changes nothing. Throws, with nothing written, when anything fails. */
	migrateFrom(src: LegacySource): { threads: number; messages: number } {
		return this.transaction(() => {
			if (this.migrated()) return { threads: 0, messages: 0 };
			let threads = 0;
			let messages = 0;
			for (const t of src.threads()) {
				if (!this.insertThreadRow(t)) continue;
				threads++;
				for (const e of src.transcript(t.id)) (this.insertEntry(t.id, e), messages++);
			}
			this.stmt("INSERT INTO meta(key, value) VALUES (?, ?)").run(MIGRATED, JSON.stringify({ at: new Date().toISOString(), threads, messages }));
			return { threads, messages };
		});
	}

	// ---- the thread store's operations ----

	private insertThreadRow(t: Thread): boolean {
		const r = this.stmt("INSERT OR IGNORE INTO threads (id, project_id, agent, title, topic, state, started_by, wave, created_at, last_at, runs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(t.id, t.projectId, t.agent, t.title, t.topic, t.state, t.startedBy, t.wave, t.createdAt, t.lastAt, t.runs);
		return Number(r.changes) > 0;
	}

	private insertEntry(threadId: string, e: ChatEntry): void {
		const x = e as unknown as Record<string, unknown>;
		this.stmt("INSERT INTO messages (thread_id, at, role, kind, text, json) VALUES (?, ?, ?, ?, ?, ?)").run(threadId, typeof x.at === "string" ? x.at : "", typeof x.role === "string" ? x.role : "", typeof x.kind === "string" ? x.kind : "text", typeof x.text === "string" ? x.text : "", JSON.stringify(e));
	}

	/** A new thread, with the lines `seed` writes to the path it is given (the legacy chat copy). The thread and its lines go in together, or not at all. */
	insert(t: Thread, seed?: (chatFile: string) => void): void {
		let seeded: ChatEntry[] = [];
		if (seed) {
			const tmp = `${this.file}.seed-${t.id}.tmp`;
			try {
				seed(tmp);
				if (existsSync(tmp)) seeded = parseTranscript(readFileSync(tmp, "utf8"));
			} finally {
				rmSync(tmp, { force: true });
			}
		}
		this.transaction(() => {
			this.insertThreadRow(t);
			for (const e of seeded) this.insertEntry(t.id, e);
		});
	}

	get(id: string): Thread | null {
		const r = this.stmt("SELECT * FROM threads WHERE id = ?").get(id) as ThreadRow | undefined;
		return r ? toThread(r) : null;
	}

	/** Newest `lastAt` first. */
	list(f: { agent?: string; open?: boolean }): Thread[] {
		const where: string[] = [];
		const args: string[] = [];
		if (f.agent !== undefined) (where.push("agent = ?"), args.push(f.agent));
		if (f.open) where.push("state <> 'closed'");
		const sql = `SELECT * FROM threads${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY last_at DESC, id`;
		return (this.db.prepare(sql).all(...args) as unknown as ThreadRow[]).map(toThread);
	}

	patch(id: string, p: Partial<Pick<Thread, "state" | "title" | "wave" | "lastAt" | "runs">>): Thread | null {
		const set: string[] = [];
		const args: (string | number | null)[] = [];
		const col = { state: "state", title: "title", wave: "wave", lastAt: "last_at", runs: "runs" } as const;
		for (const k of Object.keys(col) as (keyof typeof col)[]) {
			if (p[k] === undefined) continue;
			set.push(`${col[k]} = ?`);
			args.push(p[k] as string | number | null);
		}
		if (set.length) this.db.prepare(`UPDATE threads SET ${set.join(", ")} WHERE id = ?`).run(...args, id);
		return this.get(id);
	}

	append(id: string, e: ChatEntry): void {
		this.insertEntry(id, e);
	}

	transcript(id: string): ChatEntry[] {
		const out: ChatEntry[] = [];
		for (const r of this.stmt("SELECT json FROM messages WHERE thread_id = ? ORDER BY id").all(id) as { json: string }[]) {
			try {
				out.push(JSON.parse(r.json));
			} catch {
				// a row that is not JSON is skipped, as a torn line was
			}
		}
		return out;
	}

	search(q: SearchQuery): ConversationHit[] {
		return searchIn(this.db, q);
	}
}
