// The pi engine: two MCP servers per run with their own allow-lists, and the forbidden Revit tools never offered.
// Runs against the BUILT projektesana-tools server; no stand-in model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolsLaunch, revitLaunch } from "../src/main/engines/index.ts";
import { REVIT_AGENT_TOOLS, REVIT_FORBIDDEN, MODEL_TOOLS, SETUP_TOOLS } from "../src/main/engines/types.ts";
import { connectMcpServers } from "../src/agent-pi/index.ts";
import { createProject } from "../src/kernel/project.ts";
import { registerFile } from "../src/kernel/files.ts";

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

