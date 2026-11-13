// Carries out what an agent tool asked the window to do (open a panel, show a source, act on the viewer). Used by the chat dock
// when a tool result arrives and by the run card's chips (press one again to repeat it). Viewer actions change only the view.
import type { Pin } from "../core/model";
import { call } from "./bridge";
import { bimcraft } from "./preview/IfcView";
import { ui } from "./state";
import { viewer } from "./viewer-store";
import { windows, type PanelId } from "./windows";
import { checkViewerAction, type UiInstruction, type ViewerAction } from "../shared/ui-instruction";

/** One viewer action; a pin id is looked up for its camera. Returns a problem in words, or null. */
export async function runViewerAction(a: ViewerAction): Promise<string | null> {
	const bad = checkViewerAction(a);
	if (bad) return bad;
	switch (a.action) {
		case "fly_to": {
			if (a.guid) return bimcraft.send({ pj: 1, type: "fly", guid: a.guid }), null;
			const pins = ui.get().projectId ? await call("pins.list", ui.get().projectId!) : ([] as Pin[]);
			const p = pins.find((x) => x.id === a.pin);
			if (!p || !("elementGuid" in p.target)) return "Piezīme nav uz modeļa elementa.";
			bimcraft.send({ pj: 1, type: "fly", ...(p.target.camera ? { camera: p.target.camera } : { guid: p.target.elementGuid }) });
			return null;
		}
		case "select":
			return bimcraft.send({ pj: 1, type: "highlight", guids: a.guids }), null;
		case "isolate":
			return bimcraft.send({ pj: 1, type: "isolate", guids: a.guids, ...(a.ghost ? { ghost: true } : {}) }), null;
		case "colour":
			return bimcraft.send({ pj: 1, type: "colour", property: a.property, ...(a.guids ? { guids: a.guids } : {}) }), null;
		case "split":
			if (a.a && a.b) viewer.compareSplit({ target: { kind: "source", sourceId: a.a }, label: a.a }, { target: { kind: "source", sourceId: a.b }, label: a.b }, a.dir ?? "h");
			else viewer.split(a.dir ?? "h");
			return null;
	}
}

export function runUi(u: UiInstruction | null) {
	if (!u) return;
	if (u.open_panel) windows.open(u.open_panel.name as PanelId, u.open_panel.filter);
	if (u.show_source) ui.show({ kind: "source", sourceId: u.show_source.sourceId, page: u.show_source.page });
	if (u.highlight) bimcraft.send({ pj: 1, type: "highlight", guids: u.highlight.guids });
	if (u.viewer) void runViewerAction(u.viewer);
}
