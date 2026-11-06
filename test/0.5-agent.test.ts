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
import { tmp } from "./helpers.ts";

const levelOf = makeLevelOf({ get_focus: "read", set_fact: "propose", create_level: "confirm", create_grid: "confirm", delete_element: "confirm" });

const msg = (...tools: string[]) => ({ role: "assistant", content: tools.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: { i } })) }) as never;
const call = (m: unknown, name: string) => ({ assistantMessage: m, toolCall: { type: "toolCall", id: "x", name, arguments: {} }, args: {}, context: {} }) as never;

test("levels: never and unknown tools are not offered; delete and send_code are never whatever a table says", () => {
	assert.deepEqual(offered(["get_focus", "create_level", "delete_element", "send_code_to_revit", "made_up"], levelOf), ["get_focus", "create_level"]);
});

test("gate: a never tool is blocked even if a model names it", async () => {
	const g = new Gate(levelOf, async () => true);
	assert.equal((await g.before(call(msg("delete_element"), "delete_element")))?.block, true);
	assert.equal(await g.before(call(msg("get_focus"), "get_focus")), undefined);
});

test("gate: a confirm tool waits for Boris, once per batch", async () => {
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
