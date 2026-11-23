// What the index takes besides sources and conversations: the Markdown memory and the two logs, read from their files as units of text.
// Memory is app-wide (<appDir>\memory\...), the logs are the project's own (its notes folder). Memory goes into EACH project's
// threads.db, not into a database of its own: the agent's tool and the Avoti page open exactly one read-only database per project,
// and the whole memory is small (a file never passes 24 000 characters), so a copy per project costs less than a second
// connection and a merge of two result lists. A project's index is brought up to date by any run, so a memory write reaches every
// project's index the next time that project is indexed (the app asks for all of them when memory changes, see main.ts).
// Pure reading, no database: index.ts's syncUnits does the bookkeeping.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decisionEntries, questionEntries, type LogEntry } from "../core/process.js";
import { readNotes } from "../core/notes.js";
import { keeperOf, liveEntries, memoryDir, memoryFile, parseMemory, readMemory, todayRiga, type MemoryRef } from "../agent/memory-md.js";
import type { Unit } from "./index.js";
import { unitSha } from "./index.js";

/** The memory files that exist: the office's, each department's and each agent's (an id that is not one the app makes is skipped, as memoryFile refuses it). */
export function memoryRefs(appDir: string): MemoryRef[] {
	const refs: MemoryRef[] = [{ kind: "office", id: "office" }];
	for (const [kind, sub] of [["department", "departments"], ["agent", "agents"]] as const) {
		const dir = join(memoryDir(appDir), sub);
		if (!existsSync(dir)) continue;
		for (const n of readdirSync(dir).sort()) {
			if (!n.endsWith(".md")) continue;
			const ref: MemoryRef = { kind, id: n.slice(0, -3) };
			try {
				memoryFile(appDir, ref);
				refs.push(ref);
			} catch {
				// not a name the app gives a memory file
			}
		}
	}
	return refs;
}

/** `- 2026-11-23 · text` → `text` (the date is in the citation). */
const bare = (entry: string): string => entry.replace(/^[-*]\s+(?:\d{4}-\d{2}-\d{2}\s*·\s*)?/, "");

/** One unit per live memory entry (not struck through, not past its `until` day), and one per file for its pinned lines (headings, prose). Citation: "Atmiņa · <keeper> · <entry date>". */
export function memoryUnits(appDir: string, now = Date.now()): Unit[] {
	const out: Unit[] = [];
	const today = todayRiga(now);
	for (const ref of memoryRefs(appDir)) {
		const raw = readMemory(appDir, ref);
		if (!raw.trim()) continue;
		const key = `${ref.kind}/${ref.id}`;
		const keeper = keeperOf(appDir, ref);
		const p = parseMemory(raw);
		const fixed = p.fixed.join("\n");
		if (fixed.trim()) out.push({ key, sha: unitSha(fixed), label: `Atmiņa · ${keeper}`, text: fixed });
		for (const e of liveEntries(p, today)) {
			const text = bare(e.text);
			out.push({ key, sha: unitSha(text), label: `Atmiņa · ${keeper}${e.date ? ` · ${e.date}` : ""}`, text });
		}
	}
	return out;
}

/** The decision log and the question log of a project: one unit per note, numbered as the registers number them (L-3, J-2), the note's id as its key. */
export function logUnits(projectDir: string): { decision: Unit[]; question: Unit[] } {
	const notes = readNotes(join(projectDir, "notes"));
	const unit = (title: string) => (e: LogEntry): Unit => ({ key: e.note.id, sha: unitSha(e.text), label: `${title} · ${e.id} · ${e.note.at.slice(0, 10)}`, text: e.text });
	return { decision: decisionEntries(notes).map(unit("Lēmumu žurnāls")), question: questionEntries(notes).map(unit("Jautājumu žurnāls")) };
}
