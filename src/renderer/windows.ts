// Floating window state. The model is BIM Crew's floating workspace (branch feat/floating-workspace-ui, store.ts
// WindowState / WindowMode, one window per kind, cascade geometry, one docked window at a time); rewritten as a small
// external store for useSyncExternalStore instead of BIM Crew's app-wide store.
import { useSyncExternalStore } from "react";

export const PANELS = ["projekts", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas", "iestatijumi"] as const;
export type PanelId = (typeof PANELS)[number];

export const PANEL_TITLE: Record<PanelId, string> = {
	projekts: "Projekts",
	avoti: "Avoti",
	prasibas: "Prasības",
	telpas: "Telpas",
	nodevumi: "Nodevumi",
	atmina: "Atmiņa",
	versijas: "Versijas",
	iestatijumi: "Iestatījumi",
};

export type WindowMode = "normal" | "maximized" | "minimized" | "docked";

export interface WindowState {
	id: PanelId;
	title: string;
	x: number;
	y: number;
	w: number;
	h: number;
	z: number;
	mode: WindowMode;
	/** a filter the panel opens with (open_panel tool, links between panels) */
	filter?: string;
}

interface State {
	windows: WindowState[];
	focused: PanelId | null;
}

const KEY = "projektesana:windows";
let state: State = load();
const listeners = new Set<() => void>();

function load(): State {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) {
			const s = JSON.parse(raw) as State;
			return { windows: (s.windows ?? []).filter((w) => PANELS.includes(w.id)), focused: s.focused ?? null };
		}
	} catch {
		// private mode or cleared storage: start with no windows
	}
	return { windows: [], focused: null };
}

function set(next: State) {
	state = next;
	try {
		localStorage.setItem(KEY, JSON.stringify(state));
	} catch {
		// storage unavailable: layout is not remembered, nothing else changes
	}
	for (const l of listeners) l();
}

const topZ = () => state.windows.reduce((m, w) => Math.max(m, w.z), 0);

function nextGeometry(count: number) {
	const w = Math.min(760, window.innerWidth - 80);
	const h = Math.min(620, window.innerHeight - 160);
	const off = (count % 6) * 28;
	return { x: Math.max(16, Math.min(120 + off, window.innerWidth - w - 16)), y: Math.max(16, Math.min(110 + off, window.innerHeight - h - 16)), w, h };
}

export const windows = {
	open(id: PanelId, filter?: string) {
		const have = state.windows.find((w) => w.id === id);
		if (have) {
			set({ windows: state.windows.map((w) => (w.id === id ? { ...w, mode: w.mode === "minimized" ? "normal" : w.mode, z: topZ() + 1, filter: filter ?? w.filter } : w)), focused: id });
			return;
		}
		const g = nextGeometry(state.windows.length);
		set({ windows: [...state.windows, { id, title: PANEL_TITLE[id], ...g, z: topZ() + 1, mode: "normal", filter }], focused: id });
	},
	toggle(id: PanelId) {
		const have = state.windows.find((w) => w.id === id);
		if (have && have.mode !== "minimized" && state.focused === id) windows.mode(id, "minimized");
		else windows.open(id);
	},
	close(id: PanelId) {
		set({ windows: state.windows.filter((w) => w.id !== id), focused: state.focused === id ? null : state.focused });
	},
	focus(id: PanelId) {
		if (state.focused === id && state.windows.find((w) => w.id === id)?.z === topZ()) return;
		set({ windows: state.windows.map((w) => (w.id === id ? { ...w, z: topZ() + 1 } : w)), focused: id });
	},
	move(id: PanelId, x: number, y: number) {
		set({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) });
	},
	resize(id: PanelId, g: { x: number; y: number; w: number; h: number }) {
		set({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, ...g } : w)) });
	},
	/** Only one window is docked at a time; docking another one returns the previous one to normal. */
	mode(id: PanelId, mode: WindowMode) {
		set({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, mode } : mode === "docked" && w.mode === "docked" ? { ...w, mode: "normal" } : w)) });
	},
	setFilter(id: PanelId, filter: string | undefined) {
		set({ ...state, windows: state.windows.map((w) => (w.id === id ? { ...w, filter } : w)) });
	},
	get: () => state,
};

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useWindows(): State {
	return useSyncExternalStore(subscribe, () => state);
}
