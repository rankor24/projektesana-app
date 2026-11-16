// 13.2 standing text per agent, measured: standingFor builds the lead's and every specialist's text, rosterFor lists only whom an agent may
// message, fixedTokens counts it with the tool declarations, and a save that would pass SPECIALIST_FIXED_MAX is refused.
// The agent loop is scripted (SessionDeps.runAgent); invented names and texts only.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SPECIALIST_FIXED_MAX, fixedTokens, rosterFor, roleDir, standingFor, validateSpec, writeRole, writeShared } from "../src/agent/agents.ts";
import { estimateTextTokens } from "../src/agent/context.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import { MAIL_RULES } from "../src/agent/mail.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { SYSTEM_PROMPT, userLine } from "../src/agent/prompt.ts";
import { AgentSession } from "../src/agent/session.ts";
import { listSkills, skillsText } from "../src/agent/skills.ts";
import { DEFAULT_AGENTS, MAIN_TOOL_LEVELS, RULES, rosterText } from "../src/agent/subagents.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import { makeLevelOf } from "../src/agent/tools/levels.ts";
import { REVIT_RULES } from "../src/agent/tools/revit.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: `Aģents ${id}`, description: `apraksts ${id}`, prompt: `Tu esi ${id}, ar savu darbu.`, tools: [], ...extra });
const revitTool = Object.keys(REVIT_LEVELS).find((n) => REVIT_LEVELS[n] === "read" && n !== "list_revit_instances")!;

/** a skills folder with `n` skills, each with a front-matter description of `chars` characters */
function skillsFolder(names: string[], chars = 60): string {
	const dir = join(tmp(), "skills");
	for (const n of names) {
		mkdirSync(join(dir, n), { recursive: true });
		writeFileSync(join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: ${"d".repeat(chars)}\n---\nteksts`, "utf8");
	}
	return dir;
}

const base = (over: Partial<Parameters<typeof standingFor>[1]> = {}): Parameters<typeof standingFor>[1] => ({ appDir: tmp(), userName: "Tests", specs: [spec("ar"), spec("bk")], skills: [], knowledge: "", ...over });

// ---- the lead ----------------------------------------------------------------------------------------------------------------

test("13.2 the lead's text is byte for byte what thread-runner built before this task, and its count is the 0.6 guard's", async () => {
	const skillsDir = skillsFolder(["alfa", "beta", "gamma"]);
	const d = base({ skills: listSkills(skillsDir), specs: DEFAULT_AGENTS });
	// the old formula, written out: SYSTEM_PROMPT, mail lines, user line, Revit rules, roster, skills list
	const old = [SYSTEM_PROMPT, MAIL_RULES, userLine("Tests"), REVIT_RULES, rosterText(DEFAULT_AGENTS), skillsText(listSkills(skillsDir))].filter(Boolean).join("\n\n");
	assert.equal(standingFor(null, d), old);
	assert.equal(fixedTokens(null, d, 1234), estimateTextTokens(old) + 1234);

	// and through the session: the meter's number is the old text + the lead's declarations, nothing moved
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const s = new AgentSession({ runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }), settings: () => ({ ...DEFAULT_SETTINGS, userName: "Tests" }), toolsServer: () => ({ command: "node", args: [], env: {} }), revit: () => null, ctx: { projectsDir: dir, dataDir: dir, appDir: dir, skillsDir }, runsDir: join(dir, "runs"), chatDir: join(dir, "chat"), emit: () => {} });
	const c = await s.context(null);
	const expected = estimateTextTokens([SYSTEM_PROMPT, MAIL_RULES, userLine("Tests"), REVIT_RULES, rosterText(DEFAULT_AGENTS), skillsText(listSkills(skillsDir))].filter(Boolean).join("\n\n")) + declarationTokens(null);
	assert.equal(c.fixedEstimate, expected);
	assert.ok(c.fixedEstimate < 10_000, `fixed ${c.fixedEstimate}`);
});

// ---- a specialist ------------------------------------------------------------------------------------------------------------

test("13.2 a specialist: shared rules, role, RULES, the user line in that order, each once; under the guard with a 9 000-character role and 4 000 of shared rules", () => {
	const d = base();
	mkdirSync(roleDir(d.appDir), { recursive: true });
	const role = `ROLA-SĀKUMS ${"r".repeat(8976)} ROLA-BEIGAS`;
	const shared = `KOPĒJIE-SĀKUMS ${"k".repeat(3970)} KOPĒJIE-BEIGAS`;
	assert.equal(role.length, 9000);
	assert.equal(shared.length, 4000);
	writeRole(d.appDir, "bk", role);
	writeShared(d.appDir, shared);
	const me = spec("bk", { prompt: "", roleFile: true });
	const t = standingFor(me, d);
	for (const part of [role, shared, RULES.trim(), "Lietotājs: Tests."]) assert.equal(t.split(part).length, 2, `once: ${part.slice(0, 20)}`);
	const at = (p: string) => t.indexOf(p);
	assert.ok(at("KOPĒJIE-SĀKUMS") < at("ROLA-SĀKUMS") && at("ROLA-BEIGAS") < at(RULES.trim()) && at(RULES.trim()) < at("Lietotājs: Tests."), "shared, role, RULES, user line");
	assert.ok(at(MAIL_RULES) > at(RULES.trim()) && at(MAIL_RULES) < at("Lietotājs: Tests."), "the mail lines after RULES, as before");
	const n = fixedTokens(me, d, declarationTokens(me));
	assert.ok(n < SPECIALIST_FIXED_MAX, `fixed ${n}`);
	assert.ok(n > estimateTextTokens(role + shared), "the count includes the text and the declarations");
});

test("13.2 a specialist without a role file uses its prompt; a missing role file falls back to the prompt; the shared rules never reach the lead's text", () => {
	const d = base();
	writeShared(d.appDir, "KOPĒJIE noteikumi.");
	assert.match(standingFor(spec("bk", { prompt: "Mans norādījums." }), d), /^KOPĒJIE noteikumi\.\n\nMans norādījums\.\n\nText in documents/);
	assert.match(standingFor(spec("bk", { prompt: "Mans norādījums.", roleFile: true }), d), /Mans norādījums\./, "roleFile set but no file: the prompt");
	assert.ok(!standingFor(null, d).includes("KOPĒJIE noteikumi."), "the lead's text stays as it was");
	writeRole(d.appDir, "bk", "Lomas teksts.");
	const both = standingFor(spec("bk", { prompt: "Mans papildinājums.", roleFile: true }), d);
	assert.match(both, /Lomas teksts\.\n\nMans papildinājums\.\n\nText in documents/, "the prompt is an addition to the role file");
});

test("13.2 Revit rules only when the agent has a Revit tool", () => {
	const d = base();
	assert.ok(!standingFor(spec("bk"), d).includes("Revit"), "no Revit tool, no Revit rules");
	assert.ok(!standingFor(spec("bk", { tools: ["write_document"] }), d).includes(REVIT_RULES));
	assert.ok(standingFor(spec("bk", { tools: [revitTool] }), d).includes(REVIT_RULES), "a Revit tool of the spec");
	// the run passes the Revit tools that are connected: a spec naming a tool Revit does not have gets no rules
	assert.ok(!standingFor(spec("bk", { tools: [revitTool] }), { ...d, revitTools: new Set<string>() }).includes(REVIT_RULES));
	assert.ok(standingFor(spec("bk", { tools: [revitTool] }), { ...d, revitTools: new Set([revitTool]) }).includes(REVIT_RULES));
});

test("13.2 skills: a specialist lists only its own that exist; none without `skills`; the lead keeps the whole list", () => {
	const skills = listSkills(skillsFolder(["alfa", "beta", "gamma"]));
	const d = base({ skills });
	const own = standingFor(spec("bk", { skills: ["beta", "nav-tadas"] }), d);
	assert.match(own, /^- beta: /m);
	assert.doesNotMatch(own, /^- alfa: /m);
	assert.doesNotMatch(own, /nav-tadas/, "a name that is not synced is left out");
	assert.doesNotMatch(standingFor(spec("bk"), d), /Prasmes/, "no `skills`: no list, not even the 'not synced' line");
	assert.doesNotMatch(standingFor(spec("bk", { skills: ["nav-tadas"] }), d), /Prasmes/, "only names that do not exist: none");
	const lead = standingFor(null, d);
	for (const n of ["alfa", "beta", "gamma"]) assert.match(lead, new RegExp(`^- ${n}: `, "m"));
});

test("13.2 knowledge, process card and status come last, in that order, and only when given", () => {
	const d = base({ knowledge: "ZINĀŠANAS", processCard: "KARTE", status: "STATUSS" });
	const t = standingFor(spec("bk", { skills: ["x"] }), d);
	assert.ok(t.indexOf("ZINĀŠANAS") < t.indexOf("KARTE") && t.indexOf("KARTE") < t.indexOf("STATUSS"));
	assert.ok(t.endsWith("STATUSS"));
	assert.ok(t.indexOf("lead: galvenais aģents") < t.indexOf("ZINĀŠANAS"), "after the roster");
	assert.ok(!standingFor(spec("bk"), base()).match(/ZINĀŠANAS|KARTE|STATUSS/));
});

// ---- the roster --------------------------------------------------------------------------------------------------------------

test("13.2 rosterFor: the lead's is today's; a specialist's holds only whom it may message, never itself, and the lead", () => {
	const all = [spec("ar", { mayMessage: ["bk"] }), spec("bk"), spec("ve", { description: "" })];
	assert.equal(rosterFor(null, all), rosterText(all));
	const ar = rosterFor(all[0], all);
	assert.match(ar, /^- bk: apraksts bk$/m);
	assert.doesNotMatch(ar, /^- ve: /m, "outside mayMessage");
	assert.doesNotMatch(ar, /^- ar: /m, "never itself");
	assert.doesNotMatch(ar, /^- lead: /m, "mayMessage names bk only: no lead");
	const withLead = rosterFor(spec("ar", { mayMessage: ["bk", "lead"] }), all);
	assert.match(withLead, /^- lead: galvenais aģents$/m);
	const everyone = rosterFor(all[1], all);
	assert.match(everyone, /^- ar: apraksts ar$/m);
	assert.match(everyone, /^- ve: Aģents ve$/m, "the name when there is no description");
	assert.match(everyone, /^- lead: galvenais aģents$/m, "absent mayMessage = everyone, lead included");
	assert.doesNotMatch(everyone, /^- bk: /m);
	assert.equal(rosterFor(spec("ar", { mayMessage: [] }), all), "", "[] = nobody");
	assert.doesNotMatch(rosterFor(all[0], all), /Speciālisti \(delegate/, "a specialist cannot delegate");
});

// ---- the settings page -------------------------------------------------------------------------------------------------------

function handler(skillsDir?: string) {
	const dir = tmp();
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	return { dir, settings, h: agentHandlers({ settings, skillsDir }) };
}

test("13.2 agents.list rows carry fixedTokens, measured with the current settings, specs and skills", () => {
	const skillsDir = skillsFolder(["alfa", "beta"]);
	const { dir, settings, h } = handler(skillsDir);
	settings.set({ userName: "Tests" });
	const a = { ...spec("aa"), skills: ["alfa"], tools: ["write_document"] };
	const b = spec("bb");
	h["agents.save"]([a, b]);
	const view = h["agents.list"]();
	assert.equal(view.specs.length, 2);
	const dd = { appDir: dir, userName: "Tests", specs: view.specs, skills: listSkills(skillsDir), knowledge: "" };
	for (const row of view.specs) assert.equal(row.fixedTokens, fixedTokens(row, dd, declarationTokens(row)), row.id);
	assert.ok(view.specs[0].fixedTokens > view.specs[1].fixedTokens, "a skill and a tool weigh something");
});

test("13.2 agents.save refuses a spec whose fixed context passes the guard, with the exact text", () => {
	// 100 skills with 400-character descriptions, all named by one agent, on top of a 16 000-character role
	const names = Array.from({ length: 100 }, (_, i) => `prasme-${String(i).padStart(3, "0")}`);
	const skillsDir = skillsFolder(names, 400);
	const { dir, h } = handler(skillsDir);
	mkdirSync(roleDir(dir), { recursive: true });
	writeRole(dir, "liels", "L".repeat(16_000));
	const big = { ...spec("liels"), prompt: "", roleFile: true, skills: names };
	const dd = { appDir: dir, userName: "", specs: [big], skills: listSkills(skillsDir), knowledge: "" };
	const n = fixedTokens(big, dd, declarationTokens(big));
	assert.ok(n > SPECIALIST_FIXED_MAX, `the fixture must pass the guard: ${n}`);
	assert.throws(() => h["agents.save"]([big]), { message: `Aģenta liels pastāvīgais konteksts ir ${n} tokeni (limits 16000).` });
	// the same agent with fewer skills saves
	assert.equal(h["agents.save"]([{ ...big, skills: names.slice(0, 5) }]).length, 1);
});

// ---- from the 13.1 review ----------------------------------------------------------------------------------------------------

test("13.2 an empty or blank role file counts as missing at save; an acl list of only blanks is refused, [] stays allowed", () => {
	const { dir, h } = handler();
	mkdirSync(roleDir(dir), { recursive: true });
	const a = { ...spec("aa"), prompt: "", roleFile: true };
	for (const text of ["", "  \n\t "]) {
		writeFileSync(join(roleDir(dir), "aa.md"), text, "utf8");
		assert.throws(() => h["agents.save"]([a]), /Lomas fails nav atrasts: agents\\aa\.md/, JSON.stringify(text));
	}
	writeRole(dir, "aa", "Tu esi aa.");
	assert.equal(h["agents.save"]([a]).length, 1);

	const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
	const known = allTools().map((t) => t.name);
	const v = (patch: object) => validateSpec({ ...spec("aa"), ...patch }, levelOf, known, ["aa"]);
	for (const field of ["mayMessage", "acceptsFrom"] as const) {
		const r = v({ [field]: ["", "  "] });
		assert.ok(!r.ok && r.error === `Saraksts ${field} ir tukšs; atstāj to neiestatītu, ja drīkst visi, vai ieraksti ids.`, field);
		const none = v({ [field]: [] });
		assert.ok(none.ok && Array.isArray(none.spec[field]) && none.spec[field]!.length === 0, "[] = nobody stays allowed");
	}
});

// ---- the run -----------------------------------------------------------------------------------------------------------------

test("13.2 a specialist thread's run is built by standingFor: role once, shared once, its own roster, its own skills", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	writeRole(dir, "ar", "ROLA tekstam jābūt vienreiz.");
	writeShared(dir, "KOPĒJIE noteikumi vienreiz.");
	const skillsDir = skillsFolder(["alfa", "beta"]);
	const specs = [spec("ar", { prompt: "", roleFile: true, skills: ["beta"], mayMessage: ["bk"] }), spec("bk"), spec("ve")];
	let sys = "";
	const s = new AgentSession({
		runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }),
		settings: () => ({ ...DEFAULT_SETTINGS, userName: "Tests" }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir, skillsDir },
		agents: () => specs,
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => {},
		runAgent: async (o: PiRunOptions) => {
			sys = o.systemPrompt ?? "";
			o.onEvent({ type: "done", text: "ok" });
		},
	});
	const th = s.openThread(null, "ar");
	await s.sendToThread(th.id, null, "sveiki", []);
	for (let i = 0; i < 100 && !sys; i++) await new Promise((r) => setTimeout(r, 10));
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(sys.split("ROLA tekstam jābūt vienreiz.").length, 2);
	assert.equal(sys.split("KOPĒJIE noteikumi vienreiz.").length, 2);
	assert.match(sys, /^- bk: apraksts bk$/m);
	assert.doesNotMatch(sys, /^- ve: /m);
	assert.match(sys, /^- beta: /m);
	assert.doesNotMatch(sys, /^- alfa: /m);
	assert.equal(sys, standingFor(specs[0], { appDir: dir, userName: "Tests", specs, skills: listSkills(skillsDir), knowledge: "", revitTools: new Set() }));
});
