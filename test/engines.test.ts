// The pi engine: two MCP servers per run with their own allow-lists, the forbidden Revit tools never offered,
// and a whole run with pi's faux model (no network, no credits) against the BUILT projektesana-tools server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { toolsLaunch, revitLaunch } from "../src/main/engines/index.ts";
import { REVIT_AGENT_TOOLS, REVIT_FORBIDDEN, MODEL_TOOLS, SETUP_TOOLS } from "../src/main/engines/types.ts";
import { connectMcpServers, runPi, type PiRuntime } from "../src/agent-pi/index.ts";
import { createProject } from "../src/kernel/project.ts";
import { registerFile } from "../src/kernel/files.ts";
import type { RunEvent } from "../src/shared/types.ts";

const serverJs = join(import.meta.dirname, "..", "dist", "mcp", "server.js");
const built = existsSync(serverJs);
const dataDir = join(import.meta.dirname, "..", "data");

test("Revit allow-list never contains delete_element or send_code_to_revit; no tool of ours can approve", () => {
	for (const t of REVIT_FORBIDDEN) assert.ok(!(REVIT_AGENT_TOOLS as readonly string[]).includes(t));
	assert.ok(![...MODEL_TOOLS, ...SETUP_TOOLS].some((t) => /approve/i.test(t)));
	assert.equal(revitLaunch(null), null);
	assert.deepEqual(revitLaunch("C:\\r\\index.js")?.tools, REVIT_AGENT_TOOLS);
});

function project() {
	const root = mkdtempSync(join(tmpdir(), "bvpi-"));
	createProject(root, "T");
	writeFileSync(join(root, "PU.txt"), "Projektēšanas uzdevums. Objekts: Duntes iela 8, Rīga.");
	registerFile(root, "PU.txt", "PU");
	return root;
}

/** The node that runs tests runs the built server (tsx not needed): same path Electron takes with ELECTRON_RUN_AS_NODE. */
function tools(root: string, mode: "setup" | "model") {
	const l = toolsLaunch({ serverJs, root, engine: "pi", dataDir, mode, revisionId: "r1" });
	return { command: l.command, args: l.args, env: { ...(process.env as Record<string, string>), ...l.env }, allow: l.tools };
}

test("two servers in one run: each keeps its own allow-list; a name offered twice is refused", { skip: !built && "npm run build first" }, async () => {
	const root = project();
	const both = await connectMcpServers({ projektesana: tools(root, "model"), second: { ...tools(root, "setup"), allow: ["set_fact"] } });
	try {
		assert.deepEqual(both.tools.map((t) => t.name).sort(), [...MODEL_TOOLS, "set_fact"].sort());
	} finally {
		await both.close();
	}
	await assert.rejects(connectMcpServers({ a: tools(root, "model"), b: { ...tools(root, "setup"), allow: ["read_doc"] } }), /same tool: read_doc/);
});

test("a full pi run (faux model) reads the PU through the real tool server and finishes", { skip: !built && "npm run build first" }, async () => {
	const root = project();
	const faux = fauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const models = createModels();
	models.setProvider(faux.provider);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read_doc", { path: "PU.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("Objekts ir Duntes iela 8.")]),
	]);
	const runtime = { models, live: { fetchedAt: {}, providers: {} } } as unknown as PiRuntime;
	const events: RunEvent[] = [];
	await runPi({ runtime, model: faux.getModel(), prompt: "Izlasi PU.", mcp: { projektesana: tools(root, "model") }, signal: new AbortController().signal, onEvent: (e) => events.push(e), effort: "high" });
	const kinds = events.map((e) => (e.type === "tool_result" ? `result:${e.name}:${e.ok}` : e.type === "tool" ? `tool:${e.name}` : e.type));
	assert.ok(kinds.includes("tool:read_doc"), kinds.join(","));
	assert.ok(kinds.includes("result:read_doc:true"), kinds.join(","));
	const done = events.find((e) => e.type === "done") as { text: string } | undefined;
	assert.equal(done?.text, "Objekts ir Duntes iela 8.");
	const result = events.find((e) => e.type === "tool_result") as { output?: string };
	assert.match(result.output ?? "", /Duntes iela 8/);
});

test("a tool the server does not offer stops the run with a clear error, not a hang", { skip: !built && "npm run build first" }, async () => {
	const root = project();
	const faux = fauxProvider({ models: [{ id: "faux-1" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const events: RunEvent[] = [];
	const runtime = { models, live: { fetchedAt: {}, providers: {} } } as unknown as PiRuntime;
	await runPi({ runtime, model: faux.getModel(), prompt: "x", mcp: { projektesana: { ...tools(root, "model"), allow: ["read_doc", "nav_tada"] } }, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
	assert.match((events.find((e) => e.type === "error") as { message: string }).message, /nav_tada/);
});
