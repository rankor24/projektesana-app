// Specialists for the settings page (task 8.15): the list the agent can delegate to, edited by the user. Saved in agents.json of the
// app data; until the first save the shipped three are in use. A specialist's tools are checked here against the tools that exist
// and their levels (nothing above `run` unless the agent's maxLevel is "confirm", nothing that starts other agents). 13.5: the role text and the
// shared rules the Aģenti page edits.
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { PROCESS_OWN_TOOLS } from "../../core/process-def.js";
import { appLevels, allTools } from "../../agent/tools/defs.js";
import { REVIT_LEVELS } from "../../agent/tools/revit-levels.js";
import { makeLevelOf } from "../../agent/tools/levels.js";
import { DEFAULT_AGENTS, LEVEL_RANK, MAIN_TOOL_LEVELS, validateSpec } from "../../agent/subagents.js";
import { LEAD_FIXED_MAX, ROLE_MAX, SHARED_MAX, SPECIALIST_FIXED_MAX, type StandingDeps, fixedTokens, processReserve, readRole, revitReserve, readShared, writeRole, writeShared } from "../../agent/agents.js";
import { declarationTokens } from "../../agent/declarations.js";
import { listSkills, officeSkillsDir } from "../../agent/skills.js";
import type { AgentSpec, AgentSpecRow, AgentToolRow } from "../../shared/agent-types.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "agents.list" | "agents.save" | "agents.role.get" | "agents.role.set" | "agents.role.import" | "agents.shared.get" | "agents.shared.set";

export function agentHandlers(d: { settings: AppSettings; /** the synced skills folder; without it no agent has a skills list */ skillsDir?: string }): Pick<Handlers, K> {
	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const known = [...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)];
	const rows = (): AgentToolRow[] => {
		const app = allTools().map((t) => ({ name: t.name, level: t.level as string, description: t.description.split(/(?<=\.)\s/)[0] ?? "" }));
		const rv = Object.entries(REVIT_LEVELS).map(([name, level]) => ({ name, level: level as string, description: "Revit" }));
		// the process write tools are given to bpv and eks by themselves (R35): not a row to tick
		// confirm tools are listed too (13.5): the page offers them only to an agent with maxLevel "confirm", validateSpec holds the line on save
		return [...app, ...rv].filter((r) => !PROCESS_OWN_TOOLS.has(r.name) && LEVEL_RANK[levelOf(r.name)] > 0 && LEVEL_RANK[levelOf(r.name)] <= LEVEL_RANK.confirm).sort((a, b) => a.name.localeCompare(b.name));
	};
	/** what the agent's requests carry before the conversation starts, measured with the settings, the specs and the skills as they are now, and with what a run adds later at its
	 *  largest: the office knowledge, the process text (status, stage card) and the declarations of its Revit tools. The limit must hold then (R47). `unsaved`: a role text or shared rules not saved yet. */
	const fixedOf = (spec: AgentSpec, specs: readonly AgentSpec[], unsaved: Pick<StandingDeps, "roleText" | "sharedText"> = {}) =>
		fixedTokens(spec, { appDir: d.settings.dir, userName: d.settings.get().userName, specs, skills: listSkills(d.skillsDir ?? "", officeSkillsDir(d.settings.dir)), ...processReserve(spec), ...unsaved }, declarationTokens(spec) + revitReserve(spec));
	/** A role or shared text that would push a saved agent past the limit is refused before it is written; an agent that is over already may only get smaller. */
	const holds = (unsaved: Pick<StandingDeps, "roleText" | "sharedText">) => {
		const { specs, shipped } = d.settings.agentSpecs();
		if (shipped) return; // the shipped three have no role files of their own to grow
		for (const spec of specs) {
			// a role text reaches only the agent that reads its file; the shared rules reach everyone
			if (unsaved.roleText ? !(unsaved.roleText.id === spec.id && spec.roleFile) : unsaved.sharedText === undefined) continue;
			const n = fixedOf(spec, specs, unsaved);
			if (n > SPECIALIST_FIXED_MAX && n > fixedOf(spec, specs)) throw new Error(`Aģenta ${spec.id} pastāvīgais konteksts būtu ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}); teksts nav saglabāts.`);
		}
	};
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
			// the standing text is read from the role file, and a process adds its status and card: this is the most the agent's runs will carry
			for (const spec of out) {
				const n = fixedOf(spec, out);
				if (n > SPECIALIST_FIXED_MAX) throw new Error(`Aģenta ${spec.id} pastāvīgais konteksts ir ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}).`);
			}
			// each added specialist adds a roster line to the lead's text: the lead is measured with the new list, as the 0.6 guard measures it (R49).
			// A save that does not make the lead heavier always goes through, so a list already over the cap (a skills sync adds to the lead) can still be
			// trimmed; only a save that crosses the cap, or adds to a lead already over it, is refused.
			const leadOf = (list: AgentSpec[]) => fixedTokens(null, { appDir: d.settings.dir, userName: d.settings.get().userName, specs: list, skills: listSkills(d.skillsDir ?? "", officeSkillsDir(d.settings.dir)), knowledge: "" }, declarationTokens(null));
			const lead = leadOf(out);
			if (lead > LEAD_FIXED_MAX && lead > leadOf(d.settings.agentSpecs().specs)) throw new Error(`Galvenā aģenta pastāvīgais konteksts būtu ${lead} tokeni (limits ${LEAD_FIXED_MAX}). Saīsini aģentu aprakstus vai noņem kādu aģentu.`);
			d.settings.saveAgentSpecs(out);
			return out;
		},
		"agents.role.get": (id: string) => readRole(d.settings.dir, id),
		"agents.role.set": (id: string, text: string) => {
			if (typeof text !== "string") throw new Error("Lomas teksts: jābūt tekstam.");
			readRole(d.settings.dir, id); // refuses a bad id before anything is measured
			if (text.length <= ROLE_MAX) holds({ roleText: { id, text } });
			writeRole(d.settings.dir, id, text);
		},
		"agents.role.import": (id: string, path: string) => {
			if (typeof path !== "string" || extname(path).toLowerCase() !== ".md") throw new Error("Lomas aprakstam jābūt .md failam.");
			readRole(d.settings.dir, id); // refuses a bad id before the file is touched
			let bytes: Buffer;
			try {
				// a UTF-8 character is at most 4 bytes: a bigger file cannot fit, and is not read at all
				if (statSync(path).size > ROLE_MAX * 4 + 3) throw new Error(`Lomas teksts: līdz ${ROLE_MAX} zīmēm.`);
				bytes = readFileSync(path);
			} catch (e) {
				if (e instanceof Error && e.message.startsWith("Lomas teksts")) throw e;
				throw new Error(`Fails nav atrasts vai nevar nolasīt: ${path}`);
			}
			let text: string;
			try {
				// the decoder drops a byte order mark an editor may have added: it is not part of the role
				text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
			} catch {
				throw new Error("Fails nav UTF-8 teksts; saglabā to kā UTF-8 .md.");
			}
			if (text.length <= ROLE_MAX) holds({ roleText: { id, text } });
			writeRole(d.settings.dir, id, text); // refuses over ROLE_MAX and keeps the replaced text
			return { chars: text.length };
		},
		"agents.shared.get": () => readShared(d.settings.dir),
		"agents.shared.set": (text: string) => {
			if (typeof text !== "string") throw new Error("Kopējie noteikumi: jābūt tekstam.");
			if (text.length <= SHARED_MAX) holds({ sharedText: text });
			writeShared(d.settings.dir, text);
		},
	};
}
