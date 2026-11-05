// Spawns the BUILT projektesana-tools server and talks MCP to it over stdio, as an agent engine would.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createProject } from "../src/kernel/project.ts";
import { registerFile } from "../src/kernel/files.ts";
import { appendChat } from "../src/main/chat/brief.ts";

const serverJs = join(import.meta.dirname, "..", "dist", "mcp", "server.js");
const built = existsSync(serverJs);

async function connect(root: string, mode: "setup" | "model") {
	const t = new StdioClientTransport({ command: process.execPath, args: [serverJs], env: { ...(process.env as Record<string, string>), PROJEKTESANA_ROOT: root, PROJEKTESANA_ENGINE: "claude", PROJEKTESANA_MODE: mode, PROJEKTESANA_REVISION: "r1", PROJEKTESANA_DATA: join(import.meta.dirname, "..", "data") } });
	const c = new Client({ name: "test", version: "0" });
	await c.connect(t);
	return c;
}
const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

test("model mode exposes the working tools and no approve/set_fact", { skip: !built && "run npm run build first" }, async () => {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	const c = await connect(root, "model");
	const names = (await c.listTools()).tools.map((t) => t.name).sort();
	assert.deepEqual(names, ["add_note", "finish_revision", "list_files", "list_open_pins", "project_brief", "read_doc", "resolve_pin", "rules_for_stage", "search_sources"]);
	await c.close();
});

test("setup mode: set_fact refuses an invented quote and accepts a real one; read_doc refuses outside the project", { skip: !built && "run npm run build first" }, async () => {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	writeFileSync(join(root, "PU.txt"), "Objekts: Duntes iela 8, Rīga");
	registerFile(root, "PU.txt", "PU");
	appendChat(root, "boris", "jauna publiska ēka");
	const c = await connect(root, "setup");
	const names = (await c.listTools()).tools.map((t) => t.name);
	assert.ok(names.includes("set_fact") && names.includes("mark_unknown") && !names.includes("finish_revision"));
	const bad = await c.callTool({ name: "set_fact", arguments: { id: "object", value: "Brīvības iela 1", source: { kind: "file", path: "PU.txt", quote: "Objekts: Brīvības iela 1" } } });
	assert.equal((bad as { isError?: boolean }).isError, true);
	const good = await c.callTool({ name: "set_fact", arguments: { id: "object", value: "Duntes iela 8, Rīga", source: { kind: "file", path: "PU.txt", quote: "Objekts: Duntes iela 8, Rīga" } } });
	assert.notEqual((good as { isError?: boolean }).isError, true);
	assert.match(text(await c.callTool({ name: "project_brief", arguments: {} })), /Duntes iela 8/);
	const out = await c.callTool({ name: "read_doc", arguments: { path: "..\\..\\Windows\\win.ini" } });
	assert.equal((out as { isError?: boolean }).isError, true);
	await c.close();
});

test("rules_for_stage over MCP returns cited rules once the brief has work and use", { skip: !built && "run npm run build first" }, async () => {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	appendChat(root, "boris", "jauna publiska ēka 3 stāvi 2500 m2");
	const c = await connect(root, "setup");
	const at = new Date().toISOString();
	for (const [id, value, quote] of [["engine.work", "new_build", "jauna publiska ēka"], ["engine.use", "public", "jauna publiska ēka"], ["engine.floorsAbove", "3", "3 stāvi"], ["engine.totalAreaM2", "2500", "2500 m2"]])
		await c.callTool({ name: "set_fact", arguments: { id, value, source: { kind: "boris", quote, at } } });
	const r = JSON.parse(text(await c.callTool({ name: "rules_for_stage", arguments: { stage: "mbp" } })));
	assert.equal(r.group.value, 3);
	assert.equal(r.procedure.value, "mbp_buvatlauja");
	assert.ok(r.content.items.every((i: { quote: string; article: string }) => i.quote && i.article));
	await c.close();
});
