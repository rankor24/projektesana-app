// Tool definitions of the app's own tools server. Each tool has a name, an approval level, an input schema and a run function.
// Phases add their tools in their own files (sources.ts, requirements.ts, …); this file collects them.
import { z } from "zod";
import { focusText } from "../focus.js";
import { readFocus, type ToolCtx } from "./context.js";
import type { Level } from "./levels.js";

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
	name: string;
	level: Level;
	description: string;
	input: S;
	run: (ctx: ToolCtx, args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>;
}

/** Keeps the input shape's types attached to `run`. */
export const tool = <S extends z.ZodRawShape>(d: ToolDef<S>): ToolDef => d as unknown as ToolDef;

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
	return [...focusTools];
}

/** Level table of the app's own tools, for the gate. */
export function appLevels(tools = allTools()): Record<string, Level> {
	return Object.fromEntries(tools.map((t) => [t.name, t.level]));
}
