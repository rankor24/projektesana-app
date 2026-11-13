// Notes as files: one markdown file per note with a JSON front matter line. The project memory (Atmiņa, in the project's data
// folder) and the office memory (task 8.8, in <app data>\memory) use the same format and the same functions.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { upgradeWho, type Note, type NoteType } from "./model.js";

export function serializeNote(n: Note): string {
	const fm = { id: n.id, type: n.type, title: n.title, refs: n.refs, by: n.by, at: n.at, ...(n.from ? { from: n.from } : {}), ...(n.state ? { state: n.state } : {}) };
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
