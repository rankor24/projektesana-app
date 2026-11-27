// What the open model viewer or PDF page can do, for the comment tool column (task 9.4 / D6): the focused single-model IfcView or
// the focused source PDF (SourcePdf) puts its actions here and takes them away when it closes or loses focus. The column shows the viewer's tools only while there are
// actions, so it never offers a tool that has no model to act on.
import { useSyncExternalStore } from "react";
import type { Markup } from "../core/model";

export interface ViewerActions {
	/** "model" (default): a 3D model, pin and sketch need selected elements, isolate / colour by exist. "page": a PDF page, pin and
	 *  sketch work on a click / a rectangle on the page, and there is no isolate or colour by. */
	kind?: "model" | "page";
	/** a model is open and the bridge answers */
	ready: boolean;
	/** elements selected in the model */
	selected: number;
	shape: Markup["shape"] | null;
	marks: number;
	/** a pin on the selected element with this text (and the marks drawn over the view); on a page: the next click on the page */
	pin(text: string): void;
	/** the selection with its places, as an instruction to the agent; on a page: the next rectangle drawn on the page */
	sketch(text: string): void;
	setShape(s: Markup["shape"] | null): void;
	clearMarks(): void;
	/** show only the selected elements, the rest dimmed */
	isolate(): void;
	showAll(): void;
	/** paint the model by an attribute or property ("klase", "typename", "Pset.Name") */
	colourBy(property: string): void;
}

let cur: ViewerActions | null = null;
const subs = new Set<() => void>();
export const viewerActions = {
	set(a: ViewerActions | null) {
		cur = a;
		subs.forEach((f) => f());
	},
	/** only the owner clears: a newer viewer that took over is not cleared by an older one closing */
	clear(a: ViewerActions | null) {
		if (cur === a) viewerActions.set(null);
	},
	get: () => cur,
};
export const useViewerActions = (): ViewerActions | null => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cur);
