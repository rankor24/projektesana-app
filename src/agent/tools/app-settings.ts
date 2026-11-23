// app_settings: how an agent finds, reads and changes the app's own settings (language, theme, AI model and effort, backup, limits…) and
// answers "where do I change X?". One tool with four actions instead of one tool per setting, so the tool list stays short; the details of a
// setting are looked up with find / get, never listed here.
// The tier of each setting decides what a set does (main/app-settings/registry.ts):
//   safe        applied at once; the user sees a notice with an Undo button (set returns the change's id, undo takes it)
//   secret      API keys and tokens: never given to or taken from the agent; the user is shown where to type the key
//   owner-only  sign-in, paths of programs, the name signed under decisions: explained, never written
// At most 10 sets per run. Ported from OpenMausBot docs/superpowers/specs/2026-11-12-app-settings-tool-design.md ("Tool"). Goes through the
// bridge (main/agent-bridge.ts /app-settings) so the budget, the log and the Undo live in main, in one place.
import { z } from "zod";
import { bridge } from "./app.js";
import { tool, type ToolDef } from "./tool.js";

export const appSettingsTools: ToolDef[] = [
	tool({
		name: "app_settings",
		level: "run",
		description:
			"The app's own settings. find: words (LV or EN) → matching settings with value and where the user changes them. get: one setting by id. set: id + value; safe ones apply at once and the user can Undo; keys, sign-in and paths only the user sets (you are told where). undo: a change id from set.",
		input: {
			action: z.enum(["find", "get", "set", "undo"]),
			query: z.string().optional().describe("find: e.g. 'dark mode', 'rezerves AI', 'api key'"),
			id: z.string().optional().describe("get/set: the setting id from find; undo: the change id (chg-…) set returned"),
			value: z.unknown().optional().describe("set: the new value, as get shows its allowed values"),
		},
		run: async (ctx, a) => {
			const r = await bridge(ctx, "/app-settings", { action: a.action, query: a.query, id: a.id, value: a.value, run: ctx.runDir, agent: ctx.agent });
			return String(r.text ?? "");
		},
	}),
];
