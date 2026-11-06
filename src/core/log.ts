// Append-only log: one JSON object per line. Lines are never rewritten or removed.
// Carried from v1 src/kernel/log.ts. Changed: the log path is given (the data folder owns it, not the project folder),
// and the next sequence number is cached per file instead of re-reading the whole log on every append.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";

export interface LogEntry {
	/** e.g. project.created, source.scanned, fact.confirmed, finding.overridden, agent.tool */
	kind: string;
	/** who acted: boris | agent | app */
	by: string;
	data?: Record<string, unknown>;
}

export interface StoredEntry extends LogEntry {
	at: string;
	seq: number;
}

export function readLog(file: string): { entries: StoredEntry[]; bad: number } {
	if (!existsSync(file)) return { entries: [], bad: 0 };
	const entries: StoredEntry[] = [];
	let bad = 0;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line) as StoredEntry;
			if (typeof e.kind !== "string" || typeof e.seq !== "number") throw new Error("not an entry");
			entries.push(e);
		} catch {
			// a torn line (crash mid-write) is counted, never fatal
			bad++;
		}
	}
	return { entries, bad };
}

const nextSeq = new Map<string, number>();

export function appendLog(file: string, e: LogEntry, now = new Date()): StoredEntry {
	mkdirSync(dirname(file), { recursive: true });
	let seq = nextSeq.get(file);
	let prefix = "";
	if (seq === undefined) {
		seq = readLog(file).entries.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
	}
	if (existsSync(file)) {
		// a torn last line must not glue onto the next entry: look at the last byte only
		const size = statSync(file).size;
		if (size > 0) {
			const fd = openSync(file, "r");
			const b = Buffer.alloc(1);
			readSync(fd, b, 0, 1, size - 1);
			closeSync(fd);
			if (b[0] !== 0x0a) prefix = "\n";
		}
	}
	const stored: StoredEntry = { at: now.toISOString(), seq, ...e };
	appendFileSync(file, prefix + JSON.stringify(stored) + "\n", "utf8");
	nextSeq.set(file, seq + 1);
	return stored;
}

/** Tests and a project re-open drop the cached sequence so it is read from the file again. */
export function forgetLogCache(file?: string): void {
	if (file) nextSeq.delete(file);
	else nextSeq.clear();
}
