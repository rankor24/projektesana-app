// The run queue as plain data: who may start next, and how it is kept on disk. No timers, no runs.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { QueueItem, Running } from "../shared/thread-types.js";

// The shapes live in shared/thread-types.ts (the window imports them and must not reach node:fs through this file).
export type { QueueItem, Running };

/** The oldest queued item whose thread is not running, whose agent is not running in that project, while fewer than `cap` runs are not waiting for a confirmation. */
export function pickNext(queue: QueueItem[], running: Running[], cap: number, paused: boolean): QueueItem | null {
	if (paused) return null;
	// A run parked on a confirmation does not hold a slot: the user may be away for hours.
	const active = running.filter((r) => !r.waitingConfirm).length;
	if (active >= Math.max(1, cap)) return null;
	return (
		queue.find(
			(q) =>
				q.state === "queued" &&
				!running.some((r) => r.threadId === q.threadId || (r.agent === q.agent && r.projectId === q.projectId)),
		) ?? null
	);
}

function isItem(v: unknown): v is QueueItem {
	if (!v || typeof v !== "object") return false;
	const o = v as Record<string, unknown>;
	const s = (k: string) => typeof o[k] === "string";
	return (
		s("id") && s("threadId") && s("agent") && s("wave") && s("at") &&
		(o.projectId === null || typeof o.projectId === "string") &&
		(o.state === "queued" || o.state === "stopped") &&
		!!o.input && typeof o.input === "object" && !Array.isArray(o.input)
	);
}

/** Missing file: empty. Damaged file: empty and paused, so nothing starts by itself after damage. Never throws. */
export function loadQueue(file: string): { items: QueueItem[]; paused: boolean } {
	if (!existsSync(file)) return { items: [], paused: false };
	try {
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("shape");
		const o = raw as { items?: unknown; paused?: unknown };
		if (!Array.isArray(o.items) || typeof o.paused !== "boolean") throw new Error("shape");
		return { items: o.items.filter(isItem), paused: o.paused };
	} catch {
		return { items: [], paused: true };
	}
}

/** Temp file + rename, as `atomicWrite` in store.ts: a crash leaves the old file or the new one, never half. */
export function saveQueue(file: string, q: { items: QueueItem[]; paused: boolean }): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(q, null, 1));
	renameSync(tmp, file);
}
