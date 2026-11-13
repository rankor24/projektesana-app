// App-wide renderer state: the open project, what the preview shows, and the Fokuss (what the agent is pointed at).
// A small external store, same pattern as windows.ts.
import { useSyncExternalStore } from "react";
import type { FocusItem } from "../shared/api";

export type PreviewTarget = { kind: "source"; sourceId: string; page?: number } | { kind: "ifc"; path: string; label: string } | { kind: "compare"; a: string; b: string; aLabel: string; bLabel: string; mode: "sheet" | "ifc" } | { kind: "law"; sourceId: string; quote?: string } | null;

interface UiState {
	projectId: string | null;
	preview: PreviewTarget;
	focus: FocusItem[];
	/** text the palette (or another part of the window) puts in the agent's message box: the dock takes it and clears it */
	draft: string | null;
	/** GlobalIds the viewer selects as soon as the model it is about to open is open (a sheet change traced to elements, 8.11) */
	highlight: string[] | null;
	/** bumps when main says data changed, so panels reload */
	tick: number;
}

const KEY = "projektesana:ui";
let state: UiState = { projectId: null, preview: null, focus: [], draft: null, highlight: null, tick: 0 };

/** The files the user opened lately, per project, for the command palette: a source or an IFC, newest first. */
export type RecentTarget = { kind: "source"; sourceId: string } | { kind: "ifc"; path: string; label: string };
const RECENT_KEY = "projektesana:recent";
function readRecent(): Record<string, RecentTarget[]> {
	try {
		return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") as Record<string, RecentTarget[]>;
	} catch {
		return {};
	}
}
const sameTarget = (a: RecentTarget, b: RecentTarget) => (a.kind === "source" && b.kind === "source" ? a.sourceId === b.sourceId : a.kind === "ifc" && b.kind === "ifc" && a.path === b.path);
function remember(projectId: string | null, p: PreviewTarget) {
	if (!projectId || !p || (p.kind !== "source" && p.kind !== "ifc")) return;
	const t: RecentTarget = p.kind === "source" ? { kind: "source", sourceId: p.sourceId } : { kind: "ifc", path: p.path, label: p.label };
	try {
		const all = readRecent();
		all[projectId] = [t, ...(all[projectId] ?? []).filter((x) => !sameTarget(x, t))].slice(0, 8);
		localStorage.setItem(RECENT_KEY, JSON.stringify(all));
	} catch {
		// not remembered: the palette just has no recent files
	}
}
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
	show: (preview: PreviewTarget) => {
		remember(state.projectId, preview);
		set({ preview });
	},
	recent: (projectId: string | null): RecentTarget[] => (projectId ? readRecent()[projectId] ?? [] : []),
	draft: (text: string | null) => set({ draft: text }),
	highlightNext: (guids: string[] | null) => set({ highlight: guids }),
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
