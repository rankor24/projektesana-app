// What the user picked on the page to comment on (task 9.4): a row, a cell, a tile, a fact. A page calls `pick` on a click;
// the CommentTools palette reads it. One thing at a time, forgotten when the page changes.
import { useSyncExternalStore } from "react";
import type { PinTarget } from "../core/model";

export interface Subject {
	target: PinTarget;
	/** how the palette names it */
	label: string;
}
let current: Subject | null = null;
const listeners = new Set<() => void>();
const set = (s: Subject | null) => {
	current = s;
	for (const l of listeners) l();
};

export const commentSubject = {
	get: () => current,
	pick: (target: PinTarget, label: string) => set({ target, label }),
	clear: () => set(null),
};
export function useSubject(): Subject | null {
	return useSyncExternalStore(
		(l) => (listeners.add(l), () => listeners.delete(l)),
		() => current,
	);
}
