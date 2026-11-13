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
	| { pj: 1; type: "compare"; a: { name: string; bytes: Uint8Array }; b: { name: string; bytes: Uint8Array } };

/** A pin drawn in 3D: a numbered dot at the element it is placed on. */
export interface PinMarker {
	id: string;
	guid: string;
	n: number;
	state: "open" | "resolved" | "closed";
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
	/** how many of the asked markers found their element */
	| { pj: 1; type: "markers"; drawn: number; asked: number }
	| { pj: 1; type: "compared"; added: number; removed: number; changed: number; same: number; changes: { guid: string; props: string[]; moved: number; reshaped: boolean }[] }
	| { pj: 1; type: "error"; message: string };

const TO_HOST = ["ready", "opened", "selection", "highlighted", "sketch", "captured", "marker", "markers", "compared", "error"];

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
