// Office memory (task 8.8): lessons that hold for every project, kept in <app data>\memory beside the settings, read by the agent
// in every project. Atmiņa (one project's notes) stays per project; the user lifts a note up with one click. Rules:
//   - a note the user writes or lifts is standing at once; a note the agent writes is only a proposal until the user accepts it
//     (unvetted lessons must not steer other projects), and the agent does not see proposals as memory;
//   - lifting copies: the project's note stays where it is, and the office copy says where it came from;
//   - rejecting moves the file to memory\rejected, and a replaced file is kept in memory\versions: nothing is deleted.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { appendLog } from "./log.js";
import { newId, type Note, type NoteType, type Who } from "./model.js";
import { readNotes, writeNoteFile } from "./notes.js";
import type { ProjectStore } from "./store.js";

export class OfficeMemory {
	constructor(readonly dir: string) {}

	private log(kind: string, by: Who, data: Record<string, unknown>) {
		mkdirSync(this.dir, { recursive: true });
		appendLog(join(this.dir, "log.jsonl"), { kind, by, data });
	}

	/** Notes newest first. The agent asks for `standing` only; the user sees the proposals too. */
	list(opts: { type?: NoteType; standing?: boolean } = {}): Note[] {
		return readNotes(this.dir, opts.type).filter((n) => !opts.standing || n.state !== "proposed");
	}

	write(input: { type: NoteType; title: string; body: string; refs?: string[] }, by: Who): Note {
		if (input.title.trim().length < 3) throw new Error("Virsraksts ir pārāk īss.");
		const note: Note = { id: newId("o"), type: input.type, title: input.title.trim(), body: input.body, refs: input.refs ?? [], by, at: new Date().toISOString(), ...(by === "agent" ? { state: "proposed" as const } : {}) };
		writeNoteFile(this.dir, note, join(this.dir, "versions"));
		this.log("memory.written", by, { id: note.id, type: note.type, proposed: by === "agent" });
		return note;
	}

	/** The user lifts a project note up to the office memory. The project's note stays; lifting it twice is refused. */
	promote(store: ProjectStore, noteId: string): Note {
		const src = store.notes().find((n) => n.id === noteId);
		if (!src) throw new Error(`Piezīme ${noteId} nav atrasta.`);
		if (this.list().some((n) => n.from?.project === store.project.id && n.from.note === noteId)) throw new Error("Šis ieraksts jau ir biroja atmiņā.");
		const note: Note = { id: newId("o"), type: src.type, title: src.title, body: src.body, refs: [], by: "user", at: new Date().toISOString(), from: { project: store.project.id, note: noteId } };
		writeNoteFile(this.dir, note, join(this.dir, "versions"));
		this.log("memory.promoted", "user", { id: note.id, from: note.from });
		return note;
	}

	/** The user answers a proposal: accept makes it standing, reject moves it aside. */
	decide(id: string, accept: boolean): void {
		const n = this.list().find((x) => x.id === id);
		if (!n) throw new Error(`Ieraksts ${id} nav atrasts.`);
		if (n.state !== "proposed") throw new Error("Šis ieraksts nav priekšlikums.");
		if (accept) {
			const { state: _state, ...rest } = n;
			void _state;
			writeNoteFile(this.dir, rest, join(this.dir, "versions"));
		} else {
			mkdirSync(join(this.dir, "rejected"), { recursive: true });
			const f = join(this.dir, `${id}.md`);
			if (existsSync(f)) renameSync(f, join(this.dir, "rejected", `${id}.md`));
		}
		this.log(accept ? "memory.accepted" : "memory.rejected", "user", { id });
	}
}
