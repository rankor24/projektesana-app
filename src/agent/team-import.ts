// Reading a team folder (the 16 BD role agents) at run time and turning it into specs: the file system part of Aģenti → «Importēt BD komandu…». The folder is the user's own
// and stays on their disk; nothing of it is copied into the app. The handler (main/handlers/agents.ts) applies the plan with the same checks as a save from the page.
//
// The folder holds `01_buvprojekta_vaditajs.md` … `16_ekspertize.md` (one role text each; the heading is «# Agents: <name>», the first sentence of «## Loma» says what the agent
// is) and `skilli\NN-<role>\<skill>\SKILL.md` (NN = the role's number; `skilli\00-kopigie` is for all). The number gives the agent's id, the ids the process and the default
// departments are keyed on (shared/departments.ts DEFAULT_DEPARTMENT_OF, core/process-def.ts: bpv and eks).
//
// OpenMausBot (Apache-2.0) has no team import; the idea is its "templates"/"presets" (docs/team-sharing.md: an agent or a department as a folder), which the plan leaves
// out ("BPV sets the team up in chat"); this is the one-time form of it for the user's own 16 roles. What is kept from the way OpenMausBot restores a bot over an
// existing one is the rule that the person's own choices (model, backup, tools, reach) are never overwritten by a re-import.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import { DEFAULT_DEPARTMENT_OF, TEAM_IDS, type Department } from "../shared/departments.js";
import { frontMatter } from "./skills.js";

/** The role number of a file name → the agent id (shared/departments.ts: the window needs it too, to tell which agent a skill group belongs to). */
export { TEAM_IDS };

export interface TeamRole {
	id: string;
	/** the role file's name, for the report */
	file: string;
	name: string;
	description: string;
	/** the whole file: it is the role text */
	text: string;
	/** names (front matter `name`) of the skills in this role's own folder */
	skills: string[];
}

export interface TeamPlan {
	roles: TeamRole[];
	/** role numbers with no file in the folder */
	missing: string[];
	/** <folder>\skilli when it exists */
	skillsRoot?: string;
	/** names of the skills of `skilli\00-kopigie`: assigned to every role */
	common: string[];
}

/** «# Agents: Arhitekts» → «Arhitekts»; a heading without the prefix is taken whole. */
export function nameFromHeading(text: string): string {
	const h = /^\s*#\s+(.+?)\s*$/m.exec(text)?.[1] ?? "";
	return h.replace(/^Agents?\s*[:\-–—]\s*/i, "").trim();
}

/** The first sentence of the «## Loma» section ("" when there is none), cut to the 200 characters a description may have. */
export function descriptionFromLoma(text: string): string {
	const section = /^##\s+Loma\s*\r?\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text)?.[1] ?? "";
	const flat = section.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	// a sentence ends at . ! ? followed by a space or the end; «Nr. 169»-like abbreviations are not in the Loma lines of these files, and a cut one is still a fair description
	const sentences = flat.match(/.*?[.!?](?=\s|$)/g)?.map((s) => s.trim()) ?? [flat];
	// the first sentence of these files only names the role ("you are the office's … agent"); the next one says what it does, which is what a roster line needs
	const first = (/^Tu esi\b/i.test(sentences[0] ?? "") && sentences[1] ? sentences[1] : sentences[0]) ?? flat;
	// a roster line in the lead's text for each of 16 agents: 140 characters say what the role does without making the lead heavy
	return first.length > 140 ? `${first.slice(0, 139).trimEnd()}…` : first;
}

/** The skill names of one folder `<root>\<group>`: every `<skill>\SKILL.md` directly under it. A skill without a name in its front matter is not listed (the library refuses it too). */
function skillNames(group: string): string[] {
	if (!existsSync(group) || !statSync(group).isDirectory()) return [];
	const out: string[] = [];
	for (const e of readdirSync(group, { withFileTypes: true })) {
		const file = join(group, e.name, "SKILL.md");
		if (!e.isDirectory() || !existsSync(file)) continue;
		const name = frontMatter(readFileSync(file, "utf8")).name;
		if (name) out.push(name);
	}
	return out;
}

/** Reads the folder. Throws when it holds no role file at all (the wrong folder). */
export function readTeam(folder: string): TeamPlan {
	if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`Mape nav atrasta: ${folder}`);
	const files = readdirSync(folder).filter((n) => /^\d\d_.+\.md$/i.test(n));
	const roles: TeamRole[] = [];
	const missing: string[] = [];
	const skillsRoot = join(folder, "skilli");
	const hasSkills = existsSync(skillsRoot) && statSync(skillsRoot).isDirectory();
	const groups = hasSkills ? readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
	for (const [nn, id] of Object.entries(TEAM_IDS)) {
		const file = files.find((n) => n.startsWith(`${nn}_`));
		if (!file) {
			missing.push(nn);
			continue;
		}
		const text = readFileSync(join(folder, file), "utf8").replace(/^﻿/, "");
		const name = nameFromHeading(text);
		const group = groups.find((g) => g.name.startsWith(`${nn}-`));
		roles.push({ id, file, name: name || id, description: descriptionFromLoma(text), text, skills: group ? skillNames(join(skillsRoot, group.name)) : [] });
	}
	if (!roles.length) throw new Error("Mapē nav neviena lomas faila (01_….md … 16_….md).");
	const common = groups.find((g) => g.name.startsWith("00-"));
	return { roles, missing, ...(hasSkills ? { skillsRoot } : {}), common: common ? skillNames(join(skillsRoot, common.name)) : [] };
}

/** The spec an imported role gives. A new agent: the file's name, description and text, its department by its id, the skills of its folder and the common ones.
 *  An agent of that id that exists: the user's own settings stay (provider, model, effort, backup, tools, level, reach, check, MCP servers, department, extra prompt);
 *  the name, the description and the role text come from the file, the department is set only when the agent has none yet, and the skills are added to its own. */
export function mergeRole(existing: AgentSpec | undefined, role: TeamRole, common: readonly string[], departments: readonly Department[]): AgentSpec {
	const skills = [...new Set([...(existing?.skills ?? []), ...role.skills, ...common])];
	const dept = DEFAULT_DEPARTMENT_OF[role.id];
	// a department the user's list no longer has is not filed under a name nobody sees: the agent is then in none, as for any id that has no default
	const department = existing?.department ?? (dept && departments.some((d) => d.id === dept) ? dept : undefined);
	return { prompt: "", tools: [], ...existing, id: role.id, name: role.name, description: role.description, roleFile: true, skills, ...(department !== undefined ? { department } : {}) };
}
