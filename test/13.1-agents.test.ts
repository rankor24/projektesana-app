// 13.1 spec v2 and role files: validation of the new fields, the role / shared text files with their kept versions, and the send rules
// that now read the typed acl fields. Invented names only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROLE_MAX, SHARED_MAX, readRole, readShared, roleDir, validateSpec, writeRole, writeShared } from "../src/agent/agents.ts";
import * as sub from "../src/agent/subagents.ts";
import { DEFAULT_AGENTS, MAIN_TOOL_LEVELS } from "../src/agent/subagents.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import { makeLevelOf } from "../src/agent/tools/levels.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";
import { DEFAULT_LIMITS, canSend } from "../src/core/messages.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { tmp } from "./helpers.ts";

const levelOf = makeLevelOf(MAIN_TOOL_LEVELS, appLevels(), REVIT_LEVELS);
const known = [...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)];
const confirmTool = Object.entries(REVIT_LEVELS).find(([, l]) => l === "confirm")![0];
const old = { id: "tulkojums", name: "Tulkotājs", description: "tulko", prompt: "Tulko tekstu uz latviešu valodu.", tools: ["write_document"] };
const bad = (patch: object, ids?: string[], roleExists?: (id: string) => boolean) => {
	const v = validateSpec({ ...old, ...patch }, levelOf, known, ids, roleExists);
	return v.ok ? "ok" : v.error;
};

test("13.1 validateSpec: an old spec validates as before, without any new key; subagents.ts re-exports the same function", () => {
	const v = validateSpec(old, levelOf, known);
	assert.ok(v.ok);
	assert.deepEqual(v.spec, old);
	assert.equal(sub.validateSpec, validateSpec);
	for (const a of DEFAULT_AGENTS) assert.ok(validateSpec(a, levelOf, known, DEFAULT_AGENTS.map((x) => x.id)).ok, a.id);
	assert.match(bad({ id: "lead" }), /rezervēts/);
	assert.match(bad({ tools: ["send_message"] }), /dots katram aģentam/);
});

test("13.1 validateSpec: a confirm tool needs maxLevel confirm; never tools and main-process tools stay out whatever the level", () => {
	assert.match(bad({ tools: [confirmTool] }), /prasa lietotāja apstiprinājumu/);
	assert.match(bad({ tools: [confirmTool], maxLevel: "run" }), /prasa lietotāja apstiprinājumu/);
	const ok = validateSpec({ ...old, tools: [confirmTool], maxLevel: "confirm" }, levelOf, known);
	assert.ok(ok.ok && ok.spec.maxLevel === "confirm" && ok.spec.tools[0] === confirmTool);
	assert.match(bad({ tools: ["delete_element"], maxLevel: "confirm" }), /prasa lietotāja apstiprinājumu|nekad|never/);
	assert.notEqual(bad({ tools: ["delete_element"], maxLevel: "confirm" }), "ok");
	assert.notEqual(bad({ tools: ["delete_element"] }), "ok");
	assert.notEqual(bad({ tools: ["send_code_to_revit"], maxLevel: "confirm" }), "ok");
	assert.match(bad({ tools: ["delegate"], maxLevel: "confirm" }), /nevar palaist citus aģentus/);
	assert.match(bad({ tools: ["run_subagent"], maxLevel: "confirm" }), /nevar palaist citus aģentus/);
	assert.match(bad({ maxLevel: "never" }), /maxLevel/);
	assert.match(bad({ maxLevel: "read" }), /maxLevel/);
	assert.equal(bad({ maxLevel: "run" }), "ok");
});

test("13.1 validateSpec: mayMessage / acceptsFrom name existing ids or lead; [] is nobody; omitted ids skip the check", () => {
	const ids = ["tulkojums", "ar"];
	assert.equal(bad({ mayMessage: ["ar", "lead"], acceptsFrom: [] }, ids), "ok");
	assert.match(bad({ mayMessage: ["zz"] }, ids), /zz/);
	assert.match(bad({ acceptsFrom: ["ar", "yy"] }, ids), /yy/);
	assert.match(bad({ mayMessage: "ar" }, ids), /mayMessage/);
	// R4: without the ids nothing is checked
	assert.equal(bad({ mayMessage: ["zz"] }), "ok");
	const v = validateSpec({ ...old, mayMessage: ["ar", "ar"], acceptsFrom: [] }, levelOf, known, ids);
	assert.ok(v.ok);
	assert.deepEqual(v.spec.mayMessage, ["ar"]);
	assert.deepEqual(v.spec.acceptsFrom, [], "[] is kept: nobody");
});

test("13.1 validateSpec: prompt may be empty only with roleFile, and then the role file must exist; skills, model, effort are stored", () => {
	assert.match(bad({ prompt: "" }), /Norādījums/);
	assert.match(bad({ prompt: "", roleFile: true }, undefined, () => false), /Lomas fails nav atrasts: agents\\tulkojums\.md/);
	assert.equal(bad({ prompt: "", roleFile: true }, undefined, () => true), "ok");
	assert.equal(bad({ prompt: "", roleFile: true }), "ok", "no roleExists given: not checked here");
	assert.match(bad({ prompt: "x".repeat(4001), roleFile: true }), /Norādījums/);
	const v = validateSpec({ ...old, roleFile: true, skills: ["a", "a", " b "], model: " gpt-x ", effort: "high" }, levelOf, known);
	assert.ok(v.ok);
	assert.deepEqual([v.spec.roleFile, v.spec.skills, v.spec.model, v.spec.effort], [true, ["a", "b"], "gpt-x", "high"]);
	assert.match(bad({ effort: "enormous" }), /effort/i);
	assert.equal(bad({ effort: "", model: "" }), "ok");
	assert.match(bad({ skills: "a" }), /skills/i);
});

test("13.1 role files: 16 000 characters accepted, 16 001 refused; no role is null; the replaced text is kept under versions", () => {
	const app = tmp();
	assert.equal(roleDir(app), join(app, "agents"));
	assert.equal(readRole(app, "ar"), null);
	writeRole(app, "ar", "x".repeat(ROLE_MAX));
	assert.equal(readRole(app, "ar")?.length, ROLE_MAX);
	assert.throws(() => writeRole(app, "ar", "x".repeat(ROLE_MAX + 1)), /16000|16 000/);
	assert.equal(readRole(app, "ar")?.length, ROLE_MAX, "a refused write changes nothing");
	writeRole(app, "ar", "first");
	writeRole(app, "ar", "second");
	assert.equal(readRole(app, "ar"), "second");
	const kept = readdirSync(join(roleDir(app), "versions")).filter((f) => f.startsWith("ar."));
	assert.ok(kept.length >= 2, `kept: ${kept.join(",")}`);
	const texts = kept.map((f) => readFileSync(join(roleDir(app), "versions", f), "utf8"));
	assert.ok(texts.includes("first"), "the first text is under versions");
	assert.ok(texts.includes("x".repeat(ROLE_MAX)));
	for (const f of kept) assert.match(f, /^ar\.[0-9TZ-]+(\.\d+)?\.md$/);
	assert.throws(() => writeRole(app, "../x", "t"), /Identifikators/);
});

test("13.1 role files: two writes in the same millisecond do not overwrite each other's kept copy", () => {
	const app = tmp();
	writeRole(app, "ar", "one");
	const RealNow = Date.now;
	Date.now = () => 1_800_000_000_000;
	try {
		writeRole(app, "ar", "two");
		writeRole(app, "ar", "three");
		writeRole(app, "ar", "four");
	} finally {
		Date.now = RealNow;
	}
	const texts = readdirSync(join(roleDir(app), "versions")).map((f) => readFileSync(join(roleDir(app), "versions", f), "utf8"));
	for (const t of ["one", "two", "three"]) assert.ok(texts.includes(t), t);
});

test("13.1 shared rules: _kopejie.md, 6 000 characters, replaced text kept; empty when absent", () => {
	const app = tmp();
	assert.equal(readShared(app), "");
	writeShared(app, "x".repeat(SHARED_MAX));
	assert.equal(readShared(app).length, SHARED_MAX);
	assert.throws(() => writeShared(app, "x".repeat(SHARED_MAX + 1)), /6000|6 000/);
	writeShared(app, "jauns");
	assert.equal(readShared(app), "jauns");
	assert.ok(existsSync(join(roleDir(app), "_kopejie.md")));
	const kept = readdirSync(join(roleDir(app), "versions")).filter((f) => f.startsWith("_kopejie."));
	assert.ok(kept.some((f) => readFileSync(join(roleDir(app), "versions", f), "utf8") === "x".repeat(SHARED_MAX)));
});

test("13.1 an agents.json written before this task loads unchanged", () => {
	const dir = tmp();
	const s = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	writeFileSync(join(dir, "agents.json"), JSON.stringify([old], null, 2), "utf8");
	const { specs, shipped } = s.agentSpecs();
	assert.equal(shipped, false);
	assert.deepEqual(specs, [old]);
	assert.ok(validateSpec(specs[0], levelOf, known).ok);
});

test("13.1 canSend: the typed acl fields refuse both ways; absent = everyone, [] = nobody", () => {
	const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id, description: "", prompt: "", tools: [], ...extra });
	const ctx = (agents: AgentSpec[]) => ({ agents, limits: DEFAULT_LIMITS, messages: [] });
	const m = { from: "ar", to: "bk", kind: "ask" as const, topic: null, depth: 0 };
	assert.deepEqual(canSend(m, ctx([spec("ar"), spec("bk")])), { ok: true });
	const a = canSend(m, ctx([spec("ar", { mayMessage: ["ve"] }), spec("bk")]));
	assert.ok(!a.ok && a.code === "acl");
	const b = canSend(m, ctx([spec("ar"), spec("bk", { acceptsFrom: ["ve"] })]));
	assert.ok(!b.ok && b.code === "acl");
	const c = canSend(m, ctx([spec("ar", { mayMessage: [] }), spec("bk")]));
	assert.ok(!c.ok && c.code === "acl", "[] = may message nobody");
	const d = canSend(m, ctx([spec("ar"), spec("bk", { acceptsFrom: [] })]));
	assert.ok(!d.ok && d.code === "acl", "[] = accepts from nobody");
	assert.deepEqual(canSend(m, ctx([spec("ar", { mayMessage: ["bk"] }), spec("bk", { acceptsFrom: ["ar"] })])), { ok: true });
});

test("13.1 the agents handler passes the ids being saved plus lead, and checks the role file at save time", async () => {
	const { agentHandlers } = await import("../src/main/handlers/agents.ts");
	const dir = tmp();
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	const h = agentHandlers({ settings });
	const a = { ...old, id: "aa", mayMessage: ["bb", "lead"] };
	const b = { ...old, id: "bb", name: "Bb" };
	assert.equal(h["agents.save"]([a, b]).length, 2);
	assert.throws(() => h["agents.save"]([{ ...a, mayMessage: ["cc"] }, b]), /cc/);
	assert.throws(() => h["agents.save"]([{ ...a, prompt: "", roleFile: true }, b]), /Lomas fails nav atrasts: agents\\aa\.md/);
	mkdirSync(roleDir(dir), { recursive: true });
	writeRole(dir, "aa", "Tu esi aa.");
	assert.equal(h["agents.save"]([{ ...a, prompt: "", roleFile: true }, b])[0].roleFile, true);
	assert.equal(settings.agentSpecs().specs[0].roleFile, true);
});

// ---- 13.5 Aģenti page: the handlers behind the role and shared-rule editors ----

async function pageHandlers() {
	const { agentHandlers } = await import("../src/main/handlers/agents.ts");
	const dir = tmp();
	const settings = new AppSettings(dir, { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	return { dir, settings, h: agentHandlers({ settings }) };
}

test("13.5 agents.role.get / set: null without a file, text back, ROLE_MAX enforced, the replaced text kept, a bad id refused", async () => {
	const { dir, h } = await pageHandlers();
	assert.equal(h["agents.role.get"]("aa"), null);
	h["agents.role.set"]("aa", "Pirmais teksts.");
	assert.equal(h["agents.role.get"]("aa"), "Pirmais teksts.");
	h["agents.role.set"]("aa", "Otrais teksts.");
	assert.equal(h["agents.role.get"]("aa"), "Otrais teksts.");
	const kept = readdirSync(join(roleDir(dir), "versions")).map((f) => readFileSync(join(roleDir(dir), "versions", f), "utf8"));
	assert.ok(kept.includes("Pirmais teksts."), "the replaced text is under versions");
	assert.throws(() => h["agents.role.set"]("aa", "x".repeat(ROLE_MAX + 1)), /16000|16 000/);
	assert.equal(h["agents.role.get"]("aa"), "Otrais teksts.", "a refused write changes nothing");
	assert.throws(() => h["agents.role.set"]("../x", "t"), /Identifikators/);
	assert.throws(() => h["agents.role.get"]("..\\x"), /Identifikators/);
	assert.throws(() => h["agents.role.set"]("aa", 5 as unknown as string), /teksts/i);
});

test("13.5 agents.role.import: reads a UTF-8 .md into the role file (the old text kept), returns its length; roleFile only comes with a spec save", async () => {
	const { dir, settings, h } = await pageHandlers();
	const src = join(tmp(), "loma.md");
	const text = "# Loma\nTu esi ēkas inženieris. Atbildi īsi.\n";
	writeFileSync(src, "﻿" + text, "utf8"); // an editor's byte order mark is not part of the role
	h["agents.role.set"]("aa", "veca loma");
	assert.deepEqual(h["agents.role.import"]("aa", src), { chars: text.length });
	assert.equal(h["agents.role.get"]("aa"), text);
	const kept = readdirSync(join(roleDir(dir), "versions")).map((f) => readFileSync(join(roleDir(dir), "versions", f), "utf8"));
	assert.ok(kept.includes("veca loma"));
	assert.equal(settings.agentSpecs().shipped, true, "importing saves no spec");
	// the spec save is what sets roleFile
	const spec = { ...old, id: "aa", prompt: "", roleFile: true };
	assert.equal(h["agents.save"]([spec])[0].roleFile, true);
});

test("13.5 agents.role.import: over ROLE_MAX, not .md, not UTF-8, missing, or a bad id are refused and change nothing", async () => {
	const { h } = await pageHandlers();
	const d = tmp();
	h["agents.role.set"]("aa", "paliek");
	const big = join(d, "liela.md");
	writeFileSync(big, "x".repeat(ROLE_MAX + 1), "utf8");
	assert.throws(() => h["agents.role.import"]("aa", big), /16000|16 000/);
	const exactly = join(d, "tieši.md");
	writeFileSync(exactly, "x".repeat(ROLE_MAX), "utf8");
	assert.deepEqual(h["agents.role.import"]("aa", exactly), { chars: ROLE_MAX });
	h["agents.role.set"]("aa", "paliek");
	const exe = join(d, "loma.docx");
	writeFileSync(exe, "teksts", "utf8");
	assert.throws(() => h["agents.role.import"]("aa", exe), /\.md/);
	const bin = join(d, "bin.md");
	writeFileSync(bin, Buffer.from([0x41, 0xff, 0xfe, 0x42]));
	assert.throws(() => h["agents.role.import"]("aa", bin), /UTF-8/);
	assert.throws(() => h["agents.role.import"]("aa", join(d, "nav.md")), /nav atrasts|nevar nolasīt/i);
	assert.throws(() => h["agents.role.import"]("../x", exactly), /Identifikators/);
	assert.equal(h["agents.role.get"]("aa"), "paliek");
});

test("13.5 agents.shared.get / set: empty without a file, 6 000 characters, the replaced text kept", async () => {
	const { dir, h } = await pageHandlers();
	assert.equal(h["agents.shared.get"](), "");
	h["agents.shared.set"]("Rakstām latviski.");
	h["agents.shared.set"]("Rakstām īsi.");
	assert.equal(h["agents.shared.get"](), "Rakstām īsi.");
	assert.equal(readShared(dir), "Rakstām īsi.");
	assert.throws(() => h["agents.shared.set"]("x".repeat(SHARED_MAX + 1)), /6000|6 000/);
	assert.equal(h["agents.shared.get"](), "Rakstām īsi.");
	const kept = readdirSync(join(roleDir(dir), "versions")).filter((f) => f.startsWith("_kopejie."));
	assert.ok(kept.some((f) => readFileSync(join(roleDir(dir), "versions", f), "utf8") === "Rakstām latviski."));
});

test("13.5 agents.list tools: confirm-level tools are listed with their level (the page filters by the agent's maxLevel); never and main-process tools stay out", async () => {
	const { h } = await pageHandlers();
	const rows = h["agents.list"]().tools;
	const byName = new Map(rows.map((r) => [r.name, r]));
	assert.equal(byName.get(confirmTool)?.level, "confirm");
	assert.ok(rows.some((r) => r.level === "run"), "run tools are still there");
	assert.ok(rows.every((r) => r.level !== "never" && r.level !== "read"));
	for (const n of ["delete_element", "send_code_to_revit", "delegate", "run_subagent", "send_message"]) assert.ok(!byName.has(n), n);
	// every row the page may show ticked under maxLevel confirm validates with maxLevel confirm; under run only the run rows do
	for (const r of rows) {
		assert.ok(validateSpec({ ...old, tools: [r.name], maxLevel: "confirm" }, levelOf, known).ok, r.name);
		assert.equal(validateSpec({ ...old, tools: [r.name] }, levelOf, known).ok, r.level !== "confirm", r.name);
	}
});
