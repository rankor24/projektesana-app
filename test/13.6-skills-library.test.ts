// 13.6 the office's skills library: an imported tree is stored flat with its groups in skills.json, a skill is `ready` only without placeholders and
// once the user has marked it tested, a draft never reaches an agent, and read_skill refuses it. Invented skills only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SPECIALIST_FIXED_MAX, fixedTokens, standingFor } from "../src/agent/agents.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import { PLACEHOLDER, importSkills, listSkills, markTested, officeSkillsDir, readSkill, skillsFor, skillsText } from "../src/agent/skills.ts";
import { skillTools } from "../src/agent/tools/revit.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { skillHandlers } from "../src/main/handlers/skills.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { tmp } from "./helpers.ts";

const skillMd = (name: string, body = "teksts", description = `apraksts ${name}`) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n${body}\n`;
const put = (file: string, text: string) => {
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, text, "utf8");
};
const PH = "{{AIZPILDĪT: biroja paraugs}}";

/** An invented office tree: two groups, one skill with two placeholders and a reference file, one folder without a name. */
function tree(): string {
	const src = join(tmp(), "skilli");
	put(join(src, "01-grupa-a", "alfa-parbaude", "SKILL.md"), skillMd("alfa-parbaude"));
	put(join(src, "01-grupa-a", "beta-aprekins", "SKILL.md"), skillMd("beta-aprekins", `Rezerve ${PH}, termiņš ${PH}.`));
	put(join(src, "01-grupa-a", "beta-aprekins", "references", "reg.md"), "atsauces");
	put(join(src, "01-grupa-a", "beta-aprekins", "skripts.ps1"), "Write-Host not-copied");
	put(join(src, "02-grupa-b", "gamma-saraksts", "SKILL.md"), skillMd("gamma-saraksts"));
	put(join(src, "02-grupa-b", "bez-nosaukuma", "SKILL.md"), "# nav front matter\n");
	return src;
}

const synced = (...names: string[]): string => {
	const dir = join(tmp(), "synced");
	for (const n of names) put(join(dir, n, "SKILL.md"), skillMd(n));
	return dir;
};

const ctxOf = (appDir: string, skillsDir?: string): ToolCtx => ({ projectsDir: appDir, projectId: null, dataDir: appDir, appDir, runDir: null, skillsDir, agent: null, thread: null });
const readSkillTool = skillTools.find((t) => t.name === "read_skill")!;

test("13.6 import: a tree with two groups becomes one flat folder, the groups are in skills.json, only .md files are copied", () => {
	const office = join(tmp(), "skills");
	const r = importSkills(tree(), office);
	assert.deepEqual([...r.imported].sort(), ["alfa-parbaude", "beta-aprekins", "gamma-saraksts"]);
	assert.equal(r.refused.length, 1);
	assert.match(r.refused[0].why, /front matter|name/i, "a folder without a name says why");
	assert.ok(existsSync(join(office, "alfa-parbaude", "SKILL.md")));
	assert.ok(existsSync(join(office, "beta-aprekins", "references", "reg.md")));
	assert.ok(!existsSync(join(office, "beta-aprekins", "skripts.ps1")), "a script is not copied");
	assert.ok(!existsSync(join(office, "01-grupa-a")), "the group is not a folder level");
	const meta = JSON.parse(readFileSync(join(office, "skills.json"), "utf8"));
	assert.deepEqual(meta.groups, { "alfa-parbaude": "01-grupa-a", "beta-aprekins": "01-grupa-a", "gamma-saraksts": "02-grupa-b" });
	assert.deepEqual(meta.tested, []);
	const list = listSkills(synced(), office);
	assert.deepEqual(list.map((s) => [s.name, s.group]).sort(), [["alfa-parbaude", "01-grupa-a"], ["beta-aprekins", "01-grupa-a"], ["gamma-saraksts", "02-grupa-b"]]);
	assert.ok(list.every((s) => s.origin === "office"));
});

test("13.6 a skill with two placeholders is a draft with placeholders 2; markTested is refused; without them and marked tested it is ready", () => {
	const office = join(tmp(), "skills");
	importSkills(tree(), office);
	const get = (n: string) => listSkills(synced(), office).find((s) => s.name === n)!;
	assert.equal(get("beta-aprekins").placeholders, 2);
	assert.equal(get("beta-aprekins").state, "draft");
	assert.throws(() => markTested(office, "beta-aprekins", true), /Prasmei beta-aprekins vēl ir 2 vietturi\./);
	assert.equal(get("beta-aprekins").state, "draft");

	// the user fills them in, outside the app; the next list reads it. Filled but not yet tested is still a draft
	writeFileSync(join(office, "beta-aprekins", "SKILL.md"), skillMd("beta-aprekins", "Rezerve 10 %, termiņš 5 dienas."), "utf8");
	assert.equal(get("beta-aprekins").placeholders, 0);
	assert.equal(get("beta-aprekins").state, "draft");
	const marked = markTested(office, "beta-aprekins", true);
	assert.equal(marked.state, "ready");
	assert.equal(marked.tested, true);
	assert.equal(get("beta-aprekins").state, "ready");

	// a tested skill that gains a placeholder is a draft again
	writeFileSync(join(office, "beta-aprekins", "SKILL.md"), skillMd("beta-aprekins", `Rezerve ${PH}.`), "utf8");
	assert.deepEqual([get("beta-aprekins").placeholders, get("beta-aprekins").state, get("beta-aprekins").tested], [1, "draft", false]);
	assert.deepEqual(JSON.parse(readFileSync(join(office, "skills.json"), "utf8")).tested, [], "the mark is dropped on disk too");
	// a placeholder in a reference file counts too
	writeFileSync(join(office, "beta-aprekins", "SKILL.md"), skillMd("beta-aprekins", "labi"), "utf8");
	writeFileSync(join(office, "beta-aprekins", "references", "reg.md"), `atsauce ${PH}`, "utf8");
	assert.deepEqual([get("beta-aprekins").placeholders, get("beta-aprekins").state], [1, "draft"]);
	writeFileSync(join(office, "beta-aprekins", "references", "reg.md"), "atsauce", "utf8");
	assert.deepEqual([get("beta-aprekins").state, get("beta-aprekins").tested], ["draft", false], "fixed again, but it has to be tested again");
	markTested(office, "beta-aprekins", true);

	// unmarking is always allowed
	assert.equal(markTested(office, "beta-aprekins", false).state, "draft");
	assert.throws(() => markTested(office, "nav-tadas", true), /nav atrasta/);
	assert.ok("x {{AIZPILDĪT: a}} y".match(PLACEHOLDER));
});

test("13.6 a name that exists is replaced and the old folder is kept under versions; tested is cleared for the new text", () => {
	const office = join(tmp(), "skills");
	importSkills(tree(), office);
	markTested(office, "alfa-parbaude", true);
	const again = tree();
	put(join(again, "01-grupa-a", "alfa-parbaude", "SKILL.md"), skillMd("alfa-parbaude", "jauns teksts"));
	const r = importSkills(again, office);
	assert.ok(r.imported.includes("alfa-parbaude"));
	assert.match(readFileSync(join(office, "alfa-parbaude", "SKILL.md"), "utf8"), /jauns teksts/);
	const kept = readdirSync(join(office, "versions")).filter((n) => n.startsWith("alfa-parbaude."));
	assert.equal(kept.length, 1, "the replaced folder is moved, not deleted");
	assert.match(readFileSync(join(office, "versions", kept[0], "SKILL.md"), "utf8"), /teksts/);
	assert.ok(!listSkills(synced(), office).some((s) => s.name === "versions"), "versions is not a skill");
	assert.equal(listSkills(synced(), office).find((s) => s.name === "alfa-parbaude")!.state, "draft", "the new text has not been tested");
	// a third import in the same moment does not overwrite the first copy
	importSkills(again, office);
	assert.equal(readdirSync(join(office, "versions")).filter((n) => n.startsWith("alfa-parbaude.")).length, 2);
});

test("13.6 importing the name of a synced skill is refused with a reason; nothing is written for it", () => {
	const office = join(tmp(), "skills");
	const src = join(tmp(), "skilli");
	put(join(src, "grupa", "revit-modeling", "SKILL.md"), skillMd("revit-modeling"));
	put(join(src, "grupa", "tikai-biroja", "SKILL.md"), skillMd("tikai-biroja"));
	const r = importSkills(src, office, synced("revit-modeling"));
	assert.deepEqual(r.imported, ["tikai-biroja"]);
	assert.deepEqual(r.refused, [{ name: "revit-modeling", why: "Prasme revit-modeling jau ir starp Revit prasmēm." }]);
	assert.ok(!existsSync(join(office, "revit-modeling")));
});

test("13.6 a synced skill is always ready with no placeholders; a synced name wins over an office folder of the same name", () => {
	const office = join(tmp(), "skills");
	put(join(office, "revit-modeling", "SKILL.md"), skillMd("revit-modeling", PH));
	const list = listSkills(synced("revit-modeling", "revit-api"), office);
	assert.deepEqual(list.map((s) => [s.name, s.origin, s.state, s.placeholders]).sort(), [
		["revit-api", "synced", "ready", 0],
		["revit-modeling", "synced", "ready", 0],
	]);
	// the old one-argument call keeps working
	assert.equal(listSkills(synced("revit-api")).length, 1);
	assert.equal(listSkills("", undefined).length, 0);
	assert.ok(list.every((s) => s.tested), "synced skills count as tested");
});

test("13.6 skillsFor leaves out drafts and skills the agent was not given", () => {
	const office = join(tmp(), "skills");
	importSkills(tree(), office);
	markTested(office, "alfa-parbaude", true);
	markTested(office, "gamma-saraksts", true);
	const all = listSkills(synced("revit-api"), office);
	const spec: AgentSpec = { id: "ar", name: "AR", description: "", prompt: "Tu esi AR.", tools: [], skills: ["alfa-parbaude", "beta-aprekins", "revit-api", "nav-tadas"] };
	assert.deepEqual(skillsFor(spec, all).map((s) => s.name).sort(), ["alfa-parbaude", "revit-api"], "beta is a draft, gamma is not assigned, nav-tadas does not exist");
	assert.deepEqual(skillsFor({ ...spec, skills: undefined }, all), []);
	assert.deepEqual(skillsFor(null, all), []);
});

test("13.6 a specialist's standing text lists its ready office skills; the lead's list stays the synced ones", () => {
	const office = join(tmp(), "skills");
	importSkills(tree(), office);
	markTested(office, "alfa-parbaude", true);
	const all = listSkills(synced("revit-api"), office);
	const spec: AgentSpec = { id: "ar", name: "AR", description: "", prompt: "Tu esi AR, ar savu darbu.", tools: [], skills: ["alfa-parbaude", "beta-aprekins"] };
	const d = { appDir: tmp(), userName: "Tests", specs: [spec], skills: all, knowledge: "" };
	const own = standingFor(spec, d);
	assert.match(own, /- alfa-parbaude: apraksts alfa-parbaude/);
	assert.doesNotMatch(own, /beta-aprekins/, "a draft is never listed");
	const lead = standingFor(null, d);
	assert.equal(lead, standingFor(null, { ...d, skills: listSkills(synced("revit-api")) }), "office skills do not move the lead's text");
	assert.doesNotMatch(lead, /alfa-parbaude/);
	assert.match(lead, /- revit-api: apraksts revit-api/);
});

test("13.6 read_skill: a draft gives the refusal, a ready office skill is read, a path outside the skill's folder is refused", async () => {
	const appDir = tmp();
	const office = officeSkillsDir(appDir);
	assert.equal(office, join(appDir, "skills"));
	importSkills(tree(), office);
	const skillsDir = synced("revit-api");
	const ctx = ctxOf(appDir, skillsDir);
	assert.equal(await readSkillTool.run(ctx, { name: "beta-aprekins" }), "Prasme beta-aprekins nav gatava (vietturi: 2). Jautā lietotājam.");
	// filled but untested: still not ready, no placeholders left to count
	writeFileSync(join(office, "beta-aprekins", "SKILL.md"), skillMd("beta-aprekins", "labi"), "utf8");
	assert.equal(await readSkillTool.run(ctx, { name: "beta-aprekins" }), "Prasme beta-aprekins nav gatava (vietturi: 0). Jautā lietotājam.");
	markTested(office, "beta-aprekins", true);
	assert.match(String(await readSkillTool.run(ctx, { name: "beta-aprekins" })), /# beta-aprekins/);
	assert.equal(await readSkillTool.run(ctx, { name: "beta-aprekins", path: "references/reg.md" }), "atsauces");
	await assert.rejects(async () => readSkillTool.run(ctx, { name: "beta-aprekins", path: "../alfa-parbaude/SKILL.md" }), /ārpus/);
	await assert.rejects(async () => readSkillTool.run(ctx, { name: "../x" }), /Nederīgs/);
	// the synced skill reads as before, with or without an office folder
	assert.match(String(await readSkillTool.run(ctx, { name: "revit-api" })), /# revit-api/);
	assert.match(String(await readSkillTool.run(ctxOf(tmp(), skillsDir), { name: "revit-api" })), /# revit-api/);
	// and the shared rule holds for readSkill itself
	assert.throws(() => readSkill(office, "alfa-parbaude", "../../x"), /ārpus/);
});

test("13.6 an agent with 12 assigned ready skills stays under SPECIALIST_FIXED_MAX", () => {
	const office = join(tmp(), "skills");
	const src = join(tmp(), "skilli");
	const names = Array.from({ length: 12 }, (_, i) => `prasme-${i + 1}`);
	for (const n of names) put(join(src, "grupa", n, "SKILL.md"), skillMd(n, "teksts", "d".repeat(400)));
	importSkills(src, office);
	for (const n of names) markTested(office, n, true);
	const spec: AgentSpec = { id: "ar", name: "AR", description: "", prompt: "Tu esi AR, ar savu darbu.", tools: [], skills: names };
	const d = { appDir: tmp(), userName: "Tests", specs: [spec], skills: listSkills("", office), knowledge: "" };
	assert.equal(skillsFor(spec, d.skills).length, 12);
	const n = fixedTokens(spec, d, declarationTokens(spec));
	assert.ok(n < SPECIALIST_FIXED_MAX, `${n} tokens`);
	assert.ok(n > fixedTokens({ ...spec, skills: [] }, d, declarationTokens(spec)), "the skills weigh something");
});

test("13.6 the handlers: list, import, tested and read work on <appDir>\\skills; agents.save keeps assigned skill names", () => {
	const dir = tmp();
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	const skillsDir = synced("revit-api");
	const h = skillHandlers({ settings, skillsDir });
	assert.deepEqual(h["skills.list"]().map((s) => s.name), ["revit-api"]);
	const r = h["skills.import"](tree());
	assert.equal(r.imported.length, 3);
	assert.ok(existsSync(join(dir, "skills", "skills.json")));
	assert.throws(() => h["skills.import"](join(dir, "nav-mapes")), /nav atrasta/i);
	assert.throws(() => h["skills.tested"]("beta-aprekins", true), /vēl ir 2 vietturi/);
	assert.equal(h["skills.tested"]("alfa-parbaude", true).state, "ready");
	assert.equal(h["skills.list"]().find((s) => s.name === "alfa-parbaude")!.state, "ready");
	// the view reads a draft's text too (the page shows it read-only); an unknown name is an error
	assert.match(h["skills.read"]("beta-aprekins"), /AIZPILDĪT/);
	assert.match(h["skills.read"]("revit-api"), /# revit-api/);
	assert.throws(() => h["skills.read"]("nav-tadas"), /nav/i);

	// assignment goes through agents.save, and the measure counts the ready office skill
	const ah = agentHandlers({ settings, skillsDir });
	const spec: AgentSpec = { id: "ar", name: "AR", description: "", prompt: "Tu esi AR, ar savu darbu.", tools: [], skills: ["alfa-parbaude", "beta-aprekins"] };
	const plain = { ...spec, skills: [] };
	const saved = ah["agents.save"]([spec]);
	assert.deepEqual(saved[0].skills, ["alfa-parbaude", "beta-aprekins"]);
	const withSkill = ah["agents.list"]().specs[0].fixedTokens;
	ah["agents.save"]([plain]);
	assert.ok(withSkill > ah["agents.list"]().specs[0].fixedTokens, "the ready skill is in the measure");
});

test("13.6 a skill that fails to import is refused alone; the others go in, and a replaced skill is never left marked tested", () => {
	const office = join(tmp(), "skills");
	importSkills(tree(), office);
	markTested(office, "alfa-parbaude", true);
	markTested(office, "gamma-saraksts", true);
	// `versions` is a file: replacing an existing skill cannot move the old folder there, so that one throws; new skills are unaffected
	writeFileSync(join(office, "versions"), "ne mape", "utf8");
	const src = join(tmp(), "skilli");
	put(join(src, "g", "alfa-parbaude", "SKILL.md"), skillMd("alfa-parbaude", "jauns"));
	put(join(src, "g", "delta-jauna", "SKILL.md"), skillMd("delta-jauna"));
	put(join(src, "g", "epsilon-jauna", "SKILL.md"), skillMd("epsilon-jauna"));
	const r = importSkills(src, office);
	assert.deepEqual(r.imported.sort(), ["delta-jauna", "epsilon-jauna"]);
	assert.equal(r.refused.length, 1);
	assert.equal(r.refused[0].name, "alfa-parbaude");
	assert.match(r.refused[0].why, /Neizdevās importēt/);
	assert.match(r.refused[0].why, /\.import-alfa-parbaude/, "the staging folder it left is named");
	assert.ok(readdirSync(office).some((n) => n.startsWith(".import-alfa-parbaude")), "and is not deleted");
	// the failed one: old text still there, but its mark is gone (the new text was never tested, and nothing can leave it marked)
	const all = listSkills(synced(), office);
	assert.match(readFileSync(join(office, "alfa-parbaude", "SKILL.md"), "utf8"), /teksts/);
	assert.deepEqual([all.find((s) => s.name === "alfa-parbaude")!.tested, all.find((s) => s.name === "alfa-parbaude")!.state], [false, "draft"]);
	assert.equal(all.find((s) => s.name === "gamma-saraksts")!.tested, true, "a skill not in this import keeps its mark");
	assert.equal(JSON.parse(readFileSync(join(office, "skills.json"), "utf8")).groups["delta-jauna"], "g", "the group of an imported skill is recorded");
	assert.ok(all.some((s) => s.name === "delta-jauna") && all.some((s) => s.name === "epsilon-jauna"));
});

test("13.6 reserved and hostile front-matter names (con, COM1, ../x, a-backslash-b, versions) are refused and write nothing", () => {
	const office = join(tmp(), "skills");
	const src = join(tmp(), "skilli");
	for (const [dirName, name] of [["a", "con"], ["b", "COM1"], ["c", "nul"], ["d", "../x"], ["e", "a\\b"], ["f", "a/b"], ["g", "lpt9"], ["h", "dobra-prasme"], ["i", "versions"]]) {
		put(join(src, "g", dirName, "SKILL.md"), skillMd(name));
	}
	const r = importSkills(src, office);
	assert.deepEqual(r.imported, ["dobra-prasme"]);
	assert.deepEqual(r.refused.map((x) => x.name).sort(), ["../x", "COM1", "a/b", "a\\b", "con", "lpt9", "nul", "versions"].sort());
	assert.match(r.refused.find((x) => x.name === "con")!.why, /rezervēts/);
	assert.match(r.refused.find((x) => x.name === "../x")!.why, /Nederīgs/);
	assert.deepEqual(readdirSync(office).filter((n) => n !== "skills.json").sort(), ["dobra-prasme"], "nothing was written outside the skill's own folder");
	assert.ok(!existsSync(join(office, "..", "x")));
});
