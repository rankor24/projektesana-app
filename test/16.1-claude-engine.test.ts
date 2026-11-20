// 16.1 Claude subscription engine (Agent SDK beside pi): the SDK's messages as RunEvents, the environment claude.exe gets, the
// one in-process tool server, the confirm batches, and ThreadRunner choosing the engine and resuming the SDK session.
// Nothing here starts claude.exe or reaches the network: the engine itself is scripted in the ThreadRunner tests.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { claudeEvents, newClaudeState, toolNameOf } from "../src/agent/claude/events.ts";
import { catalogProvider, claudeEffort, CLAUDE_SUB, NOT_CONNECTED } from "../src/agent/claude/provider.ts";
import { Batches, claudeEnv, type ClaudeRunOptions } from "../src/agent/claude/run.ts";
import { toolServer } from "../src/agent/claude/tools.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { ThreadRunner } from "../src/agent/thread-runner.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { LEAD_ID, type Thread } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const M = (m: unknown) => m as SDKMessage;
const run = (msgs: unknown[], maxTurns = 80) => {
	const st = newClaudeState(maxTurns);
	return msgs.flatMap((m) => claudeEvents(M(m), st));
};
const stream = (event: unknown) => ({ type: "stream_event", parent_tool_use_id: null, uuid: "u", session_id: "s1", event });

test("16.1 SDK messages become the RunEvents pi gives: streamed text once, tool, result, usage, retry, done", () => {
	const ev = run([
		{ type: "system", subtype: "init", session_id: "s1", tools: [], mcp_servers: [], model: "claude-sonnet-5-5" },
		stream({ type: "message_start", message: { id: "m1", usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 } } }),
		stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "domāju" } }),
		stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Sve" } }),
		stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "iki" } }),
		{ type: "assistant", parent_tool_use_id: null, session_id: "s1", message: { id: "m1", content: [{ type: "thinking", thinking: "domāju" }, { type: "text", text: "Sveiki" }] } },
		{ type: "assistant", parent_tool_use_id: null, session_id: "s1", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__app__read_doc", input: { id: "x" } }] } },
		stream({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }),
		{ type: "user", parent_tool_use_id: null, session_id: "s1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "saturs" }] }] } },
		// an SDK sub-agent's traffic is not this run's
		{ type: "assistant", parent_tool_use_id: "t9", session_id: "s1", message: { id: "m9", content: [{ type: "text", text: "cits" }] } },
		{ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 500, error: "overloaded", error_status: 529, session_id: "s1" },
		{ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 150000, post_tokens: 30000 }, session_id: "s1" },
		{ type: "result", subtype: "success", is_error: false, result: "Gatavs", session_id: "s1" },
	]);
	assert.deepEqual(ev, [
		{ type: "turn", n: 1 },
		{ type: "thinking", text: "domāju" },
		{ type: "text", text: "Sve" },
		{ type: "text", text: "iki" },
		{ type: "tool", name: "read_doc", id: "t1", detail: '{"id":"x"}' },
		{ type: "usage", input: 100, output: 7, cacheRead: 20, cacheWrite: 5, cost: null },
		{ type: "tool_result", name: "read_doc", id: "t1", ok: true, detail: undefined, output: "saturs", chars: 6 },
		{ type: "retry", attempt: 1, of: 10, delayMs: 500, message: "overloaded" },
		{ type: "compact", phase: "done", before: 150000, after: 30000 },
		{ type: "done", text: "Gatavs" },
	]);
});

test("16.1 a non-streamed answer is shown from the assistant message; a failed tool is not ok", () => {
	const ev = run([
		{ type: "assistant", parent_tool_use_id: null, session_id: "s", message: { id: "m1", content: [{ type: "text", text: "Viss" }, { type: "tool_use", id: "t1", name: "mcp__app__write_fact", input: {} }] } },
		{ type: "user", parent_tool_use_id: null, session_id: "s", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "Lietotājs šo partiju noraidīja." }] } },
		{ type: "result", subtype: "success", is_error: false, result: "", session_id: "s" },
	]);
	assert.deepEqual(ev[0], { type: "text", text: "Viss" });
	assert.deepEqual(ev[2], { type: "tool_result", name: "write_fact", id: "t1", ok: false, detail: "Lietotājs šo partiju noraidīja.", output: "Lietotājs šo partiju noraidīja.", chars: 31 });
	assert.deepEqual(ev.at(-1), { type: "done", text: "Viss" }, "an empty result falls back to the last assistant text");
});

test("16.1 errors: the SDK's own text once, the turn limit in the app's words, never a done after them", () => {
	const auth = run([
		{ type: "assistant", parent_tool_use_id: null, error: "authentication_failed", session_id: "s", message: { id: "m1", content: [{ type: "text", text: "Invalid bearer token" }] } },
		{ type: "result", subtype: "success", is_error: true, result: "Invalid bearer token", session_id: "s" },
	]);
	assert.deepEqual(auth.filter((e) => e.type === "error"), [{ type: "error", engine: "pi", message: "Invalid bearer token" }]);
	assert.ok(!auth.some((e) => e.type === "done"));
	assert.deepEqual(run([{ type: "result", subtype: "error_max_turns", is_error: true, errors: [], session_id: "s" }], 40), [{ type: "error", engine: "pi", message: "Sasniegts soļu limits (40)." }]);
	assert.deepEqual(run([{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["a", "b"], session_id: "s" }]), [{ type: "error", engine: "pi", message: "a\nb" }]);
});

test("16.1 names, catalog and effort: the app's tool names, Claude's catalog, only the SDK's effort levels", () => {
	assert.equal(toolNameOf("mcp__app__revit_set"), "revit_set");
	assert.equal(toolNameOf("Bash"), "Bash");
	assert.equal(catalogProvider(CLAUDE_SUB), "anthropic");
	assert.equal(catalogProvider("xai"), "xai");
	assert.equal(claudeEffort("high"), "high");
	assert.equal(claudeEffort("off"), undefined);
	assert.equal(claudeEffort("minimal"), undefined);
});

test("16.1 claude.exe gets the user's token and the app's config folder; no key or endpoint from the environment", () => {
	const env = claudeEnv("tok", { configDir: "C:\\app\\claude-code", clientApp: "projektesana/2.5.0" }, { PATH: "p", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "u", CLAUDE_CODE_USE_BEDROCK: "1" });
	assert.equal(env.PATH, "p");
	assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "tok");
	assert.equal(env.CLAUDE_CONFIG_DIR, "C:\\app\\claude-code");
	assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, "projektesana/2.5.0");
	for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK"]) assert.ok(!(k in env), k);
});

test("16.1 the tool bridge lists JSON-Schema tools, validates arguments, and runs with the id the gate saw", async () => {
	const seen: { id: string; args: unknown }[] = [];
	const tool: AgentTool<any> = {
		name: "write_note",
		label: "write_note",
		description: "Ieraksta piezīmi",
		parameters: Type.Object({ title: Type.String(), n: Type.Optional(Type.Number()) }),
		execute: async (id, args) => (seen.push({ id, args }), { content: [{ type: "text", text: "ok" }], details: {} }),
	};
	const ids = ["toolu_1"];
	const b = toolServer("app", [tool], () => ids.shift() ?? "none", new AbortController().signal);
	const [a, s] = InMemoryTransport.createLinkedPair();
	await b.server.connect(s);
	const client = new Client({ name: "t", version: "1" });
	await client.connect(a);
	const listed = await client.listTools();
	assert.equal(listed.tools[0].name, "write_note");
	assert.deepEqual(Object.keys(listed.tools[0].inputSchema.properties ?? {}), ["title", "n"]);
	assert.equal(listed.tools[0]._meta?.["anthropic/alwaysLoad"], true);
	const bad = await client.callTool({ name: "write_note", arguments: { n: 1 } });
	assert.equal(bad.isError, true, "a missing required field is refused before the tool runs");
	assert.equal(seen.length, 0);
	const good = await client.callTool({ name: "write_note", arguments: { title: "Lēmums" } });
	assert.equal(good.isError, false);
	assert.deepEqual(seen, [{ id: "none", args: { title: "Lēmums" } }]);
	const missing = await client.callTool({ name: "nav", arguments: {} });
	assert.equal(missing.isError, true);
	await client.close();
});

test("16.1 confirm batches: the tools a message holds at the first ask go together; a later one is asked about on its own", () => {
	const b = new Batches();
	const blk = (id: string, name: string) => ({ type: "toolCall" as const, id, name, arguments: {} });
	b.add("m1", blk("a", "revit_set"));
	b.add("m1", blk("b", "revit_set"));
	const first = b.messageFor("a", blk("a", "revit_set")) as { content: { id: string }[] };
	assert.deepEqual(first.content.map((c) => c.id), ["a", "b"]);
	assert.equal(b.messageFor("b", blk("b", "revit_set")), first, "b was in the batch the user answered");
	// the model's message brought a third call after the user had answered
	b.add("m1", blk("c", "revit_set"));
	const later = b.messageFor("c", blk("c", "revit_set")) as { content: { id: string }[] };
	assert.notEqual(later, first, "never runs on an answer given before the user saw it");
	assert.deepEqual(later.content.map((c) => c.id), ["c"]);
	// a call whose message was not seen: a batch of one
	assert.deepEqual((b.messageFor("z", blk("z", "x")) as { content: { id: string }[] }).content.map((c) => c.id), ["z"]);
});

function rig(claudeRun: ((o: ClaudeRunOptions) => Promise<void>) | undefined) {
	const dir = tmp();
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const store = new ThreadStore(join(dir, "threads"));
	const piCalls: PiRunOptions[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, provider: CLAUDE_SUB }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (o) => void piCalls.push(o),
		claudeRun,
		threads: () => store,
		locks: new LockRegistry(),
	});
	let n = 0;
	const events: RunEvent[] = [];
	const go = (thread: Thread, text: string) =>
		runner.run({ runId: `r${++n}`, thread, spec: null, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => events.push(e), ask: async () => true });
	return { store, runner, go, piCalls, events };
}

test("16.1 ThreadRunner: a Claude subscription runs on the SDK engine, resumes its session, and never touches pi", async () => {
	const calls: ClaudeRunOptions[] = [];
	const t = rig(async (o) => {
		calls.push(o);
		o.onSession?.("sess-1");
		o.onEvent({ type: "usage", input: 1000, output: 50, cacheRead: 200, cacheWrite: 0, cost: null });
		o.onEvent({ type: "done", text: `atbilde ${calls.length}` });
	});
	const th = t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" });
	const r1 = await t.go(th, "pirmais");
	assert.deepEqual(r1, { ok: true, answer: "atbilde 1", confirmedBatches: 0 });
	assert.equal(calls[0].resume, undefined, "a new thread starts a new session");
	assert.equal(calls[0].provider, CLAUDE_SUB);
	assert.ok(calls[0].mcp["projektesana-tools"], "the same tool servers pi gets");
	await t.go(th, "otrais");
	assert.equal(calls[1].resume, "sess-1", "the next turn continues the SDK session");
	assert.equal(t.piCalls.length, 0);
	const ctx = await t.runner.context(th);
	assert.equal(ctx.used, 1250, "the context meter shows the session's size from the SDK's usage");
	assert.equal(ctx.source, "usage");
	await assert.rejects(t.runner.compactNow(th), /saspiež pats/);
	t.runner.reset(th.id);
	await t.go(th, "trešais");
	assert.equal(calls[2].resume, undefined, "a reset thread starts over");
});

test("16.1 ThreadRunner: without the engine the run fails with the sign-in hint, not on pi", async () => {
	const t = rig(undefined);
	const th = t.store.create({ projectId: null, agent: LEAD_ID, title: "A", startedBy: "user" });
	const r = await t.go(th, "sveiki");
	assert.equal(r.ok, false);
	assert.ok(t.events.some((e) => e.type === "error" && e.message === NOT_CONNECTED));
	assert.equal(t.piCalls.length, 0);
});
