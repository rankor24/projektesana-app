// The viewer's tabs and panes (task 9.3) as a small external store over the pure model (shared/viewer.ts), the bus the two
// panes of a linked split talk over, and what the open model tells the side panels (properties, tree, metadata).
// ui.show(target) opens a tab here; ui.preview mirrors the active tab of the focused pane for everything that reads it.
import { useSyncExternalStore } from "react";
import type { ElementProps, IfcMeta, TreeNode } from "../shared/bimcraft-protocol";
import * as V from "../shared/viewer";
import { ui } from "./state";

let state: V.ViewerState = V.emptyViewer();
const listeners = new Set<() => void>();

function commit(next: V.ViewerState) {
	if (next === state) return;
	state = next;
	// ui.preview follows the focused pane's active tab: the toolbar, the palette and the chat read it
	const tab = V.activeTab(state);
	ui.mirrorPreview(tab ? tab.target : null);
	for (const l of listeners) l();
}

export const viewer = {
	get: () => state,
	open(target: V.ViewTarget, label?: string, pane?: number) {
		commit(V.open(state, target, label ?? V.targetLabel(target), { pane }));
	},
	close: (id: string) => commit(V.close(state, id)),
	activate: (id: string, pane?: number) => commit(V.activate(state, id, pane)),
	focusPane: (i: number) => commit(V.focusPane(state, i)),
	split: (dir: "h" | "v") => commit(V.splitPane(state, dir)),
	unsplit: () => commit(V.unsplit(state)),
	moveTab: (id: string, to: number) => commit(V.moveTab(state, id, to)),
	linkCamera: (on: boolean) => commit(V.setLinkedCamera(state, on)),
	linkPage: (on: boolean) => commit(V.setLinkedPage(state, on)),
	compareSplit: (a: { target: V.ViewTarget; label: string }, b: { target: V.ViewTarget; label: string }, dir: "h" | "v" = "h") => commit(V.compareSplit(state, a, b, dir)),
	/** a source's page changed in a pane (the follower of a linked page follows) */
	pageChanged(fromPane: number, sourceId: string, page: number) {
		const to = V.followerOf(state, fromPane, "page");
		if (to === null) return;
		const tab = V.activeTab(state, to);
		if (!tab || tab.target.kind !== "source" || tab.target.page === page) return;
		commit(V.open(state, { ...tab.target, page }, tab.label, { pane: to }));
		void sourceId;
	},
	/** tabs whose source was removed from the project */
	closeAll: () => commit(V.emptyViewer()),
};

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export function useViewer(): V.ViewerState {
	return useSyncExternalStore(subscribe, () => state);
}

// ---- the camera of one pane, for the other (a linked split) ----
type CamListener = (from: number, camera: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
const camListeners = new Set<CamListener>();
export const cameraBus = {
	emit: (from: number, camera: Parameters<CamListener>[1]) => camListeners.forEach((l) => l(from, camera)),
	on: (l: CamListener) => (camListeners.add(l), () => camListeners.delete(l)),
};

// ---- what the focused model tells the side panels ----
export interface ViewerInfo {
	props: ElementProps | null;
	tree: TreeNode[] | null;
	meta: IfcMeta | null;
	/** which model (tab label) this is about: another model clears it */
	model: string | null;
	error: string | null;
}
let info: ViewerInfo = { props: null, tree: null, meta: null, model: null, error: null };
const infoListeners = new Set<() => void>();
export const viewerInfo = {
	get: () => info,
	set(patch: Partial<ViewerInfo>) {
		info = { ...info, ...patch };
		infoListeners.forEach((l) => l());
	},
	reset(model: string | null) {
		info = { props: null, tree: null, meta: null, model, error: null };
		infoListeners.forEach((l) => l());
	},
};
export function useViewerInfo(): ViewerInfo {
	return useSyncExternalStore(
		(l) => (infoListeners.add(l), () => infoListeners.delete(l)),
		() => info,
	);
}
