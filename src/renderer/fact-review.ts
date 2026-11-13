// The fact review in progress (task 9.7): which fact the card is on, for which project, and whether the quote was found on
// the page that is open. A small external store, same pattern as windows.ts; the walk itself is shared/fact-review.ts.
import { useSyncExternalStore } from "react";

export interface ReviewState {
	projectId: string | null;
	/** the fact the card shows; null = no review */
	current: string | null;
	/** what the PDF view found of the quote on the page it shows */
	found: "whole" | "start" | null;
	/** the review started from this fact: the walk begins there instead of at the first */
	startedAt: string | null;
}

let state: ReviewState = { projectId: null, current: null, found: null, startedAt: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<ReviewState>) => {
	state = { ...state, ...patch };
	for (const l of listeners) l();
};

export const factReview = {
	get: () => state,
	/** Starts the review: at a given fact, or (none given) at the first waiting one, which the card picks. */
	start: (projectId: string, factId?: string) => set({ projectId, current: factId ?? "", startedAt: factId ?? null, found: null }),
	go: (factId: string | null) => set({ current: factId, found: null }),
	quoteFound: (found: "whole" | "start" | null) => set({ found }),
	stop: () => set({ current: null, found: null, startedAt: null }),
};

export function useFactReview(): ReviewState {
	return useSyncExternalStore(
		(l) => (listeners.add(l), () => listeners.delete(l)),
		() => state,
	);
}
