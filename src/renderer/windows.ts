// The window layout store (task 9.0): a small external store over the pure layout model (shared/layout.ts) for
// useSyncExternalStore. There is ONE layout for the whole app, as in BIM Crew: a window stays where the user put it when
// the page changes, and a page adds its own windows the first time it is opened. It is kept in the app's data folder through
// main (layout.json), not in localStorage; the old `projektesana:windows` value and the per-page layouts of the first
// builds are read once and migrated. BIM Crew's floating-workspace store is
// the model (WindowState / WindowMode); here every window is in a tab group that floats or docks on one of four sides.
import { useSyncExternalStore } from "react";
import * as L from "../shared/layout";
import { defaultLayout, pageById, resolveOpen, SIDEBAR_SIZE, START_PAGE } from "../shared/pages";
import { popIdOf } from "../shared/popout";
import { call, on } from "./bridge";
import { tr } from "./i18n";

export const PANELS = L.PANEL_IDS;
export type PanelId = (typeof L.PANEL_IDS)[number];

export const PANEL_TITLE: Record<PanelId, string> = {
	projekts: tr("Projekti"),
	parskats: tr("Pārskats"),
	koordinacija: tr("Koordinācija"),
	normativi: tr("Normatīvi"),
	telpaslapa: tr("Telpas (lapa)"),
	faili: tr("Faili"),
	grafiks: tr("Grafiks"),
	avoti: tr("Avoti"),
	prasibas: tr("Prasības"),
	telpas: tr("Telpas"),
	nodevumi: tr("Nodevumi"),
	atmina: tr("Atmiņa"),
	versijas: tr("Versijas"),
	iestatijumi: tr("Iestatījumi"),
	prasmes: tr("Prasmes"),
	agenti: tr("Aģenti"),
};
export const WINDOW_TITLE: Record<string, string> = {
	...PANEL_TITLE,
	chat: tr("Aģents"),
	tools: tr("Komentāru rīki"),
	"viewer.props": tr("Īpašības"),
	"viewer.tree": tr("Elementu koks"),
	"viewer.ifcmeta": tr("IFC metadati"),
	"viewer.filemeta": tr("Faila metadati"),
	"viewer.comments": tr("Komentāri / BCF"),
	"coord.matrix": tr("Koordinācijas matrica"),
	"coord.reference": tr("Atsauce"),
	"coord.lines": tr("Šūnas labojumi"),
	"vers.list": tr("Izmaiņas"),
	"vers.models": tr("Modeļi"),
	"vers.sheets": tr("Lapu izmaiņas"),
	"vers.revit": tr("Revit"),
	"telpas.diffs": tr("Atšķirības"),
	"telpas.inventory": tr("Inventarizācija"),
	"telpas.inv": tr("INV Area"),
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
/** which layout window this OS window shows (a pop-out), or null for the main window */
export const POP_ID = typeof location === "undefined" ? null : popIdOf(location.search);
/** names this window to main, so it does not adopt its own "layout.changed" */
const ORIGIN = Math.random().toString(36).slice(2, 10);
const vp = (): L.Vp => ({ w: window.innerWidth, h: window.innerHeight });
let defaultFor: (page: string) => L.Layout = defaultLayout;
let state: WindowsState = { page: START_PAGE, layout: L.emptyLayout(), store: L.emptyStore(), loaded: false };
const listeners = new Set<() => void>();
let listening = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function notify() {
	for (const l of listeners) l();
}
let unsaved = false;
function saveNow() {
	clearTimeout(saveTimer);
	if (!unsaved) return;
	unsaved = false;
	call("layout.set", state.store, ORIGIN).catch(() => {
		// the layout is not remembered this time; nothing else changes
	});
}
function scheduleSave() {
	if (!state.loaded || POP_ID) return; // never overwrite the file with defaults before it was read; a pop-out does not own the layout
	unsaved = true;
	clearTimeout(saveTimer);
	saveTimer = setTimeout(saveNow, 400);
}
// the last move before the app closes is kept too (the timer would die with the window)
if (typeof window !== "undefined") window.addEventListener("beforeunload", saveNow);
function commit(next: L.Layout) {
	if (next === state.layout) return;
	state = { ...state, layout: next, store: L.withShared(state.store, next) };
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
		const migrating = !store.shared;
		const base = L.sharedLayout(store, page, defaultFor, vp());
		// a store from the per-page builds starts the shared layout: the open page's windows are added once (the tool bar too)
		const seeded = migrating ? L.addMissing(base, defaultFor(page), vp()) : base;
		// the OS windows of a last session are gone: whatever was popped out is docked back (a pop-out window shows its one window)
		const layout = POP_ID ? seeded : L.popInAll(seeded, vp());
		state = { ...state, page, store, loaded: true, layout, ...(POP_ID ? {} : { store: L.withShared(store, layout, store.visited ?? [page]) }) };
		notify();
		scheduleSave();
		windows.listen();
	},
	/** One store for every window (task 9.11): what another window saved is adopted; our own saves are ignored. */
	listen() {
		if (listening) return;
		listening = true;
		on("layout.changed", ({ store, origin }) => {
			if (origin === ORIGIN) return;
			const page = POP_ID && store.current && pageById(store.current) ? store.current : state.page;
			state = { ...state, store, page, layout: L.sharedLayout(store, page, defaultFor, vp()) };
			notify();
		});
		// the OS window of a popped window was closed: it docks back where it was
		on("layout.popped", ({ id }) => {
			if (!POP_ID) op((l, v) => L.popIn(l, id, v));
		});
	},
	/**
	 * The page changes; the windows do not. A page that was never opened adds its own windows to the shared layout (each where
	 * the page's default puts it, nothing that is open is moved); after that it leaves the layout alone, so a window the user
	 * closed stays closed (the Windows menu brings it back).
	 */
	setPage(page: string, canvasFilter?: string) {
		if (page === state.page && state.loaded) {
			if (canvasFilter !== state.canvasFilter) (state = { ...state, canvasFilter }), notify();
			return;
		}
		const seen = state.store.visited ?? [];
		const first = state.loaded && !seen.includes(page);
		const layout = first ? L.addMissing(state.layout, defaultFor(page), vp()) : state.layout;
		state = { ...state, page, canvasFilter, layout, store: { ...L.withShared(state.store, layout, first ? [...seen, page] : seen), current: page } };
		notify();
		scheduleSave();
	},
	/** The rail, Ctrl+K, the agent's open_panel and the links between panels: a page opens as the page; a global window floats. */
	go(name: string, filter?: string) {
		// a pop-out has no pages: the main window goes there
		if (POP_ID) return void call("layout.relay", { t: "go", name, ...(filter !== undefined ? { filter } : {}) }).catch(() => undefined);
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
	/** a floating group fills the screen, or goes back (BIM Crew: the maximize button, a double-click on the title bar) */
	maximize: (id: string) => op((l, v) => L.toggleMaximize(l, id, v)),
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
	/** Pops a window out to its own OS window (a second monitor); if the window cannot be made it stays where it was. */
	popOut(id: string) {
		const before = state.layout;
		op((l, v) => L.popOut(l, id, v));
		call("layout.popOut", id).catch(() => commit(before));
	},
	/** Docks a popped window back and closes its OS window. */
	popIn(id: string) {
		op((l, v) => L.popIn(l, id, v));
		call("layout.popIn", id).catch(() => undefined);
	},
	setFilter: (id: string, filter: string | undefined) => op((l) => L.setFilter(l, id, filter)),
	/** The Windows menu: a closed window opens where the page's default keeps it; an open one closes (the chat never). */
	toggleOnPage(id: string) {
		if (L.groupOf(state.layout, id)) return id === L.CHAT ? windows.focus(id) : windows.close(id);
		op((l, v) => L.reopen(l, id, L.normalize(defaultFor(state.page), v), v));
	},
	/** Every window goes back to where this page's default puts it (the other pages add theirs again when they are opened). */
	resetLayout() {
		const layout = L.normalize(defaultFor(state.page), vp());
		state = { ...state, layout, store: L.withShared(state.store, layout, [state.page]) };
		notify();
		scheduleSave();
	},
	get: () => state,
};

const subscribe = (l: () => void) => {
	listeners.add(l);
	return () => listeners.delete(l);
};

export function useWindows(): WindowsState {
	return useSyncExternalStore(subscribe, () => state);
}
