// The window layout store (task 9.0): a small external store over the pure layout model (shared/layout.ts) for
// useSyncExternalStore. There is ONE layout for the whole app, as in BIM Crew: a window stays where the user put it when
// the page changes, and a page adds its own windows the first time it is opened. It is kept in the app's data folder through
// main (layout.json), not in localStorage; the old `projektesana:windows` value and the per-page layouts of the first
// builds are read once and migrated. BIM Crew's floating-workspace store is
// the model (WindowState / WindowMode); here every window is in a tab group that floats or docks on one of four sides.
import { useSyncExternalStore } from "react";
import * as L from "../shared/layout";
import { defaultLayout, LIST_DOCK_SIZE, LOG_DOCK_SIZE, LOG_PANEL, migrateToolsColumn, pageById, resolveOpen, START_PAGE, TOOLS_COLUMN } from "../shared/pages";
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
	zurnals: tr("Žurnāls"),
};
export const WINDOW_TITLE: Record<string, string> = {
	...PANEL_TITLE,
	chat: tr("Aģents"),
	tools: tr("Komentāru rīki"),
	threads: tr("Sarunas"),
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
	/** the list sidebar between the rail and the chat (B3, BIM Crew's Explorer column) */
	sidebar: L.SidebarState;
	store: L.LayoutStore;
	loaded: boolean;
}

/** which layout window this OS window shows (a pop-out), or null for the main window */
export const POP_ID = typeof location === "undefined" ? null : popIdOf(location.search);
/** names this window to main, so it does not adopt its own "layout.changed" */
const ORIGIN = Math.random().toString(36).slice(2, 10);
const vp = (): L.Vp => ({ w: window.innerWidth, h: window.innerHeight });
let defaultFor: (page: string) => L.Layout = defaultLayout;
let state: WindowsState = { page: START_PAGE, layout: L.emptyLayout(), sidebar: L.emptySidebar(), store: L.emptyStore(), loaded: false };
/** a stored sidebar that names something other than a list page shows nothing */
const validSidebar = (s: L.SidebarState): L.SidebarState => (s.id === L.THREADS ? s : { ...s, id: null, open: false });
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
function setSidebar(next: L.SidebarState) {
	const sidebar = validSidebar(next);
	if (JSON.stringify(sidebar) === JSON.stringify(state.sidebar)) return;
	state = { ...state, sidebar, store: { ...state.store, sidebar } };
	notify();
	scheduleSave();
}

export const windows = {
	/** Reads layout.json, then shows the current page's layout. */
	async init() {
		let store = L.emptyStore();
		try {
			store = await call("layout.get");
		} catch {
			// no file access: every page uses its default
		}
		const page = store.current && pageById(store.current) ? store.current : state.page;
		const migrating = !store.shared;
		const base = L.sharedLayout(store, page, defaultFor, vp());
		// a store from the per-page builds starts the shared layout: the open page's windows are added once (the tool bar too)
		const seeded = migrating ? L.addMissing(base, defaultFor(page), vp()) : base;
		// 2.6.7: floating comment tools go back to the column beside the chat, once
		const repaired = store.migrated?.includes(TOOLS_COLUMN) ? seeded : migrateToolsColumn(seeded);
		// the OS windows of a last session are gone: whatever was popped out is docked back (a pop-out window shows its one window)
		const layout = POP_ID ? repaired : L.popInAll(repaired, vp());
		// the list that was open (a list page as the current page, before plan C) is the sidebar's
		const sidebar = validSidebar(store.sidebar ?? (pageById(page)?.kind === "sidebar" ? { ...L.emptySidebar(), id: page, open: true } : L.emptySidebar()));
		const migrated = [...new Set([...(store.migrated ?? []), TOOLS_COLUMN])];
		state = { ...state, page, store, sidebar, loaded: true, layout, ...(POP_ID ? {} : { store: { ...L.withShared(store, layout, store.visited ?? [page]), sidebar, migrated } }) };
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
			state = { ...state, store, page, layout: L.sharedLayout(store, page, defaultFor, vp()), sidebar: validSidebar(store.sidebar ?? state.sidebar) };
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
		if (name === LOG_PANEL) return windows.openLog(filter);
		const t = resolveOpen(name, filter);
		if (!t || !t.page) return windows.openWindow(name, filter);
		const def = pageById(t.page)!;
		windows.setPage(t.page, def.kind === "page" ? t.filter : undefined);
		if (def.kind === "sidebar") {
			// a list opens in the right panel, as a tab stacked with the lists that are already there; one the user floated or
			// moved elsewhere is only brought to the front where it is
			if (!L.groupOf(state.layout, def.id)) op((l, v) => L.dock(L.open(l, def.id, v), def.id, "right", v, { size: LIST_DOCK_SIZE }));
			op((l, v) => L.open(l, def.id, v, t.filter));
		}
	},
	/**
	 * The agent log opens like a list page, in the right panel as a tab, but it is no page: the page the user is on stays. One the user floated or moved
	 * elsewhere is only brought to the front where it is. `filter`: a run id, or `thread:<id>` for the newest run of a thread.
	 */
	openLog(filter?: string) {
		if (!L.groupOf(state.layout, LOG_PANEL)) op((l, v) => L.dock(L.open(l, LOG_PANEL, v), LOG_PANEL, "right", v, { size: LOG_DOCK_SIZE }));
		// the time makes the same ask (the chat's button, again) count again after the user has picked another run
		op((l, v) => L.open(l, LOG_PANEL, v, filter ? `${filter.replace(/@\d+$/, "")}@${Date.now()}` : undefined));
	},
	/** The rail's item and the chat's button: a second click on the log that is the tab in front of the right panel closes it. */
	toggleLog() {
		const g = L.groupOf(state.layout, LOG_PANEL);
		if (g && g.place.kind === "dock" && !g.place.collapsed && g.active === LOG_PANEL) return op((l) => L.close(l, LOG_PANEL));
		windows.openLog();
	},
	/**
	 * A click on a rail item. A list that is the tab in front in the right panel closes on a second click (the other tabs stay);
	 * anything else opens.
	 */
	railClick(id: string) {
		if (pageById(id)?.kind === "sidebar" && state.page === id) {
			const g = L.groupOf(state.layout, id);
			if (g && g.place.kind === "dock" && !g.place.collapsed && g.active === id) return op((l) => L.close(l, id));
		}
		windows.go(id);
	},
	/** The conversations are the left side panel (BIM Crew's session sidebar): the rail item and the chat's button open and close it. */
	toggleThreads() {
		const s = state.sidebar;
		if (s.open && s.id === L.THREADS) return setSidebar({ ...s, open: false });
		// as a window it is brought to the front instead (the user made it one)
		if (L.groupOf(state.layout, L.THREADS)) return op((l, v) => L.open(l, L.THREADS, v));
		setSidebar({ ...s, id: L.THREADS, open: true });
	},
	/** The sidebar's edge was dragged (a width) or it was closed / reopened from its own header. */
	setSidebarWidth: (width: number) => setSidebar({ ...state.sidebar, width: L.clampSidebar(width) }),
	closeSidebar: () => setSidebar({ ...state.sidebar, open: false }),
	/** The list leaves the sidebar and becomes a floating window (every panel is detachable, P2); the rail then opens it there. */
	sidebarToWindow() {
		const s = state.sidebar;
		if (!s.id) return;
		setSidebar({ ...s, open: false });
		op((l, v) => L.open(l, s.id!, v, s.filter));
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
	/** The comment tools window draws its own height (its contents, CSS): the store only records it, so a move keeps it on the screen. */
	recordHeight(id: string, h: number) {
		const p = L.groupOf(state.layout, id)?.place;
		if (!p || p.kind !== "float" || h <= 0 || Math.abs(p.h - h) < 2) return;
		op((l, v) => L.resize(l, id, { x: p.x, y: p.y, w: p.w, h }, v));
	},
	/** a floating group fills the screen, or goes back (BIM Crew: the maximize button, a double-click on the title bar) */
	maximize: (id: string) => op((l, v) => L.toggleMaximize(l, id, v)),
	resizeDock: (side: L.Side, size: number) => op((l, v) => L.resizeDock(l, side, size, v)),
	dock: (id: string, side: L.Side, opts?: { whole?: boolean }) => op((l, v) => L.dock(l, id, side, v, opts)),
	undock: (id: string) => op((l, v) => L.undock(l, id, v)),
	/** into the slim column beside the chat (the comment tools' home) */
	toEdge: (id: string, opts?: { whole?: boolean }) => op((l) => L.toEdge(l, id, opts)),
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
