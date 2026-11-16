// Notes as files: one markdown file per note with a JSON front matter line. The project memory (Atmiņa, in the project's data
// folder) and the office memory (task 8.8, in <app data>\memory) use the same format and the same functions.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WaitingItem } from "../shared/thread-types.js";
import { newId, upgradeWho, type Note, type NoteType } from "./model.js";

export function serializeNote(n: Note): string {
	const fm = { id: n.id, type: n.type, title: n.title, refs: n.refs, by: n.by, at: n.at, ...(n.from ? { from: n.from } : {}), ...(n.state ? { state: n.state } : {}), ...(n.agent ? { agent: n.agent } : {}), ...(n.to ? { to: n.to } : {}), ...(n.topic ? { topic: n.topic } : {}), ...(n.stage ? { stage: n.stage } : {}), ...(n.status ? { status: n.status } : {}), ...(n.reviewed !== undefined ? { reviewed: n.reviewed } : {}), ...(n.cancels ? { cancels: n.cancels } : {}) };
	return `---\n${JSON.stringify(fm)}\n---\n${n.body}\n`;
}

export function parseNote(raw: string): Note | null {
	const m = /^---\n(.*)\n---\n([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
	if (!m) return null;
	try {
		const fm = upgradeWho(JSON.parse(m[1]) as Omit<Note, "body">);
		return { ...fm, body: m[2].replace(/\n$/, "") } as Note;
	} catch {
		return null;
	}
}

/** The notes in a folder, newest first. A file that is not a note (or half written) is skipped. */
export function readNotes(dir: string, type?: NoteType): Note[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((n) => n.endsWith(".md"))
		.map((n) => parseNote(readFileSync(join(dir, n), "utf8")))
		.filter((n): n is Note => !!n && (!type || n.type === type))
		.sort((a, b) => b.at.localeCompare(a.at));
}

/** Writes a note atomically; the file it replaces is kept in `versionsDir` (never overwritten without a copy). */
export function writeNoteFile(dir: string, n: Note, versionsDir: string): void {
	mkdirSync(dir, { recursive: true });
	const f = join(dir, `${n.id}.md`);
	if (existsSync(f)) {
		mkdirSync(versionsDir, { recursive: true });
		renameSync(f, join(versionsDir, `note.${n.id}.${Date.now()}.md`));
	}
	const tmp = `${f}.${process.pid}.tmp`;
	writeFileSync(tmp, serializeNote(n));
	renameSync(tmp, f);
}

// ---- the registers of mail (task 12.3): questions and decisions agents leave in Atmiņa ----------------------------------------------

/** What these helpers need of a project: its notes and the write that logs. `ProjectStore` is one. */
export interface NoteStore {
	notes(type?: NoteType): Note[];
	writeNote(n: Note): void;
}

function find(store: NoteStore, id: string): Note {
	const n = store.notes().find((x) => x.id === id);
	if (!n) throw new Error(`Piezīme ${id} nav atrasta.`);
	return n;
}

/** Is this decision cancelled: a note by the user that says it cancels it. An agent's note (whatever its title) never counts. */
export const isCancelled = (id: string, notes: readonly Note[]): boolean => notes.some((n) => n.cancels === id && n.by === "user");

/** Closes (or reopens) a question; the file it replaces is kept by the store's write. */
export function setNoteStatus(store: NoteStore, id: string, status: "open" | "closed"): Note {
	const n = find(store, id);
	if (n.type !== "question") throw new Error("Slēgt var tikai jautājumu.");
	const next = { ...n, status };
	store.writeNote(next);
	return next;
}

/** The user has seen an agents' decision. */
export function reviewDecision(store: NoteStore, id: string): Note {
	const n = find(store, id);
	if (n.type !== "decision") throw new Error("Pārskatīt var tikai lēmumu.");
	const next = { ...n, reviewed: true };
	store.writeNote(next);
	return next;
}

/** Cancels a decision the way the books allow: a new decision note that names it. The cancelled note stays as it was; nothing is deleted. */
export function cancelDecision(store: NoteStore, id: string, reason: string): Note {
	const n = find(store, id);
	if (n.type !== "decision") throw new Error("Atcelt var tikai lēmumu.");
	if (isCancelled(id, store.notes())) throw new Error("Šis lēmums jau ir atcelts.");
	if (!reason.trim()) throw new Error("Norādi atcelšanas iemeslu.");
	const note: Note = { id: newId("n"), type: "decision", title: `Atcelts: ${n.title}`, body: reason.trim(), refs: [id], cancels: id, by: "user", at: new Date().toISOString(), ...(n.topic ? { topic: n.topic } : {}) };
	store.writeNote(note);
	return note;
}

/** Every open question for the user, of every project that has data: the `question` items of "Gaida tevi". A project whose notes cannot be read is left out. */
export function waitingQuestions(projectsDir: string): Extract<WaitingItem, { kind: "question" }>[] {
	const out: Extract<WaitingItem, { kind: "question" }>[] = [];
	let dirs: string[] = [];
	try {
		dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(projectsDir, e.name, "project.json"))).map((e) => e.name);
	} catch {
		return out;
	}
	for (const projectId of dirs) {
		try {
			for (const n of readNotes(join(projectsDir, projectId, "notes"), "question")) {
				if (n.to === "user" && n.status === "open") out.push({ kind: "question", noteId: n.id, projectId, from: n.agent ?? "", title: n.title });
			}
		} catch {
			// unreadable notes folder: skipped
		}
	}
	return out;
}
