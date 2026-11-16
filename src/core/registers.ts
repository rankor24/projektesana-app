// The registers of process mode as files (task 14.5): the generated copy of what Atmiņa and the process state hold, in the folder layout of process chapter 3
// (00_vadiba). Kept apart from process.ts because it writes files and process.ts is imported by the renderer's typecheck, which has no node types.
// The data stays in the store; these files are overwritten each time.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Mailbox, openTasks } from "./messages.js";
import { type ProcessState, decisionLog, noteLog, questionLog, statusText } from "./process.js";
import { checkWrite } from "./guard.js";
import type { ProjectStore } from "./store.js";

/** `00_vadiba` under the project's data folder: where `process.export` writes. */
export const exportDir = (store: ProjectStore): string => join(store.dir, "export", "00_vadiba");

const section = (title: string, entries: readonly string[]) => `# ${title}\n\n${entries.length ? entries.join("\n\n") : "nav"}\n`;

function atomicWrite(file: string, body: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, body, "utf8");
	renameSync(tmp, file);
}

/** Writes the five registers and one `gate_<Hx>.md` per gate id into `dir`, which must lie inside the project's data folder: the store's guard refuses the office
 *  project folder (and anything else outside the data folder) before a file is written. Returns the paths. A gate id asked for twice (a returned gate, then its
 *  repeat) has one file: the newest note, in its latest version. */
export function exportRegisters(store: ProjectStore, dir: string, s: ProcessState): string[] {
	const notes = store.notes();
	const open = openTasks(new Mailbox(join(store.dir, "mail")).messages());
	const files: [string, string][] = [
		["lemumu_zurnals.md", section("Lēmumu žurnāls", decisionLog(notes))],
		["jautajumu_zurnals.md", section("Jautājumu žurnāls", questionLog(notes))],
		["risku_registrs.md", section("Risku reģistrs", noteLog(notes, "risk"))],
		[
			"izmainu_zurnals.md",
			`${section("Izmaiņu žurnāls", noteLog(notes, "change"))}\n## Procesa profila izmaiņas\n\n${s.profile.changes.length ? s.profile.changes.map((c) => `- ${c.at.slice(0, 10)} ${c.what} (${c.why})`).join("\n") : "nav"}\n`,
		],
		["projekta_statuss.md", `${statusText(s, { notes, open, now: new Date().toISOString() })}\n`],
	];
	const latest = new Map<string, string>();
	for (const g of s.gates) {
		// the id becomes a file name: only the seven real ones (process.json is a file a hand can edit)
		if (!/^H[1-7]$/.test(g.id)) continue;
		const n =g.noteId ? notes.find((x) => x.id === g.noteId) : undefined;
		if (n) latest.set(g.id, n.body);
	}
	for (const [id, body] of latest) files.push([`gate_${id}.md`, `${body}\n`]);

	// every target is checked before the first is written: a refused dir leaves nothing behind
	const targets = files.map(([name, body]) => {
		const g = checkWrite(store.guard, join(dir, name));
		if (!g.ok) throw new Error(g.reason);
		return { path: g.path, body };
	});
	mkdirSync(dir, { recursive: true });
	for (const t of targets) atomicWrite(t.path, t.body);
	return targets.map((t) => t.path);
}
