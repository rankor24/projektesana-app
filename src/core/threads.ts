// A project's threads (one conversation each, with one agent). They live in `<project>\threads.db`, one SQLite file with a
// full-text index (threads-db.ts). The store's API is the same as it was when each thread was a folder with thread.json and
// chat.jsonl; the callers do not know the difference.
//
// The old folders are read once, when the database is first opened, and copied in (a marker in the database says so).
// They are never deleted or changed. If that copy fails for any reason, the store goes on in the old way, on the files, for
// this run, and tries again at the next start: the files stay authoritative until the copy has succeeded. A database that is
// damaged (SQLite says so) or cannot be opened is another matter: it is reported (log, and an error with a text the window can
// show) and never rewritten, and nothing is written to the old files in its place, because they are out of date by then.
//
// The old way, kept as the fallback: <dir>\<threadId>\thread.json (the state, rewritten atomically) and chat.jsonl (the
// transcript, append-only). The app can die mid-write: a torn transcript line is skipped, a half-written temp file is never read.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatEntry } from "../shared/api.js";
import { LEAD_ID, type Thread } from "../shared/thread-types.js";
import { newId } from "./model.js";
import { ThreadsDb, ThreadsDbError, parseTranscript, threadsDbFile, type ConversationHit, type SearchQuery } from "./threads-db.js";

/** Where a project's threads live: inside the project's data folder; with no project, under the app's data folder. */
export function threadsDir(appDir: string, projectsDir: string, projectId: string | null): string {
	return projectId ? join(projectsDir, projectId, "threads") : join(appDir, "threads", "_");
}

/** Every project the app has threads for: each `<projectsDir>/<id>` with a `threads` folder or a `threads.db`, plus the project-less folder (null). A folder that cannot be read is left out. */
export function knownProjects(appDir: string, projectsDir: string): (string | null)[] {
	const out: (string | null)[] = [];
	const has = (projectId: string | null) => {
		const dir = threadsDir(appDir, projectsDir, projectId);
		return existsSync(dir) || existsSync(threadsDbFile(dir));
	};
	try {
		for (const e of readdirSync(projectsDir, { withFileTypes: true })) {
			if (e.isDirectory() && has(e.name)) out.push(e.name);
		}
	} catch {
		// no projects folder yet, or one that cannot be read
	}
	if (has(null)) out.push(null);
	return out;
}

function atomicWrite(file: string, body: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, body);
	renameSync(tmp, file);
}

type Patch = Partial<Pick<Thread, "state" | "title" | "wave" | "lastAt" | "runs" | "pinned">>;
type Filter = { agent?: string; open?: boolean };

/** The threads as the files keep them: the old store, now the fallback and the source of the one-time copy into the database. */
class FileThreads {
	constructor(private readonly dir: string) {}

	private folder(id: string) {
		return join(this.dir, id);
	}
	private metaFile(id: string) {
		return join(this.folder(id), "thread.json");
	}
	private chatFile(id: string) {
		return join(this.folder(id), "chat.jsonl");
	}

	insert(t: Thread, seed?: (chatFile: string) => void): void {
		mkdirSync(this.folder(t.id), { recursive: true });
		// before thread.json: a failed seed leaves a folder list() skips, never a thread with missing history
		seed?.(this.chatFile(t.id));
		this.save(t);
	}

	private save(t: Thread) {
		atomicWrite(this.metaFile(t.id), JSON.stringify(t, null, 1));
	}

	get(id: string): Thread | null {
		try {
			const t = JSON.parse(readFileSync(this.metaFile(id), "utf8"));
			// parseable but not a thread (hand-edited, other tool): treated as absent, so list() never throws on it
			return typeof t?.id === "string" && typeof t.agent === "string" ? (t as Thread) : null;
		} catch {
			return null;
		}
	}

	/** Newest `lastAt` first. A folder without a readable thread.json (a half-made thread) is left out. */
	list(f: Filter = {}): Thread[] {
		if (!existsSync(this.dir)) return [];
		const out: Thread[] = [];
		for (const e of readdirSync(this.dir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const t = this.get(e.name);
			if (!t) continue;
			if (f.agent !== undefined && t.agent !== f.agent) continue;
			if (f.open && t.state === "closed") continue;
			out.push(t);
		}
		return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
	}

	/** For the copy into the database: every thread the files hold. */
	threads(): Thread[] {
		return this.list();
	}

	patch(id: string, p: Patch): Thread {
		const t = this.get(id);
		if (!t) throw new Error(`Saruna ${id} nav atrasta.`);
		const next: Thread = { ...t, ...p };
		this.save(next);
		return next;
	}

	append(id: string, e: ChatEntry): void {
		const f = this.chatFile(id);
		mkdirSync(this.folder(id), { recursive: true });
		// a torn last line has no newline; without one the new entry would be glued to it and lost with it
		appendFileSync(f, (endsWithoutNewline(f) ? "\n" : "") + JSON.stringify(e) + "\n", "utf8");
	}

	transcript(id: string): ChatEntry[] {
		const f = this.chatFile(id);
		return existsSync(f) ? parseTranscript(readFileSync(f, "utf8")) : [];
	}
}

type Mode = { kind: "db"; db: ThreadsDb } | { kind: "files"; why: string } | { kind: "broken"; error: ThreadsDbError };

/** What state the store is in, for a window that wants to say it: `db` is the normal one; `files` means the copy into the database failed and the old files are in use; `damaged` / `unavailable` carry the error text. */
export interface ThreadsHealth {
	kind: "none" | "db" | "files" | "damaged" | "unavailable";
	text?: string;
}

export class ThreadStore {
	private readonly files: FileThreads;
	private mode: Mode | null = null;
	private warned = false;
	readonly dbFile: string;

	constructor(private readonly dir: string) {
		this.files = new FileThreads(dir);
		this.dbFile = threadsDbFile(dir);
	}

	/** Opens the database on first use: checks it, copies the old folders in once. A read of a project that has nothing yet opens nothing. */
	private ready(write: boolean): Mode | null {
		if (this.mode) return this.mode;
		if (!write && !existsSync(this.dbFile) && !existsSync(this.dir)) return null;
		return (this.mode = this.start());
	}

	private start(): Mode {
		let db: ThreadsDb | null = null;
		try {
			db = ThreadsDb.open(this.dbFile);
			if (!db.migrated()) {
				try {
					const r = db.migrateFrom(this.files);
					console.log(`[threads] ${this.dbFile}: ${r.threads} threads, ${r.messages} messages copied from the old files (which are kept).`);
				} catch (e) {
					const why = e instanceof Error ? e.message : String(e);
					console.warn(`[threads] ${this.dbFile}: copying the old files failed (${why}); the old files stay in use and the copy is tried again at the next start.`);
					db.close();
					return { kind: "files", why };
				}
			}
			return { kind: "db", db };
		} catch (e) {
			try {
				db?.close();
			} catch {
				// already closed
			}
			const error = e instanceof ThreadsDbError ? e : new ThreadsDbError("unavailable", this.dbFile, e instanceof Error ? e.message : String(e));
			console.error(`[threads] ${error.message}`);
			return { kind: "broken", error };
		}
	}

	/** For a write: the working backend, or the error that says why there is none. */
	private writer(): ThreadsDb | FileThreads {
		const m = this.ready(true)!;
		if (m.kind === "broken") throw m.error;
		return m.kind === "db" ? m.db : this.files;
	}

	/** For a read: null when there is nothing yet, or the database is unusable (logged once; a read that must not look like an empty answer uses `ready` itself). */
	private reader(): ThreadsDb | FileThreads | null {
		const m = this.ready(false);
		if (!m) return null;
		if (m.kind === "broken") {
			if (!this.warned) {
				this.warned = true;
				console.warn(`[threads] reading ${this.dbFile}: ${m.error.message}`);
			}
			return null;
		}
		return m.kind === "db" ? m.db : this.files;
	}

	health(): ThreadsHealth {
		const m = this.ready(false);
		if (!m) return { kind: "none" };
		if (m.kind === "db") return { kind: "db" };
		if (m.kind === "files") return { kind: "files", text: m.why };
		return { kind: m.error.kind, text: m.error.message };
	}

	/** Lets go of the database file (tests on Windows cannot remove a folder with an open database in it). The store opens it again on next use. */
	close(): void {
		if (this.mode?.kind === "db") this.mode.db.close();
		this.mode = null;
	}

	create(i: { projectId: string | null; agent: string; title: string; topic?: string | null; startedBy: string }, seed?: (chatFile: string) => void): Thread {
		const now = new Date().toISOString();
		const t: Thread = { id: newId("th"), projectId: i.projectId, agent: i.agent, title: i.title, topic: i.topic ?? null, state: "idle", startedBy: i.startedBy, wave: null, createdAt: now, lastAt: now, runs: 0 };
		this.writer().insert(t, seed);
		return t;
	}

	get(id: string): Thread | null {
		return this.reader()?.get(id) ?? null;
	}

	/** Newest `lastAt` first. */
	list(f: Filter = {}): Thread[] {
		return this.reader()?.list(f) ?? [];
	}

	patch(id: string, p: Patch): Thread {
		const next = this.writer().patch(id, p);
		if (!next) throw new Error(`Saruna ${id} nav atrasta.`);
		return next;
	}

	append(id: string, e: ChatEntry): void {
		this.writer().append(id, e);
	}

	/** A damaged database throws here (the window's history call shows the text) instead of answering with an empty conversation. */
	transcript(id: string): ChatEntry[] {
		const m = this.ready(false);
		if (m?.kind === "broken") throw m.error;
		return this.reader()?.transcript(id) ?? [];
	}

	/** Full-text search over message text (diacritics folded). Empty while the old files are in use: they have no index. */
	search(q: SearchQuery): ConversationHit[] {
		const r = this.reader();
		return r instanceof ThreadsDb ? r.search(q) : [];
	}

	/** The lead's open thread (newest not closed); made on first use. The legacy chat file is copied in once, when the thread is made, and kept. */
	lead(projectId: string | null, legacyChat: string): Thread {
		const open = this.list({ agent: LEAD_ID, open: true })[0];
		if (open) return open;
		// "once": a lead thread that was closed already took the legacy lines, so a new one starts empty
		const first = this.list({ agent: LEAD_ID }).length === 0;
		return this.create({ projectId, agent: LEAD_ID, title: "Saruna", startedBy: "user" }, (chat) => {
			if (first && existsSync(legacyChat)) copyFileSync(legacyChat, chat);
		});
	}
}

function endsWithoutNewline(file: string): boolean {
	if (!existsSync(file)) return false;
	const size = statSync(file).size;
	if (size === 0) return false;
	const fd = openSync(file, "r");
	try {
		const b = Buffer.alloc(1);
		readSync(fd, b, 0, 1, size - 1);
		return b[0] !== 0x0a;
	} finally {
		closeSync(fd);
	}
}
