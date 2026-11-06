// App-wide renderer state: the open project, what the preview shows, and the Fokuss (what the agent is pointed at).
// A small external store, same pattern as windows.ts.
import { useSyncExternalStore } from "react";
import type { FocusItem } from "../shared/api";

export type PreviewTarget = { kind: "source"; sourceId: string; page?: number } | { kind: "ifc"; path: string; label: string } | { kind: "compare"; a: string; b: string; mode: "sheet" | "ifc" } | null;

interface UiState {
	projectId: string | null;
	preview: PreviewTarget;
	focus: FocusItem[];
	/** bumps when main says data changed, so panels reload */
	tick: number;
}

const KEY = "projektesana:ui";
let state: UiState = { projectId: null, preview: null, focus: [], tick: 0 };
try {
	const raw = localStorage.getItem(KEY);
	if (raw) state = { ...state, projectId: (JSON.parse(raw) as { projectId?: string }).projectId ?? null };
} catch {
	// no storage: start without a project
}

const listeners = new Set<() => void>();
function set(patch: Partial<UiState>) {
	state = { ...state, ...patch };
	try {
		localStorage.setItem(KEY, JSON.stringify({ projectId: state.projectId }));
	} catch {
		// not remembered, nothing else changes
	}
	for (const l of listeners) l();
}

export const ui = {
	get: () => state,
	setProject: (projectId: string | null) => set({ projectId, preview: null, focus: [] }),
	show: (preview: PreviewTarget) => set({ preview }),
	/** Adds to the Fokuss, replacing an item with the same kind and id. */
	focusAdd: (item: FocusItem) => set({ focus: [...state.focus.filter((f) => !(f.kind === item.kind && f.id === item.id)), item] }),
	focusRemove: (kind: FocusItem["kind"], id: string) => set({ focus: state.focus.filter((f) => !(f.kind === kind && f.id === id)) }),
	focusClear: () => set({ focus: [] }),
	bump: () => set({ tick: state.tick + 1 }),
};

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useUi(): UiState {
	return useSyncExternalStore(subscribe, () => state);
}
