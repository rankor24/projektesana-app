// What an agent may change in itself, and the undo of it. Three things, each logged with its text before and after (agent/self-journal.ts)
// and each undoable from the Atmiņa page:
//   - its own role text (<app data>\agents\<id>.md), through the same write the settings page uses (agents.ts writeRole keeps the old text
//     in agents\versions);
//   - a skill DRAFT in the office skills library: a new skill is never active; it stays a draft until the user marks it tested on the Prasmes
//     page (skills.ts: an office skill is `ready` only after that click), and an agent may rewrite only a draft it made itself;
//   - its own memory (agent/memory-md.ts; the journal line is written there).
// Ported in idea from OpenMausBot (Apache-2.0): its bots editing their own instructions and skills with an undo on the change card
// (docs/routine-schedules.md "Edit, Pause and Undo"; docs/memory.md "a journal of every change with one-click undo"). Nothing is ever deleted:
// an undone new skill folder is moved to skills\versions.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import { ROLE_MAX } from "../shared/agent-types.js";
import type { SelfChange } from "../shared/memory-types.js";
import { readRole, writeRole } from "./agents.js";
import { relTarget, todayRiga, writeMemory, type MemoryRef } from "./memory-md.js";
import { getChange, listChanges, logChange, markUndone } from "./self-journal.js";
import { listSkills, officeSkillsDir } from "./skills.js";

export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|versions)$/;
export const SKILL_MAX = 20_000;

/** The role text of the agent itself. `append` adds a dated section at the end (the usual way); `replace` rewrites it and may not make it less than half as long. */
export function changeOwnRole(appDir: string, spec: Pick<AgentSpec, "id" | "roleFile">, mode: "append" | "replace", text: string, reason: string): SelfChange {
	if (!spec.roleFile) throw new Error("Tavas lomas teksts ir saglabāts Iestatījumos, nevis failā agents\\<id>.md, tāpēc to šeit nevar mainīt. Jautā lietotājam.");
	const t = text.trim();
	if (t.length < 10) throw new Error("Teksts ir pārāk īss.");
	const before = readRole(appDir, spec.id) ?? "";
	let after: string;
	if (mode === "append") after = `${before.trimEnd()}\n\n## Mācība (${todayRiga()})\n${t}\n`;
	else {
		if (before && t.length < before.length / 2) throw new Error("Aizvietojums, kas ir vairāk nekā uz pusi īsāks par esošo lomu, nav atļauts: pievieno ar mode append vai jautā lietotājam.");
		after = `${t}\n`;
	}
	if (after.length > ROLE_MAX) throw new Error(`Lomas teksts: līdz ${ROLE_MAX} zīmēm (būtu ${after.length}).`);
	writeRole(appDir, spec.id, after);
	return logChange(appDir, { by: "agent", agent: spec.id, kind: "role", target: `agents/${spec.id}.md`, reason, before, after });
}

export interface SkillDraft {
	name: string;
	description: string;
	body: string;
}

/** A skill draft in the office library. A name taken by a synced skill, or by an office skill that is not the agent's own untested draft, is refused. */
export function draftSkill(appDir: string, syncedDir: string, agent: string, d: SkillDraft, reason: string): SelfChange {
	const name = d.name.trim();
	if (!SKILL_NAME.test(name) || RESERVED.test(name)) throw new Error(`Prasmes nosaukums: mazie burti, cipari, domuzīme, 2–40 zīmes (${name}).`);
	const description = d.description.replace(/\s+/g, " ").trim();
	if (description.length < 10 || description.length > 300) throw new Error("Apraksts (kad lietot šo prasmi): 10–300 zīmes.");
	const body = d.body.trim();
	if (body.length < 30 || body.length > SKILL_MAX) throw new Error(`Prasmes teksts: 30–${SKILL_MAX} zīmes.`);
	const all = listSkills(syncedDir, officeSkillsDir(appDir));
	const same = all.find((s) => s.name === name);
	const dir = join(officeSkillsDir(appDir), name);
	const file = join(dir, "SKILL.md");
	let before: string | null = null;
	if (same) {
		const mine = listChanges(appDir).some((c) => c.kind === "skill" && c.target === name && c.agent === agent && c.by === "agent" && !c.undone);
		if (same.origin !== "office" || same.state === "ready" || !mine) throw new Error(`Prasme ${name} jau ir ${same.origin === "office" && same.state !== "ready" ? "cita melnraksts" : "gatava prasme"}; savu melnrakstu vari pārrakstīt, citas prasmes nē. Izvēlies citu nosaukumu.`);
		before = readFileSync(file, "utf8");
	} else if (existsSync(dir)) throw new Error(`Mape skills\\${name} jau ir; izvēlies citu nosaukumu.`);
	const after = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
	mkdirSync(dir, { recursive: true });
	// a temp file and a rename: a crash leaves the old text
	writeFileSync(`${file}.tmp`, after, "utf8");
	renameSync(`${file}.tmp`, file);
	return logChange(appDir, { by: "agent", agent, kind: "skill", target: name, reason, before, after });
}

/** The memory ref a journal target names ("memory/agents/x.md"). */
function memoryRefOf(target: string): MemoryRef | null {
	const m = /^memory\/(?:(agents|departments)\/([a-z0-9-]+)|(office))\.md$/.exec(target);
	if (!m) return null;
	return m[3] ? { kind: "office", id: "office" } : { kind: m[1] === "agents" ? "agent" : "department", id: m[2] };
}

/** Puts the text from before a change back. Returns what it did, in a sentence. The text it replaces is kept (versions folders and the journal). */
export function undoChange(appDir: string, syncedDir: string, id: string): string {
	const c = getChange(appDir, id);
	if (!c) throw new Error(`Izmaiņa ${id} nav atrasta.`);
	if (c.undone) throw new Error("Šī izmaiņa jau ir atsaukta.");
	let done: string;
	if (c.kind === "memory") {
		const ref = memoryRefOf(c.target);
		if (!ref || relTarget(ref) !== c.target) throw new Error(`Nezināms atmiņas fails: ${c.target}`);
		writeMemory(appDir, ref, c.before ?? "", { by: "user", reason: `Atsaukta izmaiņa ${id}` });
		done = `Atmiņas fails ${c.target} atgriezts iepriekšējā stāvoklī.`;
	} else if (c.kind === "role") {
		const agent = /^agents\/([a-z][a-z0-9-]{1,30})\.md$/.exec(c.target)?.[1];
		if (!agent || c.before === null) throw new Error(`Lomu ${c.target} nevar atjaunot.`);
		writeRole(appDir, agent, c.before);
		done = `Aģenta ${agent} lomas teksts atgriezts iepriekšējā stāvoklī.`;
	} else {
		const dir = join(officeSkillsDir(appDir), c.target);
		const info = listSkills(syncedDir, officeSkillsDir(appDir)).find((s) => s.name === c.target && s.origin === "office");
		if (info?.state === "ready") throw new Error(`Prasme ${c.target} jau ir atzīmēta kā pārbaudīta. Vispirms atceļ atzīmi Prasmēs.`);
		if (c.before === null) {
			if (existsSync(dir)) {
				const v = join(officeSkillsDir(appDir), "versions");
				mkdirSync(v, { recursive: true });
				let kept = join(v, `${c.target}.${new Date().toISOString().replace(/[:.]/g, "-")}`);
				for (let n = 1; existsSync(kept); n++) kept = `${kept}.${n}`;
				renameSync(dir, kept);
			}
			done = `Prasmes melnraksts ${c.target} noņemts no bibliotēkas (mape pārvietota uz skills\\versions).`;
		} else {
			writeFileSync(join(dir, "SKILL.md"), c.before, "utf8");
			done = `Prasmes ${c.target} melnraksts atgriezts iepriekšējā stāvoklī.`;
		}
	}
	markUndone(appDir, id);
	return done;
}
