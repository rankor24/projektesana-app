// An agent's own MCP servers (shared/mcp-paste.ts, agent/agent-mcp.ts): the paste parser (cases of OpenMausBot's mcp-paste tests), the checks on an agent's mcp / check fields and a
// department's lead, the secrets that never reach the window, the levels of the tools a run connects, and a real stdio server tried, listed and called through the same code a run uses.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { agentMcpRun, mcpToolName, maskMcp, probeMcpTools, restoreSecrets } from "../src/agent/agent-mcp.ts";
import { validateSpec } from "../src/agent/agents.ts";
import { connectMcpServers } from "../src/agent/pi/mcp.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { Gate, makeLevelOf } from "../src/agent/tools/levels.ts";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { AppSettings } from "../src/main/settings.ts";
import { MCP_SECRET_SET, type AgentMcpServer, type AgentSpec } from "../src/shared/agent-types.ts";
import { checkDepartments } from "../src/shared/departments.ts";
import { readMcpPaste, shellCommands } from "../src/shared/mcp-paste.ts";
import { FIX, tmp } from "./helpers.ts";

const FAKE = join(FIX, "fake-mcp-server.mjs");
const crypto = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };

const one = (text: string, taken: string[] = []) => {
	const r = readMcpPaste(text, taken);
	if (!r?.ok) throw new Error(`expected a server, got ${JSON.stringify(r)}`);
	assert.equal(r.servers.length, 1);
	return r.servers[0]!;
};

test("paste: claude mcp add (gateway with variables, stdio with -e, several commands) as OpenMausBot reads them", () => {
	const gw = one(`claude mcp add --transport http my-mcp https://mcp.example.com/route \\\n  --header "CF-Access-Client-Id: $CF_ID" \\\n  --header "X-Plain: v"`);
	assert.deepEqual(gw.server, { name: "my-mcp", url: "https://mcp.example.com/route", headers: { "CF-Access-Client-Id": "", "X-Plain": "v" } });
	assert.deepEqual(gw.gaps, ["CF-Access-Client-Id"], "a $VARIABLE is never saved as written: the dialog asks for the value");
	const stdio = one(`claude mcp add github -e GITHUB_TOKEN=ghp_abc -e MODE=read -- npx -y @modelcontextprotocol/server-github --read-only`);
	assert.deepEqual(stdio.server, { name: "github", command: "npx", args: ["-y", "@modelcontextprotocol/server-github", "--read-only"], env: { GITHUB_TOKEN: "ghp_abc", MODE: "read" } });
	const names = (t: string) => (readMcpPaste(t) as { servers: { server: { name: string } }[] }).servers.map((s) => s.server.name);
	assert.deepEqual(names(`$ claude mcp add --transport http one https://one.example/mcp\nclaude mcp add --transport http two https://two.example/mcp`), ["one", "two"]);
	assert.equal(one("claude mcp add --transport http browser https://b.example/mcp").server.name, "browser", "a name is only kept apart from this app's own: projektesana-tools, revit");
	assert.equal(one("claude mcp add --transport http revit https://b.example/mcp").server.name, "mcp-revit");
	assert.equal(one(`claude mcp add --transport http g https://g.example/mcp`, ["g"]).server.name, "g-2");
	assert.equal(one("claude mcp add —transport http docs https://docs.example/mcp —header “X-Key: k1”").server.headers?.["X-Key"], "k1", "typographic quotes and dashes");
});

test("paste: add-json, mcpServers block, bare address, npx / docker lines, and what is not a server", () => {
	assert.deepEqual(one(`claude mcp add-json weather '{"type":"stdio","command":"uvx","args":["weather-mcp"],"env":{"KEY":"k"}}'`).server, { name: "weather", command: "uvx", args: ["weather-mcp"], env: { KEY: "k" } });
	const block = readMcpPaste(JSON.stringify({ mcpServers: { Notes: { command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "<token>" } }, docs: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer abc" } } } }));
	assert.ok(block?.ok);
	assert.deepEqual(block.servers.map((s) => s.server.name), ["notes", "docs"]);
	assert.deepEqual(block.servers[0]!.gaps, ["NOTES_TOKEN"], "a <placeholder> is a gap");
	assert.equal(one("https://mcp.acme.example/mcp").server.name, "acme");
	assert.deepEqual(one("uvx mcp-server-fetch").server, { name: "fetch", command: "uvx", args: ["mcp-server-fetch"] });
	const docker = one("docker run -i --rm -e GITHUB_TOKEN=ghp_secret registry.example/acme/github-mcp-server:latest stdio").server;
	assert.deepEqual(docker.args, ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "registry.example/acme/github-mcp-server:latest", "stdio"], "docker's -e value moves out of the arguments");
	assert.deepEqual(docker.env, { GITHUB_TOKEN: "ghp_secret" });
	for (const garbage of ["hello world", "rm -rf /", "claude mcp list", "{}", "[1, 2]"]) assert.equal(readMcpPaste(garbage)?.ok, false, garbage);
	assert.equal(readMcpPaste("claude mcp add --transport http lonely")?.ok, false);
	const bad = readMcpPaste(`claude mcp add --transport http x https://x.example/mcp -H "Authorization Bearer sk-live-123"`);
	assert.equal(bad?.ok, false);
	assert.ok(!JSON.stringify(bad).includes("sk-live-123"), "a value it read is never echoed in the refusal");
	assert.equal(readMcpPaste("claude mcp add --transport http t https://<tenant>.example.com/mcp")?.ok, false, "a placeholder in the address");
	assert.equal(readMcpPaste("   \n "), null);
	assert.deepEqual(shellCommands(`a 'b c' "d \\"e\\"" f\\ g # comment\nh;i && j`), [["a", "b c", "d \"e\"", "f g"], ["h"], ["i"], ["j"]]);
});

const base = { id: "ar", name: "Arhitekts", description: "", prompt: "", tools: [] as string[], roleFile: true };
const levelOf = makeLevelOf({});
const spec = (extra: object) => validateSpec({ ...base, ...extra }, levelOf, [], ["ar", "bk"], () => true);

test("validateSpec: mcp servers and the check fields", () => {
	const ok = spec({ mcp: [{ name: "notes", command: "npx", args: ["-y", "n"], env: { K: "v" }, tools: ["a", "b"], read: ["a", "zz"] }, { name: "remote", url: "https://x.example/mcp", headers: { Authorization: "Bearer t" } }], check: { agent: "bk", maxChecks: 2 } });
	assert.ok(ok.ok);
	assert.deepEqual(ok.spec.mcp?.[0]?.read, ["a"], "only a listed tool can be marked read");
	assert.deepEqual(ok.spec.check, { agent: "bk", maxChecks: 2 });
	for (const [what, extra] of [
		["reserved name", { mcp: [{ name: "revit", command: "x" }] }],
		["both", { mcp: [{ name: "a1", command: "x", url: "https://x.example" }] }],
		["neither", { mcp: [{ name: "a1" }] }],
		["bad url", { mcp: [{ name: "a1", url: "ftp://x" }] }],
		["bad name", { mcp: [{ name: "Big Name", command: "x" }] }],
		["twice", { mcp: [{ name: "a1", command: "x" }, { name: "a1", command: "y" }] }],
		["bad env", { mcp: [{ name: "a1", command: "x", env: { "bad name": "v" } }] }],
		["check itself", { check: { agent: "ar" } }],
		["check unknown", { check: { agent: "nobody" } }],
		["check provider", { check: { provider: "no-such" } }],
		["check count", { check: { agent: "bk", maxChecks: 4 } }],
	] as const) assert.equal(spec(extra).ok, false, what);
	const none = spec({ check: { maxChecks: 2 } });
	assert.ok(none.ok && none.spec.check === undefined, "a check with nothing chosen is no check");
});

test("departments: a lead is an agent of the department; the field survives a rename", () => {
	const specs = [{ id: "ar", department: "arhitektura" }, { id: "bk", department: "konstrukcijas" }];
	const cur = [{ id: "arhitektura", name: "Arhitektūra" }, { id: "konstrukcijas", name: "Konstrukcijas" }];
	const r = checkDepartments([{ ...cur[0]!, lead: "ar" }, cur[1]!], specs, cur);
	assert.ok(r.ok && r.list[0]?.lead === "ar" && r.list[1]?.lead === undefined);
	assert.equal(checkDepartments([{ ...cur[0]!, lead: "bk" }, cur[1]!], specs, cur).ok, false, "an agent of another department");
	assert.equal(checkDepartments([{ ...cur[0]!, lead: "nobody" }, cur[1]!], specs, cur).ok, false, "an unknown agent");
	const renamed = checkDepartments([{ id: "arhitektura", name: "Arhitekti", lead: "ar" }, cur[1]!], specs, cur);
	assert.ok(renamed.ok && renamed.list[0]?.lead === "ar");
});

test("secrets: the window gets the mask, sends it back, and the saved value is kept; a lead follows its agent out of a department", () => {
	const dir = tmp("pj-mcp-");
	const settings = new AppSettings(dir, crypto);
	const h = agentHandlers({ settings });
	const real: AgentMcpServer = { name: "notes", command: "npx", args: ["x"], env: { TOKEN: "ghp_real", EMPTY: "" } };
	h["agents.save"]([{ ...base, roleFile: false, prompt: "Tu esi arhitekts, atbildi īsi.", mcp: [real] }, { ...base, id: "bk", name: "Konstrukcijas", roleFile: false, prompt: "Tu esi konstruktors, atbildi īsi." }]);
	const stored = () => settings.agentSpecs().specs.find((s) => s.id === "ar")!;
	assert.equal(stored().mcp?.[0]?.env?.TOKEN, "ghp_real");
	const listed = (h["agents.list"]() as { specs: AgentSpec[] }).specs.find((s) => s.id === "ar")!;
	assert.equal(listed.mcp?.[0]?.env?.TOKEN, MCP_SECRET_SET);
	assert.equal(listed.mcp?.[0]?.env?.EMPTY, "", "not set stays not set");
	assert.ok(!JSON.stringify(listed).includes("ghp_real"));
	// a save with the mask keeps the value; a typed value replaces it; the mask of a key that was never set is dropped
	h["agents.save"]([{ ...listed }, { ...base, id: "bk", name: "Konstrukcijas", roleFile: false, prompt: "Tu esi konstruktors, atbildi īsi." }]);
	assert.equal(stored().mcp?.[0]?.env?.TOKEN, "ghp_real");
	h["agents.save"]([{ ...listed, mcp: [{ ...listed.mcp![0]!, env: { TOKEN: "ghp_new", GHOST: MCP_SECRET_SET } }] }, { ...base, id: "bk", name: "Konstrukcijas", roleFile: false, prompt: "Tu esi konstruktors, atbildi īsi." }]);
	assert.deepEqual(stored().mcp?.[0]?.env, { TOKEN: "ghp_new" });
	assert.deepEqual(restoreSecrets([{ name: "n", url: "https://x.example", headers: { A: MCP_SECRET_SET } }], [{ name: "n", url: "https://x.example", headers: { A: "tok" } }])![0]!.headers, { A: "tok" });
	assert.equal(maskMcp({ mcp: [{ name: "n", command: "c", env: { A: "s" } }] }).mcp![0]!.env!.A, MCP_SECRET_SET);
	// the department lead is dropped when its agent leaves the department
	h["agents.move"]("ar", "arhitektura", null);
	h["departments.save"]([{ id: "vadiba", name: "Vadība" }, { id: "arhitektura", name: "Arhitektūra", lead: "ar" }, { id: "konstrukcijas", name: "Konstrukcijas" }]);
	assert.equal(settings.departments().departments.find((d) => d.id === "arhitektura")?.lead, "ar");
	h["agents.move"]("ar", "konstrukcijas", null);
	assert.equal(settings.departments().departments.find((d) => d.id === "arhitektura")?.lead, undefined);
});

test("a run's servers: only the listed tools, confirm unless marked read, the gate asks for a confirm tool and lets a read one through", async () => {
	const s: AgentMcpServer = { name: "fake", command: process.execPath, args: [FAKE], tools: ["lookup", "write_note"], read: ["lookup"] };
	const { servers, levels } = agentMcpRun({ mcp: [s, { name: "idle", command: "x" }] });
	assert.deepEqual(Object.keys(servers), ["fake"], "a server with no listed tool is not connected");
	assert.deepEqual(levels, { [mcpToolName("fake", "lookup")]: "read", [mcpToolName("fake", "write_note")]: "confirm" });
	const mcp = await connectMcpServers(servers, {});
	try {
		assert.deepEqual(mcp.tools.map((t) => t.name).sort(), ["fake__lookup", "fake__write_note"], "whoami is not listed, so it is not offered; the names carry the server");
		const asked: string[][] = [];
		const gate = new Gate(makeLevelOf(levels), async (req) => (asked.push(req.batch.map((b) => b.tool)), true));
		const msg = { role: "assistant", content: [{ type: "toolCall", id: "1", name: "fake__lookup", arguments: {} }, { type: "toolCall", id: "2", name: "fake__write_note", arguments: {} }] } as never;
		const ctx = (name: string) => ({ assistantMessage: msg, toolCall: { type: "toolCall", id: "x", name, arguments: {} }, args: {}, context: {} }) as never;
		assert.equal(await gate.before(ctx("fake__lookup")), undefined);
		assert.deepEqual(asked, [], "a read tool runs without asking");
		assert.equal(await gate.before(ctx("fake__write_note")), undefined);
		assert.deepEqual(asked, [["fake__write_note"]], "a confirm tool asks the user once, naming only the confirm calls");
		const lookup = mcp.tools.find((t) => t.name === "fake__lookup")!;
		const res = await lookup.execute("1", { word: "x" } as never, new AbortController().signal);
		assert.match(JSON.stringify(res.content), /found x/);
	} finally {
		await mcp.close();
	}
	// a server that does not start does not stop the run: it is left out and named
	const broken = await connectMcpServers({ gone: { command: join(FIX, "no-such-program"), args: [], env: {}, allow: ["a"], optional: true } }, {});
	assert.equal(broken.tools.length, 0);
	assert.match(broken.missing[0]!, /^gone:/);
});

test("probe: starts the server and lists its tools; a server that fails says why", async () => {
	const tools = await probeMcpTools({ name: "fake", command: process.execPath, args: [FAKE], env: { SECRET_NAME: "abc" } });
	assert.deepEqual(tools.map((t) => t.name).sort(), ["lookup", "whoami", "write_note"]);
	assert.match(tools.find((t) => t.name === "lookup")!.description, /Looks a word up/);
	await assert.rejects(() => probeMcpTools({ name: "gone", command: join(FIX, "no-such-program") }, 5000));
});

test("a thread run: the agent's own servers are connected for that agent only, with its tools at their levels; no other agent and not the lead", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const mk = (id: string, extra: object = {}): AgentSpec => ({ id, name: id, description: "", prompt: `You are AGENT ${id}.`, tools: [], maxLevel: "confirm", ...extra });
	const own: AgentMcpServer = { name: "fake", command: process.execPath, args: [FAKE], tools: ["lookup", "write_note"], read: ["lookup"] };
	const seen = new Map<string, { servers: string[]; allow: string[]; gate: (name: string) => Promise<unknown> }>();
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [mk("ar", { mcp: [own] }), mk("bk")],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (o) => {
			const who = /AGENT (\w+)\./.exec(o.systemPrompt ?? "")?.[1] ?? "lead";
			seen.set(who, { servers: Object.keys(o.mcp ?? {}), allow: o.mcp?.fake ? [...o.mcp.fake.allow] : [], gate: async (name) => o.beforeToolCall?.({ toolCall: { name, id: "t", arguments: {} }, args: {} } as never, new AbortController().signal) });
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	for (const who of ["lead", "ar", "bk"]) {
		await s.sendToThread(s.openThread("BD999", who).id, "BD999", "sāc", []);
		for (let i = 0; i < 100 && (s.queueView().running.length || !seen.has(who)); i++) await new Promise((r) => setTimeout(r, 5));
	}
	assert.deepEqual([...seen.keys()].sort(), ["ar", "bk", "lead"]);
	assert.ok(seen.get("ar")!.servers.includes("fake"));
	assert.deepEqual(seen.get("ar")!.allow, ["lookup", "write_note"]);
	assert.ok(!seen.get("bk")!.servers.includes("fake"), "another agent never gets it");
	assert.ok(!seen.get("lead")!.servers.includes("fake"), "nor the lead");
	// the gate of that run knows the tools: a read one passes, a name the list does not hold is refused
	assert.equal(await seen.get("ar")!.gate("fake__lookup"), undefined);
	assert.deepEqual(await seen.get("ar")!.gate("fake__whoami"), { block: true, reason: "Rīks fake__whoami nav atļauts (līmenis: nekad)." });
});
