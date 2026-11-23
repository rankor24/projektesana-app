// The team import (agents.importTeam): the 16 BD role files and their skills read at run time from the user's folder into a temporary app folder. The real BD folder is
// read only when it exists on this PC (docs\BD of the main checkout is the user's, confidential, never copied into the repo: the test copies it into a temp folder and
// deletes nothing); the second test uses a small invented folder so the rules are tested everywhere.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { skillHandlers } from "../src/main/handlers/skills.ts";
import { AppSettings } from "../src/main/settings.ts";
import { TEAM_IDS, descriptionFromLoma, nameFromHeading } from "../src/agent/team-import.ts";
import { DEFAULT_DEPARTMENT_OF, departmentOf } from "../src/shared/departments.ts";
import { tmp } from "./helpers.ts";

const crypto = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };
const REAL_BD = "D:\\Code\\BIM\\projektesana-app\\docs\\BD";
const SYNCED = "D:\\Code\\BIM\\projektesana-app\\resources\\skills";

/** Every file under a folder with its size: what "nothing was written there" is compared with. */
const snapshot = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile())
		.map((e) => `${join(e.parentPath, e.name)}:${statSync(join(e.parentPath, e.name)).size}:${statSync(join(e.parentPath, e.name)).mtimeMs}`)
		.sort();

function app() {
	const dir = tmp("pj-team-");
	const settings = new AppSettings(dir, crypto);
	const skillsDir = existsSync(SYNCED) ? SYNCED : undefined;
	return { dir, settings, h: agentHandlers({ settings, skillsDir }), sk: skillHandlers({ settings, skillsDir }) };
}

test("heading and the first sentence of Loma", () => {
	assert.equal(nameFromHeading("# Agents: Arhitekts\n\n## Loma\nx"), "Arhitekts");
	assert.equal(nameFromHeading("# Meliorators\n"), "Meliorators");
	assert.equal(descriptionFromLoma("# A\n\n## Loma\nTu esi tests. Otrais teikums.\n\n## Cits\nnē"), "Tu esi tests.");
	assert.equal(descriptionFromLoma("# A\n## Loma\nBez punkta beigās"), "Bez punkta beigās");
	assert.equal(descriptionFromLoma("# A\nnav sadaļas"), "");
	assert.equal(descriptionFromLoma(`## Loma\n${"v".repeat(300)}.`).length, 200);
});

test("a small invented team: created, then updated with the user's own settings kept", () => {
	const src = tmp("pj-team-src-");
	const role = (name: string, loma: string) => `# Agents: ${name}\n\n## Loma\n${loma}\n\n## Darbs\nParasts teksts.\n`;
	writeFileSync(join(src, "01_a.md"), role("Vadītājs", "Tu esi vadītājs. Otrs teikums."));
	writeFileSync(join(src, "02_b.md"), role("Arhitekts", "Tu esi arhitekts."));
	const skill = (group: string, name: string) => {
		mkdirSync(join(src, "skilli", group, name), { recursive: true });
		writeFileSync(join(src, "skilli", group, name, "SKILL.md"), `---\nname: ${name}\ndescription: Apraksts ${name}.\n---\n\n# ${name}\n`);
	};
	skill("00-kopigie", "kopigs");
	skill("01-vaditajs", "vadibas-skills");
	skill("02-arhitekts", "ar-skills");
	const a = app();
	const r1 = a.h["agents.importTeam"](src) as ReturnType<typeof a.h["agents.importTeam"]> & { created: string[] };
	assert.deepEqual(r1.created.sort(), ["ar", "bpv"]);
	assert.equal(r1.missing.length, 14);
	assert.deepEqual(r1.skills.imported.sort(), ["ar-skills", "kopigs", "vadibas-skills"]);
	const { specs } = a.settings.agentSpecs();
	const ar = specs.find((s) => s.id === "ar")!;
	assert.equal(ar.name, "Arhitekts");
	assert.equal(ar.description, "Tu esi arhitekts.");
	assert.equal(ar.roleFile, true);
	assert.equal(departmentOf(ar), "arhitektura");
	assert.deepEqual(ar.skills?.sort(), ["ar-skills", "kopigs"]);
	assert.equal(readFileSync(join(a.dir, "agents", "ar.md"), "utf8"), role("Arhitekts", "Tu esi arhitekts."));
	assert.equal(a.settings.get().teamFolder, src);

	// the user changes settings; the re-import keeps them, updates text and name, and does not drop a skill's tested mark
	a.h["agents.save"](specs.map((s) => (s.id === "ar" ? { ...s, provider: "openai-codex", model: "x", mayMessage: ["bpv"], department: "", skills: [...(s.skills ?? []), "mans"] } : s)));
	a.sk["skills.tested"]("ar-skills", true);
	writeFileSync(join(src, "02_b.md"), role("Arhitekts (jauns)", "Tu esi jaunais arhitekts."));
	const r2 = a.h["agents.importTeam"](src);
	assert.deepEqual(r2.created, []);
	assert.deepEqual(r2.updated.sort(), ["ar", "bpv"]);
	assert.deepEqual(r2.skills.imported, []);
	assert.equal(r2.skills.kept.length, 3);
	const ar2 = a.settings.agentSpecs().specs.find((s) => s.id === "ar")!;
	assert.equal(ar2.name, "Arhitekts (jauns)");
	assert.equal(ar2.provider, "openai-codex");
	assert.equal(ar2.model, "x");
	assert.deepEqual(ar2.mayMessage, ["bpv"]);
	assert.equal(ar2.department, "", "a department the user took the agent out of is not put back");
	assert.ok(ar2.skills?.includes("mans"));
	assert.equal(a.sk["skills.list"]().find((s) => s.name === "ar-skills")?.tested, true);
	assert.match(readFileSync(join(a.dir, "agents", "ar.md"), "utf8"), /jaunais arhitekts/);
	assert.throws(() => a.h["agents.importTeam"](join(src, "nav")), /nav atrasta/);
});

test("the real BD team: 16 agents, their departments and skills, only the temp folder written", { skip: !existsSync(REAL_BD) }, () => {
	const src = join(tmp("pj-team-real-"), "BD");
	cpSync(REAL_BD, src, { recursive: true });
	// what the folder holds, counted here from the files (nothing of its content is written into the test): skills per role folder, by the role number
	const skillsIn = (prefix: string): number => {
		const g = readdirSync(join(src, "skilli")).find((n) => n.startsWith(prefix));
		return g ? readdirSync(join(src, "skilli", g)).filter((n) => existsSync(join(src, "skilli", g, n, "SKILL.md"))).length : 0;
	};
	const nn = (id: string) => Object.entries(TEAM_IDS).find(([, v]) => v === id)![0];
	const allSkills = readdirSync(join(src, "skilli"), { withFileTypes: true }).filter((e) => e.isDirectory()).reduce((n, e) => n + skillsIn(e.name.slice(0, 3)), 0);
	const before = snapshot(src);
	const realBefore = snapshot(REAL_BD);
	const a = app();
	const r = a.h["agents.importTeam"](src);
	assert.deepEqual(r.skipped, []);
	assert.deepEqual(r.missing, []);
	assert.equal(r.created.length, 16);
	const { specs } = a.settings.agentSpecs();
	for (const id of Object.values(TEAM_IDS)) {
		const s = specs.find((x) => x.id === id);
		assert.ok(s, `agent ${id}`);
		assert.equal(s.roleFile, true);
		assert.ok(s.name.length >= 2 && !s.name.startsWith("Agents"), `name of ${id}: ${s.name}`);
		assert.ok(s.description.length > 10 && s.description.length <= 200, `description of ${id}`);
		assert.equal(departmentOf(s), DEFAULT_DEPARTMENT_OF[id]);
		assert.equal((s.skills ?? []).length, skillsIn(`00-`) + skillsIn(`${nn(id)}-`), `${id}: the common skills and those of its own folder`);
		assert.ok(readFileSync(join(a.dir, "agents", `${id}.md`), "utf8").startsWith("# Agents:"));
	}
	assert.equal(r.skills.refused.length, 0, JSON.stringify(r.skills.refused));
	assert.equal(r.skills.imported.length, allSkills, "every skill of the folder is in the library");
	assert.equal(r.skills.notReady, allSkills, "imported skills are drafts until the user marks them tested");
	// everything the importer wrote is inside the temp app folder; the source folders are unchanged
	assert.deepEqual(snapshot(src), before);
	assert.deepEqual(snapshot(REAL_BD), realBefore);
	assert.equal(readdirSync(join(a.dir, "skills")).filter((n) => existsSync(join(a.dir, "skills", n, "SKILL.md"))).length, allSkills);
	// a second import changes nothing it should not: same agents, no new skills
	const again = a.h["agents.importTeam"](src);
	assert.equal(again.updated.length, 16);
	assert.equal(again.skills.imported.length, 0);
	assert.equal(a.settings.agentSpecs().specs.length, specs.length);
});
