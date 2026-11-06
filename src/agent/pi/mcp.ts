// Connects to a stdio MCP server through pi-mcp and turns each of its tools into a pi AgentTool.
//
// Borrowed from BIM Crew apps/server/src/runtime/mcp.ts (McpClient + StdioTransport, listTools, callTool) and
// tools/mcp-tools.ts (toLlmContent for results). BIM Crew hides ~60 tools behind a search tool; here the server
// has nine, so each one is a tool of its own and the model sees exact names and argument schemas.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import { McpClient, StdioTransport, toLlmContent } from "@earendil-works/pi-mcp";

/** How to start the server: command, arguments and extra environment, as the app's `McpLaunch` describes it. */
export interface McpLaunchSpec {
	command: string;
	args: string[];
	env: Record<string, string>;
	cwd?: string;
}

export interface McpToolsOptions {
	/** Only these tools are offered to the model. Everything else the server lists is ignored. */
	allow?: readonly string[];
	/** Name shown to the server as this client. */
	clientName?: string;
	/** One tool call may take this long (documents are slow to read). */
	callTimeoutMs?: number;
	/** Tool results over this many characters are cut, with a note, so one document cannot fill the context. */
	maxResultChars?: number;
}

export interface McpTools {
	tools: AgentTool<TSchema>[];
	/** Tools in `allow` that the server did not list. */
	missing: string[];
	close(): Promise<void>;
}

const DEFAULT_CALL_TIMEOUT_MS = 300_000;

/** The server's JSON Schema as pi wants it: pi validates plain JSON Schema, but `$schema` is noise for providers. */
function parametersOf(inputSchema: Record<string, unknown>): TSchema {
	const { $schema: _drop, ...rest } = inputSchema;
	return (Object.keys(rest).length ? rest : { type: "object", properties: {} }) as unknown as TSchema;
}

/**
 * Several servers in one run (this app: Revit MCP + projektesana-tools). Each keeps its own allow-list;
 * a tool name offered by two servers is refused rather than silently shadowed.
 */
export async function connectMcpServers(servers: Record<string, McpLaunchSpec & { allow: readonly string[] }>, opts: Omit<McpToolsOptions, "allow"> = {}): Promise<McpTools> {
	const opened: McpTools[] = [];
	const closeAll = async () => void (await Promise.all(opened.map((o) => o.close().catch(() => undefined))));
	try {
		for (const [name, s] of Object.entries(servers)) {
			const t = await connectMcpTools(s, { ...opts, allow: s.allow, clientName: opts.clientName ?? name });
			opened.push({ ...t, missing: t.missing.map((m) => `${name}:${m}`) });
		}
		const tools = opened.flatMap((o) => o.tools);
		const dup = tools.map((t) => t.name).filter((n, i, a) => a.indexOf(n) !== i);
		if (dup.length) throw new Error(`Two tool servers offer the same tool: ${[...new Set(dup)].join(", ")}`);
		return { tools, missing: opened.flatMap((o) => o.missing), close: closeAll };
	} catch (e) {
		await closeAll();
		throw e;
	}
}

export async function connectMcpTools(spec: McpLaunchSpec, opts: McpToolsOptions = {}): Promise<McpTools> {
	const client = new McpClient({ name: opts.clientName ?? "agent-pi", version: "1.0.0", requestTimeoutMs: opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS });
	await client.connect(new StdioTransport({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env, stderr: "pipe" }));
	const timeoutMs = opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
	const maxChars = opts.maxResultChars;
	try {
		const listed = await client.listTools();
		const allow = opts.allow ? new Set(opts.allow) : null;
		const offered = listed.filter((t) => !allow || allow.has(t.name));
		const tools: AgentTool<TSchema>[] = offered.map((t) => ({
			name: t.name,
			label: t.title ?? t.name,
			description: t.description ?? t.name,
			parameters: parametersOf(t.inputSchema),
			execute: async (_toolCallId, params, signal) => {
				const result = await client.callTool(t.name, (params ?? {}) as Record<string, unknown>, { signal, timeoutMs });
				let content = toLlmContent(result);
				if (maxChars !== undefined) {
					content = content.map((c) => (c.type === "text" && c.text.length > maxChars ? { type: "text" as const, text: `${c.text.slice(0, maxChars)}\n[… cut: ${c.text.length} characters in all]` } : c));
				}
				return {
					content: content.length ? content : [{ type: "text" as const, text: "(empty result)" }],
					details: { tool: t.name },
					isError: result.isError === true,
				};
			},
		}));
		const have = new Set(offered.map((t) => t.name));
		return { tools, missing: allow ? [...allow].filter((n) => !have.has(n)) : [], close: () => client.close() };
	} catch (e) {
		await client.close().catch(() => undefined);
		throw e;
	}
}
