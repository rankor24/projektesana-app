// Tokens of the tool declarations a run carries with every request (task 13.2: moved out of thread-runner so the settings page can count them too).
// The schema is counted as pi sends it: without `$schema` (pi/mcp.ts drops it), which is about 14 tokens a tool.
// Revit's tools come on top when it is connected; they are not counted here (the lead's number never counted them either).
import { z } from "zod";
import type { AgentSpec } from "../shared/agent-types.js";
import { estimateTextTokens } from "./context.js";
import { mailDeclarations } from "./mail.js";
import { PROCESS_OWN_TOOLS } from "../core/process-def.js";
import { MAIN_TOOL_LEVELS, ownTools, subagentDeclarations } from "./subagents.js";
import { allTools, appLevels } from "./tools/defs.js";
import { makeLevelOf, offered } from "./tools/levels.js";
import { REVIT_LEVELS } from "./tools/revit-levels.js";

type Decl = { name: string; description: string; parameters: unknown };

let appDecls: Decl[] | null = null;
const appDeclarations = (): Decl[] => {
	if (!appDecls) {
		const params = (t: { input: Parameters<typeof z.object>[0] }) => {
			const { $schema: _drop, ...rest } = z.toJSONSchema(z.object(t.input)) as Record<string, unknown>;
			return rest;
		};
		appDecls = allTools().map((t) => ({ name: t.name, description: t.description, parameters: params(t) }));
	}
	return appDecls;
};

let leadTokens: number | null = null;

/** What the agent's requests carry as tool declarations: the lead's own, run_subagent, delegate and the mail tools; a specialist's are its
 *  read tools, its own tools and the mail tools (no helpers). */
export function declarationTokens(spec: AgentSpec | null): number {
	if (!spec) return (leadTokens ??= estimateTextTokens(JSON.stringify([...appDeclarations().filter((d) => !PROCESS_OWN_TOOLS.has(d.name)), ...subagentDeclarations(), ...mailDeclarations()])));
	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const mine = new Set(ownTools(offered(appDeclarations().map((d) => d.name), levelOf), levelOf, new Set(), spec));
	return estimateTextTokens(JSON.stringify([...appDeclarations().filter((d) => mine.has(d.name)), ...mailDeclarations()]));
}
