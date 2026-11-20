// The one viewer (task 9.3): one tab per open file (a 3D model, a 2D sheet or document, a compare, a law), in one pane or two
// side by side / one above the other, each pane with its own tabs. A split can show two angles of one model (the same tab in
// both panes), a model beside its sheet, or two files; a linked camera / page keeps the two views together. Pure and
// node-free: the viewer component, the Versijas page (9.9) and the tests use the same functions.
import type { CompareMode } from "./compare2d.js";

export type ViewTarget =
	/** `quote`: text to highlight on the page (a fact's citation, task 9.7); it is not part of the file's identity */
	| { kind: "source"; sourceId: string; page?: number; quote?: string }
	| { kind: "ifc"; path: string; label: string }
	/** a PDF that is not a registered source (the Faili tab): `path` is a sheets.bytes ref, "file:<root>:<rel>" */
	| { kind: "pdf"; path: string; label: string }
	/** a DWG drawn from CadCraft's reader: `path` is a compare ref ("src:<id>", "file:<root>:<rel>") */
	| { kind: "dwg"; path: string; label: string }
	/** `only` (sheets): list only the sheets that differ (9.9) */
	| { kind: "compare"; a: string; b: string; aLabel: string; bLabel: string; mode: CompareMode; only?: boolean }
	| { kind: "law"; sourceId: string; quote?: string };

export interface Tab {
	id: string;
	target: ViewTarget;
	/** the file bar shows the name only */
	label: string;
}
export interface Pane {
	/** tab ids; the same tab may be in both panes (two angles of one model) */
	tabs: string[];
	active: string | null;
}
export type SplitDir = "none" | "h" | "v";
export interface ViewerState {
	tabs: Tab[];
	panes: Pane[];
	split: SplitDir;
	/** the pane the next opened file goes to, and the one the chat and the side panels follow */
	focused: number;
	linkedCamera: boolean;
	linkedPage: boolean;
}

export const emptyViewer = (): ViewerState => ({ tabs: [], panes: [{ tabs: [], active: null }], split: "none", focused: 0, linkedCamera: false, linkedPage: false });

/** The identity of a target: opening the same file again brings its tab forward instead of making a second tab. */
export function targetKey(t: ViewTarget): string {
	if (t.kind === "source") return `source:${t.sourceId}`;
	if (t.kind === "ifc") return `ifc:${t.path}`;
	if (t.kind === "pdf") return `pdf:${t.path}`;
	if (t.kind === "dwg") return `dwg:${t.path}`;
	if (t.kind === "compare") return `compare:${t.mode}:${t.a}|${t.b}`;
	return `law:${t.sourceId}`;
}
export function targetLabel(t: ViewTarget, titleOf: (sourceId: string) => string | undefined = () => undefined): string {
	if (t.kind === "ifc" || t.kind === "pdf" || t.kind === "dwg") return t.label;
	if (t.kind === "compare") return `${t.aLabel} ↔ ${t.bLabel}`;
	if (t.kind === "law") return titleOf(t.sourceId) ?? "likums";
	return titleOf(t.sourceId) ?? t.sourceId;
}

const sameKey = (tab: Tab, t: ViewTarget) => targetKey(tab.target) === targetKey(t);
const pane = (s: ViewerState, i: number): Pane => s.panes[Math.max(0, Math.min(i, s.panes.length - 1))];
const withPane = (s: ViewerState, i: number, p: Pane): ViewerState => ({ ...s, panes: s.panes.map((x, k) => (k === i ? p : x)) });

/** The active target of a pane (the focused one by default): what `ui.preview` mirrors. */
export function activeTab(s: ViewerState, paneIndex = s.focused): Tab | null {
	const p = pane(s, paneIndex);
	return s.tabs.find((t) => t.id === p.active) ?? null;
}

let nextId = 1;
const mintTab = () => `v${nextId++}`;

/**
 * Opens a file. The same file already open somewhere is brought forward in its pane (the page of a source is updated);
 * otherwise it becomes a tab in `paneIndex` (default: the focused pane), active.
 */
export function open(s: ViewerState, target: ViewTarget, label: string, opts: { pane?: number; id?: string } = {}): ViewerState {
	const at = Math.max(0, Math.min(opts.pane ?? s.focused, s.panes.length - 1));
	const have = s.tabs.find((t) => sameKey(t, target));
	let tabs = s.tabs;
	let id: string;
	if (have) {
		id = have.id;
		tabs = s.tabs.map((t) => (t.id === id ? { ...t, target, label } : t));
	} else {
		id = opts.id ?? mintTab();
		tabs = [...s.tabs, { id, target, label }];
	}
	// in its own pane if it is in one already, else in the asked pane
	const holder = s.panes.findIndex((p) => p.tabs.includes(id));
	const where = holder >= 0 && holder !== at && !pane(s, at).tabs.includes(id) ? holder : at;
	const p = pane(s, where);
	return { ...withPane({ ...s, tabs }, where, { tabs: p.tabs.includes(id) ? p.tabs : [...p.tabs, id], active: id }), focused: where };
}

/** Closing a tab closes it in both panes; a pane left empty collapses the split; the active tab picks its neighbour. */
export function close(s: ViewerState, tabId: string): ViewerState {
	if (!s.tabs.some((t) => t.id === tabId)) return s;
	const panes = s.panes.map((p) => {
		const at = p.tabs.indexOf(tabId);
		if (at < 0) return p;
		const tabs = p.tabs.filter((t) => t !== tabId);
		return { tabs, active: p.active === tabId ? (tabs[Math.min(at, tabs.length - 1)] ?? null) : p.active };
	});
	return collapseEmpty({ ...s, tabs: s.tabs.filter((t) => t.id !== tabId), panes });
}

function collapseEmpty(s: ViewerState): ViewerState {
	if (s.panes.length < 2) return s;
	const keep = s.panes.filter((p) => p.tabs.length > 0);
	if (keep.length === 2) return s;
	return { ...s, panes: [keep[0] ?? { tabs: [], active: null }], split: "none", focused: 0, linkedCamera: false, linkedPage: false };
}

export function activate(s: ViewerState, tabId: string, paneIndex = s.focused): ViewerState {
	const p = pane(s, paneIndex);
	if (!p.tabs.includes(tabId)) return s;
	return { ...withPane(s, paneIndex, { ...p, active: tabId }), focused: paneIndex };
}
export const focusPane = (s: ViewerState, i: number): ViewerState => (i >= 0 && i < s.panes.length && i !== s.focused ? { ...s, focused: i } : s);

/**
 * Splits the viewer. The new pane shows the active tab again (two angles of one model, or the same page twice), so the user
 * has something to look at and a second view to turn. With nothing open the split is refused.
 */
export function splitPane(s: ViewerState, dir: "h" | "v"): ViewerState {
	const cur = activeTab(s);
	if (!cur) return s;
	if (s.panes.length === 2) return { ...s, split: dir };
	return { ...s, split: dir, panes: [...s.panes, { tabs: [cur.id], active: cur.id }], focused: 1 };
}

/** Back to one pane: the tabs of the second pane join the first (tabs are not lost). */
export function unsplit(s: ViewerState): ViewerState {
	if (s.panes.length < 2) return s;
	const [a, b] = s.panes;
	const tabs = [...a.tabs, ...b.tabs.filter((t) => !a.tabs.includes(t))];
	const active = s.focused === 1 ? (b.active ?? a.active) : (a.active ?? b.active);
	return { ...s, panes: [{ tabs, active }], split: "none", focused: 0, linkedCamera: false, linkedPage: false };
}

/** Moves a tab to the other pane (splitting first if there is only one). A pane left empty collapses the split. */
export function moveTab(s: ViewerState, tabId: string, toPane: number): ViewerState {
	const tab = s.tabs.find((t) => t.id === tabId);
	if (!tab) return s;
	let st = s;
	if (st.panes.length < 2) {
		if (toPane === 0) return s;
		st = { ...st, split: st.split === "none" ? "h" : st.split, panes: [...st.panes, { tabs: [], active: null }] };
	}
	const to = Math.max(0, Math.min(toPane, 1));
	const from = 1 - to;
	const src = st.panes[from];
	const dst = st.panes[to];
	const srcTabs = src.tabs.filter((t) => t !== tabId);
	const panes = st.panes.map((p, i) =>
		i === from ? { tabs: srcTabs, active: src.active === tabId ? (srcTabs[0] ?? null) : src.active } : i === to ? { tabs: dst.tabs.includes(tabId) ? dst.tabs : [...dst.tabs, tabId], active: tabId } : p,
	);
	return collapseEmpty({ ...st, panes, focused: to });
}

/** Two angles of one model: the camera of one pane drives the other, or they move apart. Only with two panes. */
export const setLinkedCamera = (s: ViewerState, on: boolean): ViewerState => (s.panes.length < 2 ? s : { ...s, linkedCamera: on });
export const setLinkedPage = (s: ViewerState, on: boolean): ViewerState => (s.panes.length < 2 ? s : { ...s, linkedPage: on });

/**
 * A file against another: A and B as two tabs in two panes side by side (or one above the other), the camera or the page
 * linked. The Versijas page (9.9) opens a picked change this way; BimCraft's own compare and the sheet overlay stay a single
 * "compare" tab (open with a compare target).
 */
export function compareSplit(s: ViewerState, a: { target: ViewTarget; label: string }, b: { target: ViewTarget; label: string }, dir: "h" | "v" = "h"): ViewerState {
	const st = open(open({ ...s, panes: [{ tabs: [], active: null }, { tabs: [], active: null }], split: dir, focused: 0 }, a.target, a.label, { pane: 0 }), b.target, b.label, { pane: 1 });
	const aId = st.panes[0].active;
	const bId = st.panes[1].active;
	// what was open before stays: those tabs go behind A in pane 0
	const rest = st.tabs.map((t) => t.id).filter((id) => id !== aId && id !== bId);
	const panes: Pane[] = [{ tabs: [aId!, ...rest], active: aId }, { tabs: [bId!], active: bId }];
	return { ...st, panes, split: dir, linkedCamera: a.target.kind === "ifc" && b.target.kind === "ifc", linkedPage: a.target.kind === "source" && b.target.kind === "source", focused: 0 };
}

/** The pane that should receive a camera / page the other pane reports, or null when they are not linked. */
export function followerOf(s: ViewerState, from: number, what: "camera" | "page"): number | null {
	if (s.panes.length < 2) return null;
	if (what === "camera" ? !s.linkedCamera : !s.linkedPage) return null;
	return from === 0 ? 1 : 0;
}

/** Problems with a state (empty = valid): used by the tests after every operation. */
export function problems(s: ViewerState): string[] {
	const out: string[] = [];
	const ids = new Set(s.tabs.map((t) => t.id));
	if (ids.size !== s.tabs.length) out.push("tab id twice");
	if (s.panes.length < 1 || s.panes.length > 2) out.push(`${s.panes.length} panes`);
	if ((s.panes.length === 2) !== (s.split !== "none")) out.push("split and panes disagree");
	if (s.focused < 0 || s.focused >= s.panes.length) out.push("focus outside the panes");
	for (const [i, p] of s.panes.entries()) {
		if (new Set(p.tabs).size !== p.tabs.length) out.push(`pane ${i} lists a tab twice`);
		for (const t of p.tabs) if (!ids.has(t)) out.push(`pane ${i} has a missing tab ${t}`);
		if (p.active !== null && !p.tabs.includes(p.active)) out.push(`pane ${i} active tab is not in it`);
		if (p.active === null && p.tabs.length) out.push(`pane ${i} has tabs and no active one`);
	}
	for (const t of s.tabs) if (!s.panes.some((p) => p.tabs.includes(t.id))) out.push(`tab ${t.id} is in no pane`);
	if (s.panes.length < 2 && (s.linkedCamera || s.linkedPage)) out.push("linked with one pane");
	return out;
}
