// "Gaida tevi": everything that waits for the user, in one list. Pure; the coordinator and later tasks hand in their parts, the renderer reads the result.
import type { WaitingItem } from "./thread-types.js";

export type { WaitingItem } from "./thread-types.js";

type Of<K extends WaitingItem["kind"]> = Extract<WaitingItem, { kind: K }>;

/** What needs an answer first comes first: a run parked on a confirmation holds a slot of the user's attention, an interrupted restart can wait. */
export function waitingItems(i: { confirms: Of<"confirm">[]; restore: { interrupted: number; queued: number } | null; paused: Of<"wave-paused">[]; questions: Of<"question">[]; gates: Of<"gate">[]; escalated?: Of<"escalated">[] }): WaitingItem[] {
	return [...i.confirms, ...i.gates, ...(i.escalated ?? []), ...i.questions, ...i.paused, ...(i.restore ? [{ kind: "interrupted" as const, ...i.restore }] : [])];
}
