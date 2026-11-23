// The journal of what agents changed in themselves (their memory, their role text, their skill drafts): one line per change with the text
// before and after, so the Atmiņa page can list it and the user can undo any of it. Kept in <app data>\self-changes.jsonl, OUTSIDE the
// memory folder and the agents' folder on purpose: an audit trail the audited agent can rewrite is not an audit trail (the same reason
// OpenMausBot keeps its memory journal, server/memory-journal.ts, outside the bot's workspace; Apache-2.0).
// Append-only: an undo is a second line that names the first, nothing is edited or removed.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SelfChange } from "../shared/memory-types.js";
import { newId } from "../core/model.js";

export const journalFile = (appDir: string): string => join(appDir, "self-changes.jsonl");

type Line = ({ t: "change" } & Omit<SelfChange, "undone" | "undoneAt">) | { t: "undo"; id: string; at: string };

function append(appDir: string, line: Line): void {
	const f = journalFile(appDir);
	mkdirSync(dirname(f), { recursive: true });
	appendFileSync(f, `${JSON.stringify(line)}\n`, "utf8");
}

/** Records a change. A journal that cannot be written must not stop the change it records, so the caller wraps this when it matters; here it throws. */
export function logChange(appDir: string, c: Omit<SelfChange, "id" | "at" | "undone" | "undoneAt">, now = new Date()): SelfChange {
	const row = { id: newId("sc"), at: now.toISOString(), ...c };
	append(appDir, { t: "change", ...row });
	return { ...row, undone: false };
}

export function markUndone(appDir: string, id: string, now = new Date()): void {
	append(appDir, { t: "undo", id, at: now.toISOString() });
}

/** Every change, newest first, with the undone ones marked. A damaged line is skipped. */
export function listChanges(appDir: string): SelfChange[] {
	const f = journalFile(appDir);
	if (!existsSync(f)) return [];
	const out = new Map<string, SelfChange>();
	for (const raw of readFileSync(f, "utf8").split("\n")) {
		if (!raw.trim()) continue;
		try {
			const l = JSON.parse(raw) as Line;
			if (l.t === "change") {
				const { t: _t, ...rest } = l;
				void _t;
				out.set(l.id, { ...rest, undone: false });
			} else if (l.t === "undo") {
				const c = out.get(l.id);
				if (c) out.set(l.id, { ...c, undone: true, undoneAt: l.at });
			}
		} catch {
			// a torn last line
		}
	}
	return [...out.values()].reverse();
}

export const getChange = (appDir: string, id: string): SelfChange | undefined => listChanges(appDir).find((c) => c.id === id);
