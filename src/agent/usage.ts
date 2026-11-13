// Token usage per model turn, kept in <app data>\usage.jsonl, one line per turn (task 8.7). pi reports each assistant message's
// counts and, when the model has a catalogue price, its cost; a subscription sign-in (ChatGPT/Codex) usually has none, and
// then the cost stays unknown — never a guess. The totals below add what is known and say how many turns were priced.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageRow } from "../shared/api.js";

export interface UsageEntry {
	at: string;
	run: string;
	project: string | null;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** US dollars at the catalogue price; null = the provider gave no price */
	cost: number | null;
}

export function appendUsage(file: string, e: UsageEntry): void {
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${JSON.stringify(e)}\n`, "utf8");
}

/** Every well-formed line; a half-written or damaged line is skipped, not fatal. */
export function parseUsage(text: string): UsageEntry[] {
	const out: UsageEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const e = JSON.parse(line) as UsageEntry;
			if (typeof e.run === "string" && typeof e.at === "string" && Number.isFinite(e.input) && Number.isFinite(e.output)) out.push({ ...e, cacheRead: e.cacheRead || 0, cacheWrite: e.cacheWrite || 0, cost: typeof e.cost === "number" ? e.cost : null });
		} catch {
			// skipped
		}
	}
	return out;
}

export const readUsage = (file: string): UsageEntry[] => (existsSync(file) ? parseUsage(readFileSync(file, "utf8")) : []);

/** Totals per project (null = chats with no project open), the busiest first. */
export function summarizeUsage(entries: UsageEntry[]): UsageRow[] {
	const by = new Map<string, { row: UsageRow; runs: Set<string> }>();
	for (const e of entries) {
		const key = e.project ?? "";
		let g = by.get(key);
		if (!g) by.set(key, (g = { row: { project: e.project, runs: 0, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, priced: 0, lastAt: e.at }, runs: new Set() }));
		g.runs.add(e.run);
		g.row.turns++;
		g.row.input += e.input;
		g.row.output += e.output;
		g.row.cacheRead += e.cacheRead;
		g.row.cacheWrite += e.cacheWrite;
		if (e.cost !== null) {
			g.row.cost = (g.row.cost ?? 0) + e.cost;
			g.row.priced++;
		}
		if (e.at > g.row.lastAt) g.row.lastAt = e.at;
	}
	return [...by.values()].map((g) => ({ ...g.row, runs: g.runs.size })).sort((a, b) => b.input + b.output - (a.input + a.output));
}
