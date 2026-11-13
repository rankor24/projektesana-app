// App-wide renderer state: the open project, what the preview shows, and the Fokuss (what the agent is pointed at).
// A small external store, same pattern as windows.ts.
import { useSyncExternalStore } from "react";
import type { FocusItem } from "../shared/api";
import type { PinCamera } from "../core/model";
import type { ViewKind, ViewMode, ViewState } from "../shared/view-context";

export type PreviewTarget = { kind: "source"; sourceId: string; page?: number } | { kind: "ifc"; path: string; label: string } | { kind: "compare"; a: string; b: string; aLabel: string; bLabel: string; mode: "sheet" | "ifc" } | { kind: "law"; sourceId: string; quote?: string } | null;

interface UiState {
	projectId: string | null;
	preview: PreviewTarget;
	focus: FocusItem[];
	/** text the palette (or another part of the window) puts in the agent's message box: the dock takes it and clears it */
	draft: string | null;
	/** GlobalIds the viewer selects as soon as the model it is about to open is open (a sheet change traced to elements, 8.11) */
	highlight: string[] | null;
	/** what the open viewer tab shows: file, page, selection, camera (task 9.2); the chat's Auto mode sends it */
	view: ViewState;
	/** the user's choice of Auto / Manual for the tab kind it was made on; null = the default of the tab */
	viewChoice: { kind: ViewKind; mode: ViewMode } | null;
	/** bumps when main says data changed, so panels reload */
	tick: number;
}

const KEY = "projektesana:ui";
const NO_VIEW: ViewState = { kind: null, selection: [] };
let state: UiState = { projectId: null, preview: null, focus: [], draft: null, highlight: null, view: NO_VIEW, viewChoice: null, tick: 0 };

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
	setProject: (projectId: string | null) => {
		showHook?.(null);
		set({ projectId, preview: null, focus: [], view: NO_VIEW });
	},
	/** Opens a file in the viewer (a tab; the same file again brings its tab forward). The viewer mirrors it back as `preview`. */
	show: (preview: PreviewTarget) => {
		remember(state.projectId, preview);
		if (showHook) showHook(preview);
		else set({ preview });
	},
	/** The viewer's active tab became this (shell/viewer-store.ts); no tab → null. */
	mirrorPreview: (preview: PreviewTarget) => set({ preview }),
	/** The viewer registers how a file is opened (so state.ts does not import the viewer). */
	onShow: (fn: ((p: PreviewTarget) => void) | null) => {
		showHook = fn;
	},
	recent: (projectId: string | null): RecentTarget[] => (projectId ? readRecent()[projectId] ?? [] : []),
	draft: (text: string | null) => set({ draft: text }),
	highlightNext: (guids: string[] | null) => set({ highlight: guids }),
	/** Adds to the Fokuss, replacing an item with the same kind and id. */
	focusAdd: (item: FocusItem) => set({ focus: [...state.focus.filter((f) => !(f.kind === item.kind && f.id === item.id)), item] }),
	focusRemove: (kind: FocusItem["kind"], id: string) => set({ focus: state.focus.filter((f) => !(f.kind === kind && f.id === id)) }),
	focusClear: () => set({ focus: [] }),
	bump: () => set({ tick: state.tick + 1 }),
	/** The viewer tells what it shows. A new file (another kind, label, path or source) starts with no selection, camera or page. */
	setView: (patch: Partial<ViewState>) => {
		const v = state.view;
		const fresh = ("kind" in patch && patch.kind !== v.kind) || ("label" in patch && patch.label !== v.label) || ("path" in patch && patch.path !== v.path) || ("sourceId" in patch && patch.sourceId !== v.sourceId);
		const next: ViewState = fresh ? { kind: null, selection: [], ...patch } : { ...v, ...patch };
		set({ view: next });
		for (const w of viewWaiters.splice(0)) w();
	},
	setViewMode: (mode: ViewMode) => set({ viewChoice: { kind: state.view.kind, mode } }),
	/** Resolves when the viewer next reports (the camera it was asked for), or after `ms`. */
	nextView: (ms = 600) =>
		new Promise<void>((resolve) => {
			const t = setTimeout(resolve, ms);
			viewWaiters.push(() => (clearTimeout(t), resolve()));
		}),
};
const viewWaiters: (() => void)[] = [];
let showHook: ((p: PreviewTarget) => void) | null = null;
export type { PinCamera };

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useUi(): UiState {
	return useSyncExternalStore(subscribe, () => state);
}
