// Final review, the context caps as the app runs them (R47): the lead's fixed context measured with the real synced skills stays under 10 000 tokens;
// a specialist's save reserves the office knowledge and its Revit tools' declarations; a role or shared text that would push a saved agent over is refused.
// Invented agents and skills; nothing leaves the machine.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { KNOWLEDGE_MAX, REVIT_DECLARATION_TOKENS, SPECIALIST_FIXED_MAX, fixedTokens, processReserve, readRole, readShared, revitReserve, standingFor, writeRole } from "../src/agent/agents.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import { LEAD_SKILL_DESC_MAX, listSkills } from "../src/agent/skills.ts";
import { DEFAULT_AGENTS } from "../src/agent/subagents.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: `Aģents ${id}`, description: `apraksts ${id}`, prompt: `Tu esi ${id}, ar savu darbu.`, tools: [], ...extra });
const SYNCED = join(import.meta.dirname, "..", "resources", "skills");

function skillsFolder(names: string[], chars: number): string {
	const dir = join(tmp(), "skills");
	for (const n of names) {
		mkdirSync(join(dir, n), { recursive: true });
		writeFileSync(join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: ${"d".repeat(chars)}\n---\nteksts`, "utf8");
	}
	return dir;
}
function handler(skillsDir: string) {
	const dir = tmp();
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	// the fixture skills are the office's, ready: the lead lists only the synced ones, and these are meant to weigh on the specialist alone
	cpSync(skillsDir, join(dir, "skills"), { recursive: true });
	writeFileSync(join(dir, "skills", "skills.json"), JSON.stringify({ groups: {}, tested: readdirSync(skillsDir) }), "utf8");
	return { dir, settings, h: agentHandlers({ settings }) };
}
const NAMES = Array.from({ length: 200 }, (_, i) => `prasme-${String(i).padStart(3, "0")}`);

// ---- the lead ---------------------------------------------------------------------------------------------------------------------

test("R47: the lead with the real synced skills stays under 10 000 tokens, and lists each skill description at most LEAD_SKILL_DESC_MAX characters", () => {
	const skills = listSkills(SYNCED);
	assert.ok(skills.filter((s) => s.origin === "synced").length >= 5, "the app's five synced skills are there");
	const d = { appDir: tmp(), userName: "", specs: DEFAULT_AGENTS, skills, knowledge: "" };
	const n = fixedTokens(null, d, declarationTokens(null));
	assert.ok(n < 10_000, `lead fixed ${n}`);
	const lines = standingFor(null, d).split("\n").filter((l) => /^- [a-z0-9-]+: /.test(l) && skills.some((s) => l.startsWith(`- ${s.name}: `)));
	assert.equal(lines.length, skills.filter((s) => s.origin === "synced").length);
	for (const l of lines) assert.ok(l.slice(l.indexOf(": ") + 2).length <= LEAD_SKILL_DESC_MAX, l);
});

test("R47: a specialist's own skills list keeps its longer descriptions", () => {
	const dir = skillsFolder(["alfa"], 300);
	const text = standingFor(spec("ar", { skills: ["alfa"] }), { appDir: tmp(), userName: "", specs: [spec("ar")], skills: listSkills(dir), knowledge: "" });
	assert.ok(text.includes(`- alfa: ${"d".repeat(300)}`));
});

// ---- the save reserve -------------------------------------------------------------------------------------------------------------

/** the most skills `s(k)` may name so that `measure` still fits */
const most = (s: (k: number) => AgentSpec, measure: (x: AgentSpec) => number) => {
	let k = 0;
	while (k < NAMES.length && measure(s(k + 1)) <= SPECIALIST_FIXED_MAX) k++;
	return k;
};

test("R47: the save reserves the knowledge maximum: an agent that fits without it but not with it is refused, with the number", () => {
	const skillsDir = skillsFolder(NAMES, 400);
	const { dir, h } = handler(skillsDir);
	const skills = listSkills(skillsDir);
	const full = (x: AgentSpec) => fixedTokens(x, { appDir: dir, userName: "", specs: [x], skills, ...processReserve(x) }, declarationTokens(x));
	const noKnowledge = (x: AgentSpec) => fixedTokens(x, { appDir: dir, userName: "", specs: [x], skills, ...processReserve(x), knowledge: "" }, declarationTokens(x));
	const s = (k: number) => spec("ar", { skills: NAMES.slice(0, k) });
	const k = most(s, noKnowledge);
	assert.ok(k > 10 && k < NAMES.length, `the fixture reaches the limit: ${k}`);
	assert.ok(noKnowledge(s(k)) <= SPECIALIST_FIXED_MAX);
	const n = full(s(k));
	assert.ok(n > SPECIALIST_FIXED_MAX, `with the knowledge maximum it passes: ${n}`);
	assert.equal(processReserve(s(k)).knowledge?.length, KNOWLEDGE_MAX);
	assert.throws(() => h["agents.save"]([s(k)]), { message: `Aģenta ar pastāvīgais konteksts ir ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}).` });
	assert.equal(h["agents.save"]([s(most(s, full))]).length, 1);
});

test("R47: the save counts the Revit tools an agent names, 150 tokens each", () => {
	const revit = Object.keys(REVIT_LEVELS).filter((n) => REVIT_LEVELS[n] === "read" && n !== "list_revit_instances").slice(0, 3);
	assert.equal(revit.length, 3);
	const skillsDir = skillsFolder(NAMES, 400);
	const { dir, h } = handler(skillsDir);
	const skills = listSkills(skillsDir);
	const s = (k: number) => spec("ar", { skills: NAMES.slice(0, k), tools: revit });
	assert.equal(revitReserve(s(0)), 3 * REVIT_DECLARATION_TOKENS);
	assert.equal(revitReserve(spec("bb", { tools: ["write_document"] })), 0);
	const without = (x: AgentSpec) => fixedTokens(x, { appDir: dir, userName: "", specs: [x], skills, ...processReserve(x) }, declarationTokens(x));
	const k = most(s, without);
	const n = without(s(k)) + 3 * REVIT_DECLARATION_TOKENS;
	assert.ok(without(s(k)) <= SPECIALIST_FIXED_MAX && n > SPECIALIST_FIXED_MAX, `the Revit reserve tips it over: ${n}`);
	assert.throws(() => h["agents.save"]([s(k)]), { message: `Aģenta ar pastāvīgais konteksts ir ${n} tokeni (limits ${SPECIALIST_FIXED_MAX}).` });
});

// ---- role and shared texts after the save -----------------------------------------------------------------------------------------

test("R47: agents.role.set and agents.role.import refuse a role that pushes a saved agent over the cap; the old text stays; a smaller one is allowed", () => {
	const skillsDir = skillsFolder(NAMES, 400);
	const { dir, h } = handler(skillsDir);
	const skills = listSkills(skillsDir);
	writeRole(dir, "liels", "kopsavilkums");
	const full = (x: AgentSpec) => fixedTokens(x, { appDir: dir, userName: "", specs: [x], skills, ...processReserve(x) }, declarationTokens(x));
	const s = (k: number) => spec("liels", { prompt: "", roleFile: true, skills: NAMES.slice(0, k) });
	h["agents.save"]([s(most(s, full))]);
	assert.throws(() => h["agents.role.set"]("liels", "L".repeat(3000)), /Aģenta liels pastāvīgais konteksts būtu \d+ tokeni \(limits 16000\); teksts nav saglabāts\./);
	assert.equal(readRole(dir, "liels"), "kopsavilkums");
	const md = join(tmp(), "loma.md");
	writeFileSync(md, "L".repeat(3000));
	assert.throws(() => h["agents.role.import"]("liels", md), /būtu \d+ tokeni/);
	assert.equal(readRole(dir, "liels"), "kopsavilkums");
	// a short change passes
	h["agents.role.set"]("liels", "īss");
	assert.equal(readRole(dir, "liels"), "īss");
	// an agent that is over already (a file written around the page) may only get smaller
	writeRole(dir, "liels", "L".repeat(6000));
	assert.throws(() => h["agents.role.set"]("liels", "L".repeat(7000)), /būtu \d+ tokeni/);
	h["agents.role.set"]("liels", "L".repeat(5000));
	assert.equal(readRole(dir, "liels")!.length, 5000);
	// a role for an id nobody saved has no agent to push over
	h["agents.role.set"]("citss", "L".repeat(3000));
	// over the plain limit keeps its own message
	assert.throws(() => h["agents.role.set"]("liels", "L".repeat(20_000)), /Lomas teksts: līdz/);
});

test("R47: agents.shared.set refuses shared rules that push any saved agent over the cap", () => {
	const skillsDir = skillsFolder(NAMES, 400);
	const { dir, h } = handler(skillsDir);
	const skills = listSkills(skillsDir);
	const full = (x: AgentSpec) => fixedTokens(x, { appDir: dir, userName: "", specs: [x], skills, ...processReserve(x) }, declarationTokens(x));
	const s = (id: string, k: number) => spec(id, { skills: NAMES.slice(0, k) });
	const k = most((n) => s("aa", n), full);
	h["agents.save"]([s("aa", k), s("bb", 3)]);
	assert.throws(() => h["agents.shared.set"]("K".repeat(3000)), /Aģenta aa pastāvīgais konteksts būtu \d+ tokeni \(limits 16000\); teksts nav saglabāts\./);
	assert.equal(readShared(dir), "");
	h["agents.shared.set"]("īsi noteikumi");
	assert.equal(readShared(dir), "īsi noteikumi");
});
