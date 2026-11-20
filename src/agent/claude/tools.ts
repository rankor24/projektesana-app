// Every tool of a run (the tool servers' tools pi-mcp already connected, plus the main process's lanes and mail tools) as ONE
// in-process MCP server the Claude Agent SDK can take (`{ type: "sdk", instance }`).
//
// Why not hand the SDK the stdio servers: pi-mcp (pi/mcp.ts) already applies the run's allow-lists, cuts long results and refuses a
// tool two servers offer; going through it keeps both engines on one tool path. The tools carry plain JSON Schema (TypeBox), which
// the SDK's zod-based `tool()` helper does not take, so the list/call handlers are set on the low-level server — the same two
// handlers @modelcontextprotocol/sdk's McpServer.setToolRequestHandlers registers (dist/esm/server/mcp.js), minus zod.
// Arguments are validated against the tool's schema before it runs, as pi's agent loop does (agent-loop.js: validateToolArguments).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ToolBridge {
	server: McpServer;
	names: string[];
}

/** `nextId` gives the tool_use id the permission check saw for this tool (run.ts), so execute gets the same id pi would give it. */
export function toolServer(name: string, tools: readonly AgentTool<any>[], nextId: (tool: string) => string, signal: AbortSignal): ToolBridge {
	const byName = new Map(tools.map((t) => [t.name, t]));
	const server = new McpServer({ name, version: "1.0.0" });
	const low = server.server;
	low.registerCapabilities({ tools: {} });
	low.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((t) => {
			const { $schema: _drop, ...schema } = (t.parameters ?? {}) as Record<string, unknown>;
			// always in the prompt, never deferred behind Claude Code's tool search: a run has a few dozen tools at most (sdk.d.ts, alwaysLoad)
			return { name: t.name, description: t.description, inputSchema: (Object.keys(schema).length ? schema : { type: "object", properties: {} }) as { type: "object" }, _meta: { "anthropic/alwaysLoad": true } };
		}),
	}));
	low.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
		const t = byName.get(req.params.name);
		if (!t) return { content: [{ type: "text", text: `Tool ${req.params.name} not found` }], isError: true };
		const id = nextId(t.name);
		try {
			const args = validateToolArguments(t as never, { type: "toolCall", id, name: t.name, arguments: (req.params.arguments ?? {}) as never });
			const r = await t.execute(id, args, signal);
			const content = (r.content ?? []).map((c) =>
				c.type === "image" ? { type: "image" as const, data: c.data, mimeType: c.mimeType } : { type: "text" as const, text: c.type === "text" ? c.text : "" },
			);
			return { content: content.length ? content : [{ type: "text", text: "(empty result)" }], isError: (r as { isError?: boolean }).isError === true };
		} catch (e) {
			return { content: [{ type: "text", text: (e as Error).message }], isError: true };
		}
	});
	return { server, names: tools.map((t) => t.name) };
}
