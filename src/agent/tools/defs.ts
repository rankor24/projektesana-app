// Tool definitions of the app's own tools server. Each tool has a name, an approval level, an input schema and a run function.
// Phases add their tools in their own files (sources.ts, requirements.ts, …); this file collects them.
import { focusText } from "../focus.js";
import { readFocus } from "./context.js";
import { tool, type ToolDef } from "./tool.js";
export type { ToolDef } from "./tool.js";
import type { Level } from "./levels.js";
import { projectTools, sourceTools } from "./sources.js";
import { skillTools } from "./revit.js";
import { pinTools } from "./pins.js";
import { todoTools } from "./todos.js";
import { coordinationTools } from "./coordination.js";
import { revitCommandTools } from "./revit-commands.js";
import { requirementTools } from "./requirements.js";
import { checkTools } from "./checks.js";
import { viewerTools } from "./viewer.js";
import { deliveryTools } from "./deliveries.js";


export const focusTools: ToolDef[] = [
	tool({
		name: "get_focus",
		level: "read",
		description: "What the user has selected now (Fokuss): sources, page regions, facts, requirements, findings, rooms, elements. Start from it.",
		input: {},
		run: (ctx) => focusText(readFocus(ctx)),
	}),
];

export function allTools(): ToolDef[] {
	return [...focusTools, ...sourceTools, ...projectTools, ...requirementTools, ...checkTools, ...deliveryTools, ...viewerTools, ...pinTools, ...todoTools, ...coordinationTools, ...skillTools, ...revitCommandTools];
}

/** Level table of the app's own tools, for the gate. */
export function appLevels(tools = allTools()): Record<string, Level> {
	return Object.fromEntries(tools.map((t) => [t.name, t.level]));
}
