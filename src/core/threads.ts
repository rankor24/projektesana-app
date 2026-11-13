// Threads on disk: <dir>\<threadId>\thread.json (the state, rewritten atomically) and chat.jsonl (the transcript, append-only).
// The app can die mid-write: a torn transcript line is skipped, a half-written temp file is never read.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatEntry } from "../shared/api.js";
import { LEAD_ID, type Thread } from "../shared/thread-types.js";
import { newId } from "./model.js";

/** Where a project's threads live: inside the project's data folder; with no project, under the app's data folder. */
export function threadsDir(appDir: string, projectsDir: string, projectId: string | null): string {
	return projectId ? join(projectsDir, projectId, "threads") : join(appDir, "threads", "_");
}

function atomicWrite(file: string, body: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, body);
	renameSync(tmp, file);
}

export class ThreadStore {
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

	create(i: { projectId: string | null; agent: string; title: string; topic?: string | null; startedBy: string }): Thread {
		const now = new Date().toISOString();
		const t: Thread = { id: newId("th"), projectId: i.projectId, agent: i.agent, title: i.title, topic: i.topic ?? null, state: "idle", startedBy: i.startedBy, wave: null, createdAt: now, lastAt: now, runs: 0 };
		mkdirSync(this.folder(t.id), { recursive: true });
		this.save(t);
		return t;
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
	list(f: { agent?: string; open?: boolean } = {}): Thread[] {
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

	patch(id: string, p: Partial<Pick<Thread, "state" | "title" | "wave" | "lastAt" | "runs">>): Thread {
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
		if (!existsSync(f)) return [];
		const out: ChatEntry[] = [];
		for (const line of readFileSync(f, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line));
			} catch {
				// a torn line is skipped
			}
		}
		return out;
	}

	/** The lead's open thread (newest not closed); made on first use. The legacy chat file is copied in once, when the thread is made, and kept. */
	lead(projectId: string | null, legacyChat: string): Thread {
		const open = this.list({ agent: LEAD_ID, open: true })[0];
		if (open) return open;
		// "once": a lead thread that was closed already took the legacy lines, so a new one starts empty
		const first = this.list({ agent: LEAD_ID }).length === 0;
		const t = this.create({ projectId, agent: LEAD_ID, title: "Saruna", startedBy: "user" });
		if (first && existsSync(legacyChat)) copyFileSync(legacyChat, this.chatFile(t.id));
		return t;
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
