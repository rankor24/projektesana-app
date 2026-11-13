// projektesana-tools: the app's stdio MCP server. Started by the main process for each agent run (Electron's node,
// ELECTRON_RUN_AS_NODE=1), configured by environment variables (context.ts). A `never` tool is not even registered.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { basename } from "node:path";
import { trackCreated } from "../../core/checkpoints.js";
import { inToolScope } from "../../core/scope.js";
import { ProjectStore } from "../../core/store.js";
import { ctxFromEnv } from "./context.js";
import { allTools } from "./defs.js";

const ctx = ctxFromEnv(process.env);
const server = new McpServer({ name: "projektesana-tools", version: "2.0.0" });

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const out = (v: unknown): Out => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });

for (const t of allTools()) {
	if (t.level === "never") continue;
	server.registerTool(t.name, { description: t.description, inputSchema: t.input }, async (args: unknown) => {
		try {
			// a tool that can change something runs in a scope (its writes name the run and the tool) and its new files are recorded
			if (t.level === "read") return out(await t.run(ctx, args as never));
			const store = ctx.projectId ? ProjectStore.load(ctx.projectsDir, ctx.projectId) : null;
			const run = ctx.runDir ? basename(ctx.runDir) : null;
			return out(await inToolScope({ run, tool: t.name }, () => trackCreated(store, () => t.run(ctx, args as never))));
		} catch (e) {
			return { content: [{ type: "text" as const, text: (e as Error).message }], isError: true };
		}
	});
}

await server.connect(new StdioServerTransport());
