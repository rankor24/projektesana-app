// 0.5 agent harness: approval levels and the per-batch gate, the real tools server over stdio, sign-in state.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { focusText } from "../src/agent/focus.ts";
import { AgentSession } from "../src/agent/session.ts";
import { ctxEnv } from "../src/agent/tools/context.ts";
import { Gate, makeLevelOf, offered, type ConfirmRequest } from "../src/agent/tools/levels.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { z } from "zod";
import { allTools } from "../src/agent/tools/defs.ts";
import { mailDeclarations } from "../src/agent/mail.ts";
import { subagentDeclarations } from "../src/agent/subagents.ts";
import { tmp } from "./helpers.ts";

const levelOf = makeLevelOf({ get_focus: "read", set_fact: "propose", create_level: "confirm", create_grid: "confirm", delete_element: "confirm", send_code_to_revit: "confirm" });

const msg = (...tools: string[]) => ({ role: "assistant", content: tools.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: { i } })) }) as never;
const call = (m: unknown, name: string) => ({ assistantMessage: m, toolCall: { type: "toolCall", id: "x", name, arguments: {} }, args: {}, context: {} }) as never;

test("levels: never and unknown tools are not offered; send_code_to_revit is never whatever a table says; delete_element waits for the user like any change (2.14.4)", () => {
	assert.deepEqual(offered(["get_focus", "create_level", "delete_element", "send_code_to_revit", "made_up"], levelOf), ["get_focus", "create_level", "delete_element"]);
});

test("gate: a never tool is blocked even if a model names it", async () => {
	const g = new Gate(levelOf, async () => true);
	assert.equal((await g.before(call(msg("send_code_to_revit"), "send_code_to_revit")))?.block, true);
	assert.equal(await g.before(call(msg("get_focus"), "get_focus")), undefined);
});

test("gate: a confirm tool waits for the user, once per batch", async () => {
	const asked: ConfirmRequest[] = [];
	let release!: (ok: boolean) => void;
	const g = new Gate(levelOf, (r) => {
		asked.push(r);
		return new Promise((res) => (release = res));
	});
	const m = msg("create_level", "get_focus", "create_grid");
	let done = false;
	const first = g.before(call(m, "create_level")).then((r) => ((done = true), r));
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(done, false, "waits");
	assert.deepEqual(asked[0].batch.map((b) => b.tool), ["create_level", "create_grid"]);
	release(true);
	assert.equal(await first, undefined);
	assert.equal(await g.before(call(m, "create_grid")), undefined);
	assert.equal(asked.length, 1, "asked once for the batch");
});

test("gate: a refused batch blocks every confirm call in it; the next message asks again", async () => {
	let n = 0;
	const g = new Gate(levelOf, async () => (++n, false));
	const m = msg("create_level", "create_grid");
	assert.equal((await g.before(call(m, "create_level")))?.block, true);
	assert.equal((await g.before(call(m, "create_grid")))?.block, true);
	assert.equal(n, 1);
	await g.before(call(msg("create_level"), "create_level"));
	assert.equal(n, 2);
});

test("tools server: lists only offered tools and serves the Fokuss", async () => {
	const runDir = tmp();
	const env = ctxEnv({ projectsDir: tmp(), projectId: null, dataDir: join(import.meta.dirname, "..", "data"), appDir: tmp(), runDir });
	const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", join(import.meta.dirname, "..", "src", "agent", "tools", "server.ts")], env: { ...(process.env as Record<string, string>), ...env } });
	const client = new Client({ name: "test", version: "1" });
	await client.connect(transport);
	try {
		const { tools } = await client.listTools();
		assert.ok(tools.some((t) => t.name === "get_focus"));
		const text = async () => ((await client.callTool({ name: "get_focus", arguments: {} })) as { content: { text: string }[] }).content[0].text;
		assert.equal(await text(), "Fokuss: nekas");
		writeFileSync(join(runDir, "focus.json"), JSON.stringify([{ kind: "source", id: "s1", label: "PU.pdf" }]));
		assert.equal(await text(), focusText([{ kind: "source", id: "s1", label: "PU.pdf" }]));
	} finally {
		await client.close();
	}
});

test("session: without a credential the status is nav pieslēgts", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => {},
	});
	const st = await s.status();
	assert.equal(st.provider, "openai-codex");
	assert.equal(st.signedIn, false);
	assert.equal(st.reason, "nav pieslēgts");
	assert.equal(st.revit, "nav konfigurēts");
});

test("gate: operate_element with Delete waits for the user like any change of the model (2.14.4); declined, it is blocked", async () => {
	const lv = makeLevelOf({ operate_element: "confirm" });
	const asked: ConfirmRequest[] = [];
	const g = new Gate(lv, async (r) => (asked.push(r), true));
	const m = { role: "assistant", content: [{ type: "toolCall", id: "a", name: "operate_element", arguments: {} }] } as never;
	const del = { assistantMessage: m, toolCall: { type: "toolCall", id: "a", name: "operate_element", arguments: { data: { action: "Delete", elementIds: [1] } } }, args: { data: { action: "Delete", elementIds: [1] } }, context: {} } as never;
	const sel = { assistantMessage: m, toolCall: { type: "toolCall", id: "a", name: "operate_element", arguments: { data: { action: "Select", elementIds: [1] } } }, args: { data: { action: "Select", elementIds: [1] } }, context: {} } as never;
	assert.equal(await g.before(del), undefined);
	assert.equal(asked.length, 1, "the user was asked");
	assert.equal(await g.before(sel), undefined);
	const no = new Gate(lv, async () => false);
	assert.equal((await no.before(del))?.block, true);
});

test("every tool the agent is sent has parameter names the providers accept (Claude: ^[a-zA-Z0-9_.-]{1,64}$; \"daļa\" failed every run)", () => {
	const ok = /^[a-zA-Z0-9_.-]{1,64}$/;
	const bad: string[] = [];
	const walk = (s: unknown, at: string): void => {
		if (!s || typeof s !== "object") return;
		if (Array.isArray(s)) return s.forEach((x, i) => walk(x, `${at}[${i}]`));
		const o = s as Record<string, unknown>;
		if (o.properties && typeof o.properties === "object") for (const k of Object.keys(o.properties)) if (!ok.test(k)) bad.push(`${at}: ${k}`);
		for (const [k, v] of Object.entries(o)) walk(v, `${at}.${k}`);
	};
	for (const t of allTools()) walk(z.toJSONSchema(z.object(t.input)), t.name);
	for (const d of [...mailDeclarations(), ...subagentDeclarations()]) walk(d.parameters, d.name);
	assert.deepEqual(bad, []);
	for (const t of allTools()) assert.ok(ok.test(t.name), `tool name ${t.name}`);
});
