// Specialists for the settings page (task 8.15): the list the agent can delegate to, edited by the user. Saved in agents.json of the
// app data; until the first save the shipped three are in use. A specialist's tools are checked here against the tools that exist
// and their levels (nothing above `run`, nothing that starts other agents).
import { appLevels, allTools } from "../../agent/tools/defs.js";
import { REVIT_LEVELS } from "../../agent/tools/revit-levels.js";
import { makeLevelOf } from "../../agent/tools/levels.js";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOL_LEVELS, SPECIALIST_CAP, validateSpec } from "../../agent/subagents.js";
import { SPECIALIST_FIXED_MAX, fixedTokens, readRole } from "../../agent/agents.js";
import { declarationTokens } from "../../agent/declarations.js";
import { listSkills } from "../../agent/skills.js";
import type { AgentSpec, AgentSpecRow, AgentToolRow } from "../../shared/agent-types.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "agents.list" | "agents.save";

export function agentHandlers(d: { settings: AppSettings; /** the synced skills folder; without it no agent has a skills list */ skillsDir?: string }): Pick<Handlers, K> {
	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const known = [...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)];
	const rows = (): AgentToolRow[] => {
		const app = allTools().map((t) => ({ name: t.name, level: t.level as string, description: t.description.split(/(?<=\.)\s/)[0] ?? "" }));
		const rv = Object.entries(REVIT_LEVELS).map(([name, level]) => ({ name, level: level as string, description: "Revit" }));
		return [...app, ...rv].filter((r) => LEVEL_RANK[levelOf(r.name)] > 0 && LEVEL_RANK[levelOf(r.name)] <= LEVEL_RANK[SPECIALIST_CAP]).sort((a, b) => a.name.localeCompare(b.name));
	};
	/** what the agent's requests carry before the conversation starts, measured with the settings, the specs and the skills as they are now */
	const fixedOf = (spec: AgentSpec, specs: readonly AgentSpec[]) => fixedTokens(spec, { appDir: d.settings.dir, userName: d.settings.get().userName, specs, skills: listSkills(d.skillsDir ?? ""), knowledge: "" }, declarationTokens(spec));
	return {
		"agents.list": () => {
			const { specs, shipped } = d.settings.agentSpecs();
			const withTokens: AgentSpecRow[] = specs.map((s) => ({ ...s, fixedTokens: fixedOf(s, specs) }));
			return { specs: withTokens, shipped, defaults: DEFAULT_AGENTS, tools: rows(), maxParallel: d.settings.get().maxParallelAgents };
		},
		"agents.save": (specs: AgentSpec[]) => {
			const out: AgentSpec[] = [];
			// the names in mayMessage / acceptsFrom are checked against the list being saved (and the lead)
			const ids = specs.map((s) => (typeof s?.id === "string" ? s.id.trim() : ""));
			// an empty or blank file is no role: the agent would run with nothing
			const roleExists = (id: string) => (readRole(d.settings.dir, id) ?? "").trim() !== "";
			for (const raw of specs) {
				const v = validateSpec(raw, levelOf, known, ids, roleExists);
				if (!v.ok) throw new Error(`${(raw as { name?: string })?.name || (raw as { id?: string })?.id || "speciālists"}: ${v.error}`);
				if (out.some((o) => o.id === v.spec.id)) throw new Error(`Identifikators ${v.spec.id} atkārtojas.`);
				out.push(v.spec);
			}
			// the standing text is read from the role file, so this is the count the agent's runs will carry
			for (const spec of out) {
				const n = fixedOf(spec, out);
				if (n > SPECIALIST_FIXED_MAX) throw new Error(`Aģenta ${spec.id} pastāvīgais konteksts ir ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}).`);
			}
			d.settings.saveAgentSpecs(out);
			return out;
		},
	};
}
