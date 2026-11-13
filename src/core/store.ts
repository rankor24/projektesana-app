// Per-project store: one data folder per BD code under the app's data folder, JSON collections plus append-only log.
// Every write of a collection keeps the previous file as versions\<name>.<seq>.json, where <seq> is the log entry of the
// write that replaced it — so "what did facts.json look like before event 41" is one file away (design doc 4.4).
// Writes are atomic (temp file + rename); the office project folder is never written (guard).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkWrite, isInside } from "./guard.js";
import { appendLog, readLog, type StoredEntry } from "./log.js";
import { readNotes, writeNoteFile } from "./notes.js";
import { currentScope } from "./scope.js";
import { COLLECTIONS, upgradeWho, type CollectionName, type Collections, type Note, type NoteType, type Project, type Who } from "./model.js";

export const SUBDIRS = ["notes", "revisions", "text", "versions"] as const;

function atomicWrite(file: string, body: string | Uint8Array) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, body);
	renameSync(tmp, file);
}

export class ProjectStore {
	readonly dir: string;
	private cache = new Map<CollectionName, { stamp: string; value: unknown[] }>();

	private constructor(
		readonly projectsDir: string,
		readonly project: Project,
	) {
		this.dir = join(projectsDir, project.id);
	}

	/** Opens (and on first use creates) the data folder set of a project. */
	static open(projectsDir: string, project: Project): ProjectStore {
		const s = new ProjectStore(projectsDir, project);
		// the data folder can never sit inside the office project folder: that folder is read-only to the app
		if (isInside(s.dir, project.root)) throw new Error(`Izejas mapē app neraksta nekad: ${s.dir}`);
		mkdirSync(s.dir, { recursive: true });
		for (const d of SUBDIRS) mkdirSync(join(s.dir, d), { recursive: true });
		const pj = join(s.dir, "project.json");
		const fresh = !existsSync(pj);
		if (fresh) atomicWrite(pj, JSON.stringify(project, null, 1));
		for (const c of COLLECTIONS) if (!existsSync(s.file(c))) atomicWrite(s.file(c), "[]");
		if (fresh) s.log({ kind: "project.created", by: "user", data: { id: project.id, root: project.root } });
		return s;
	}

	/** Reads a project.json that already exists. */
	static load(projectsDir: string, id: string): ProjectStore {
		const pj = join(projectsDir, id, "project.json");
		if (!existsSync(pj)) throw new Error(`Projekta dati nav atrasti: ${id}`);
		return ProjectStore.open(projectsDir, JSON.parse(readFileSync(pj, "utf8")) as Project);
	}

	get guard() {
		return { sourceRoot: this.project.root, dataDir: this.dir };
	}

	private file(c: CollectionName | string) {
		return join(this.dir, `${c}.json`);
	}

	logFile() {
		return join(this.dir, "log.jsonl");
	}

	log(e: { kind: string; by: Who | string; data?: Record<string, unknown> }): StoredEntry {
		// inside an agent tool call (task 8.7) the entry says which run and tool wrote it
		const sc = currentScope();
		return appendLog(this.logFile(), sc ? { ...e, data: { ...e.data, run: sc.run, tool: sc.tool } } : e);
	}

	events(): StoredEntry[] {
		return upgradeWho(readLog(this.logFile()).entries);
	}

	/** The cache is keyed by the file's mtime and size: the tools server writes the same files from its own process. */
	private stamp(f: string): string {
		if (!existsSync(f)) return "none";
		const s = statSync(f);
		return `${s.mtimeMs}:${s.size}`;
	}

	read<C extends CollectionName>(c: C): Collections[C] {
		const f = this.file(c);
		const stamp = this.stamp(f);
		const hit = this.cache.get(c);
		if (hit && hit.stamp === stamp) return structuredClone(hit.value) as Collections[C];
		const v = existsSync(f) ? upgradeWho(JSON.parse(readFileSync(f, "utf8")) as Collections[C]) : ([] as unknown as Collections[C]);
		this.cache.set(c, { stamp, value: v });
		return structuredClone(v);
	}

	/** Replaces a collection. The previous file is kept under versions\ with the seq of this write's log entry. */
	write<C extends CollectionName>(c: C, value: Collections[C], e: { kind: string; by: Who | string; data?: Record<string, unknown> }): StoredEntry {
		const f = this.file(c);
		const g = checkWrite(this.guard, f);
		if (!g.ok) throw new Error(g.reason);
		const entry = this.log({ ...e, data: { ...e.data, collection: c, count: value.length } });
		if (existsSync(f)) renameSync(f, join(this.dir, "versions", `${c}.${entry.seq}.json`));
		atomicWrite(f, JSON.stringify(value, null, 1));
		this.cache.set(c, { stamp: this.stamp(f), value: structuredClone(value) });
		return entry;
	}

	/** Read-modify-write of one collection. */
	update<C extends CollectionName>(c: C, fn: (v: Collections[C]) => Collections[C], e: { kind: string; by: Who | string; data?: Record<string, unknown> }): Collections[C] {
		const next = fn(this.read(c));
		this.write(c, next, e);
		return next;
	}

	/** Earlier versions of a collection, newest first: the seq of the write that replaced each. */
	versions(c: CollectionName): number[] {
		const re = new RegExp(`^${c}\\.(\\d+)\\.json$`);
		return readdirSync(join(this.dir, "versions"))
			.map((n) => re.exec(n)?.[1])
			.filter((x): x is string => !!x)
			.map(Number)
			.sort((a, b) => b - a);
	}

	readVersion<C extends CollectionName>(c: C, seq: number): Collections[C] {
		return upgradeWho(JSON.parse(readFileSync(join(this.dir, "versions", `${c}.${seq}.json`), "utf8")) as Collections[C]);
	}

	// ---- small meta files (roles.json, scan.json): one object each, previous kept like a collection ----

	readMeta<T>(name: string, fallback: T): T {
		if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Nederīgs nosaukums: ${name}`);
		const f = join(this.dir, `${name}.json`);
		if (!existsSync(f)) return fallback;
		try {
			return upgradeWho(JSON.parse(readFileSync(f, "utf8")) as T);
		} catch {
			return fallback;
		}
	}

	writeMeta(name: string, value: unknown, e?: { kind: string; by: Who | string; data?: Record<string, unknown> }): void {
		if (!/^[a-z][a-z0-9-]*$/.test(name) || (COLLECTIONS as string[]).includes(name)) throw new Error(`Nederīgs nosaukums: ${name}`);
		const f = join(this.dir, `${name}.json`);
		if (e) {
			const entry = this.log(e);
			if (existsSync(f)) renameSync(f, join(this.dir, "versions", `${name}.${entry.seq}.json`));
		}
		atomicWrite(f, JSON.stringify(value, null, 1));
	}

	// ---- text cache (per sha, shared by every path of a source) ----

	textFile(sha: string) {
		return join(this.dir, "text", `${sha}.json`);
	}

	readText(sha: string): { pages: string[]; state: string; reason?: string } | null {
		const f = this.textFile(sha);
		return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { pages: string[]; state: string }) : null;
	}

	writeText(sha: string, t: { pages: string[]; state: string; reason?: string; ocrPages?: number[] }) {
		atomicWrite(this.textFile(sha), JSON.stringify(t));
	}

	// ---- notes (Atmiņa): one markdown file per note ----

	writeNote(n: Note): void {
		writeNoteFile(join(this.dir, "notes"), n, join(this.dir, "versions"));
		this.log({ kind: "note.written", by: n.by, data: { id: n.id, type: n.type } });
	}

	notes(type?: NoteType): Note[] {
		return readNotes(join(this.dir, "notes"), type);
	}

	/** Removes stray temp files from a crash mid-write. */
	sweep(): void {
		for (const n of readdirSync(this.dir)) if (n.endsWith(".tmp")) unlinkSync(join(this.dir, n));
	}
}
