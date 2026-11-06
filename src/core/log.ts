// Append-only log: one JSON object per line. Lines are never rewritten or removed.
// Carried from v1 src/kernel/log.ts. Changed: the log path is given (the data folder owns it, not the project folder),
// and the next sequence number comes from the file's tail instead of re-reading the whole log on every append.
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

/** The tail of the file that is read to find the last sequence number and whether the last line is torn. */
const TAIL = 64 * 1024;

/** Last seq in the file and whether it ends without a newline. Reads only the tail, so two processes appending to the
 *  same log (main and the tools server) both see each other's entries without a shared in-memory counter. */
function tailState(file: string): { seq: number; torn: boolean } {
	if (!existsSync(file)) return { seq: 0, torn: false };
	const size = statSync(file).size;
	if (size === 0) return { seq: 0, torn: false };
	const len = Math.min(size, TAIL);
	const fd = openSync(file, "r");
	const b = Buffer.alloc(len);
	try {
		readSync(fd, b, 0, len, size - len);
	} finally {
		closeSync(fd);
	}
	const torn = b[len - 1] !== 0x0a;
	const lines = b.toString("utf8").split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			const e = JSON.parse(lines[i]) as StoredEntry;
			if (typeof e.seq === "number") return { seq: e.seq, torn };
		} catch {
			// torn or partial first line of the tail
		}
	}
	// no whole entry in the tail (one huge line): read everything
	return { seq: readLog(file).entries.reduce((m, x) => Math.max(m, x.seq), 0), torn };
}

export function appendLog(file: string, e: LogEntry, now = new Date()): StoredEntry {
	mkdirSync(dirname(file), { recursive: true });
	const t = tailState(file);
	const stored: StoredEntry = { at: now.toISOString(), seq: t.seq + 1, ...e };
	// a torn last line must not glue onto the next entry
	appendFileSync(file, (t.torn ? "\n" : "") + JSON.stringify(stored) + "\n", "utf8");
	return stored;
}
