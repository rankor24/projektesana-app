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
import { importSkills, listSkills, officeSkillsDir } from "../../agent/skills.js";
import { maskMcp, probeMcpTools, restoreSecrets } from "../../agent/agent-mcp.js";
import { mergeRole, readTeam } from "../../agent/team-import.js";
import type { SkillInfo } from "../../shared/skill-types.js";
import type { AgentMcpServer, AgentSpec, AgentSpecRow, AgentToolRow, McpProbe, TeamImportReport } from "../../shared/agent-types.js";
import { BPV_ID, DEFAULT_DEPARTMENTS, checkDepartments, departmentOf, type Department } from "../../shared/departments.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "agents.list" | "agents.save" | "agents.move" | "departments.list" | "departments.save" | "agents.role.get" | "agents.role.set" | "agents.role.import" | "agents.shared.get" | "agents.shared.set" | "agents.importTeam" | "agents.mcp.probe";

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
	// the library is read from disk (every SKILL.md and its files): a call that measures many agents reads it once and passes it in
	const library = () => listSkills(d.skillsDir ?? "", officeSkillsDir(d.settings.dir));
	const fixedOf = (spec: AgentSpec, specs: readonly AgentSpec[], unsaved: Pick<StandingDeps, "roleText" | "sharedText"> = {}, skills: SkillInfo[] = library()) =>
		fixedTokens(spec, { appDir: d.settings.dir, userName: d.settings.get().userName, specs, skills, chief: spec.id === BPV_ID, ...processReserve(spec), ...unsaved }, declarationTokens(spec) + revitReserve(spec));
	/** A role or shared text that would push a saved agent past the limit is refused before it is written; an agent that is over already may only get smaller. */
	const holds = (unsaved: Pick<StandingDeps, "roleText" | "sharedText">) => {
		const { specs, shipped } = d.settings.agentSpecs();
		if (shipped) return; // the shipped three have no role files of their own to grow
		const skills = library();
		for (const spec of specs) {
			// a role text reaches only the agent that reads its file; the shared rules reach everyone
			if (unsaved.roleText ? !(unsaved.roleText.id === spec.id && spec.roleFile) : unsaved.sharedText === undefined) continue;
			const n = fixedOf(spec, specs, unsaved, skills);
			if (n > SPECIALIST_FIXED_MAX && n > fixedOf(spec, specs, {}, skills)) throw new Error(`Aģenta ${spec.id} pastāvīgais konteksts būtu ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}); teksts nav saglabāts.`);
		}
	};
	/** The departments' leads follow their agents: a lead that was removed, or moved out of its department, is no lead any more (the department falls back to BPV). */
	const pruneLeads = (specs: readonly AgentSpec[]) => {
		const { departments } = d.settings.departments();
		const next = departments.map((x) => {
			if (!x.lead) return x;
			const who = specs.find((s) => s.id === x.lead);
			if (who && departmentOf(who) === x.id) return x;
			const { lead: _gone, ...rest } = x;
			return rest;
		});
		if (next.some((x, k) => x !== departments[k])) d.settings.saveDepartments(next);
	};
	/** The save of the page, and of the team import: every check on the whole list, then the file. A masked MCP secret is swapped for the saved value first. */
	const saveList = (specs: AgentSpec[]): AgentSpec[] => {
		const out: AgentSpec[] = [];
		const saved = d.settings.agentSpecs().specs;
		// the names in mayMessage / acceptsFrom (and `check.agent`) are checked against the list being saved (and the lead)
		const ids = specs.map((s) => (typeof s?.id === "string" ? s.id.trim() : ""));
		// an empty or blank file is no role: the agent would run with nothing
		const roleExists = (id: string) => (readRole(d.settings.dir, id) ?? "").trim() !== "";
		for (const raw of specs) {
			const mcp = restoreSecrets(Array.isArray((raw as Partial<AgentSpec>)?.mcp) ? (raw as AgentSpec).mcp : undefined, saved.find((x) => x.id === (raw as AgentSpec)?.id)?.mcp);
			const v = validateSpec(mcp ? { ...raw, mcp } : raw, levelOf, known, ids, roleExists);
			if (!v.ok) throw new Error(`${(raw as { name?: string })?.name || (raw as { id?: string })?.id || "speciālists"}: ${v.error}`);
			// the department is one of the app's list (an empty one = in none); the list is the user's, so an id it lacks is refused rather than filed under a name nobody sees
			if (v.spec.department && !d.settings.departments().departments.some((x) => x.id === v.spec.department)) throw new Error(`${v.spec.name}: nodaļa ${v.spec.department} nav nodaļu sarakstā.`);
			if (out.some((o) => o.id === v.spec.id)) throw new Error(`Identifikators ${v.spec.id} atkārtojas.`);
			out.push(v.spec);
		}
		// the standing text is read from the role file, and a process adds its status and card: this is the most the agent's runs will carry
		const skills = library();
		for (const spec of out) {
			const n = fixedOf(spec, out, {}, skills);
			if (n > SPECIALIST_FIXED_MAX) throw new Error(`Aģenta ${spec.id} pastāvīgais konteksts ir ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}).`);
		}
		// each added specialist adds a roster line to the lead's text: the lead is measured with the new list, as the 0.6 guard measures it (R49).
		// A save that does not make the lead heavier always goes through, so a list already over the cap (a skills sync adds to the lead) can still be
		// trimmed; only a save that crosses the cap, or adds to a lead already over it, is refused.
		const leadOf = (list: AgentSpec[]) => fixedTokens(null, { appDir: d.settings.dir, userName: d.settings.get().userName, specs: list, skills, knowledge: "" }, declarationTokens(null));
		const lead = leadOf(out);
		if (lead > LEAD_FIXED_MAX && lead > leadOf(d.settings.agentSpecs().specs)) throw new Error(`Galvenā aģenta pastāvīgais konteksts būtu ${lead} tokeni (limits ${LEAD_FIXED_MAX}). Saīsini aģentu aprakstus vai noņem kādu aģentu.`);
		d.settings.saveAgentSpecs(out);
		pruneLeads(out);
		return out;
	};
	return {
		"agents.list": () => {
			const { specs, shipped } = d.settings.agentSpecs();
			// the window never gets a secret of an MCP server (env values, headers): it gets the mask, and sends it back to keep the value
			const skills = library();
			const withTokens: AgentSpecRow[] = specs.map((s) => ({ ...maskMcp(s), fixedTokens: fixedOf(s, specs, {}, skills) }));
			return { specs: withTokens, shipped, defaults: DEFAULT_AGENTS, tools: rows(), maxParallel: d.settings.get().maxParallelAgents };
		},
		"agents.save": (specs: AgentSpec[]) => saveList(specs).map(maskMcp),
		"agents.move": (id: string, department: string | null, before: string | null) => {
			const { specs } = d.settings.agentSpecs();
			if (department !== null && !d.settings.departments().departments.some((x) => x.id === department)) throw new Error(`Nezināma nodaļa: ${department}.`);
			const at = specs.findIndex((s) => s.id === id);
			if (at < 0) throw new Error(`Nav aģenta ${id}.`);
			// only the department changes (and the place in the list, which is the order the panel shows): "" = in none, so the default of its id does not file it back
			const rest = specs.filter((_, k) => k !== at);
			const to = before ? rest.findIndex((s) => s.id === before) : -1;
			rest.splice(to >= 0 ? to : rest.length, 0, { ...specs[at]!, department: department ?? "" });
			d.settings.saveAgentSpecs(rest);
			pruneLeads(rest);
			return rest.map(maskMcp);
		},
		"departments.list": () => {
			const { departments, shipped } = d.settings.departments();
			return { departments, defaults: DEFAULT_DEPARTMENTS, shipped };
		},
		"departments.save": (departments: Department[]) => {
			const r = checkDepartments(departments, d.settings.agentSpecs().specs, d.settings.departments().departments);
			if (!r.ok) throw new Error(r.error);
			d.settings.saveDepartments(r.list);
			return r.list;
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
		"agents.importTeam": (folder: string): TeamImportReport => {
			if (typeof folder !== "string" || !folder.trim()) throw new Error("Norādi mapi ar komandas failiem.");
			const plan = readTeam(folder.trim());
			const report: TeamImportReport = { folder: folder.trim(), created: [], updated: [], skipped: [], missing: plan.missing, skills: { imported: [], kept: [], refused: [], notReady: 0 }, assigned: 0 };
			// 1. the skills first: the library takes the ones it lacks (a skill it has is left alone, with its tested mark), so an agent's list can name them
			if (plan.skillsRoot) {
				const office = officeSkillsDir(d.settings.dir);
				const have = new Set(listSkills(d.skillsDir ?? "", office).map((x) => x.name));
				const r = importSkills(plan.skillsRoot, office, d.skillsDir, (name) => have.has(name));
				report.skills = { ...report.skills, imported: r.imported, refused: r.refused };
				const all = [...new Set([...plan.common, ...plan.roles.flatMap((x) => x.skills)])];
				report.skills.kept = all.filter((n) => have.has(n));
			}
			// 2. the agents. All the roles go in one save (one measurement of the whole list); only if that is refused is each role tried alone, so a role that cannot be saved
			// (a text over the limit, a context over the limit) is skipped with its reason and the others still go in
			const start = d.settings.agentSpecs().specs;
			const inLibrary = new Set(library().map((x) => x.name));
			const common = plan.common.filter((n) => inLibrary.has(n));
			const departments = d.settings.departments().departments;
			// a name the library does not have (a refused skill) is not assigned
			const specOf = (list: readonly AgentSpec[], role: (typeof plan.roles)[number]) => mergeRole(list.find((x) => x.id === role.id), { ...role, skills: role.skills.filter((n) => inLibrary.has(n)) }, common, departments);
			const writable = plan.roles.filter((role) => {
				if (role.text.length <= ROLE_MAX) return true;
				report.skipped.push({ id: role.id, why: `Lomas teksts ${role.text.length} zīmes (limits ${ROLE_MAX}).` });
				return false;
			});
			for (const role of writable) writeRole(d.settings.dir, role.id, role.text);
			const put = (list: AgentSpec[], spec: AgentSpec) => (list.some((x) => x.id === spec.id) ? list.map((x) => (x.id === spec.id ? spec : x)) : [...list, spec]);
			const note = (before: readonly AgentSpec[], spec: AgentSpec) => {
				(before.some((x) => x.id === spec.id) ? report.updated : report.created).push(spec.id);
				report.assigned += spec.skills?.length ?? 0;
			};
			try {
				const all = writable.reduce((list, role) => put(list, specOf(list, role)), start);
				saveList(all);
				for (const role of writable) note(start, all.find((x) => x.id === role.id)!);
			} catch {
				let current = start;
				for (const role of writable) {
					try {
						const spec = specOf(current, role);
						const next = saveList(put(current, spec));
						note(current, spec);
						current = next;
					} catch (e) {
						report.skipped.push({ id: role.id, why: e instanceof Error ? e.message : String(e) });
					}
				}
			}
			// skills still waiting for the user's mark (Prasmes): an agent is told about a ready skill only
			const states = new Map(library().map((x) => [x.name, x.state]));
			report.skills.notReady = [...new Set([...plan.common, ...plan.roles.flatMap((x) => x.skills)])].filter((n) => states.get(n) === "draft").length;
			d.settings.set({ teamFolder: folder.trim() });
			return report;
		},
		"agents.mcp.probe": async (agent: string, server: AgentMcpServer): Promise<McpProbe> => {
			// a secret the window still shows as the mask is the saved one of this agent's server of that name
			const saved = d.settings.agentSpecs().specs.find((x) => x.id === agent)?.mcp;
			const [one] = restoreSecrets([server], saved) ?? [];
			const v = validateSpec({ id: "probe", name: "probe", description: "", prompt: "", tools: [], mcp: [{ ...one, tools: [], read: [] }] }, levelOf, known);
			if (!v.ok) throw new Error(v.error);
			return { tools: await probeMcpTools(v.spec.mcp![0]!) };
		},
	};
}
