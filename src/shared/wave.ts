// What the chat shows of waves. Pure.
import type { Running, Wave } from "./thread-types.js";

/** "vilnis: 7 skrējieni · $0.42"; the cost is left out when it is 0 (the provider gave none, or nothing was spent yet). */
export function waveLine(w: Wave): string {
	return `vilnis: ${w.runs} skrējieni${w.cost > 0 ? ` · $${w.cost.toFixed(2)}` : ""}`;
}

/** The wave the open project's chat shows: one with a run going first, else the newest. null when the project has none. */
export function currentWave(waves: readonly Wave[], running: readonly Running[], projectId: string | null): Wave | null {
	const mine = waves.filter((w) => w.projectId === projectId);
	const newest = (ws: Wave[]) => ws.reduce<Wave | null>((a, w) => (!a || w.startedAt > a.startedAt ? w : a), null);
	return newest(mine.filter((w) => running.some((r) => r.wave === w.id))) ?? newest(mine);
}
