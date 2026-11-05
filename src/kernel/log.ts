// Append-only project log: one JSON object per line. Lines are never rewritten or removed.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LogEntry {
	/** e.g. project.created, file.registered, revision.created, pin.added, page.approved, agent.tool */
	kind: string;
	/** who acted: boris | agent:claude | agent:codex | app */
	by: string;
	data?: Record<string, unknown>;
}

export interface StoredEntry extends LogEntry {
	at: string;
	seq: number;
}

export const logPath = (root: string) => join(root, ".bv", "log.jsonl");

export function readLog(root: string): { entries: StoredEntry[]; bad: number } {
	const p = logPath(root);
	if (!existsSync(p)) return { entries: [], bad: 0 };
	const entries: StoredEntry[] = [];
	let bad = 0;
	for (const line of readFileSync(p, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line) as StoredEntry;
			if (typeof e.kind !== "string") throw new Error("no kind");
			entries.push(e);
		} catch {
			bad++;
		}
	}
	return { entries, bad };
}

export function appendLog(root: string, e: LogEntry, now = new Date()): StoredEntry {
	const p = logPath(root);
	mkdirSync(dirname(p), { recursive: true });
	const seq = readLog(root).entries.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
	const stored: StoredEntry = { at: now.toISOString(), seq, ...e };
	// a torn last line (crash mid-write) must not glue onto the next entry
	const prefix = existsSync(p) && !readFileSync(p, "utf8").endsWith("\n") && readFileSync(p, "utf8").length > 0 ? "\n" : "";
	appendFileSync(p, prefix + JSON.stringify(stored) + "\n", "utf8");
	return stored;
}
