// The history of open findings, one line per check run (task 9.6): `findings-history.jsonl` in the project's data folder.
// It makes "Atradumi over time" on Pārskats possible; nothing else reads it. A damaged line is skipped, never fatal.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./model.js";
import type { HistoryPoint } from "./summary-types.js";
import type { ProjectStore } from "./store.js";

export const HISTORY_FILE = "findings-history.jsonl";
const KEEP = 500;

/** The open counts of a findings list, as one history point. */
export function pointOf(findings: Finding[], at = new Date().toISOString()): HistoryPoint {
	const p: HistoryPoint = { at, error: 0, warning: 0, info: 0 };
	for (const f of findings) if (f.state === "open") p[f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "info"]++;
	return p;
}

export function appendHistory(store: ProjectStore, point: HistoryPoint): void {
	appendFileSync(join(store.dir, HISTORY_FILE), `${JSON.stringify(point)}\n`, "utf8");
}

const isPoint = (x: unknown): x is HistoryPoint => {
	const p = x as HistoryPoint;
	return !!p && typeof p.at === "string" && [p.error, p.warning, p.info].every((n) => Number.isInteger(n) && n >= 0);
};

/** The points, oldest first, the newest 500; lines that do not parse or do not look like a point are skipped. */
export function readHistory(store: ProjectStore): HistoryPoint[] {
	const f = join(store.dir, HISTORY_FILE);
	if (!existsSync(f)) return [];
	const out: HistoryPoint[] = [];
	for (const line of readFileSync(f, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const j = JSON.parse(line) as unknown;
			if (isPoint(j)) out.push(j);
		} catch {
			// a half-written line: skipped
		}
	}
	return out.slice(-KEEP);
}
