// The window layout store (task 9.0): a small external store over the pure layout model (shared/layout.ts) for
// useSyncExternalStore. The layout is per page and kept in the app's data folder through main (layout.json), not in
// localStorage; the old `projektesana:windows` value is read once and migrated. BIM Crew's floating-workspace store is
// the model (WindowState / WindowMode); here every window is in a tab group that floats or docks on one of four sides.
import { useSyncExternalStore } from "react";
import * as L from "../shared/layout";
import { defaultLayout, pageById, resolveOpen, SIDEBAR_SIZE, START_PAGE } from "../shared/pages";
import { call } from "./bridge";

export const PANELS = L.PANEL_IDS;
export type PanelId = (typeof L.PANEL_IDS)[number];

export const PANEL_TITLE: Record<PanelId, string> = {
	projekts: "Projekti",
	parskats: "Pārskats",
	koordinacija: "Koordinācija",
	normativi: "Normatīvi",
	faili: "Faili",
	grafiks: "Grafiks",
	avoti: "Avoti",
	prasibas: "Prasības",
	telpas: "Telpas",
	nodevumi: "Nodevumi",
	atmina: "Atmiņa",
	versijas: "Versijas",
	iestatijumi: "Iestatījumi",
};
export const WINDOW_TITLE: Record<string, string> = {
	...PANEL_TITLE,
	chat: "Aģents",
	"viewer.props": "Īpašības",
	"viewer.tree": "Elementu koks",
	"viewer.ifcmeta": "IFC metadati",
	"viewer.filemeta": "Faila metadati",
	"viewer.comments": "Komentāri / BCF",
	"coord.matrix": "Koordinācijas matrica",
	"coord.reference": "Atsauce",
	"coord.lines": "Šūnas labojumi",
};

export interface WindowsState {
	page: string;
	/** the filter the open full page's panel was opened with (a sidebar page's filter lives in the layout) */
	canvasFilter?: string;
	layout: L.Layout;
	store: L.LayoutStore;
	loaded: boolean;
}

const OLD_KEY = "projektesana:windows";
const vp = (): L.Vp => ({ w: window.innerWidth, h: window.innerHeight });
let defaultFor: (page: string) => L.Layout = defaultLayout;
let state: WindowsState = { page: START_PAGE, layout: L.emptyLayout(), store: L.emptyStore(), loaded: false };
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function notify() {
	for (const l of listeners) l();
}
function scheduleSave() {
	if (!state.loaded) return; // never overwrite the file with defaults before it was read
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		call("layout.set", state.store).catch(() => {
			// the layout is not remembered this time; nothing else changes
		});
	}, 400);
}
function commit(next: L.Layout) {
	if (next === state.layout) return;
	state = { ...state, layout: next, store: L.withPage(state.store, state.page, next) };
	notify();
	scheduleSave();
}
const op = (f: (l: L.Layout, v: L.Vp) => L.Layout) => commit(f(state.layout, vp()));

export const windows = {
	/** Reads layout.json (and migrates the old localStorage value once), then shows the current page's layout. */
	async init() {
		let store = L.emptyStore();
		try {
			store = await call("layout.get");
		} catch {
			// no file access: every page uses its default
		}
		if (!Object.keys(store.pages).length && !store.legacy) {
			try {
				const raw = localStorage.getItem(OLD_KEY);
				const old = raw ? L.fromLegacy(JSON.parse(raw), vp()) : null;
				if (old) store = { ...store, legacy: old };
				if (raw) localStorage.removeItem(OLD_KEY);
			} catch {
				// unreadable old value: start from the defaults
			}
		}
		const page = store.current && pageById(store.current) ? store.current : state.page;
		state = { ...state, page, store, loaded: true, layout: L.layoutFor(store, page, defaultFor, vp()) };
		notify();
		scheduleSave();
	},
	/** The page's layout becomes the one shown; a page that was never laid out gets `def(page)`. */
	setPage(page: string, canvasFilter?: string) {
		if (page === state.page && state.loaded) {
			if (canvasFilter !== state.canvasFilter) (state = { ...state, canvasFilter }), notify();
			return;
		}
		state = { ...state, page, canvasFilter, store: { ...state.store, current: page }, layout: L.layoutFor(state.store, page, defaultFor, vp()) };
		notify();
		scheduleSave();
	},
	/** The rail, Ctrl+K, the agent's open_panel and the links between panels: a page opens as the page; a global window floats. */
	go(name: string, filter?: string) {
		const t = resolveOpen(name, filter);
		if (!t || !t.page) return windows.openWindow(name, filter);
		const def = pageById(t.page)!;
		windows.setPage(t.page, def.kind === "page" ? t.filter : undefined);
		if (def.kind === "sidebar") {
			// the sidebar's panel is part of the page's layout; reopen it where it belongs if the user closed it
			if (!L.groupOf(state.layout, def.id)) op((l, v) => L.dock(L.open(l, def.id, v), def.id, "right", v, { size: SIDEBAR_SIZE }));
			op((l, v) => L.open(l, def.id, v, t.filter));
		}
	},
	/** The window changed size: every size is clamped again. */
	refit() {
		const n = L.normalize(state.layout, vp());
		if (JSON.stringify(n) !== JSON.stringify(state.layout)) commit(n);
	},
	/** Opens a window in the current page's layout (floating if new). Panel names that are pages go through `go`. */
	openWindow: (id: string, filter?: string) => op((l, v) => L.open(l, id, v, filter)),
	open: (id: string, filter?: string) => windows.go(id, filter),
	toggle: (id: string) => op((l, v) => L.toggle(l, id, v)),
	close: (id: string) => op((l) => L.close(l, id)),
	focus: (id: string) => op((l) => L.focus(l, id)),
	setActive: (id: string) => op((l) => L.setActive(l, id)),
	move: (id: string, x: number, y: number) => op((l, v) => L.move(l, id, x, y, v)),
	resize: (id: string, g: L.Geo) => op((l, v) => L.resize(l, id, g, v)),
	resizeDock: (side: L.Side, size: number) => op((l, v) => L.resizeDock(l, side, size, v)),
	dock: (id: string, side: L.Side, opts?: { whole?: boolean }) => op((l, v) => L.dock(l, id, side, v, opts)),
	undock: (id: string) => op((l, v) => L.undock(l, id, v)),
	pullOut: (id: string, at?: { x: number; y: number }) => op((l, v) => L.pullOut(l, id, v, at)),
	mergeInto: (id: string, targetId: string, index?: number) => op((l) => L.mergeInto(l, id, targetId, index)),
	/** a whole group dropped on a tab strip: every tab joins it */
	mergeGroup: (id: string, targetId: string) =>
		op((l) => {
			let next = l;
			for (const t of [...(L.groupOf(l, id)?.tabs ?? [])]) next = L.mergeInto(next, t, targetId);
			return next;
		}),
	reorder: (id: string, index: number) => op((l) => L.reorder(l, id, index)),
	collapse: (id: string, on = true) => op((l) => L.collapse(l, id, on)),
	popOut: (id: string) => op((l, v) => L.popOut(l, id, v)),
	popIn: (id: string) => op((l, v) => L.popIn(l, id, v)),
	setFilter: (id: string, filter: string | undefined) => op((l) => L.setFilter(l, id, filter)),
	get: () => state,
};

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useWindows(): WindowsState {
	return useSyncExternalStore(subscribe, () => state);
}
