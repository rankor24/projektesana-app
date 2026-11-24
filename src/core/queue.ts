// The run queue as plain data: who may start next, and how it is kept on disk. No timers, no runs.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Limits, QueueItem, Running, Wave, WaitReason } from "../shared/thread-types.js";

// The shapes live in shared/thread-types.ts (the window imports them and must not reach node:fs through this file).
export type { QueueItem, Running, Wave, WaitReason };

/** Has the wave reached a limit: `runs` when it has started `runsPerWave` runs, `cost` when `waveCost` is set and spent; null while it may start more. Runs are named first. */
export function waveCheck(w: Wave, l: Limits): null | "runs" | "cost" {
	if (w.runs >= l.runsPerWave) return "runs";
	if (l.waveCost !== null && w.cost >= l.waveCost) return "cost";
	return null;
}

/** The oldest queued item whose thread is not running, while fewer than `cap` runs are not waiting for a confirmation.
 *  Two conversations of one agent (two Lead agent chats) run side by side: what they share is guarded where it is used (the write locks, the one Revit seat), not here.
 *  `blocked` names items that must wait for now (a paused agent's, a paused wave's); the pick goes on to the next. It is asked only of items that could otherwise start. */
export function pickNext(queue: QueueItem[], running: Running[], cap: number, paused: boolean, blocked?: (q: QueueItem) => boolean): QueueItem | null {
	if (paused) return null;
	// A run parked on a confirmation does not hold a slot: the user may be away for hours.
	const active = running.filter((r) => !r.waitingConfirm).length;
	if (active >= Math.max(1, cap)) return null;
	return queue.find((q) => q.state === "queued" && !running.some((r) => r.threadId === q.threadId) && !blocked?.(q)) ?? null;
}

/** Why a queued item is not running: the whole queue is paused, its agent is paused, its wave hit a limit, its own conversation is still answering,
 *  or all `cap` slots are taken. Same order `pickNext` checks them in. null = nothing holds it (it starts at the next pick). */
export function waitReason(q: QueueItem, running: Running[], cap: number, paused: boolean, blocked?: (q: QueueItem) => "held" | "wave" | null): WaitReason | null {
	if (paused) return { kind: "paused" };
	const b = blocked?.(q);
	if (b) return { kind: b };
	if (running.some((r) => r.threadId === q.threadId)) return { kind: "thread" };
	const active = running.filter((r) => !r.waitingConfirm).length;
	if (active >= Math.max(1, cap)) return { kind: "cap", active, cap: Math.max(1, cap) };
	return null;
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

/** Missing file: empty. Damaged file: empty and paused, so nothing starts by itself after damage. A file that lost items to the shape check
 *  is paused too, whatever it said. Never throws. */
export function loadQueue(file: string): { items: QueueItem[]; paused: boolean } {
	if (!existsSync(file)) return { items: [], paused: false };
	try {
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("shape");
		const o = raw as { items?: unknown; paused?: unknown };
		if (!Array.isArray(o.items) || typeof o.paused !== "boolean") throw new Error("shape");
		const items = o.items.filter(isItem);
		return { items, paused: o.paused || items.length < o.items.length };
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
