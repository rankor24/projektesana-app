// A stand-in for Google's Antigravity ACP server, with invented models: speaks ACP's JSON lines on stdin / stdout like the real one.
// Prompts steer it: "CALLTOOL" makes it start the MCP relay it was given and call a tool through it (what the real server does for an MCP server),
// "WAIT" makes it hold the prompt until session/cancel, anything else is echoed. Every call it gets is appended to $FAKE_AGY_LOG as a JSON line.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const LOG = process.env.FAKE_AGY_LOG;
const log = (o) => LOG && appendFileSync(LOG, `${JSON.stringify(o)}\n`);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const sessions = new Map();
let nextSession = 1;
let nextServerRequest = 9000;
const waiting = new Map(); // server request id -> resolve

const options = (s) => [
	{ id: "model", type: "select", currentValue: s.model, options: [{ value: "gem-a", name: "Gem A" }, { value: "gem-b", name: "Gem B" }] },
	{ id: "thought_level", type: "select", category: "thought_level", currentValue: s.level, options: s.model === "gem-a" ? [{ value: "low", name: "Low" }, { value: "high", name: "High" }] : [{ value: "medium", name: "Medium" }] },
	{ id: "mode", type: "select", currentValue: s.mode, options: [{ value: "default", name: "Default" }, { value: "yolo", name: "Yolo" }] },
];

function askClient(method, params) {
	const id = nextServerRequest++;
	out({ jsonrpc: "2.0", id, method, params });
	return new Promise((resolve) => waiting.set(id, resolve));
}

/** Talks MCP to the relay the way the real server does for a configured MCP server: initialize, list the tools, call one. */
async function callThroughRelay(server, tool, args) {
	const env = Object.fromEntries(server.env.map((e) => [e.name, e.value]));
	const child = spawn(server.command, server.args, { env, stdio: ["pipe", "pipe", "inherit"] });
	const lines = createInterface({ input: child.stdout });
	const answers = new Map();
	lines.on("line", (l) => {
		const m = JSON.parse(l);
		answers.get(m.id)?.(m);
	});
	let n = 0;
	const rpc = (method, params) =>
		new Promise((resolve) => {
			const id = ++n;
			answers.set(id, resolve);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-agy", version: "0" } });
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
	const listed = await rpc("tools/list", {});
	const called = await rpc("tools/call", { name: tool, arguments: args });
	child.stdin.end();
	return { tools: listed.result?.tools?.map((t) => t.name) ?? [], called };
}

async function prompt(msg, text) {
	const sessionId = msg.params.sessionId;
	const s = sessions.get(sessionId);
	const chunk = (t) => out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } } });
	// "STALL1" / "STALL2": the next one / two prompts of the session go silent (no update) until session/cancel, which this server honours; "STALLDEAF": silent, and a cancel is ignored
	const stall = /STALL(\d)/.exec(text);
	if (stall) s.stalls = Number(stall[1]);
	if (s.stalls > 0) {
		s.stalls--;
		s.cancelled = () => out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "cancelled" } });
		return;
	}
	if (text.includes("STALLDEAF")) return;
	// "MAXTURNS2": the next two prompts of the session end at the server's own limit of model requests per prompt (`max_turn_requests`), a third one is answered
	const lim = /MAXTURNS(\d)/.exec(text);
	if (lim) s.limits = Number(lim[1]);
	if (s.limits > 0) {
		s.limits--;
		chunk("deļa. ");
		return out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "max_turn_requests" } });
	}
	if (text.includes("WAIT")) {
		s.cancelled = () => out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "cancelled" } });
		return;
	}
	if (text.includes("CALLTOOL")) {
		// a cancel during the work ends the prompt as "cancelled", like the real server (no answer after it)
		let cancelled = false;
		s.cancelled = () => {
			cancelled = true;
			out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "cancelled" } });
		};
		chunk("Looking it up. ");
		const asked = await askClient("session/request_permission", {
			sessionId,
			toolCall: { toolCallId: "t1", title: "mcp__app__echo_tool", kind: "other", rawInput: {} },
			options: [{ optionId: "yes", kind: "allow_once", name: "Allow" }, { optionId: "no", kind: "reject_once", name: "Reject" }],
		});
		const native = await askClient("session/request_permission", {
			sessionId,
			toolCall: { toolCallId: "t2", title: "rm -rf work", kind: "execute", rawInput: { command: "rm -rf work" } },
			options: [{ optionId: "yes", kind: "allow_once", name: "Allow" }, { optionId: "no", kind: "reject_once", name: "Reject" }],
		});
		log({ permission: { own: asked.outcome, native: native.outcome } });
		const r = await callThroughRelay(s.mcpServers[0], "echo_tool", { word: "pelēks" });
		log({ relay: { tools: r.tools, result: r.called.result ?? r.called.error } });
		if (cancelled) return;
		chunk(`&_a_m_p_;_Gatavs: ${r.called.result?.content?.[0]?.text ?? "(nav)"}`);
		// the real server reports the size of the context (the prompt of its newest model call) apart from the turn's summed usage
		out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "usage_update", used: 1234, size: 5000 } } });
		return out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } } });
	}
	chunk(`atbilde: ${text.slice(0, 40)}`);
	out({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
	const msg = JSON.parse(line);
	if (msg.method === undefined) return waiting.get(msg.id)?.(msg.result ?? msg.error);
	log({ method: msg.method, params: msg.method === "session/prompt" ? { sessionId: msg.params.sessionId, text: msg.params.prompt.map((b) => b.text ?? `[${b.type}]`).join("") } : msg.params });
	switch (msg.method) {
		case "initialize":
			return out({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentInfo: { name: "antigravity-acp", version: "1.4.3" }, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, auth: { logout: {} } }, authMethods: [{ id: "oauth-personal" }] } });
		case "authenticate":
			return out({ jsonrpc: "2.0", id: msg.id, result: {} });
		case "session/new": {
			const sessionId = `sess-${nextSession++}`;
			const s = { model: "gem-a", level: "low", mode: "yolo", mcpServers: msg.params.mcpServers };
			sessions.set(sessionId, s);
			return out({ jsonrpc: "2.0", id: msg.id, result: { sessionId, configOptions: options(s) } });
		}
		case "session/resume": {
			const s = sessions.get(msg.params.sessionId);
			if (!s) return out({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "unknown session" } });
			s.mcpServers = msg.params.mcpServers;
			return out({ jsonrpc: "2.0", id: msg.id, result: { configOptions: options(s) } });
		}
		case "session/set_config_option": {
			const s = sessions.get(msg.params.sessionId);
			if (msg.params.configId === "model") {
				s.model = msg.params.value;
				s.level = s.model === "gem-a" ? "low" : "medium";
			} else if (msg.params.configId === "thought_level") s.level = msg.params.value;
			else if (msg.params.configId === "mode") s.mode = msg.params.value;
			return out({ jsonrpc: "2.0", id: msg.id, result: { configOptions: options(s) } });
		}
		case "session/prompt":
			return void prompt(msg, msg.params.prompt.map((b) => b.text ?? "").join(""));
		case "session/cancel":
			return sessions.get(msg.params.sessionId)?.cancelled?.();
		default:
			return msg.id !== undefined && out({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
	}
});
process.stdin.on("end", () => process.exit(0));
