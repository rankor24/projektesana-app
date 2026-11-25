// Antigravity engine (src/agent/antigravity): the sign-in link and redirect checks, the profile's environment, the ACP updates as run events, the permission
// answers, the model catalog, the tool bridge with its stdio relay, and a whole run against a stand-in for Google's server (test/fixtures/fake-antigravity.mjs).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RunEvent } from "../src/shared/types.ts";
import {
	ANTIGRAVITY_AUTH_PREFIX,
	antigravityClientInfo,
	antigravitySessionSetup,
	authorizationUrlFromLine,
	catalogFromSession,
	isValidAntigravityInitializeResult,
	parseAntigravityAuthorizationUrl,
	prepareAntigravityProfile,
	processIsAlive,
	sweepAntigravityTemp,
	unpackFolderOwnerPids,
	validateAntigravityCallbackUrl,
} from "../src/agent/antigravity/acp.ts";
import { startToolBridge } from "../src/agent/antigravity/bridge.ts";
import { antigravityContext, antigravityEnd, antigravityEvents, antigravitySignInError, antigravityToolEnded, antigravityToolStarted, antigravityUsage, cleanAntigravityTextStart, newAntigravityState, ownToolRequest, permissionOption } from "../src/agent/antigravity/events.ts";
import { AntigravityHost } from "../src/agent/antigravity/host.ts";
import { resolveAntigravityReleaseAsset } from "../src/agent/antigravity/release.ts";
import { antigravityPrompt, createAntigravityRun, relayEnv } from "../src/agent/antigravity/run.ts";
import { lookupAgentModel } from "../src/agent/agent-model.ts";
import { catalogProvider } from "../src/agent/claude/provider.ts";
import { createPiRuntime, lookupPiModel } from "../src/agent/pi/models.ts";
import { checkerProvider, isKnownProvider } from "../src/agent/failover/plan.ts";
import { FIX, tmp } from "./helpers.ts";

const GOOD_URL = "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&state=abc123&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2F";

test("sign-in link: only Google's own authorization page with a loopback redirect", () => {
	assert.equal(authorizationUrlFromLine(`${ANTIGRAVITY_AUTH_PREFIX}${GOOD_URL}`), GOOD_URL);
	assert.equal(authorizationUrlFromLine("some other stderr line"), null);
	const marked = `__PROJEKTESANA_ANTIGRAVITY_AUTH_URL__${JSON.stringify(GOOD_URL)}`;
	assert.equal(authorizationUrlFromLine(marked), GOOD_URL);
	const parsed = parseAntigravityAuthorizationUrl(GOOD_URL);
	assert.deepEqual({ redirectUri: parsed.redirectUri, state: parsed.state }, { redirectUri: "http://127.0.0.1:43111/", state: "abc123" });
	for (const bad of [
		GOOD_URL.replace("accounts.google.com", "accounts.google.com.evil.example"),
		GOOD_URL.replace("https:", "http:"),
		GOOD_URL.replace("response_type=code", "response_type=token"),
		GOOD_URL.replace("43111", "80"),
		GOOD_URL.replace("127.0.0.1", "10.0.0.5"),
		`${GOOD_URL}#frag`,
		`${GOOD_URL}&state=two`,
		"https://user:pw@accounts.google.com/o/oauth2/v2/auth?state=a&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A43111%2F",
	]) assert.throws(() => parseAntigravityAuthorizationUrl(bad), /invalid Google sign-in URL/, bad);
});

test("pasted redirect: it must be this sign-in's own (state, port, one code or one error)", () => {
	const pending = { redirectUri: "http://127.0.0.1:43111/", state: "abc123" };
	assert.equal(validateAntigravityCallbackUrl(pending, "http://127.0.0.1:43111/?state=abc123&code=4%2Fxyz").searchParams.get("code"), "4/xyz");
	assert.equal(validateAntigravityCallbackUrl(pending, "http://127.0.0.1:43111/?state=abc123&error=access_denied").searchParams.get("error"), "access_denied");
	for (const bad of ["not a url", "http://127.0.0.1:43111/?state=other&code=1", "http://127.0.0.1:43112/?state=abc123&code=1", "http://localhost:43111/?state=abc123&code=1", "http://127.0.0.1:43111/?state=abc123", "http://127.0.0.1:43111/?state=abc123&code=1&error=x", "http://127.0.0.1:43111/?state=abc123&code=1&iss=https%3A%2F%2Fevil.example"])
		assert.throws(() => validateAntigravityCallbackUrl(pending, bad), bad);
});

test("the profile: an own Google folder, foreign Google credentials and keys stripped, TEMP in the app's folder", async () => {
	const root = tmp("agy-profile-");
	const base = { GEMINI_API_KEY: "k", GOOGLE_API_KEY: "k", GOOGLE_APPLICATION_CREDENTIALS: "c", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GEMINI_HOME: "elsewhere", Temp: "C:\\Windows\\Temp", PATH: "C:\\x", KEEP_ME: "1" } as NodeJS.ProcessEnv;
	const profile = await prepareAntigravityProfile({ profileDirectory: join(root, "profile"), tempDirectory: join(root, "tmp"), runtime: { executablePath: "agy.exe", harnessPath: "C:\\h\\localharness_external.exe", version: "1.4.3" }, baseEnv: base, nodePath: "C:\\Program Files\\App\\App.exe" });
	const env = profile.environment;
	for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) assert.equal(env[k], undefined, k);
	assert.equal(env.KEEP_ME, "1");
	assert.equal(env.GEMINI_HOME, join(root, "profile"));
	assert.equal(env.ANTIGRAVITY_HARNESS_PATH, "C:\\h\\localharness_external.exe");
	assert.equal(env.AGY_ACP_FORCE_FILE_STORAGE, "1");
	assert.equal(env.TEMP, join(root, "tmp"));
	assert.equal(env.TMP, join(root, "tmp"));
	assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === "TEMP").length, 1, "an inherited `Temp` does not stay beside TEMP");
	assert.match(env.BROWSER ?? "", /^'C:\/Program Files\/App\/App\.exe' '-e' '.+' '--' '%s'$/s, "the browser stand-in is the app's own node");
	assert.deepEqual(JSON.parse(readFileSync(join(root, "profile", "antigravity-acp", "settings.json"), "utf8")), { auth: { type: "oauth-personal" } });
	assert.equal(profile.tokenPath, join(root, "profile", "antigravity-acp", "acp_token.json"));
});

test("unpack leftovers: the owner's pid is read from the folder name, a live owner's folder stays", async () => {
	assert.deepEqual(unpackFolderOwnerPids("_MEI00001a2b3"), [0x1a2b]);
	assert.deepEqual(unpackFolderOwnerPids("_MEI12345"), [1234, 123, 12]);
	assert.equal(unpackFolderOwnerPids("something"), null);
	assert.equal(processIsAlive(process.pid), true);
	const dir = tmp("agy-sweep-");
	const dead = join(dir, "_MEI0000ffff1");
	const live = join(dir, `_MEI${process.pid.toString(16).padStart(8, "0")}1`);
	const other = join(dir, "keep-me");
	for (const d of [dead, live, other]) mkdirSync(d);
	const removed = await sweepAntigravityTemp(dir, (pid) => pid === process.pid);
	assert.equal(removed, 1);
	assert.equal(existsSync(dead), false);
	assert.equal(existsSync(live), true);
	assert.equal(existsSync(other), true);
});

test("the release is pinned for Windows and the client is named for its version", () => {
	const a = resolveAntigravityReleaseAsset("win32", "x64");
	assert.ok(a && /^https:\/\/dl\.google\.com\//.test(a.url) && /^[0-9a-f]{64}$/.test(a.sha256));
	assert.equal(resolveAntigravityReleaseAsset("linux", "x64"), null);
	assert.equal(antigravityClientInfo("1.4.3").name, "zed", "before 1.5.1 a runtime offers some models only to clients it knows");
	assert.equal(antigravityClientInfo("1.5.1").name, "projektesana");
	assert.deepEqual(antigravitySessionSetup({ agentInfo: { version: "1.4.3" } }, true), { _meta: { antigravity: { disabledTools: ["run_workflow"] } } });
	assert.deepEqual(antigravitySessionSetup({ agentInfo: { version: "1.5.1" } }, true), {});
	assert.ok(antigravitySessionSetup({ agentInfo: { version: "1.4.3" } })._meta?.antigravity.disabledTools.includes("run_workflow"), "the full setup holds it too");
	const init = { protocolVersion: 1, agentInfo: { name: "antigravity-acp", version: "1.4.3" }, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, auth: { logout: {} } }, authMethods: [{ id: "oauth-personal" }] };
	assert.equal(isValidAntigravityInitializeResult(init, "1.4.3"), true);
	assert.equal(isValidAntigravityInitializeResult({ ...init, agentInfo: { name: "something-else", version: "1.4.3" } }, "1.4.3"), false);
	assert.equal(isValidAntigravityInitializeResult(init, "1.4.4"), false);
});

test("run events: text with the server's escape tokens cleaned, a turn per response, the answer is the text after the last tool", () => {
	assert.equal(cleanAntigravityTextStart("&_a_m_p_;_ Sveiki"), "Sveiki");
	const st = newAntigravityState();
	const out: RunEvent[] = [];
	const feed = (u: Record<string, unknown>) => out.push(...antigravityEvents(u, st));
	feed({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "domāju" } });
	feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Paskatīšos. " } });
	out.push(...antigravityToolStarted(st));
	antigravityToolEnded(st);
	feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "&_a_m_p_;_" } });
	feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "&_a_m_p_;_Gatavs." } });
	feed({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " Viss." } });
	feed({ sessionUpdate: "tool_call", toolCallId: "x", title: "mcp__app__t" });
	feed({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "AAA" } });
	assert.deepEqual(out.map((e) => e.type), ["turn", "thinking", "text", "turn", "text", "text"]);
	assert.deepEqual(out.filter((e) => e.type === "text").map((e) => (e as { text: string }).text), ["Paskatīšos. ", "Gatavs.", " Viss."]);
	assert.deepEqual(antigravityEnd({ stopReason: "end_turn" }, st, false), [{ type: "done", text: "Gatavs. Viss." }]);
	// a run that ended right after a tool answers with what was said
	const s2 = newAntigravityState();
	antigravityEvents({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Tikai teksts" } }, s2);
	antigravityToolStarted(s2);
	assert.deepEqual(antigravityEnd({ stopReason: "end_turn" }, s2, false), [{ type: "done", text: "Tikai teksts" }]);
});

test("the end of a prompt: a stop, a refusal and a limit are errors, never a done; usage only when the server says", () => {
	const err = (r: string, aborted = false) => antigravityEnd({ stopReason: r }, newAntigravityState(), aborted);
	assert.deepEqual(err("cancelled"), [{ type: "error", engine: "pi", message: "aborted" }]);
	assert.deepEqual(err("end_turn", true), [{ type: "error", engine: "pi", message: "aborted" }]);
	assert.equal(err("refusal")[0].type, "error");
	assert.equal(err("max_tokens")[0].type, "error");
	assert.equal(antigravityUsage({}), null);
	// the context size of the session is the server's own `usage_update`; the turn's usage is a sum over its model calls and is never read as the size
	assert.deepEqual(antigravityContext({ sessionUpdate: "usage_update", used: 118000, size: 262144 }), { used: 118000, window: 262144 });
	assert.deepEqual(antigravityContext({ sessionUpdate: "usage_update", used: 5 }), { used: 5 });
	assert.equal(antigravityContext({ sessionUpdate: "usage_update", used: 0, size: 1000 }), null);
	assert.equal(antigravityContext({ sessionUpdate: "agent_message_chunk", used: 5 }), null);
	assert.deepEqual(antigravityUsage({ usage: { inputTokens: 700000, outputTokens: 3000, cachedReadTokens: 480000 } }, { used: 118000, window: 262144 }), { type: "usage", input: 700000, output: 3000, cacheRead: 480000, cacheWrite: 0, cost: null, context: { used: 118000, window: 262144 } });
	assert.deepEqual(antigravityUsage({}, { used: 9 }), { type: "usage", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, context: { used: 9 } }, "a context size without counts still reaches the meter");
	assert.deepEqual(antigravityUsage({ usage: { inputTokens: 12, outputTokens: 3, cachedReadTokens: 4 } }), { type: "usage", input: 12, output: 3, cacheRead: 4, cacheWrite: 0, cost: null });
	assert.equal(antigravitySignInError({ code: -32000, message: "Authentication required" }), true);
	assert.equal(antigravitySignInError({ code: -32000, message: "Model overloaded" }), false);
	assert.equal(antigravitySignInError({ code: -32603, message: "Authentication required" }), false);
});

test("permission: only the run's own tools are allowed, the server's own (shell, edit) are refused", () => {
	const offered = new Set(["echo_tool", "view_page"]);
	assert.equal(ownToolRequest({ title: "mcp__app__echo_tool", kind: "other" }, "app", offered), "echo_tool");
	assert.equal(ownToolRequest({ title: "app.view_page", kind: "other" }, "app", offered), "view_page");
	assert.equal(ownToolRequest({ title: "echo_tool", kind: "other" }, "app", offered), "echo_tool");
	assert.equal(ownToolRequest({ title: "mcp__app__delete_everything", kind: "other" }, "app", offered), null, "a tool the run was not given");
	assert.equal(ownToolRequest({ title: "mcp__other__echo_tool", kind: "other" }, "app", offered), null, "another server's tool of the same name");
	assert.equal(ownToolRequest({ title: "echo_tool", kind: "execute" }, "app", offered), null, "a shell command is never a tool of ours");
	assert.equal(ownToolRequest({ title: "rm -rf x", kind: "execute" }, "app", offered), null);
	const options = [{ optionId: "a", kind: "allow_always" }, { optionId: "b", kind: "allow_once" }, { optionId: "c", kind: "reject_once" }];
	assert.equal(permissionOption(options, "allow"), "b");
	assert.equal(permissionOption(options, "reject"), "c");
	assert.equal(permissionOption([{ optionId: "a", kind: "allow_always" }], "reject"), null);
});

test("model catalog: the models, the current one as default, the thinking levels of the current model", () => {
	const session = { sessionId: "s", configOptions: [
		{ id: "model", type: "select", currentValue: "gem-b", options: [{ value: "gem-a", name: "Gem A" }, { name: "Group", options: [{ value: "gem-b", name: " Gem B " }] }] },
		{ id: "thought_level", type: "select", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
	] };
	assert.deepEqual(catalogFromSession(session), { default: "gem-b", models: [{ id: "gem-a", name: "Gem A", variants: [] }, { id: "gem-b", name: "Gem B", variants: [{ id: "low", name: "Low" }, { id: "high", name: "High" }] }] });
	assert.equal(catalogFromSession({ configOptions: [] }), null);
});

test("the provider is known to the settings and the failover; its models are described by Gemini's catalog", () => {
	assert.equal(isKnownProvider("antigravity"), true);
	assert.equal(catalogProvider("antigravity"), "google");
	assert.equal(checkerProvider(["antigravity", "xai"], ["openai-codex"]), "antigravity", "ranked before xai");
});

test("a model id only Google's server knows is not an \"Unknown model\" (it was routed to the plain google provider's registry)", () => {
	const rt = createPiRuntime({ path: join(tmp(), "pi.json"), apiKey: () => null });
	// the plain Gemini provider still refuses an id that is in neither pi's catalog nor its live list
	assert.throws(() => lookupPiModel(rt, "google", "gemini-4-neon"), /Unknown model "gemini-4-neon" for provider "google"/);
	// Antigravity names its own models: the id stays the server's, the window and image support come from Gemini's catalog
	const m = lookupAgentModel(rt, "antigravity", "gemini-4-neon");
	assert.equal(m.id, "gemini-4-neon");
	assert.ok(m.contextWindow > 0 && m.input.includes("image"));
	// a model pi does know keeps its own facts; no model named = the catalog's default, as before
	assert.equal(lookupAgentModel(rt, "antigravity", "gemini-pro-latest").id, "gemini-pro-latest");
	assert.ok(lookupAgentModel(rt, "antigravity", "").id);
	// the other engines are unchanged: Claude's subscription reads the anthropic catalog, and an unknown id there is still refused
	assert.equal(lookupAgentModel(rt, "claude-sub", "claude-sonnet-5-5").id, "claude-sonnet-5-5");
	assert.throws(() => lookupAgentModel(rt, "claude-sub", "gemini-4-neon"), /Unknown model/);
	assert.throws(() => lookupAgentModel(rt, "google", "gemini-4-neon"), /Unknown model/);
});

test("the prompt: the standing instructions go with a new session only", () => {
	assert.equal(antigravityPrompt("Tu esi aģents.", "Dari.", true), "Dari.");
	assert.equal(antigravityPrompt("", "Dari.", false), "Dari.");
	assert.match(antigravityPrompt("Tu esi aģents.", "Dari.", false), /Tu esi aģents\.[\s\S]*Dari\./);
	const env = relayEnv({ url: "http://127.0.0.1:1/mcp", token: "t" }, { PATH: "p", SECRET_KEY: "s" } as NodeJS.ProcessEnv);
	assert.deepEqual(env.map((e) => e.name).sort(), ["ELECTRON_RUN_AS_NODE", "PATH", "PROJEKTESANA_BRIDGE_TOKEN", "PROJEKTESANA_BRIDGE_URL"], "nothing of the user's environment but what node needs");
});

// ---- the bridge and a whole run ----------------------------------------------------------------------------------------------------------------

const echoTool: AgentTool<any> = {
	name: "echo_tool",
	label: "echo",
	description: "Repeats a word.",
	parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } as never,
	execute: async (_id, params) => ({ content: [{ type: "text" as const, text: `echo:${(params as { word: string }).word}` }], details: {} }),
};

async function rpc(url: string, token: string, body: unknown, extra: Record<string, string> = {}) {
	const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...extra }, body: JSON.stringify(body) });
	return { status: res.status, body: res.status === 202 ? null : await res.json().catch(() => null) };
}

test("tool bridge: lists the tools, runs a call through the gate, refuses a wrong token, reports each call", async () => {
	const events: RunEvent[] = [];
	const gate: string[] = [];
	const freed: string[] = [];
	const bridge = await startToolBridge({
		tools: [echoTool],
		signal: new AbortController().signal,
		emit: (e) => events.push(e),
		beforeToolCall: async (ctx) => {
			gate.push(ctx.toolCall.name);
			return ctx.args && (ctx.args as { word: string }).word === "stop" ? { block: true, reason: "Apstiprinājums atteikts." } : undefined;
		},
		afterToolCall: async (ctx) => {
			freed.push((ctx as unknown as { toolCall: { id: string } }).toolCall.id);
			return undefined;
		},
	});
	try {
		assert.equal((await rpc(bridge.url, "wrong", { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
		const listed = await rpc(bridge.url, bridge.token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
		assert.deepEqual((listed.body as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name), ["echo_tool"]);
		const ok = await rpc(bridge.url, bridge.token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo_tool", arguments: { word: "koks" } } });
		assert.equal((ok.body as { result: { content: { text: string }[] } }).result.content[0].text, "echo:koks");
		const blocked = await rpc(bridge.url, bridge.token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo_tool", arguments: { word: "stop" } } });
		const b = (blocked.body as { result: { isError: boolean; content: { text: string }[] } }).result;
		assert.equal(b.isError, true);
		assert.equal(b.content[0].text, "Apstiprinājums atteikts.");
		assert.deepEqual(gate, ["echo_tool", "echo_tool"], "the gate asked before each call");
		assert.equal(freed.length, 2, "the lock is freed after a call that ran and after one that was refused");
		assert.deepEqual(events.map((e) => (e.type === "tool_result" ? `result:${e.ok}` : e.type)), ["tool", "result:true", "tool", "result:false"]);
	} finally {
		await bridge.close();
	}
});

const fake = join(FIX, "fake-antigravity.mjs");
const tsxUrl = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function engine(root: string, timing: { stallMs?: number; cancelWaitMs?: number } = {}) {
	process.env.FAKE_AGY_LOG = join(root, "calls.log");
	const token = join(root, "profile", "antigravity-acp");
	mkdirSync(token, { recursive: true });
	writeFileSync(join(token, "acp_token.json"), '{"refresh_token":"x"}');
	const host = new AntigravityHost({ root, runtime: async () => ({ executablePath: process.execPath, args: [fake], harnessPath: "-", version: "1.4.3" }) });
	mkdirSync(host.folders.work, { recursive: true });
	const run = createAntigravityRun({ host, nodePath: process.execPath, nodeArgs: ["--import", tsxUrl], bridgeScript: join(import.meta.dirname, "..", "src", "agent", "antigravity", "bridge-stdio.ts"), ...timing });
	const calls = () => (existsSync(join(root, "calls.log")) ? readFileSync(join(root, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
	return { host, run, calls };
}

const base = (events: RunEvent[], over: Record<string, unknown> = {}) => ({ runtime: {} as never, prompt: "Sveiki", mcp: {}, signal: new AbortController().signal, onEvent: (e: RunEvent) => events.push(e), ...over });

test("a whole run: the server calls the app's tool through the relay, asks permission for it and for a shell, and the answer is the text after the tool", async () => {
	const root = tmp("agy-run-");
	const { host, run, calls } = engine(root);
	const events: RunEvent[] = [];
	const sessions: string[] = [];
	try {
		await run(base(events, { prompt: "CALLTOOL lūdzu", systemPrompt: "Tu esi aģents.", modelId: "gem-b", effort: "medium", extraTools: [echoTool], onSession: (id: string) => sessions.push(id) }) as never);
		assert.equal(events.some((e) => e.type === "error"), false, JSON.stringify(events.filter((e) => e.type === "error")));
		const tool = events.find((e) => e.type === "tool") as Extract<RunEvent, { type: "tool" }>;
		assert.equal(tool.name, "echo_tool");
		const result = events.find((e) => e.type === "tool_result") as Extract<RunEvent, { type: "tool_result" }>;
		assert.deepEqual({ ok: result.ok, output: result.output }, { ok: true, output: "echo:pelēks" });
		const done = events.find((e) => e.type === "done") as Extract<RunEvent, { type: "done" }>;
		assert.equal(done.text, "Gatavs: echo:pelēks", "the answer is the text after the tool, its escape tokens gone");
		assert.deepEqual(events.find((e) => e.type === "usage"), { type: "usage", input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null, context: { used: 1234, window: 5000 } }, "the turn's summed counts, and apart from them the size of the context the server reported");
		assert.deepEqual(sessions, ["sess-1"]);
		const log = calls();
		const methods = log.filter((c) => c.method).map((c) => c.method);
		assert.deepEqual(methods, ["initialize", "authenticate", "session/new", "session/set_config_option", "session/set_config_option", "session/prompt"]);
		const setOptions = log.filter((c) => c.method === "session/set_config_option").map((c) => `${c.params.configId}=${c.params.value}`);
		assert.deepEqual(setOptions, ["model=gem-b", "mode=default"], "the model is set (its thinking level, medium, is already the model's), and the server asks before it acts");
		const prompt = log.find((c) => c.method === "session/prompt");
		assert.match(prompt.params.text, /^\[Norādes šai sarunai[\s\S]*Tu esi aģents\.[\s\S]*CALLTOOL lūdzu$/, "a new session gets the standing instructions");
		const perm = log.find((c) => c.permission).permission;
		assert.deepEqual(perm, { own: { outcome: "selected", optionId: "yes" }, native: { outcome: "selected", optionId: "no" } });
		const relay = log.find((c) => c.relay).relay;
		assert.deepEqual(relay.tools, ["echo_tool"]);
		assert.equal(relay.result.content[0].text, "echo:pelēks");
	} finally {
		await host.closeAll();
	}
});

test("a second run resumes the session (no instructions repeated); a session the server lost starts a new one and says so", async () => {
	const root = tmp("agy-resume-");
	const { host, run, calls } = engine(root);
	try {
		const first: RunEvent[] = [];
		let id = "";
		await run(base(first, { prompt: "pirmā", systemPrompt: "Noteikumi.", onSession: (s: string) => (id = s) }) as never);
		assert.equal(id, "sess-1");
		const second: RunEvent[] = [];
		await run(base(second, { prompt: "otrā", systemPrompt: "Noteikumi.", resume: id }) as never);
		assert.equal(second.some((e) => e.type === "error"), false);
		const log = calls();
		assert.equal(log.filter((c) => c.method === "session/resume").length, 1);
		const prompts = log.filter((c) => c.method === "session/prompt");
		assert.equal(prompts[1].params.text, "otrā", "a resumed session holds the instructions already");
		const lost: RunEvent[] = [];
		await run(base(lost, { prompt: "trešā", systemPrompt: "Noteikumi.", resume: "sess-unknown" }) as never);
		assert.ok(lost.some((e) => e.type === "text" && /sāksies|sākas no jauna/.test(e.text)), "the person is told the conversation could not be continued");
		assert.equal(lost.some((e) => e.type === "done"), true);
		assert.match(calls().filter((c) => c.method === "session/prompt")[2].params.text, /Noteikumi\./, "the new session gets the instructions again");
	} finally {
		await host.closeAll();
	}
});

test("a stop cancels the prompt: an aborted error, never a done", async () => {
	const root = tmp("agy-stop-");
	const { host, run } = engine(root);
	try {
		const events: RunEvent[] = [];
		const ac = new AbortController();
		const started = Date.now();
		const running = run(base(events, { prompt: "WAIT", signal: ac.signal }) as never);
		setTimeout(() => ac.abort(), 1500);
		await running;
		assert.ok(Date.now() - started < 12_000);
		assert.deepEqual(events.filter((e) => e.type === "error" || e.type === "done"), [{ type: "error", engine: "pi", message: "aborted" }]);
	} finally {
		await host.closeAll();
	}
});

test("a prompt that goes silent is cancelled and the same session resumes the task once; the chat says so", async () => {
	const root = tmp("agy-stall1-");
	const { host, run, calls } = engine(root, { stallMs: 400 });
	try {
		const events: RunEvent[] = [];
		const sessions: string[] = [];
		await run(base(events, { prompt: "STALL1 sāc darbu", onSession: (id: string) => sessions.push(id) }) as never);
		assert.equal(events.some((e) => e.type === "error"), false, JSON.stringify(events.filter((e) => e.type === "error")));
		assert.ok(events.some((e) => e.type === "text" && /ilgi neatbildēja/.test(e.text)), "the user is told");
		assert.equal(events.filter((e) => e.type === "done").length, 1, "the resumed prompt ends the run");
		const prompts = calls().filter((c) => c.method === "session/prompt");
		assert.equal(prompts.length, 2);
		assert.equal(prompts[0].params.sessionId, prompts[1].params.sessionId, "the same session, not a new one");
		assert.match(prompts[1].params.text, /Turpini darbu no vietas, kur apstājies/);
		assert.equal(calls().filter((c) => c.method === "session/cancel").length, 1);
		assert.deepEqual(sessions, ["sess-1"]);
	} finally {
		await host.closeAll();
	}
});

test("a prompt that goes silent twice, or ignores the cancel, ends as an error in words (not a run that is \"working\" for ever)", async () => {
	for (const [marker, stallMs] of [["STALL2", 400], ["STALLDEAF", 400]] as const) {
		const root = tmp("agy-stall2-");
		const { host, run } = engine(root, { stallMs, cancelWaitMs: 600 });
		try {
			const events: RunEvent[] = [];
			await run(base(events, { prompt: `${marker} sāc darbu` }) as never);
			const errors = events.filter((e) => e.type === "error") as Extract<RunEvent, { type: "error" }>[];
			assert.equal(errors.length, 1, marker);
			assert.match(errors[0].message, /neko nedarīja/, marker);
			assert.equal(events.some((e) => e.type === "done"), false, marker);
		} finally {
			await host.closeAll();
		}
	}
});

test("a tool call that is still going keeps the run alive however long it is quiet", async () => {
	const root = tmp("agy-stall-tool-");
	const { host, run } = engine(root, { stallMs: 300 });
	const slowEcho: AgentTool<any> = { ...echoTool, execute: async (id, params, signal) => (await new Promise((r) => setTimeout(r, 1200)), echoTool.execute(id, params, signal)) };
	try {
		const events: RunEvent[] = [];
		await run(base(events, { prompt: "CALLTOOL lūdzu", extraTools: [slowEcho] }) as never);
		assert.equal(events.some((e) => e.type === "error"), false);
	} finally {
		await host.closeAll();
	}
});

test("not signed in: the run says so in words the failover reads as a lost sign-in, and starts nothing", async () => {
	const root = tmp("agy-out-");
	const host = new AntigravityHost({ root, runtime: async () => ({ executablePath: process.execPath, args: [fake], harnessPath: "-", version: "1.4.3" }) });
	const run = createAntigravityRun({ host, nodePath: process.execPath, bridgeScript: "x" });
	const events: RunEvent[] = [];
	await run(base(events) as never);
	assert.equal(events.length, 1);
	const e = events[0] as Extract<RunEvent, { type: "error" }>;
	assert.equal(e.type, "error");
	const { classifyFailure } = await import("../src/agent/failover/classify.ts");
	assert.equal(classifyFailure(e.message).kind, "signed_out");
	await host.closeAll();
});

// ---- the install ---------------------------------------------------------------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { extractPinnedArchive, extractWithFflate, findAntigravityRuntime, installAntigravityRuntime } from "../src/agent/antigravity/runtime.ts";
import type { AntigravityReleaseAsset } from "../src/agent/antigravity/release.ts";

/** A small invented release: two files in a zip, the pinned names, sizes and hash of this archive. */
function smallRelease(extra: Record<string, Uint8Array> = {}, sizeOff = 0) {
	const exe = strToU8("#!invented server ".repeat(500));
	const harness = strToU8("invented harness ".repeat(300));
	const archive = zipSync({ "agy_acp_server.exe": exe, "localharness_external.exe": harness, ...extra });
	const asset: AntigravityReleaseAsset = {
		version: "9.9.9",
		url: "https://dl.google.com/invented/server.zip",
		sha256: createHash("sha256").update(archive).digest("hex"),
		archiveBytes: archive.length,
		executable: { name: "agy_acp_server.exe", bytes: exe.length + sizeOff },
		harness: { name: "localharness_external.exe", bytes: harness.length },
	};
	return { asset, archive };
}
const serve = (archive: Uint8Array, url = "https://dl.google.com/invented/server.zip") =>
	(async () => Object.defineProperty(new Response(archive as unknown as BodyInit, { headers: { "content-length": String(archive.length) } }), "url", { value: url })) as unknown as typeof fetch;

test("install: the pinned size and hash, the validation, then renamed into place; a second install finds it", async () => {
	const root = tmp("agy-install-");
	const { asset, archive } = smallRelease();
	const lines: string[] = [];
	const validated: string[] = [];
	const rt = await installAntigravityRuntime({ root, asset, fetchImpl: serve(archive), progress: (l) => lines.push(l), validate: async (r, v) => void validated.push(`${v}:${existsSync(r.executablePath)}`) });
	assert.equal(rt.version, "9.9.9");
	assert.deepEqual(validated, ["9.9.9:true"], "the server is checked before it is put in place");
	assert.ok(lines.some((l) => /Lejupielādē/.test(l)) && lines.some((l) => /Izpako/.test(l)));
	assert.equal(readdirSync(join(root, `${process.platform}-${process.arch}`, "versions")).filter((n) => n.startsWith(".install-")).length, 0, "no staging folder is left");
	// a second call needs no download
	const again = await installAntigravityRuntime({ root, asset, fetchImpl: (async () => { throw new Error("no second download"); }) as never });
	assert.equal(again.executablePath, rt.executablePath);
});

test("install: a download that fails its hash, comes from elsewhere, or does not identify installs nothing", async () => {
	const { asset, archive } = smallRelease();
	const none = (root: string) => existsSync(join(root, `${process.platform}-${process.arch}`, "versions", asset.sha256));
	const a = tmp("agy-bad1-");
	const corrupt = new Uint8Array(archive);
	corrupt[corrupt.length - 1] ^= 1;
	await assert.rejects(installAntigravityRuntime({ root: a, asset, fetchImpl: serve(corrupt) }), /SHA-256/);
	assert.equal(none(a), false);
	const b = tmp("agy-bad2-");
	await assert.rejects(installAntigravityRuntime({ root: b, asset, fetchImpl: serve(archive, "https://evil.example/server.zip") }), /dl\.google\.com/);
	const c = tmp("agy-bad3-");
	await assert.rejects(installAntigravityRuntime({ root: c, asset, fetchImpl: serve(archive), validate: async () => { throw new Error("neidentificējas"); } }), /neidentificējas/);
	assert.equal(none(c), false);
	assert.equal(await findAntigravityRuntime(c), null);
});

test("unpacking: both readers take the two pinned files and refuse anything else (an extra file, a path, a wrong size)", async () => {
	const { mkdirSync: mk, writeFileSync: wf } = await import("node:fs");
	for (const [label, release, ok] of [
		["clean", smallRelease(), true],
		["extra file", smallRelease({ "evil.dll": strToU8("x") }), false],
		["a path", smallRelease({ "../escape.txt": strToU8("x") }), false],
		["wrong size", smallRelease({}, 1), false],
	] as const) {
		const dir = tmp("agy-zip-");
		const zip = join(dir, "a.zip");
		wf(zip, release.archive);
		const out = join(dir, "out");
		mk(out);
		const readers = [["tar", extractPinnedArchive], ["fflate", extractWithFflate]] as const;
		for (const [reader, extract] of readers) {
			const target = join(out, reader);
			mk(target);
			if (ok) {
				await extract(zip, target, release.asset);
				assert.deepEqual(readdirSync(target).sort(), ["agy_acp_server.exe", "localharness_external.exe"], `${label} (${reader})`);
				assert.equal(readFileSync(join(target, "agy_acp_server.exe"), "utf8").slice(0, 8), "#!invent", `${label} (${reader})`);
			} else {
				await assert.rejects(extract(zip, target, release.asset), /archive|larger/i, `${label} (${reader})`);
				assert.equal(existsSync(join(dir, "escape.txt")), false, `${label} (${reader})`);
				assert.equal(existsSync(join(target, "evil.dll")), false, `${label} (${reader})`);
			}
		}
	}
});
