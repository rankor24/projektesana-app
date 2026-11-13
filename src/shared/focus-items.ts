// Builders for Fokuss items, shared by the renderer (what the user selects) and the tests (what the agent receives).
import type { FocusItem } from "./api.js";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A rectangle on a page, in page fractions (0–1, origin top-left), with the text the text layer has inside it. */
export function regionFocus(sourceId: string, title: string, page: number, rect: { x: number; y: number; w: number; h: number }, text: string): FocusItem {
	const t = text.replace(/\s+/g, " ").trim();
	return {
		kind: "page-region",
		id: `${sourceId}:${page}:${r3(rect.x)},${r3(rect.y)},${r3(rect.w)},${r3(rect.h)}`,
		label: `${title}, lpp. ${page}${t ? ` — “${t.slice(0, 40)}${t.length > 40 ? "…" : ""}”` : ""}`,
		data: { sourceId, page, rect: { x: r3(rect.x), y: r3(rect.y), w: r3(rect.w), h: r3(rect.h) }, text: t.slice(0, 1500) },
	};
}

/** A sketch on a PDF page (8.2, Skice → aģentam): the rectangle the user drew with the note from the toolbar — an instruction to
 *  the agent, like a 3D sketch. The note goes first in the data, so the Fokuss line's length cut never drops it. */
export function pdfSketchFocus(sourceId: string, title: string, page: number, rect: { x: number; y: number; w: number; h: number }, text: string, note: string): FocusItem {
	const region = regionFocus(sourceId, title, page, rect, text);
	const n = note.trim();
	return { kind: "sketch", id: `sketch:${region.id}`, label: `skice: ${title}, lpp. ${page}${n ? ` — ${n.slice(0, 40)}` : ""}`, data: { note: n, ...region.data } };
}

export function sourceFocus(sourceId: string, title: string, role: string, page?: number): FocusItem {
	return { kind: "source", id: sourceId, label: page ? `${title} (lpp. ${page})` : title, data: { sourceId, role, ...(page ? { page } : {}) } };
}

export function textFocus(sourceId: string, title: string, page: number, text: string): FocusItem {
	const t = text.replace(/\s+/g, " ").trim().slice(0, 1500);
	return { kind: "text", id: `${sourceId}:${page}:${t.length}:${t.slice(0, 24)}`, label: `“${t.slice(0, 40)}${t.length > 40 ? "…" : ""}” (${title}, lpp. ${page})`, data: { sourceId, page, text: t } };
}
