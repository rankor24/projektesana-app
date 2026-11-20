// The page registry (task 9.1). A page is one entry of the rail: an id (the panel it shows), a group, a kind and a default
// layout. Layout plan C (the board "Projektesana UI layout plan", BIM Crew's shell): a **sidebar** page is a list that opens
// in the collapsible sidebar between the rail and the chat (BIM Crew's Explorer column), with the viewer in the main area;
// a **page** fills the main area with its panel, and a file opened there shows beside it (a draggable split). The comment
// tools are a slim column beside the chat on every page. Every panel is reachable from exactly one page, or is a global
// window (the project list, the settings). Pure and node-free: the rail, the palette, the top bar's status pill and the
// tests use the same table. BIM Crew reference: shell/NavRail.tsx and shell/items.tsx (grouped rail items, icon + name,
// collapse); App.tsx (the secondary sidebar and its ResizeHandle).
import { allWindows, close, DEFAULT_DOCK, dock, emptyLayout, groupOf, mergeInto, open, resizeDock, setActive, toEdge, TOOLS, type Layout, type PANEL_IDS, type Vp } from "./layout.js";

export type PanelName = (typeof PANEL_IDS)[number];
export type PageGroup = "projekts" | "dati" | "nodosana";
export type PageKind = "sidebar" | "page";

export interface PageDef {
	/** the page id is its panel's id */
	id: PanelName;
	title: string;
	group: PageGroup;
	kind: PageKind;
	hint: string;
	/** a single glyph for the collapsed rail */
	icon: string;
	/** what fills the main area instead of the page's panel: the federated 3D scene of Koordinācija (9.8) */
	canvas?: "scene" | "viewer" | "plan";
	/** not in the rail: reached from another page (Telpas: "Atvērt kā lapu") and by name */
	hidden?: boolean;
}

export const GROUPS: { id: PageGroup; title: string }[] = [
	{ id: "projekts", title: "Projekts" },
	{ id: "dati", title: "Dati" },
	{ id: "nodosana", title: "Nodošana" },
];

/** In rail order. */
export const PAGES: PageDef[] = [
	{ id: "parskats", title: "Pārskats", group: "projekts", kind: "page", hint: "projekta panelis: kas jādara vispirms", icon: "▦" },
	{ id: "grafiks", title: "Grafiks", group: "projekts", kind: "page", hint: "kalendārs, termiņi, uzdevumi", icon: "▤" },
	{ id: "telpas", title: "Telpas", group: "projekts", kind: "sidebar", hint: "telpu programma pret modeli", icon: "▥" },
	{ id: "telpaslapa", title: "Telpas (lapa)", group: "projekts", kind: "page", hint: "telpu plāns pa stāviem, atšķirības no modeļa", icon: "▥", canvas: "plan", hidden: true },
	{ id: "prasibas", title: "Prasības", group: "projekts", kind: "sidebar", hint: "prasības un atradumi", icon: "☑" },
	{ id: "avoti", title: "Avoti", group: "dati", kind: "sidebar", hint: "dokumenti pa mapēm", icon: "▤" },
	{ id: "faili", title: "Faili", group: "dati", kind: "sidebar", hint: "mapju koks, meklēšana", icon: "▭" },
	{ id: "normativi", title: "Normatīvi", group: "dati", kind: "sidebar", hint: "likumi un noteikumi, bibliotēka", icon: "§" },
	{ id: "atmina", title: "Atmiņa", group: "dati", kind: "sidebar", hint: "lēmumi un atbildes", icon: "✎" },
	{ id: "nodevumi", title: "Nodevumi", group: "nodosana", kind: "page", hint: "nodot projektu, termiņi", icon: "⇪" },
	{ id: "versijas", title: "Versijas", group: "nodosana", kind: "page", hint: "kas mainījās starp datumiem", icon: "⇄", canvas: "viewer" },
	{ id: "koordinacija", title: "Koordinācija", group: "nodosana", kind: "page", hint: "modeļu pamatpunkts, hierarhija, stāvi", icon: "⊕", canvas: "scene" },
];

/** Windows that belong to no page: the project list (the switcher in the top bar) and the settings. */
export const GLOBAL_PANELS: PanelName[] = ["projekts", "iestatijumi", "prasmes", "agenti"];
export const GLOBAL_TITLE: Record<string, { title: string; hint: string }> = {
	projekts: { title: "Projekti", hint: "projektu saraksts, nolasīšana" },
	iestatijumi: { title: "Iestatījumi", hint: "ceļi, modelis, Revit" },
	prasmes: { title: "Prasmes", hint: "biroja prasmju bibliotēka, aģentiem" },
	agenti: { title: "Aģenti", hint: "aģentu saraksts, lomas, ierobežojumi" },
};
export const START_PAGE: PanelName = "parskats";

export const pageById = (id: string): PageDef | undefined => PAGES.find((p) => p.id === id);
export const isPageId = (id: string): boolean => PAGES.some((p) => p.id === id);

export const isListPage = (id: string): boolean => pageById(id)?.kind === "sidebar";
export const FULL_PAGE_CHAT = 340;
/** the width a canvas page's own list docks at (Versijas' changes, Telpas' differences) */
const PAGE_PANEL_SIZE = 480;
/** the right panel the list pages stack in (Faili, Avoti, Prasības, Telpas, Normatīvi, Atmiņa: one tab each) */
export const LIST_DOCK_SIZE = 520;
export const MATRIX_SIZE = 300;

const NOMINAL: Vp = { w: 1600, h: 900 };

/**
 * A page's default layout: its own windows, and the comment tool bar in the edge column beside the chat (the board's
 * purple column; a window like the others: it can be dragged off, docked on any side or joined to a tab group, and then it
 * stays there on every page). Always valid under 9.0.
 */
export function defaultLayout(page: string): Layout {
	const l = baseLayout(page);
	if (!pageById(page)) return l;
	return { ...toEdge(open(l, TOOLS, NOMINAL), TOOLS), focused: l.focused };
}

function baseLayout(page: string): Layout {
	let l = emptyLayout();
	const def = pageById(page);
	if (!def) return l;
	if (def.canvas === "scene") {
		// the models the user ticks in one 3D scene on the canvas; the matrix docked at the bottom; the reference a window of its
		// own (the page's top strip opens it); a cell click opens its lines in a window docked on the right (shell/KoordScene.tsx)
		l = dock(open(l, "coord.matrix", NOMINAL), "coord.matrix", "bottom", NOMINAL, { size: MATRIX_SIZE });
		return { ...l, focused: "chat" };
	}
	if (def.canvas === "plan") {
		// the floor strip and the tile plan on the canvas; the differences (and the inventory as a tab of the same group) docked on
		// the right; INV Area at the bottom
		l = dock(open(l, "telpas.diffs", NOMINAL), "telpas.diffs", "right", NOMINAL, { size: PAGE_PANEL_SIZE + 40 });
		l = mergeInto(open(l, "telpas.inventory", NOMINAL), "telpas.inventory", "telpas.diffs");
		l = setActive(l, "telpas.diffs");
		l = dock(open(l, "telpas.inv", NOMINAL), "telpas.inv", "bottom", NOMINAL, { size: 200 });
		return { ...l, focused: "chat" };
	}
	if (def.canvas === "viewer") {
		// the viewer (split A / B for the picked change) on the canvas; the change list docked on the right of it, with the kind
		// filters; Modeļi, Lapu izmaiņas and Revit as one group at the bottom
		l = dock(open(l, "vers.list", NOMINAL), "vers.list", "right", NOMINAL, { size: PAGE_PANEL_SIZE });
		l = dock(open(l, "vers.models", NOMINAL), "vers.models", "bottom", NOMINAL, { size: MATRIX_SIZE });
		l = mergeInto(open(l, "vers.sheets", NOMINAL), "vers.sheets", "vers.models");
		l = mergeInto(open(l, "vers.revit", NOMINAL), "vers.revit", "vers.models");
		l = setActive(l, "vers.models");
		return { ...l, focused: "chat" };
	}
	// a list page is not a window: it opens in the sidebar (windows.ts), so its layout is the chat alone
	if (def.kind === "sidebar") return l;
	// a full page: its panel is the main area; the lists it works with (Faili, Avoti, Prasības) open in the sidebar
	return { ...resizeDock(l, "left", FULL_PAGE_CHAT, NOMINAL), focused: "chat" };
}
export const CHAT_DEFAULT_SIZE = DEFAULT_DOCK;

/** The viewer's own side windows: on every page whose canvas is the viewer (sidebar pages and Versijas). */
const VIEWER_WINDOWS = ["viewer.props", "viewer.tree", "viewer.ifcmeta", "viewer.filemeta", "viewer.comments"];

/**
 * The windows the Windows menu lists for a page: what its default layout holds, the windows its canvas opens later (a cell's
 * lines, the viewer's side windows) and the side pages of a full page. Every window a page can show is in this list, so a
 * closed one is always one click away.
 */
export function pageWindows(page: string): string[] {
	const def = pageById(page);
	if (!def) return [];
	const out = new Set(allWindows(defaultLayout(page)));
	out.add("chat");
	out.add("threads");
	if (def.canvas === "scene") {
		out.add("coord.lines");
		out.add("coord.reference");
	}
	if (def.kind !== "page" || def.canvas === "viewer" || !def.canvas) for (const v of VIEWER_WINDOWS) out.add(v);
	return [...out];
}

// ---- which windows a page shows (B5) ----

/** Windows that belong to one page: drawn only there, kept where the user put them while another page is open. */
const OWNER: Record<string, string> = {
	"coord.matrix": "koordinacija",
	"coord.reference": "koordinacija",
	"coord.lines": "koordinacija",
	"vers.list": "versijas",
	"vers.models": "versijas",
	"vers.sheets": "versijas",
	"vers.revit": "versijas",
	"telpas.diffs": "telpaslapa",
	"telpas.inventory": "telpaslapa",
	"telpas.inv": "telpaslapa",
};
export const ownerOf = (id: string): string | undefined => OWNER[id];

/**
 * Is a window drawn on this page? A page's own windows only on that page; the viewer's side windows only while the viewer is
 * on screen; everything else (the chat, the comment tools, the conversations, a list or a global panel the user opened as a
 * window) on every page, as BIM Crew's windows are.
 */
export function windowShown(id: string, page: string, viewerShown: boolean): boolean {
	const owner = OWNER[id];
	if (owner) return owner === page;
	if (VIEWER_WINDOWS.includes(id)) return viewerShown;
	return true;
}

/** Is the viewer on screen: on a list page and Versijas always, on a full page only beside an open file (or a fact review). */
export function viewerShownOn(page: string, fileOpen: boolean): boolean {
	const def = pageById(page);
	if (def?.canvas === "scene" || def?.canvas === "plan") return false;
	if (def?.kind === "page" && !def.canvas) return fileOpen;
	return true;
}

// ---- one-time repair of a layout saved before plan C ----

export const PLAN_C = "plan-c";
/**
 * A layout saved before plan C has the list pages docked as windows (on the right) and the comment tools docked on top: the
 * lists leave the docks for the sidebar, and the tool bar goes to the column beside the chat. A list the user floated stays
 * a floating window (it was put there on purpose); the tool bar stays wherever the user moved it, unless it is still on top.
 */
export function migratePlanC(l: Layout): Layout {
	let next = l;
	for (const p of PAGES) {
		if (p.kind !== "sidebar") continue;
		const g = groupOf(next, p.id);
		if (g && (g.place.kind === "dock" || ((g.place.kind === "min" || g.place.kind === "pop") && g.place.from.kind === "dock"))) next = close(next, p.id);
	}
	const t = groupOf(next, TOOLS);
	if (t && t.place.kind === "dock" && t.place.side === "top") next = toEdge(next, TOOLS);
	return next;
}

// ---- opening by name: the agent's open_panel, Ctrl+K, links between panels ----

export interface OpenTarget {
	panel: PanelName;
	/** the page to switch to; null for a global window */
	page: PanelName | null;
	filter?: string;
}

/**
 * Every name that open_panel and the links between panels used before the rail still resolves. Koordinācija left
 * Prasības' tabs: the filter "coordination" now opens its own page.
 */
export function resolveOpen(name: string, filter?: string): OpenTarget | null {
	if (name === "prasibas" && filter === "coordination") return { panel: "koordinacija", page: "koordinacija" };
	if (GLOBAL_PANELS.includes(name as PanelName)) return { panel: name as PanelName, page: null, filter };
	const p = pageById(name);
	return p ? { panel: p.id, page: p.id, filter } : null;
}

// ---- the rail and the palette ----

export function railGroups(): { id: PageGroup; title: string; pages: PageDef[] }[] {
	return GROUPS.map((g) => ({ ...g, pages: PAGES.filter((p) => p.group === g.id && !p.hidden) }));
}

export interface PageItem {
	id: string;
	label: string;
	hint: string;
	keywords: string;
}
/** What the palette lists for pages: by rail order, the group in the hint and in the keywords. */
export function pageItems(): PageItem[] {
	const groupTitle = (g: PageGroup) => GROUPS.find((x) => x.id === g)!.title;
	return [
		...PAGES.map((p) => ({ id: p.id, label: p.title, hint: `${groupTitle(p.group)} · ${p.hint}`, keywords: `${groupTitle(p.group)} ${p.kind === "page" ? "lapa" : "sānjosla"}` })),
		...GLOBAL_PANELS.map((id) => ({ id, label: GLOBAL_TITLE[id].title, hint: GLOBAL_TITLE[id].hint, keywords: "" })),
	];
}

// ---- the top bar's status pill ----

export interface PillInput {
	stage: string | null;
	openFindings: number;
	openInfo: number;
}
export interface Pill {
	text: string;
	tone: "bad" | "ok";
	open: { panel: PanelName; filter?: string };
}

/** "1 atradums", "2 atradumi", "11 atradumi", "21 atradums": Latvian plural by the last digits. */
export const findingsWord = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? "atradums" : "atradumi");

/** One pill at most: the open errors and warnings (the worst thing), else the stage the project is in, else nothing. */
export function statusPill(p: PillInput | null): Pill | null {
	if (!p) return null;
	if (p.openFindings > 0) return { text: `${p.openFindings} ${findingsWord(p.openFindings)}`, tone: "bad", open: { panel: "prasibas", filter: "findings" } };
	if (p.stage) return { text: p.stage, tone: "ok", open: { panel: "parskats" } };
	return null;
}
