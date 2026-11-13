// The agent's viewer and panel tools (auto, annotate). The tools server is its own process, so these return a `__ui`
// instruction; the chat dock carries it out in the window (opens a panel, acts on the viewer). They never change the model or
// any project data: viewer_* only change what the user sees, and the run card keeps each as a chip the user can press again.
import { z } from "zod";
import { tool, type ToolDef } from "./tool.js";
import { checkViewerAction, MAX_GUIDS, PANEL_NAMES, uiResult, type ViewerAction } from "../../shared/ui-instruction.js";
import { storeOf } from "./context.js";

const guids = z.array(z.string()).max(MAX_GUIDS);

/** A viewer action as a tool result, checked first: what cannot be carried out is said to the model, not sent to the window. */
function viewerResult(note: string, a: ViewerAction) {
	const bad = checkViewerAction(a);
	if (bad) throw new Error(bad);
	return uiResult(note, { viewer: a });
}

export const viewerTools: ToolDef[] = [
	tool({
		name: "open_panel",
		level: "annotate",
		description: "Open an app panel, optionally with a filter text or delivery / finding id.",
		input: { name: z.enum(PANEL_NAMES), filter: z.string().optional() },
		run: (_ctx, { name, filter }) => uiResult(`Atvērts panelis ${name}.`, { open_panel: { name, filter } }),
	}),
	tool({
		name: "show_source",
		level: "annotate",
		description: "Show a source page in the viewer.",
		input: { sourceId: z.string(), page: z.number().int().min(1).optional() },
		run: (_ctx, a) => uiResult(`Parādīts avots ${a.sourceId}${a.page ? `, lpp. ${a.page}` : ""}.`, { show_source: a }),
	}),
	tool({
		name: "highlight",
		level: "annotate",
		description: "Select model elements by GlobalId in the open 3D view.",
		input: { guids: z.array(z.string()).min(1).max(500) },
		run: (_ctx, { guids }) => uiResult(`Iezīmēti ${guids.length} elementi priekšskatā.`, { highlight: { guids } }),
	}),
	tool({
		name: "draw_sketch",
		level: "annotate",
		description: "Sketch on screen only: highlight elements by GlobalId with a short note.",
		input: { guids: z.array(z.string()).min(1).max(500), note: z.string().min(3) },
		run: (_ctx, { guids, note }) => uiResult(`Skice parādīta: ${note}`, { highlight: { guids, note } }),
	}),
	tool({
		name: "viewer_fly_to",
		level: "annotate",
		description: "Fly the 3D camera to a pin (id) or an element (GlobalId).",
		input: { pin: z.string().optional(), guid: z.string().optional() },
		run: (ctx, a) => {
			if (a.pin && !storeOf(ctx).read("pins").some((p) => p.id === a.pin)) throw new Error(`Piezīme ${a.pin} nav atrasta.`);
			return viewerResult(a.pin ? `Kamera lido uz piezīmi ${a.pin}.` : "Kamera lido uz elementu.", { action: "fly_to", ...(a.pin ? { pin: a.pin } : {}), ...(a.guid ? { guid: a.guid } : {}) });
		},
	}),
	tool({
		name: "viewer_select",
		level: "annotate",
		description: "Select elements by GlobalId in the 3D view.",
		input: { guids: guids.min(1) },
		run: (_ctx, { guids }) => viewerResult(`Iezīmēti ${guids.length} elementi.`, { action: "select", guids }),
	}),
	tool({
		name: "viewer_isolate",
		level: "annotate",
		description: "Show only these elements (ghost: dim the rest). No guids: show all.",
		input: { guids, ghost: z.boolean().optional() },
		run: (_ctx, { guids, ghost }) => viewerResult(guids.length ? `Atstāti ${guids.length} elementi.` : "Rādīts viss modelis.", { action: "isolate", guids, ...(ghost ? { ghost } : {}) }),
	}),
	tool({
		name: "viewer_colour",
		level: "annotate",
		description: "Colour the model by a property or attribute value (e.g. Pset_WallCommon.FireRating), legend shown. Empty property clears.",
		input: { property: z.string().max(80), guids: guids.min(1).optional() },
		run: (_ctx, a) => viewerResult(a.property ? `Modelis krāsots pēc ${a.property}.` : "Krāsas noņemtas.", { action: "colour", property: a.property, ...(a.guids ? { guids: a.guids } : {}) }),
	}),
	tool({
		name: "viewer_split",
		level: "annotate",
		description: "Split the viewer: two angles of the open model, or two sources (a, b = source ids) side by side.",
		input: { dir: z.enum(["h", "v"]).optional(), a: z.string().optional(), b: z.string().optional() },
		run: (ctx, a) => {
			if (a.a && a.b) {
				const ids = new Set(storeOf(ctx).read("sources").map((s) => s.id));
				for (const id of [a.a, a.b]) if (!ids.has(id)) throw new Error(`Avots ${id} nav atrasts.`);
			}
			return viewerResult(a.a ? "Divi faili blakus." : "Skats sadalīts divos.", { action: "split", ...(a.dir ? { dir: a.dir } : {}), ...(a.a ? { a: a.a } : {}), ...(a.b ? { b: a.b } : {}) });
		},
	}),
];
