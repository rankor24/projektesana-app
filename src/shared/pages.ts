// The page registry (task 9.1). A page is one entry of the rail: an id (the panel it shows), a group, a kind and a default
// layout. A **sidebar** page keeps the viewer in the middle and docks its panel on the right of the canvas, with the chat on
// the left; a **page** fills the main area with its panel, with the chat docked smaller and the Faili / Avoti / Prasības
// tabs docked on the right. Every panel is reachable from exactly one page, or is a global window (the project list, the
// settings). Pure and node-free: the rail, the palette, the top bar's status pill and the tests use the same table.
// BIM Crew reference: shell/NavRail.tsx and shell/items.tsx (grouped rail items, icon + name, collapse).
import { DEFAULT_DOCK, dock, emptyLayout, mergeInto, open, resizeDock, setActive, type Layout, type PANEL_IDS, type Vp } from "./layout.js";

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
export const GLOBAL_PANELS: PanelName[] = ["projekts", "iestatijumi"];
export const GLOBAL_TITLE: Record<string, { title: string; hint: string }> = {
	projekts: { title: "Projekti", hint: "projektu saraksts, nolasīšana" },
	iestatijumi: { title: "Iestatījumi", hint: "ceļi, modelis, Revit" },
};
export const START_PAGE: PanelName = "parskats";

export const pageById = (id: string): PageDef | undefined => PAGES.find((p) => p.id === id);
export const isPageId = (id: string): boolean => PAGES.some((p) => p.id === id);

/** The panels the user opens from the left rail's side pages' tab group on a full page. */
const FULL_PAGE_TABS: PanelName[] = ["faili", "avoti", "prasibas"];
export const SIDEBAR_SIZE = 420;
export const FULL_PAGE_CHAT = 300;
export const FULL_PAGE_TABS_SIZE = 380;
export const MATRIX_SIZE = 260;

const NOMINAL: Vp = { w: 1600, h: 900 };

/** A page's default layout. Always valid under 9.0 (the tests check it for every page). */
export function defaultLayout(page: string): Layout {
	let l = emptyLayout();
	const def = pageById(page);
	if (!def) return l;
	if (def.canvas === "scene") {
		// the models in one 3D scene on the canvas; the matrix docked at the bottom; the reference a tab beside the chat (the
		// chat stays the one in front); a cell click opens its lines in a window docked on the right (shell/KoordScene.tsx)
		l = mergeInto(open(l, "coord.reference", NOMINAL), "coord.reference", "chat");
		l = setActive(l, "chat");
		l = dock(open(l, "coord.matrix", NOMINAL), "coord.matrix", "bottom", NOMINAL, { size: MATRIX_SIZE });
		return { ...l, focused: "chat" };
	}
	if (def.canvas === "plan") {
		// the floor strip and the tile plan on the canvas; the differences (and the inventory as a tab of the same group) docked on
		// the right; INV Area at the bottom
		l = dock(open(l, "telpas.diffs", NOMINAL), "telpas.diffs", "right", NOMINAL, { size: SIDEBAR_SIZE + 40 });
		l = mergeInto(open(l, "telpas.inventory", NOMINAL), "telpas.inventory", "telpas.diffs");
		l = setActive(l, "telpas.diffs");
		l = dock(open(l, "telpas.inv", NOMINAL), "telpas.inv", "bottom", NOMINAL, { size: 200 });
		return { ...l, focused: "chat" };
	}
	if (def.canvas === "viewer") {
		// the viewer (split A / B for the picked change) on the canvas; the change list docked on the right of it, with the kind
		// filters; Modeļi, Lapu izmaiņas and Revit as one group at the bottom
		l = dock(open(l, "vers.list", NOMINAL), "vers.list", "right", NOMINAL, { size: SIDEBAR_SIZE });
		l = dock(open(l, "vers.models", NOMINAL), "vers.models", "bottom", NOMINAL, { size: MATRIX_SIZE });
		l = mergeInto(open(l, "vers.sheets", NOMINAL), "vers.sheets", "vers.models");
		l = mergeInto(open(l, "vers.revit", NOMINAL), "vers.revit", "vers.models");
		l = setActive(l, "vers.models");
		return { ...l, focused: "chat" };
	}
	if (def.kind === "sidebar") {
		l = open(l, def.id, NOMINAL);
		return dock(l, def.id, "right", NOMINAL, { size: SIDEBAR_SIZE });
	}
	l = resizeDock(l, "left", FULL_PAGE_CHAT, NOMINAL);
	for (const id of FULL_PAGE_TABS) {
		l = open(l, id, NOMINAL);
		l = dock(l, id, "right", NOMINAL, { size: FULL_PAGE_TABS_SIZE });
	}
	l = setActive(l, "faili");
	return { ...l, focused: "chat" };
}
export const CHAT_DEFAULT_SIZE = DEFAULT_DOCK;

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
