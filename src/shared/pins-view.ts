// How the annotation view numbers and orders a file's pins (task 8.2). Pure, so the dot in 3D, the dot on the page and the
// row in the list always agree on the number.
import type { Pin } from "../core/model.js";

export interface NumberedPin {
	pin: Pin;
	/** 1-based, by creation time among this file's pins: it never changes when another pin closes */
	n: number;
}

const RANK = { open: 0, resolved: 1, closed: 2 } as const;

export function numbered(pins: Pin[]): NumberedPin[] {
	return [...pins].sort((a, b) => a.at.localeCompare(b.at)).map((pin, i) => ({ pin, n: i + 1 }));
}

/** Open first (oldest first: they wait longest), then resolved ones waiting for the user, closed last. */
export function listOrder(items: NumberedPin[]): NumberedPin[] {
	return [...items].sort((a, b) => RANK[a.pin.state] - RANK[b.pin.state] || a.n - b.n);
}
