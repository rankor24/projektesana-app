// Pop out (task 9.11): a window that lives in its own OS window (a second monitor). The pop-out window runs the same renderer
// bundle and shows one layout window; the layout store is shared through main, which keeps the file and tells every window when
// it changed. What a popped window does to the app (open a file in the viewer, fly the 3D camera, go to a page) is relayed through
// main to the main window, where the viewer is. Pure and node-free.
import { isWindowId } from "./layout.js";
import type { PreviewTargetLike } from "./relay-types.js";

/** `?pop=<window id>` on the renderer's URL: which layout window this OS window shows, or null for the main window. */
export function popIdOf(search: string): string | null {
	const id = new URLSearchParams(search).get("pop");
	return id && isWindowId(id) ? id : null;
}

/** A thing a popped window asks the main window to do. */
export type RelayMsg =
	| { t: "show"; target: PreviewTargetLike | null }
	| { t: "go"; name: string; filter?: string }
	/** a message for the open 3D view (fly, select, isolate…): the bimcraft bridge's own shape */
	| { t: "bimcraft"; cmd: { pj: 1; type: string; [k: string]: unknown } };

/** The problem with a relayed message, or null. Main passes on only what it can check; the main window checks again. */
export function checkRelay(m: unknown): string | null {
	const r = m as RelayMsg;
	if (!r || typeof r !== "object") return "relay: not a message";
	if (r.t === "show") return r.target === null || (typeof r.target === "object" && typeof (r.target as { kind?: unknown }).kind === "string") ? null : "relay show: a target or null";
	if (r.t === "go") return typeof r.name === "string" && r.name ? (r.filter === undefined || typeof r.filter === "string" ? null : "relay go: filter is text") : "relay go: a page name";
	if (r.t === "bimcraft") return r.cmd && r.cmd.pj === 1 && typeof r.cmd.type === "string" ? null : "relay bimcraft: a bridge message";
	return "relay: unknown kind";
}

/** The window title of a pop-out: the layout window's name, so the OS task bar says what it is. */
export const popTitle = (name: string): string => `${name} — Projektēšanas App`;
