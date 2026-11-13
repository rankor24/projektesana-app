// The view-context toggle in the chat bar (task 9.2). Auto adds one Fokuss item built from the viewer (the open file, the
// page, the selected elements, the camera) to every message; Manual sends only the Fokuss the user built. The default
// follows the active viewer tab: 3D models are Auto (what you look at is the question), documents are Manual (a page of a
// PDF is not worth the tokens on every message). Pure and node-free.
import type { PinCamera } from "../core/model.js";
import type { FocusItem } from "./api.js";

export type ViewMode = "auto" | "manual";
/** What the open viewer tab is. */
export type ViewKind = "ifc" | "source" | "compare" | "law" | null;

export interface ViewState {
	kind: ViewKind;
	/** the file's name as the user reads it */
	label?: string;
	sourceId?: string;
	/** the model's path or revision reference */
	path?: string;
	/** the page shown (a PDF) */
	page?: number;
	/** the elements selected in 3D */
	selection: { guid: string | null; cls: string | null; name: string | null }[];
	camera?: PinCamera | null;
}

export const MAX_SELECTED = 20;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 3D (and an IFC compare) → auto; documents, sheets, law, nothing → manual. */
export const defaultMode = (kind: ViewKind): ViewMode => (kind === "ifc" || kind === "compare" ? "auto" : "manual");

/** The user's own choice holds for the tab it was made on; on another kind of tab the default applies again. */
export function effectiveMode(choice: { kind: ViewKind; mode: ViewMode } | null, kind: ViewKind): ViewMode {
	return choice && choice.kind === kind ? choice.mode : defaultMode(kind);
}

/** The one Fokuss item for Auto: null when no viewer tab is open. Small and stable: the cut keeps the meter honest. */
export function viewContextItem(v: ViewState): FocusItem | null {
	if (!v.kind || !v.label) return null;
	const sel = v.selection.slice(0, MAX_SELECTED);
	const parts = [v.label];
	if (v.page) parts.push(`lpp. ${v.page}`);
	if (v.selection.length) parts.push(`${v.selection.length} elementi`);
	if (v.camera) parts.push("kamera");
	return {
		kind: "view",
		id: "view",
		label: `skats: ${parts.join(", ")}`,
		data: {
			tab: v.kind,
			file: v.label,
			...(v.sourceId ? { sourceId: v.sourceId } : {}),
			...(v.path ? { model: v.path } : {}),
			...(v.page ? { page: v.page } : {}),
			...(sel.length ? { selected: sel.map((s) => ({ guid: s.guid, cls: s.cls, name: s.name })), selectedCount: v.selection.length } : {}),
			...(v.camera ? { camera: { position: v.camera.position.map(r2), target: v.camera.target.map(r2), fov: r2(v.camera.fov) } } : {}),
		},
	};
}

/** The Fokuss that goes with a message: the user's own items, plus the view item in Auto (replacing an older one). */
export function focusForSend(focus: FocusItem[], mode: ViewMode, v: ViewState): FocusItem[] {
	const own = focus.filter((f) => f.kind !== "view");
	if (mode !== "auto") return own;
	const item = viewContextItem(v);
	return item ? [...own, item] : own;
}
