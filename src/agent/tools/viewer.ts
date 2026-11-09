// The agent's viewer and panel tools (auto, annotate). The tools server is its own process, so these return a `__ui`
// instruction; the chat dock carries it out in the window (opens a panel, highlights elements in BimCraft). They never
// change the model or any project data.
import { z } from "zod";
import { tool, type ToolDef } from "./tool.js";
import { PANEL_NAMES, uiResult } from "../../shared/ui-instruction.js";

export const viewerTools: ToolDef[] = [
	tool({
		name: "open_panel",
		level: "annotate",
		description: "Open one of the app's panels for the user, optionally with a filter (a search text, or a delivery / finding id).",
		input: { name: z.enum(PANEL_NAMES), filter: z.string().optional() },
		run: (_ctx, { name, filter }) => uiResult(`Atvērts panelis ${name}.`, { open_panel: { name, filter } }),
	}),
	tool({
		name: "show_source",
		level: "annotate",
		description: "Show a source in the preview at a page (to point the user at what you cite).",
		input: { sourceId: z.string(), page: z.number().int().min(1).optional() },
		run: (_ctx, a) => uiResult(`Parādīts avots ${a.sourceId}${a.page ? `, lpp. ${a.page}` : ""}.`, { show_source: a }),
	}),
	tool({
		name: "highlight",
		level: "annotate",
		description: "Select and highlight model elements in the IFC preview by GlobalId (the viewer must have the model open).",
		input: { guids: z.array(z.string()).min(1).max(500) },
		run: (_ctx, { guids }) => uiResult(`Iezīmēti ${guids.length} elementi priekšskatā.`, { highlight: { guids } }),
	}),
	tool({
		name: "draw_sketch",
		level: "annotate",
		description: "Show the user what you propose to change: highlight the elements by GlobalId with a short note. It is a sketch on screen only; it changes nothing in the model.",
		input: { guids: z.array(z.string()).min(1).max(500), note: z.string().min(3) },
		run: (_ctx, { guids, note }) => uiResult(`Skice parādīta: ${note}`, { highlight: { guids, note } }),
	}),
];
