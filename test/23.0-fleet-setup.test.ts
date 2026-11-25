// Role-based set-up of the agent fleet (2026-11-25): every BD role has tools that fit it, they are valid for the settings page and within the context limit, the Revit
// document tools are `confirm`, delete and send_code stay `never`, and BPV can change another agent's settings through agent_configure.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PROCESS_OWN_TOOLS } from "../src/core/process-def.ts";
import { fixedTokens, processReserve, revitReserve, validateSpec } from "../src/agent/agents.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import { MAIN_TOOLS, MAIN_TOOL_LEVELS, SPECIALIST_CAP, LEVEL_RANK, ownTools, specialistTools } from "../src/agent/subagents.ts";
import { applyPatch } from "../src/agent/tools/fleet.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import { makeLevelOf, offered } from "../src/agent/tools/levels.ts";
import { REVIT_LEVELS, REVIT_TOOLS } from "../src/agent/tools/revit-levels.ts";
import { ROLE_MAX, SPECIALIST_FIXED_MAX, type AgentSpec } from "../src/shared/agent-types.ts";
import { TEAM_IDS } from "../src/shared/departments.ts";
import { FLEET_DEFAULTS, REVIT_READ, withFleetDefaults } from "../src/shared/fleet-defaults.ts";
import { tmp } from "./helpers.ts";

const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(allTools()), REVIT_LEVELS);
const known = [...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)];
const have = { tools: new Set(known), skills: new Set(["revit-room-dimension-chains", "revit-shared-coordinates-z", "revit-ifc-export-classes", "ifc-property-set-txt", "revit-api"]) };
const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: "", prompt: "", tools: [], ...extra });

test("every BD role has a default, none of them empty", () => {
	for (const id of Object.values(TEAM_IDS)) {
		const d = FLEET_DEFAULTS[id];
		assert.ok(d, `${id} has defaults`);
		assert.ok(d.tools.length >= 10, `${id} is not left with an empty tool list`);
	}
});

test("default tools exist, are none of the always-never or the process / main tools, and match the level cap the role is given", () => {
	for (const [id, d] of Object.entries(FLEET_DEFAULTS)) {
		let hasConfirm = false;
		for (const t of d.tools) {
			assert.ok(known.includes(t), `${id}: ${t} exists`);
			assert.ok(!PROCESS_OWN_TOOLS.has(t) && !MAIN_TOOLS.has(t), `${id}: ${t} is given automatically or not at all`);
			const lv = levelOf(t);
			assert.notEqual(lv, "never", `${id}: ${t}`);
			assert.ok(LEVEL_RANK[lv] <= LEVEL_RANK.confirm, `${id}: ${t}`);
			if (lv === "confirm") hasConfirm = true;
		}
		assert.equal(hasConfirm, d.confirm, `${id}: the confirm flag says whether a confirm tool is listed`);
		assert.equal(new Set(d.tools).size, d.tools.length, `${id}: no repeats`);
		assert.ok(!d.tools.includes("delete_element") && !d.tools.includes("send_code_to_revit"), id);
	}
});

test("who models and who only reads: AR / BK / the engineers write the model, the others never do; BPV and EKS never create elements", () => {
	const writes = (id: string) => FLEET_DEFAULTS[id]!.tools.filter((t) => /^create_(?!task)|^tag_all|^operate_element$/.test(t));
	assert.ok(writes("ar").includes("create_room") && writes("ar").includes("create_level"));
	assert.ok(writes("bk").includes("create_structural_framing_system") && writes("bk").includes("create_grid"));
	for (const id of ["uk", "avk", "ga", "el", "ess"]) {
		assert.ok(writes(id).includes("create_line_based_element"), id);
		assert.ok(!writes(id).includes("create_level") && !writes(id).includes("create_room"), `${id} models its own discipline, not levels, grids or rooms`);
	}
	for (const id of ["bpv", "eks", "aa", "cd", "ea", "ak", "mel", "tam", "ud"]) assert.deepEqual(writes(id).filter((t) => t !== "operate_element"), [], `${id} creates no model elements`);
	assert.equal(FLEET_DEFAULTS.eks!.confirm, false, "the independent expert holds no confirm tool at all");
	for (const id of Object.keys(FLEET_DEFAULTS).filter((x) => x !== "eks")) assert.ok(["write_file", "edit_file", "copy_file", "move_file", "run_command", "convert_file", "archive_extract", "write_spreadsheet"].every((t) => FLEET_DEFAULTS[id]!.tools.includes(t)), id + " has the file tools");
	assert.ok(!FLEET_DEFAULTS.eks!.tools.some((t) => ["write_file", "edit_file", "move_file", "copy_file", "run_command"].includes(t)), "the expert writes no files and runs no commands");
	assert.ok(FLEET_DEFAULTS.eks!.tools.every((t) => levelOf(t) !== "confirm"));
	assert.ok(!FLEET_DEFAULTS.mel!.tools.some((t) => REVIT_LEVELS[t] !== undefined || t.startsWith("revit_")), "land improvement has no Revit");
	assert.ok(["open_document", "save_document", "reload_links"].every((t) => FLEET_DEFAULTS.ar!.tools.includes(t)));
	assert.ok(!FLEET_DEFAULTS.bpv!.tools.includes("save_document"), "BPV coordinates: it opens and refreshes models, it does not save the disciplines' models");
});

test("Revit: the three document tools are confirm, delete and send_code stay never, the reading tools of the page are the Revit MCP's reads", () => {
	for (const t of ["open_document", "save_document", "reload_links"]) assert.equal(REVIT_LEVELS[t], "confirm", t);
	assert.ok(REVIT_TOOLS.includes("open_document"));
	assert.equal(levelOf("delete_element"), "never");
	assert.equal(levelOf("send_code_to_revit"), "never");
	for (const t of REVIT_READ) assert.ok(known.includes(t), t);
});

test("each default spec is accepted by the settings page's own check, and its fixed context fits even with a role text of the longest allowed size", () => {
	const dir = tmp();
	// an invented role of the most characters a role may have (docs/BD is the user's own and is not in the repository)
	const text = "Tu esi izdomāts aģents, kas raksta garu lomas tekstu. ".repeat(Math.ceil(ROLE_MAX / 54)).slice(0, ROLE_MAX);
	const roles: AgentSpec[] = Object.values(TEAM_IDS).map((id) => spec(id, { name: id.toUpperCase(), roleFile: true }));
	for (const id of Object.values(TEAM_IDS)) {
		const base = spec(id, { name: id.toUpperCase(), roleFile: true, description: "x" });
		const s = withFleetDefaults(base, have);
		const v = validateSpec({ ...s, prompt: "" }, levelOf, known, roles.map((r) => r.id), () => true);
		assert.ok(v.ok, `${id}: ${v.ok ? "" : v.error}`);
		const out = (v as { spec: AgentSpec }).spec;
		const n = fixedTokens(out, { appDir: dir, userName: "Test", specs: roles, skills: [], knowledge: "", roleText: { id, text }, chief: id === "bpv", ...processReserve(out) }, declarationTokens(out) + revitReserve(out));
		assert.ok(n <= SPECIALIST_FIXED_MAX, `${id}: ${n} tokens of ${SPECIALIST_FIXED_MAX}`);
	}
});

test("withFleetDefaults: fills an empty list and raises the cap; keeps a list the user made; adds only synced skills the library has", () => {
	const empty = withFleetDefaults(spec("ar", { maxLevel: "run", skills: ["own-skill"] }), have);
	assert.equal(empty.maxLevel, "confirm");
	assert.ok(empty.tools.includes("create_room"));
	assert.deepEqual(empty.skills?.slice(0, 1), ["own-skill"]);
	assert.ok(empty.skills?.includes("revit-room-dimension-chains"));
	assert.ok(!empty.skills?.includes("revit-api"), "revit-api teaches send_code_to_revit, which agents do not have");
	const own = withFleetDefaults(spec("ar", { tools: ["write_note"] }), have);
	assert.deepEqual(own.tools, ["write_note"], "a list the user made is theirs");
	assert.equal(own.maxLevel, undefined);
	const lack = withFleetDefaults(spec("ar"), { tools: new Set(["write_note"]), skills: new Set() });
	assert.deepEqual(lack.tools, ["write_note"], "a tool that does not exist is not listed");
	const other = spec("zzz");
	assert.equal(withFleetDefaults(other, have), other, "no default: untouched");
});

test("a run: AR with the defaults has Revit reading and modelling in its own thread; an agent with no list has no Revit tool; BPV has agent_configure only with the confirm cap", () => {
	const revitTools = new Set(REVIT_TOOLS);
	const listed = [...offered(allTools().map((t) => t.name), levelOf), ...offered(REVIT_TOOLS, levelOf)];
	const ar = withFleetDefaults(spec("ar"), have);
	const mine = ownTools(listed, levelOf, revitTools, ar, "confirm");
	assert.ok(mine.includes("get_current_view_elements") && mine.includes("create_room") && mine.includes("open_document"));
	assert.ok(!mine.includes("delete_element") && !mine.includes("send_code_to_revit"));
	const bare = ownTools(listed, levelOf, revitTools, spec("ar"), "confirm");
	assert.ok(!bare.some((n) => revitTools.has(n)), "no Revit by itself: reading Revit has to be given");
	// at the run cap the confirm tools wait for the user's cap
	assert.ok(!ownTools(listed, levelOf, revitTools, ar, SPECIALIST_CAP).includes("create_room"));
	const bpv = withFleetDefaults(spec("bpv"), have);
	assert.ok(ownTools(listed, levelOf, revitTools, bpv, "confirm").includes("agent_configure"));
	assert.ok(!ownTools(listed, levelOf, revitTools, bpv, SPECIALIST_CAP).includes("agent_configure"));
	assert.ok(!ownTools(listed, levelOf, revitTools, ar, "confirm").includes("agent_configure"), "only BPV");
	assert.equal(levelOf("agent_configure"), "confirm", "every change of the fleet waits for the user's click");
	assert.deepEqual(specialistTools(listed, levelOf, revitTools, ar, "confirm").filter((n) => n === "agent_configure"), []);
});

test("agent_configure: applyPatch changes only what it names", () => {
	const s = spec("bk", { tools: ["write_note", "highlight"], skills: ["a"], model: "m1", maxLevel: "run" });
	const t = applyPatch(s, { tools_add: ["create_level", "write_note"], tools_remove: ["highlight"], skills_add: ["b"], model: "", maxLevel: "confirm", mayMessage: [] });
	assert.deepEqual(t.tools, ["write_note", "create_level"]);
	assert.deepEqual(t.skills, ["a", "b"]);
	assert.equal(t.model, undefined);
	assert.equal(t.maxLevel, "confirm");
	assert.deepEqual(t.mayMessage, []);
	assert.equal(t.name, s.name, "untouched");
	assert.deepEqual(applyPatch(s, {}), s);
	// the page's own check still decides: a confirm tool on a run-cap agent is refused
	const refused = validateSpec({ ...applyPatch(s, { tools_add: ["create_level"], maxLevel: "run" }), prompt: "0123456789" }, levelOf, known);
	assert.equal(refused.ok, false);
});

test("agent_configure through the bridge: reads the list, saves one agent changed, keeps the old agents.json and logs the change", async () => {
	const { fleetTools } = await import("../src/agent/tools/fleet.ts");
	const t = fleetTools.find((x) => x.name === "agent_configure")!;
	const dir = tmp();
	writeFileSync(join(dir, "agents.json"), JSON.stringify([spec("ar"), spec("bk")]));
	const saved: unknown[] = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async (_url: string, init: { body: string }) => {
		const b = JSON.parse(init.body) as { name: string; args: unknown[] };
		const result = b.name === "agents.list" ? { specs: [{ ...spec("ar"), fixedTokens: 100 }, { ...spec("bk"), fixedTokens: 100 }] } : b.name === "agents.save" ? (saved.push(b.args[0]), b.args[0]) : null;
		return { ok: true, json: async () => ({ result }) };
	}) as unknown as typeof fetch;
	try {
		const ctx = { projectsDir: dir, projectId: null, dataDir: dir, appDir: dir, runDir: null, agent: "bpv", thread: null, bridge: { url: "http://x", token: "t" } };
		const r = (await t.run(ctx, { agent: "bk", changes: { tools_add: ["create_level"], maxLevel: "confirm" }, reason: "structures need levels" })) as { ok: boolean; settings: boolean };
		assert.equal(r.ok, true);
		assert.equal(r.settings, true);
		const list = saved[0] as AgentSpec[];
		assert.deepEqual(list.map((s) => s.id), ["ar", "bk"], "the other agent is sent back as it was");
		assert.deepEqual(list[1]!.tools, ["create_level"]);
		assert.equal((list[1] as unknown as { fixedTokens?: number }).fixedTokens, undefined, "no read-only fields are sent back");
		assert.equal(readdirSync(join(dir, "agents", "versions")).filter((n) => n.startsWith("agents-json.")).length, 1, "the old agents.json is kept");
		assert.match(readFileSync(join(dir, "agents", "fleet-changes.jsonl"), "utf8"), /"agent":"bk".*"by":"bpv"|"by":"bpv".*"agent":"bk"/);
		await assert.rejects(t.run(ctx, { agent: "nav", changes: {}, reason: "no such agent" }), /Nav aģenta/);
		await assert.rejects(t.run(ctx, { agent: "lead", changes: {}, reason: "not the lead" }), /galvenā aģenta/);
		await assert.rejects(t.run(ctx, { agent: "ar", reason: "nothing to change" }), /Nav ko mainīt/);
	} finally {
		globalThis.fetch = realFetch;
	}
	assert.ok(existsSync(join(dir, "agents.json")));
	mkdirSync(dir, { recursive: true });
});

test("setupFleet: once, an empty tool list is set up by role and a list the user made is kept; a second start changes nothing", async () => {
	const { setupFleet } = await import("../src/main/handlers/agents.ts");
	const { AppSettings } = await import("../src/main/settings.ts");
	const dir = tmp("pj-fleet-");
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	assert.equal(setupFleet({ settings }), null, "nothing saved yet: nothing to set up");
	const role = (id: string) => {
		mkdirSync(join(dir, "agents"), { recursive: true });
		writeFileSync(join(dir, "agents", `${id}.md`), `# Agents: ${id}\n\n## Loma\nIzdomāta loma ${id}.\n`);
		return spec(id, { name: id.toUpperCase(), description: "x", roleFile: true, skills: ["own"] });
	};
	settings.saveAgentSpecs([role("bpv"), role("ar"), role("mel"), { ...role("bk"), tools: ["write_note"], maxLevel: "run" }, spec("dokumenti", { prompt: "Raksta Word dokumentus nodevumam.", tools: ["write_document"] })]);
	const r = setupFleet({ settings })!;
	assert.deepEqual(r.skipped, []);
	assert.deepEqual(r.applied.sort(), ["ar", "bpv", "mel"]);
	const after = settings.agentSpecs().specs;
	const get = (id: string) => after.find((s) => s.id === id)!;
	assert.equal(get("bpv").maxLevel, "confirm");
	assert.ok(get("bpv").tools.includes("app_confirm") && get("bpv").tools.includes("open_document") && !get("bpv").tools.includes("create_room"));
	assert.ok(get("ar").tools.includes("create_room") && get("ar").tools.includes("get_current_view_elements"));
	assert.equal(get("mel").maxLevel, "confirm", "every role but the expert holds the coding-agent file tools, which wait for the user");
	assert.ok(get("mel").tools.length >= 10 && !get("mel").tools.some((t) => t in REVIT_LEVELS));
	assert.deepEqual(get("bk").tools, ["write_note"], "the user's own list is kept");
	assert.equal(get("bk").maxLevel, "run");
	assert.deepEqual(get("dokumenti").tools, ["write_document"], "an agent that is not a BD role is untouched");
	assert.ok(existsSync(join(dir, "agents", ".fleet-setup-1")));
	assert.match(readFileSync(join(dir, "agents", "fleet-setup.log"), "utf8"), /"applied"/);
	// the user unticks everything on purpose afterwards: the next start leaves it
	settings.saveAgentSpecs(after.map((s) => (s.id === "mel" ? { ...s, tools: [] } : s)));
	assert.equal(setupFleet({ settings }), null);
	assert.deepEqual(settings.agentSpecs().specs.find((s) => s.id === "mel")!.tools, []);
});
