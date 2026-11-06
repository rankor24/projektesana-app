// The shape of one tool of the app's tools server. Its own file so tool modules and defs.ts do not import each other.
import type { z } from "zod";
import type { ToolCtx } from "./context.js";
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
