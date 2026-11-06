// Tool definitions of the app's own tools server. Each tool has a name, an approval level, an input schema and a run function.
// Phases add their tools in their own files (sources.ts, requirements.ts, …); this file collects them.
import { focusText } from "../focus.js";
import { readFocus } from "./context.js";
import { tool, type ToolDef } from "./tool.js";
export type { ToolDef } from "./tool.js";
import type { Level } from "./levels.js";
import { sourceTools } from "./sources.js";


export const focusTools: ToolDef[] = [
	tool({
		name: "get_focus",
		level: "read",
		description: "What Boris has selected now (Fokuss): sources, page regions, facts, requirements, findings, rooms, elements. Start from it.",
		input: {},
		run: (ctx) => focusText(readFocus(ctx)),
	}),
];

export function allTools(): ToolDef[] {
	return [...focusTools, ...sourceTools];
}

/** Level table of the app's own tools, for the gate. */
export function appLevels(tools = allTools()): Record<string, Level> {
	return Object.fromEntries(tools.map((t) => [t.name, t.level]));
}
