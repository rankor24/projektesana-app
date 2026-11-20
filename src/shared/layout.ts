// The layout model (task 9.0). Every window of the app (a panel, the chat, the viewer's side panels) is in exactly one
// place: floating over the canvas, docked on one of the four sides, minimised, or popped out to its own OS window.
// Windows that sit together are a tab group: a group has an ordered list of tabs and the active one, and one place.
// Each side holds at most one dock group. The chat is never closed, only collapsed. One layout for the whole app, as in BIM
// Crew: a window stays where the user put it when the page changes; a page adds its own windows the first time it is opened.
// Pure and node-free: the renderer store, main's layout file and the tests use the same functions. The model of windows,
// dock sides and tabs is BIM Crew's floating workspace (store.ts WindowState / WindowMode), extended from "one docked
// window at a time" to a group per side.

export const SIDES = ["left", "right", "top", "bottom"] as const;
export type Side = (typeof SIDES)[number];

/** Everything that can be a window. Panels first; the viewer's side panels (9.3); the chat. */
export const PANEL_IDS = ["projekts", "parskats", "faili", "grafiks", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas", "koordinacija", "normativi", "telpaslapa", "iestatijumi", "prasmes", "agenti"] as const;
export const VIEWER_PANEL_IDS = ["viewer.props", "viewer.tree", "viewer.ifcmeta", "viewer.filemeta", "viewer.comments"] as const;
export const COORD_PANEL_IDS = ["coord.matrix", "coord.reference", "coord.lines"] as const;
export const VERS_PANEL_IDS = ["vers.list", "vers.models", "vers.sheets", "vers.revit"] as const;
export const TELPAS_PANEL_IDS = ["telpas.diffs", "telpas.inventory", "telpas.inv"] as const;
/** The comment tool bar (9.4): a window like any other, so it can float, dock on any side, join a tab group or pop out. */
export const TOOLS = "tools";
/** The conversation list (BIM Crew: "Chat history", a panel of its own, never inside the chat): a window like the others. */
export const THREADS = "threads";
export const WINDOW_IDS: readonly string[] = ["chat", TOOLS, THREADS, ...PANEL_IDS, ...VIEWER_PANEL_IDS, ...COORD_PANEL_IDS, ...VERS_PANEL_IDS, ...TELPAS_PANEL_IDS];
export const CHAT = "chat";
export const isWindowId = (id: unknown): id is string => typeof id === "string" && WINDOW_IDS.includes(id);

export interface Geo {
	x: number;
	y: number;
	w: number;
	h: number;
}
export interface Vp {
	w: number;
	h: number;
}
/** `restore`: the geometry to go back to after a maximize (BIM Crew WindowState.restore) */
export type FloatPlace = { kind: "float"; z: number; restore?: Geo } & Geo;
export type DockPlace = { kind: "dock"; side: Side; size: number; collapsed: boolean };
/**
 * The slim column between the chat and the canvas (the board's purple "Comment Tools" column, 95 px, beside the chat on every
 * page). One group at most, like a dock side; it is the comment tool bar's default place, and any window can be put there.
 */
export type EdgePlace = { kind: "edge" };
export type Restorable = FloatPlace | DockPlace | EdgePlace;
export type Place = Restorable | { kind: "min"; from: Restorable } | { kind: "pop"; from: Restorable };

export interface Group {
	tabs: string[];
	active: string;
	place: Place;
}
export interface Layout {
	groups: Group[];
	focused: string | null;
	/** a filter a panel opens with (open_panel, links between panels) */
	filters: Record<string, string>;
}

export const MIN_W = 280;
export const MIN_H = 200;
export const MIN_DOCK = 200;
export const DEFAULT_DOCK = 440;
export const DEFAULT_DOCK_H = 320;
const MAX_DOCK_SHARE = 0.6;

const isVertical = (side: Side) => side === "left" || side === "right";
const defaultSize = (side: Side) => (isVertical(side) ? DEFAULT_DOCK : DEFAULT_DOCK_H);

/** The smallest layout: the chat docked on the left. Pages (9.1) build their defaults from this. */
export function emptyLayout(): Layout {
	return { groups: [{ tabs: [CHAT], active: CHAT, place: { kind: "dock", side: "left", size: DEFAULT_DOCK, collapsed: false } }], focused: CHAT, filters: {} };
}

// ---- reading ----

export const groupOf = (l: Layout, id: string): Group | undefined => l.groups.find((g) => g.tabs.includes(id));
export const allWindows = (l: Layout): string[] => l.groups.flatMap((g) => g.tabs);
export const dockGroup = (l: Layout, side: Side): Group | undefined => l.groups.find((g) => g.place.kind === "dock" && g.place.side === side);
export const edgeGroup = (l: Layout): Group | undefined => l.groups.find((g) => g.place.kind === "edge");
/** The edge column's width: the board's 95 px column, so a tool's icon and its label fit under each other. */
export const EDGE_SIZE = 96;
export const floatGroups = (l: Layout): Group[] => l.groups.filter((g) => g.place.kind === "float").sort((a, b) => (a.place as FloatPlace).z - (b.place as FloatPlace).z);
const topZ = (l: Layout) => l.groups.reduce((m, g) => (g.place.kind === "float" ? Math.max(m, g.place.z) : m), 0);

// ---- geometry ----

export function clampGeo(g: Geo, vp: Vp): Geo {
	const w = Math.max(MIN_W, Math.min(g.w, vp.w - 16));
	const h = Math.max(MIN_H, Math.min(g.h, vp.h - 16));
	return { x: Math.max(0, Math.min(g.x, Math.max(0, vp.w - w))), y: Math.max(0, Math.min(g.y, Math.max(0, vp.h - h))), w, h };
}
/** A bar docked on the top or bottom may be as slim as the comment tool bar; a side panel needs its width. */
export const MIN_DOCK_BAR = 72;
export function clampDock(side: Side, size: number, vp: Vp): number {
	const min = isVertical(side) ? MIN_DOCK : MIN_DOCK_BAR;
	const max = Math.max(min, Math.floor((isVertical(side) ? vp.w : vp.h) * MAX_DOCK_SHARE));
	return Math.max(min, Math.min(Math.round(size), max));
}
/** A new window opens big enough to work in: about half the screen wide and two thirds high (never under 720 x 520). */
export function defaultFloat(vp: Vp): { w: number; h: number } {
	return { w: Math.max(720, Math.min(Math.round(vp.w * 0.55), 1200)), h: Math.max(520, Math.min(Math.round(vp.h * 0.72), 860)) };
}
/** A list wants a tall, narrow window, not half the screen. */
const FLOAT_SIZE: Record<string, { w: number; h: number }> = { [THREADS]: { w: 480, h: 640 }, [TOOLS]: { w: 560, h: 260 }, "coord.reference": { w: 680, h: 720 } };
function cascade(l: Layout, vp: Vp, id?: string): Geo {
	const n = l.groups.filter((g) => g.place.kind === "float").length;
	const off = (n % 6) * 28;
	return clampGeo({ x: 120 + off, y: 110 + off, ...((id && FLOAT_SIZE[id]) || defaultFloat(vp)) }, vp);
}
const clampPlace = <P extends Restorable>(p: P, vp: Vp): P => (p.kind === "float" ? { ...p, ...clampGeo(p, vp) } : p.kind === "dock" ? { ...p, size: clampDock(p.side, p.size, vp) } : p);

// ---- helpers that keep the invariants ----

/** The tab at the same index after a removal, else the last one: closing the active tab picks its neighbour. */
function neighbour(tabs: string[], removedAt: number): string {
	return tabs[Math.min(removedAt, tabs.length - 1)];
}

/** Takes `id` out of its group; an emptied group disappears. Returns the group it was in (as it was) for its place. */
function detach(l: Layout, id: string): { layout: Layout; from?: Group } {
	const g = groupOf(l, id);
	if (!g) return { layout: l };
	const at = g.tabs.indexOf(id);
	const tabs = g.tabs.filter((t) => t !== id);
	const groups = tabs.length ? l.groups.map((x) => (x === g ? { ...x, tabs, active: g.active === id ? neighbour(tabs, at) : g.active } : x)) : l.groups.filter((x) => x !== g);
	return { layout: { ...l, groups }, from: g };
}

const restorable = (p: Place): Restorable => (p.kind === "min" || p.kind === "pop" ? p.from : p);

function addGroup(l: Layout, id: string, place: Place): Layout {
	return { ...l, groups: [...l.groups, { tabs: [id], active: id, place }], focused: id };
}

function floatPlace(l: Layout, vp: Vp, near?: Place, id?: string): FloatPlace {
	const r = near ? restorable(near) : undefined;
	const base = r && r.kind === "float" ? { x: r.x + 28, y: r.y + 28, w: r.w, h: r.h } : r && r.kind === "dock" ? dockedGeo(r, vp) : cascade(l, vp, id);
	return { kind: "float", z: topZ(l) + 1, ...clampGeo(base, vp) };
}
/** Where a docked group would float: over the middle of its side, so it does not jump across the screen. */
function dockedGeo(d: DockPlace, vp: Vp): Geo {
	const w = isVertical(d.side) ? d.size : Math.round(vp.w * 0.5);
	const h = isVertical(d.side) ? Math.round(vp.h * 0.6) : d.size;
	return { x: d.side === "right" ? vp.w - w - 24 : d.side === "left" ? 24 : Math.round((vp.w - w) / 2), y: d.side === "bottom" ? vp.h - h - 24 : d.side === "top" ? 24 : 80, w, h };
}

// ---- operations ----

/** Opens a window: brings it back from minimised / collapsed / popped state, or floats a new one. */
export function open(l: Layout, id: string, vp: Vp, filter?: string): Layout {
	if (!isWindowId(id)) return l;
	const filters = filter === undefined ? l.filters : { ...l.filters, [id]: filter };
	const g = groupOf(l, id);
	if (!g) return { ...addGroup(l, id, { kind: "float", z: topZ(l) + 1, ...cascade(l, vp, id) }), filters };
	let place = g.place;
	if (place.kind === "min") place = place.from;
	if (place.kind === "dock") place = { ...place, collapsed: false };
	if (place.kind === "float") place = { ...place, z: topZ(l) + 1 };
	return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, active: id, place } : x)), focused: id, filters };
}

export function focus(l: Layout, id: string): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	const place = g.place.kind === "float" && (l.focused !== id || g.place.z !== topZ(l)) ? { ...g.place, z: topZ(l) + 1 } : g.place;
	if (l.focused === id && g.active === id && place === g.place) return l;
	return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, active: id, place } : x)), focused: id };
}

export function setActive(l: Layout, id: string): Layout {
	return focus(l, id);
}

export function move(l: Layout, id: string, x: number, y: number, vp: Vp): Layout {
	const g = groupOf(l, id);
	if (!g || g.place.kind !== "float") return l;
	const { restore: _r, ...p } = g.place;
	return { ...l, groups: l.groups.map((k) => (k === g ? { ...k, place: { ...p, ...clampGeo({ x, y, w: p.w, h: p.h }, vp) } } : k)) };
}

export function resize(l: Layout, id: string, geo: Geo, vp: Vp): Layout {
	const g = groupOf(l, id);
	if (!g || g.place.kind !== "float") return l;
	const { restore: _r, ...p } = g.place;
	return { ...l, groups: l.groups.map((k) => (k === g ? { ...k, place: { ...p, ...clampGeo(geo, vp) } } : k)) };
}

/** A floating group fills the screen (a margin around it), or goes back to the size it had; a move or resize forgets the old size. */
export function toggleMaximize(l: Layout, id: string, vp: Vp, margin = 8): Layout {
	const g = groupOf(l, id);
	if (!g || g.place.kind !== "float") return l;
	const { restore, ...p } = g.place;
	const place: FloatPlace = restore
		? { ...p, ...clampGeo(restore, vp) }
		: { ...p, restore: { x: p.x, y: p.y, w: p.w, h: p.h }, ...clampGeo({ x: margin, y: margin, w: vp.w - margin * 2, h: vp.h - margin * 2 }, vp) };
	return { ...l, groups: l.groups.map((k) => (k === g ? { ...k, place: { ...place, z: topZ(l) + 1 } } : k)), focused: id };
}
export const isMaximized = (l: Layout, id: string): boolean => { const p = groupOf(l, id)?.place; return p?.kind === "float" && !!p.restore; };

export function resizeDock(l: Layout, side: Side, size: number, vp: Vp): Layout {
	const g = dockGroup(l, side);
	if (!g || g.place.kind !== "dock") return l;
	const p = g.place;
	return { ...l, groups: l.groups.map((k) => (k === g ? { ...k, place: { ...p, size: clampDock(side, size, vp) } } : k)) };
}

/** Docks a window on a side: it joins that side's group as a tab, or starts it. `whole` moves its whole group. */
export function dock(l: Layout, id: string, side: Side, vp: Vp, opts: { whole?: boolean; size?: number } = {}): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	const ids = opts.whole ? [...g.tabs] : [id];
	if (g.place.kind === "dock" && g.place.side === side && ids.length === g.tabs.length) return focus(l, id);
	const keep = g.place.kind === "dock" && g.place.side === side ? undefined : g.place;
	let next = l;
	for (const t of ids) next = detach(next, t).layout;
	const target = dockGroup(next, side);
	const active = opts.whole && ids.includes(g.active) ? g.active : id;
	if (target) {
		const place = { ...(target.place as DockPlace), collapsed: false };
		next = { ...next, groups: next.groups.map((x) => (x === target ? { tabs: [...x.tabs.filter((t) => !ids.includes(t)), ...ids], active, place } : x)) };
	} else {
		const size = clampDock(side, opts.size ?? (keep && keep.kind === "dock" ? keep.size : defaultSize(side)), vp);
		next = { ...next, groups: [...next.groups, { tabs: ids, active, place: { kind: "dock", side, size, collapsed: false } }] };
	}
	return { ...next, focused: id };
}

/**
 * Puts a window in the edge column beside the chat: it joins the column's group as a tab, or starts it. `whole` moves its
 * whole group (the same rule as `dock`).
 */
export function toEdge(l: Layout, id: string, opts: { whole?: boolean } = {}): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	const ids = opts.whole ? [...g.tabs] : [id];
	if (g.place.kind === "edge" && ids.length === g.tabs.length) return focus(l, id);
	let next = l;
	for (const t of ids) next = detach(next, t).layout;
	const target = edgeGroup(next);
	const active = opts.whole && ids.includes(g.active) ? g.active : id;
	next = target
		? { ...next, groups: next.groups.map((x) => (x === target ? { tabs: [...x.tabs.filter((t) => !ids.includes(t)), ...ids], active, place: x.place } : x)) }
		: { ...next, groups: [...next.groups, { tabs: ids, active, place: { kind: "edge" } }] };
	return { ...next, focused: id };
}

/** The group a window is in leaves its side (or the edge column) and floats (the whole group, as one window). */
export function undock(l: Layout, id: string, vp: Vp): Layout {
	const g = groupOf(l, id);
	if (!g || (g.place.kind !== "dock" && g.place.kind !== "edge")) return l;
	const place = floatPlace(l, vp, g.place, id);
	return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, place } : x)), focused: id };
}

/** A tab leaves its group and floats on its own (a single window in its own group is only brought to float). */
export function pullOut(l: Layout, id: string, vp: Vp, at?: { x: number; y: number }): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	if (g.tabs.length === 1) return g.place.kind === "dock" || g.place.kind === "edge" ? undock(l, id, vp) : l;
	const { layout } = detach(l, id);
	const place = floatPlace(layout, vp, g.place);
	const moved = at ? { ...place, ...clampGeo({ ...place, x: at.x, y: at.y }, vp) } : place;
	return { ...layout, groups: [...layout.groups, { tabs: [id], active: id, place: moved }], focused: id };
}

/** Drops a window onto another window's tab strip: they become one group. `index` is the tab position (default: last). */
export function mergeInto(l: Layout, id: string, targetId: string, index?: number): Layout {
	if (id === targetId) return l;
	const mine = groupOf(l, id);
	const target = groupOf(l, targetId);
	if (!mine || !target) return l;
	if (target.place.kind === "min" || target.place.kind === "pop") return l;
	const { layout } = detach(l, id);
	// id !== targetId, so the target group still exists after the detach
	const t = layout.groups.find((x) => x.tabs.includes(targetId))!;
	const tabs = t.tabs.filter((x) => x !== id);
	const at = index === undefined ? tabs.length : Math.max(0, Math.min(index, tabs.length));
	tabs.splice(at, 0, id);
	const place = t.place.kind === "dock" ? { ...t.place, collapsed: false } : t.place.kind === "float" ? { ...t.place, z: topZ(layout) + 1 } : t.place;
	return { ...layout, groups: layout.groups.map((x) => (x === t ? { tabs, active: id, place } : x)), focused: id };
}

/** Moves a tab to another position in its own group. */
export function reorder(l: Layout, id: string, index: number): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	const tabs = g.tabs.filter((x) => x !== id);
	tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, id);
	return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, tabs } : x)) };
}

/** Closes a window. The chat is refused (it can only be collapsed). */
export function close(l: Layout, id: string): Layout {
	if (id === CHAT || !groupOf(l, id)) return l;
	const { layout } = detach(l, id);
	const filters = { ...layout.filters };
	delete filters[id];
	return { ...layout, filters, focused: layout.focused === id ? (dockGroup(layout, "left")?.active ?? null) : layout.focused };
}
export const canClose = (id: string) => id !== CHAT;

/**
 * Opens a window that was closed where the page's default layout keeps it: as a tab beside a window of its default group that
 * is open, else docked on the default side, else floating. An open window is only brought to the front. Nothing a user moved
 * elsewhere is moved back: only the reopened window is placed.
 */
export function reopen(l: Layout, id: string, def: Layout, vp: Vp): Layout {
	if (groupOf(l, id)) return open(l, id, vp);
	const home = groupOf(def, id);
	const opened = open(l, id, vp);
	if (!home) return opened;
	const mate = home.tabs.find((t) => t !== id && groupOf(l, t));
	if (mate) return mergeInto(opened, id, mate);
	const p = home.place.kind === "min" || home.place.kind === "pop" ? home.place.from : home.place;
	return p.kind === "dock" ? dock(opened, id, p.side, vp, { size: p.size }) : p.kind === "edge" ? toEdge(opened, id) : opened;
}

/** Collapses a docked group to a strip, or minimises a floating one. Works for the chat. */
export function collapse(l: Layout, id: string, on = true): Layout {
	const g = groupOf(l, id);
	if (!g) return l;
	const p = g.place;
	if (p.kind === "dock") return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, place: { ...p, collapsed: on } } : x)) };
	if ((p.kind === "float" || p.kind === "edge") && on) return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, place: { kind: "min", from: p } } : x)) };
	if (p.kind === "min" && !on) return { ...l, groups: l.groups.map((x) => (x === g ? { ...x, place: p.from } : x)) };
	return l;
}
export const minimise = (l: Layout, id: string) => collapse(l, id, true);

/** Rail click: present and in front → close it (the chat only collapses); else open it. */
export function toggle(l: Layout, id: string, vp: Vp): Layout {
	const g = groupOf(l, id);
	const visible = g && g.place.kind !== "min" && g.place.kind !== "pop" && !(g.place.kind === "dock" && g.place.collapsed);
	if (g && visible && l.focused === id && g.active === id) return id === CHAT ? collapse(l, id) : close(l, id);
	return open(l, id, vp);
}

/** Pops a window out to its own OS window. It remembers where it was. */
export function popOut(l: Layout, id: string, vp: Vp): Layout {
	const g = groupOf(l, id);
	if (!g || g.place.kind === "pop") return l;
	const from = restorable(g.place);
	const { layout } = detach(l, id);
	return { ...layout, groups: [...layout.groups, { tabs: [id], active: id, place: { kind: "pop", from: clampPlace(from, vp) } }], focused: layout.focused === id ? null : layout.focused };
}

/** The popped-out window closes: it docks back (into that side's group) or floats where it was. */
export function popIn(l: Layout, id: string, vp: Vp): Layout {
	const g = groupOf(l, id);
	if (!g || g.place.kind !== "pop") return l;
	const from = clampPlace(g.place.from, vp);
	const { layout } = detach(l, id);
	if (from.kind === "dock") return dock(addGroup(layout, id, { kind: "float", z: topZ(layout) + 1, ...cascade(layout, vp) }), id, from.side, vp, { size: from.size });
	if (from.kind === "edge") return toEdge(addGroup(layout, id, { kind: "float", z: topZ(layout) + 1, ...cascade(layout, vp) }), id);
	return { ...layout, groups: [...layout.groups, { tabs: [id], active: id, place: { ...from, z: topZ(layout) + 1 } }], focused: id };
}
export const poppedOut = (l: Layout): string[] => l.groups.filter((g) => g.place.kind === "pop").flatMap((g) => g.tabs);
/** Every popped window docked back where it was: the OS windows are gone after a restart. */
export function popInAll(l: Layout, vp: Vp): Layout {
	let next = l;
	for (const id of poppedOut(l)) next = popIn(next, id, vp);
	return next;
}

export function setFilter(l: Layout, id: string, filter: string | undefined): Layout {
	const filters = { ...l.filters };
	if (filter === undefined) delete filters[id];
	else filters[id] = filter;
	return { ...l, filters };
}

/**
 * The layout as it is drawn on one page (B5): only the windows `shown` keeps. A group keeps its place and order with the
 * hidden tabs left out; a group with nothing left is not drawn; a hidden active tab gives the front to the first one shown.
 * Nothing is removed from the real layout: a page's windows come back, where they were, when that page is opened again.
 */
export function filterLayout(l: Layout, shown: (id: string) => boolean): Layout {
	let changed = false;
	const groups: Group[] = [];
	for (const g of l.groups) {
		const tabs = g.tabs.filter(shown);
		if (tabs.length === g.tabs.length) {
			groups.push(g);
			continue;
		}
		changed = true;
		if (tabs.length) groups.push({ ...g, tabs, active: tabs.includes(g.active) ? g.active : tabs[0] });
	}
	return changed ? { ...l, groups, focused: l.focused && shown(l.focused) ? l.focused : null } : l;
}

// ---- drag targets ----

export type DropTarget = { kind: "side"; side: Side } | { kind: "tabs"; targetId: string } | null;
export const EDGE = 48;

/** Which side a dragged window docks to when the pointer is within `edge` px of a screen edge (nearest edge in a corner). */
export function dockSideAt(vp: Vp, x: number, y: number, edge = EDGE): Side | null {
	const d: [Side, number][] = [
		["left", x],
		["right", vp.w - x],
		["top", y],
		["bottom", vp.h - y],
	];
	const near = d.filter(([, v]) => v >= 0 && v <= edge).sort((a, b) => a[1] - b[1]);
	return near[0]?.[0] ?? null;
}

export interface StripRect {
	/** any tab id of the group the strip belongs to (the active one) */
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}
/** The part of the screen a window can dock in: the work area (below the top bar, right of the rail). */
export interface Zone {
	x: number;
	y: number;
	w: number;
	h: number;
}
/** How deep a dock zone reaches into the work area: a clear band, never under 110 px, at most a fifth of the area (260 px). */
export function snapBand(z: Zone, side: Side): number {
	const len = isVertical(side) ? z.w : z.h;
	return Math.round(Math.max(110, Math.min(len * 0.2, 260)));
}
/** The four dock zones as rectangles, to draw them while a window is dragged and to hit-test them. */
export function snapZones(z: Zone): { side: Side; x: number; y: number; w: number; h: number }[] {
	const l = snapBand(z, "left"), r = snapBand(z, "right"), t = snapBand(z, "top"), b = snapBand(z, "bottom");
	return [
		{ side: "left", x: z.x, y: z.y, w: l, h: z.h },
		{ side: "right", x: z.x + z.w - r, y: z.y, w: r, h: z.h },
		{ side: "top", x: z.x, y: z.y, w: z.w, h: t },
		{ side: "bottom", x: z.x, y: z.y + z.h - b, w: z.w, h: b },
	];
}
/** The zone the pointer is in; in a corner (two zones overlap) the one whose edge the pointer is nearer, as a share of its band. */
export function dockSideInZone(z: Zone, x: number, y: number): Side | null {
	const hits = snapZones(z)
		.filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
		.map((r) => {
			const depth = r.side === "left" ? x - r.x : r.side === "right" ? r.x + r.w - x : r.side === "top" ? y - r.y : r.y + r.h - y;
			return { side: r.side, share: depth / (isVertical(r.side) ? r.w : r.h) };
		})
		.sort((a, b) => a.share - b.share);
	return hits[0]?.side ?? null;
}
/**
 * What a dragged window drops on: a tab strip first (it joins that group), else a dock zone (it docks there). With the work
 * area's `zone` the zones are the bands at its edges (drawn while dragging); without, the 48 px at the screen's edges.
 */
export function dropTarget(vp: Vp, strips: StripRect[], x: number, y: number, dragging?: string, zone?: Zone): DropTarget {
	const s = strips.find((r) => r.id !== dragging && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
	if (s) return { kind: "tabs", targetId: s.id };
	const side = zone ? dockSideInZone(zone, x, y) : dockSideAt(vp, x, y);
	return side ? { kind: "side", side } : null;
}
/** The index a tab dropped at pointer x takes among tabs with the given left edges and widths. */
export function tabIndexAt(tabs: { x: number; w: number }[], x: number): number {
	const i = tabs.findIndex((t) => x < t.x + t.w / 2);
	return i < 0 ? tabs.length : i;
}

// ---- repair: every invariant, applied to anything read from disk or after the window changed size ----

export function normalize(raw: Layout, vp: Vp): Layout {
	const seen = new Set<string>();
	const sideTaken = new Map<Side, Group>();
	let edge: Group | undefined;
	const groups: Group[] = [];
	for (const g of Array.isArray(raw?.groups) ? raw.groups : []) {
		const tabs = (Array.isArray(g?.tabs) ? g.tabs : []).filter((t) => {
			if (!isWindowId(t) || seen.has(t)) return false;
			seen.add(t);
			return true;
		});
		if (!tabs.length || !g.place) continue;
		const active = tabs.includes(g.active) ? g.active : tabs[0];
		const place = fixPlace(g.place, vp);
		if (!place) continue;
		if (place.kind === "dock") {
			const have = sideTaken.get(place.side);
			if (have) {
				have.tabs.push(...tabs);
				continue;
			}
			const ng = { tabs, active, place };
			sideTaken.set(place.side, ng);
			groups.push(ng);
			continue;
		}
		if (place.kind === "edge") {
			// one edge column: a second one joins the first as tabs
			if (edge) {
				edge.tabs.push(...tabs);
				continue;
			}
			edge = { tabs, active, place };
			groups.push(edge);
			continue;
		}
		groups.push({ tabs, active, place });
	}
	// z: keep the order, make it 1..n
	const floats = groups.filter((g) => g.place.kind === "float").sort((a, b) => (a.place as FloatPlace).z - (b.place as FloatPlace).z);
	floats.forEach((g, i) => ((g.place as FloatPlace).z = i + 1));
	let out: Layout = { groups, focused: raw?.focused && seen.has(raw.focused) ? raw.focused : null, filters: cleanFilters(raw?.filters, seen) };
	if (!seen.has(CHAT)) {
		const left = dockGroup(out, "left");
		out = left
			? { ...out, groups: out.groups.map((g) => (g === left ? { ...g, tabs: [CHAT, ...g.tabs] } : g)) }
			: { ...out, groups: [{ tabs: [CHAT], active: CHAT, place: { kind: "dock", side: "left", size: DEFAULT_DOCK, collapsed: false } }, ...out.groups] };
	}
	return out;
}
function cleanFilters(f: unknown, ids: Set<string>): Record<string, string> {
	if (!f || typeof f !== "object") return {};
	return Object.fromEntries(Object.entries(f as Record<string, unknown>).filter(([k, v]) => ids.has(k) && typeof v === "string")) as Record<string, string>;
}
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
function fixRestorable(p: unknown, vp: Vp): Restorable | null {
	const o = p as Record<string, unknown> | null;
	if (!o || typeof o !== "object") return null;
	if (o.kind === "float") {
			const r = o.restore as Record<string, unknown> | undefined;
			const restore = r && typeof r === "object" ? clampGeo({ x: num(r.x, 0), y: num(r.y, 0), w: num(r.w, 720), h: num(r.h, 520) }, vp) : undefined;
			return { kind: "float", z: num(o.z, 1), ...clampGeo({ x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 720), h: num(o.h, 520) }, vp), ...(restore ? { restore } : {}) };
		}
	if (o.kind === "dock" && (SIDES as readonly unknown[]).includes(o.side)) return { kind: "dock", side: o.side as Side, size: clampDock(o.side as Side, num(o.size, defaultSize(o.side as Side)), vp), collapsed: o.collapsed === true };
	if (o.kind === "edge") return { kind: "edge" };
	return null;
}
function fixPlace(p: unknown, vp: Vp): Place | null {
	const o = p as Record<string, unknown> | null;
	if (o && (o.kind === "min" || o.kind === "pop")) {
		const from = fixRestorable(o.from, vp);
		return from ? { kind: o.kind, from } : null;
	}
	return fixRestorable(p, vp);
}

// ---- the store: one layout for the app ----

export interface LayoutStore {
	version: 1;
	/** the one layout, shared by every page and every OS window */
	shared?: Layout;
	/** pages whose own windows were added to the shared layout (a page adds them once, so a window the user closed stays closed) */
	visited?: string[];
	/** the per-page layouts of the first Phase 9 builds: read once to start the shared layout, never written again */
	pages: Record<string, Layout>;
	/** the layout of the old single-layout shell, until a page gets its own */
	legacy?: Layout;
	/** the page that was open when the app closed */
	current?: string;
	/** the list sidebar between the rail and the chat (BIM Crew's Explorer / Sessions column) */
	sidebar?: SidebarState;
	/** one-time repairs already applied to `shared` (a later start never applies one twice) */
	migrated?: string[];
}
export const emptyStore = (): LayoutStore => ({ version: 1, pages: {} });

/**
 * The list sidebar (B3), as BIM Crew's secondary column (App.tsx: ProjectSidebar / SessionSidebar + ResizeHandle): which list
 * page it shows, whether it is open, its width. A rail click on the list that is showing closes it; dragging its edge
 * `SIDEBAR_COLLAPSE` px past the minimum closes it too.
 */
export interface SidebarState {
	id: string | null;
	open: boolean;
	width: number;
	/** the filter the list was opened with (a link from another panel, the agent's open_panel) */
	filter?: string;
}
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 600;
export const SIDEBAR_DEFAULT = 340;
export const SIDEBAR_COLLAPSE = 56;
export const clampSidebar = (w: number): number => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
export const emptySidebar = (): SidebarState => ({ id: null, open: false, width: SIDEBAR_DEFAULT });
export function cleanSidebar(raw: unknown): SidebarState {
	const o = raw as Record<string, unknown> | null;
	if (!o || typeof o !== "object") return emptySidebar();
	const id = typeof o.id === "string" ? o.id : null;
	return { id, open: id !== null && o.open === true, width: clampSidebar(num(o.width, SIDEBAR_DEFAULT)), ...(typeof o.filter === "string" ? { filter: o.filter } : {}) };
}

/** The layout of a page: its own, else the migrated old layout, else the page's default. */
export function layoutFor(s: LayoutStore, page: string, defaultFor: (page: string) => Layout, vp: Vp): Layout {
	const own = s.pages[page];
	if (own) return normalize(own, vp);
	return normalize(s.legacy ?? defaultFor(page), vp);
}
export function withPage(s: LayoutStore, page: string, l: Layout): LayoutStore {
	return { ...s, pages: { ...s.pages, [page]: l } };
}

/** The shared layout; a store from the per-page builds starts it from the layout of the page that was open. */
export function sharedLayout(s: LayoutStore, page: string, defaultFor: (page: string) => Layout, vp: Vp): Layout {
	return s.shared ? normalize(s.shared, vp) : layoutFor(s, page, defaultFor, vp);
}
export function withShared(s: LayoutStore, l: Layout, visited?: string[]): LayoutStore {
	return { ...s, shared: l, ...(visited ? { visited } : {}) };
}

/**
 * Adds the windows of a page's default layout that the layout does not have, each where the default puts it (beside a
 * default mate that is open, else docked on its default side). Windows already open stay where they are, every existing group
 * keeps the tab it had in front, and the focus does not move: a page you open must not rearrange what you arranged.
 */
export function addMissing(l: Layout, def: Layout, vp: Vp): Layout {
	const front = new Map<string, string>();
	for (const g of l.groups) for (const t of g.tabs) front.set(t, g.active);
	let next = l;
	for (const g of def.groups) for (const id of g.tabs) if (!groupOf(next, id)) next = reopen(next, id, def, vp);
	return {
		...next,
		focused: l.focused,
		groups: next.groups.map((g) => {
			const was = g.tabs.map((t) => front.get(t)).find((a): a is string => !!a && g.tabs.includes(a));
			return was && was !== g.active ? { ...g, active: was } : g;
		}),
	};
}

/** Reads a store from whatever was on disk. Damaged → an empty store (every page then uses its default). */
export function parseStore(text: string | null | undefined, vp: Vp): LayoutStore {
	if (!text) return emptyStore();
	try {
		const j = JSON.parse(text) as Partial<LayoutStore>;
		if (!j || j.version !== 1 || typeof j.pages !== "object" || j.pages === null) return emptyStore();
		const pages: Record<string, Layout> = {};
		for (const [k, v] of Object.entries(j.pages)) if (v && typeof v === "object") pages[k] = normalize(v as Layout, vp);
		const out: LayoutStore = { version: 1, pages };
			if (j.shared && typeof j.shared === "object") out.shared = normalize(j.shared as Layout, vp);
			if (Array.isArray(j.visited)) out.visited = j.visited.filter((x): x is string => typeof x === "string");
		if (j.legacy) out.legacy = normalize(j.legacy, vp);
		if (typeof j.current === "string") out.current = j.current;
		if (j.sidebar) out.sidebar = cleanSidebar(j.sidebar);
		if (Array.isArray(j.migrated)) out.migrated = j.migrated.filter((x): x is string => typeof x === "string");
		return out;
	} catch {
		return emptyStore();
	}
}

/** The old `projektesana:windows` value ({windows: [{id, x, y, w, h, z, mode, filter}], focused}) as a layout. */
export function fromLegacy(raw: unknown, vp: Vp): Layout | null {
	const o = raw as { windows?: Record<string, unknown>[]; focused?: string | null } | null;
	if (!o || !Array.isArray(o.windows)) return null;
	let l = emptyLayout();
	const olds = o.windows.filter((w) => isWindowId(w.id)).sort((a, b) => num(a.z, 0) - num(b.z, 0));
	for (const w of olds) {
		const id = w.id as string;
		const geo = clampGeo({ x: num(w.x, 120), y: num(w.y, 110), w: num(w.w, 720), h: num(w.h, 520) }, vp);
		const z = topZ(l) + 1;
		const mk = (place: Place): Layout => ({ ...l, groups: [...l.groups, { tabs: [id], active: id, place }] });
		if (w.mode === "docked") l = dock(mk({ kind: "float", z, ...geo }), id, "right", vp);
		else if (w.mode === "minimized") l = mk({ kind: "min", from: { kind: "float", z, ...geo } });
		else if (w.mode === "maximized") l = mk({ kind: "float", z, ...clampGeo({ x: 8, y: 8, w: vp.w - 16, h: vp.h - 16 }, vp) });
		else l = mk({ kind: "float", z, ...geo });
		if (typeof w.filter === "string") l = setFilter(l, id, w.filter);
	}
	return normalize({ ...l, focused: typeof o.focused === "string" && isWindowId(o.focused) ? o.focused : CHAT }, vp);
}

/** Checks the invariants; returns the problems (empty = valid). Used by the tests and by the page registry's test. */
export function problems(l: Layout): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const docks = new Set<string>();
	for (const g of l.groups) {
		if (!g.tabs.length) out.push("empty group");
		if (!g.tabs.includes(g.active)) out.push(`active ${g.active} not in its group`);
		for (const t of g.tabs) {
			if (!isWindowId(t)) out.push(`unknown window ${t}`);
			if (seen.has(t)) out.push(`window ${t} twice`);
			seen.add(t);
		}
		if (g.place.kind === "dock") {
			if (docks.has(g.place.side)) out.push(`two groups on ${g.place.side}`);
			docks.add(g.place.side);
		}
		if (g.place.kind === "edge") {
			if (docks.has("edge")) out.push("two edge columns");
			docks.add("edge");
		}
	}
	if (!seen.has(CHAT)) out.push("no chat");
	if (l.focused !== null && !seen.has(l.focused)) out.push("focus on a missing window");
	return out;
}
