// The messages between the app (host) and the BimCraft bridge add-on (src/bimcraft-addon/projektesana/main.js).
// Every message is { pj: 1, type, … }. Pure: the renderer, main and the tests use it.
import type { PinCamera, PinViewpoint } from "../core/model.js";

export type HostToBimcraft =
	| { pj: 1; type: "open"; name: string; bytes: Uint8Array }
	| { pj: 1; type: "select"; ids: number[] }
	| { pj: 1; type: "highlight"; guids: string[] }
	| { pj: 1; type: "sketch"; note?: string }
	/** draw these pins as numbered dots on their elements (replaces the set; [] clears) */
	| { pj: 1; type: "markers"; markers: PinMarker[] }
	/** fly the camera to a pin's saved view, or (no camera) frame the element with this GlobalId */
	| { pj: 1; type: "fly"; camera?: PinCamera; guid?: string }
	/** answer with the current selection, camera and BCF viewpoint: what a new pin is made from */
	| { pj: 1; type: "capture" }
	/** an element's attributes and property sets (the viewer's Properties window): by express id or GlobalId */
	| { pj: 1; type: "props"; id?: number; guid?: string }
	/** the spatial structure with the elements each part holds (the Element tree window) */
	| { pj: 1; type: "tree" }
	/** the schema, the project and the file header (the IFC metadata window) */
	| { pj: 1; type: "meta" }
	/** post the camera whenever the user moves it: the second view of a linked split follows */
	| { pj: 1; type: "watch"; on: boolean }
	/** show only these elements (ghost: the rest dimmed); no guids = show everything (the agent's viewer_isolate) */
	| { pj: 1; type: "isolate"; guids: string[]; ghost?: boolean }
	/** paint the elements by the value of a property or attribute, with a legend; no property clears (viewer_colour) */
	| { pj: 1; type: "colour"; property: string; guids?: string[] }
	| { pj: 1; type: "compare"; a: { name: string; bytes: Uint8Array }; b: { name: string; bytes: Uint8Array } };

/** A pin drawn in 3D: a numbered dot at the element it is placed on. */
export interface PinMarker {
	id: string;
	guid: string;
	n: number;
	state: "open" | "resolved" | "closed";
}

export interface PropRow {
	name: string;
	value: string;
}
export interface PropSet {
	name: string;
	fromType?: boolean;
	rows: PropRow[];
}
export interface ElementProps {
	id: number;
	guid: string | null;
	cls: string | null;
	name: string | null;
	objectType: string | null;
	tag: string | null;
	description: string | null;
	typeName: string | null;
	sets: PropSet[];
}
export interface TreeNode {
	id: number;
	cls: string;
	name: string | null;
	guid: string | null;
	children: TreeNode[];
	elementCount?: number;
	elements?: { id: number; cls: string; name: string | null; guid: string | null }[];
}
export interface IfcMeta {
	schema: string | null;
	project: { name: string | null; longName: string | null; phase: string | null };
	header: { timestamp: string | null; author: string | null; application: string | null };
	elements: number;
	storeys: number;
}

export interface BimcraftItem {
	id: number;
	guid: string | null;
	cls: string | null;
	name: string | null;
}

export type BimcraftToHost =
	| { pj: 1; type: "ready"; api: string }
	| { pj: 1; type: "opened"; name: string }
	| { pj: 1; type: "selection"; items: BimcraftItem[] }
	| { pj: 1; type: "highlighted"; found: number; asked: number }
	| { pj: 1; type: "sketch"; items: BimcraftItem[]; note: string }
	| { pj: 1; type: "captured"; items: BimcraftItem[]; camera: PinCamera | null; viewpoint: PinViewpoint | null }
	/** the user clicked a pin's dot in 3D */
	| { pj: 1; type: "marker"; id: string }
	| { pj: 1; type: "properties"; item: ElementProps }
	| { pj: 1; type: "tree"; nodes: TreeNode[] }
	| { pj: 1; type: "meta"; info: IfcMeta }
	/** the camera moved (only while the host watches it) */
	| { pj: 1; type: "camera"; camera: PinCamera }
	/** isolate / show all done: how many of the asked elements were in the model */
	| { pj: 1; type: "viewed"; action: "isolate" | "show_all" | "uncolour"; found: number; asked: number }
	/** the model painted by a property: one row per value, with its colour and how many elements */
	| { pj: 1; type: "coloured"; property: string; legend: { value: string; color: string; count: number }[]; total: number; painted: number; partial: boolean }
	/** how many of the asked markers found their element */
	| { pj: 1; type: "markers"; drawn: number; asked: number }
	| { pj: 1; type: "compared"; added: number; removed: number; changed: number; same: number; changes: { guid: string; props: string[]; moved: number; reshaped: boolean }[] }
	| { pj: 1; type: "error"; message: string };

const TO_HOST = ["ready", "opened", "selection", "highlighted", "sketch", "captured", "marker", "markers", "compared", "properties", "tree", "meta", "camera", "viewed", "coloured", "error"];

export function isBimcraftMessage(x: unknown): x is BimcraftToHost {
	const m = x as { pj?: unknown; type?: unknown };
	return !!m && typeof m === "object" && m.pj === 1 && typeof m.type === "string" && TO_HOST.includes(m.type);
}

/** A model element as a Fokuss item. */
export function elementFocus(it: BimcraftItem, model: string) {
	return { kind: "element" as const, id: it.guid ?? String(it.id), label: `${it.cls?.replace(/^IFC/, "Ifc") ?? "elements"} ${it.name ?? ""}`.trim(), data: { guid: it.guid, expressId: it.id, cls: it.cls, name: it.name, model } };
}

/** A sketch as the agent receives it: the elements the user marked, with their note — an instruction, never the model. */
export function sketchFocus(items: BimcraftItem[], note: string, model: string) {
	return { kind: "sketch" as const, id: `sketch:${Date.now().toString(36)}`, label: `skice: ${items.length} elementi${note ? ` — ${note.slice(0, 40)}` : ""}`, data: { model, note, elements: items.map((i) => ({ guid: i.guid, cls: i.cls, name: i.name })) } };
}

/** A message the app means to send, checked before it goes: the problem in words, or null when it is fine. */
export function checkHostMessage(m: HostToBimcraft): string | null {
	if (m.type === "props") {
		const idOk = Number.isInteger(m.id) && (m.id as number) > 0;
		const guidOk = typeof m.guid === "string" && m.guid.length > 0;
		return idOk || guidOk ? null : "props needs an element id or a GlobalId";
	}
	if (m.type === "isolate") return Array.isArray(m.guids) && m.guids.length <= 500 && m.guids.every((g) => typeof g === "string" && g) ? null : "isolate needs a list of up to 500 GlobalIds";
	if (m.type === "colour") return typeof m.property === "string" && m.property.length <= 80 && (m.guids === undefined || (Array.isArray(m.guids) && m.guids.length > 0 && m.guids.length <= 500)) ? null : "colour needs a property name (up to 80 characters) and, if given, 1 to 500 GlobalIds";
	if (m.type === "watch") return typeof m.on === "boolean" ? null : "watch needs on: true or false";
	return null;
}
