// Specialists for the settings page (task 8.15): the list the agent can delegate to, edited by the user. Saved in agents.json of the
// app data; until the first save the shipped three are in use. A specialist's tools are checked here against the tools that exist
// and their levels (nothing above `run`, nothing that starts other agents).
import { appLevels, allTools } from "../../agent/tools/defs.js";
import { REVIT_LEVELS } from "../../agent/tools/revit-levels.js";
import { makeLevelOf } from "../../agent/tools/levels.js";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOL_LEVELS, SPECIALIST_CAP, validateSpec } from "../../agent/subagents.js";
import type { AgentSpec, AgentToolRow } from "../../shared/agent-types.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "agents.list" | "agents.save";

export function agentHandlers(d: { settings: AppSettings }): Pick<Handlers, K> {
	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const known = [...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)];
	const rows = (): AgentToolRow[] => {
		const app = allTools().map((t) => ({ name: t.name, level: t.level as string, description: t.description.split(/(?<=\.)\s/)[0] ?? "" }));
		const rv = Object.entries(REVIT_LEVELS).map(([name, level]) => ({ name, level: level as string, description: "Revit" }));
		return [...app, ...rv].filter((r) => LEVEL_RANK[levelOf(r.name)] > 0 && LEVEL_RANK[levelOf(r.name)] <= LEVEL_RANK[SPECIALIST_CAP]).sort((a, b) => a.name.localeCompare(b.name));
	};
	return {
		"agents.list": () => {
			const { specs, shipped } = d.settings.agentSpecs();
			return { specs, shipped, defaults: DEFAULT_AGENTS, tools: rows(), maxParallel: d.settings.get().maxParallelAgents };
		},
		"agents.save": (specs: AgentSpec[]) => {
			const out: AgentSpec[] = [];
			for (const raw of specs) {
				const v = validateSpec(raw, levelOf, known);
				if (!v.ok) throw new Error(`${(raw as { name?: string })?.name || (raw as { id?: string })?.id || "speciālists"}: ${v.error}`);
				if (out.some((o) => o.id === v.spec.id)) throw new Error(`Identifikators ${v.spec.id} atkārtojas.`);
				out.push(v.spec);
			}
			d.settings.saveAgentSpecs(out);
			return out;
		},
	};
}
