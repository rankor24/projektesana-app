// Marks drawn on a view and not yet saved with a comment (task 9.4): one list per drawing surface (a viewer pane), and which surface the
// user drew on last. The 3D view's own pin and the page's comment strip both read it, so a rectangle drawn on a sheet compare reaches the
// "Apgabals" tool under it. A small external store, same pattern as fact-review.ts.
import { useSyncExternalStore } from "react";
import type { Markup } from "../core/model";

export interface MarksState {
	by: Record<string, Markup[]>;
	/** the surface drawn on most recently: the comment strip takes its marks */
	last: string | null;
}

let state: MarksState = { by: {}, last: null };
const listeners = new Set<() => void>();
const set = (next: MarksState) => {
	state = next;
	for (const l of listeners) l();
};

/** The surface key of a viewer pane. */
export const paneSurface = (paneIndex: number) => `pane${paneIndex}`;

export const pageMarks = {
	get: () => state,
	of: (surface: string): Markup[] => state.by[surface] ?? [],
	add: (surface: string, m: Markup) => set({ by: { ...state.by, [surface]: [...(state.by[surface] ?? []), m] }, last: surface }),
	clear: (surface: string) => {
		if (!state.by[surface]?.length) return;
		const { [surface]: _gone, ...by } = state.by;
		set({ by, last: state.last === surface ? null : state.last });
	},
	/** what the comment strip uses: the marks of the surface drawn on last, and that surface (to clear it once the pin is saved) */
	latest: (): { surface: string | null; marks: Markup[] } => ({ surface: state.last, marks: state.last ? (state.by[state.last] ?? []) : [] }),
};

export function usePageMarks(): MarksState {
	return useSyncExternalStore(
		(l) => (listeners.add(l), () => listeners.delete(l)),
		() => state,
	);
}
