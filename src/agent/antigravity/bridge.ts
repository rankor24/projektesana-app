// The tools of a run, offered to Google's Antigravity server as ONE MCP server on this PC's loopback address.
//
// Why a bridge and not the stdio servers themselves: the app's tool servers are already connected through pi-mcp (pi/mcp.ts), which applies the run's
// allow-lists, cuts long results and refuses a tool two servers offer; the main process's own tools (delegate, mail, tasks) exist only here. Going through
// the same AgentTool objects keeps this engine on the tool path the other two use, and lets the approval gate (beforeToolCall) and the write locks
// (afterToolCall) run exactly where the tool runs, as they do in pi and in claude/run.ts.
//
// The server speaks MCP's Streamable HTTP (stateless, JSON replies) on 127.0.0.1 with a random port and a bearer token that exists only for this run.
// Google's server starts a small relay (bridge-stdio.ts, the app's own node) that turns its stdio MCP into calls to this address: stdio is the one
// MCP transport every ACP agent takes. Tool calls run one at a time (the tools write project state and drive one Revit).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentTool, BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RunEvent } from "../../shared/types.js";
import { toolServer } from "../claude/tools.js";
import type { PiRunOptions } from "../pi/run.js";

/** The name of the one MCP server of a run: the permission check and the tool names of the server's own words (`mcp__app__<tool>`) use it. */
export const BRIDGE_SERVER = "app";

const OUTPUT_MAX = 2000;
const INPUT_MAX = 600;
const MAX_BODY = 32 * 1024 * 1024;

export interface ToolBridgeOptions {
	tools: readonly AgentTool<any>[];
	beforeToolCall?: PiRunOptions["beforeToolCall"];
	afterToolCall?: PiRunOptions["afterToolCall"];
	signal: AbortSignal;
	/** tool / tool_result events: the run's own report of each call */
	emit: (e: RunEvent) => void;
	/** a tool call started: the text the model writes after it is a new stretch of the answer */
	onToolStart?: () => void;
}

export interface ToolBridge {
	url: string;
	token: string;
	names: string[];
	close(): Promise<void>;
}

const text = (content: readonly { type: string; text?: string }[]): string => content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).filter(Boolean).join("\n");

/** The tools as they run behind the bridge: the gate asks first, the events tell the panel, the lock is freed after, one call at a time. */
export function guardedTools(o: ToolBridgeOptions): AgentTool<any>[] {
	let chain: Promise<unknown> = Promise.resolve();
	return o.tools.map((t) => ({
		...t,
		execute: (id: string, args: any, signal?: AbortSignal) => {
			const run = async () => {
				const input = JSON.stringify(args ?? {});
				o.onToolStart?.();
				o.emit({ type: "tool", name: t.name, id, detail: input.slice(0, INPUT_MAX), ...(input.length > INPUT_MAX ? { input } : {}) });
				const call = { type: "toolCall" as const, id, name: t.name, arguments: (args ?? {}) as Record<string, unknown> };
				const done = (ok: boolean, full: string) => {
					const out = full.slice(0, OUTPUT_MAX);
					o.emit({ type: "tool_result", name: t.name, id, ok, detail: ok ? undefined : out, output: out, chars: full.length, ...(full.length > OUTPUT_MAX ? { full } : {}) });
				};
				try {
					const ctx = { assistantMessage: { role: "assistant", content: [call] }, toolCall: call, args, context: undefined } as unknown as BeforeToolCallContext;
					const verdict = o.beforeToolCall ? await o.beforeToolCall(ctx, signal ?? o.signal) : undefined;
					if (verdict?.block) {
						const reason = verdict.reason ?? "Bloķēts.";
						done(false, reason);
						return { content: [{ type: "text" as const, text: reason }], details: {}, isError: true };
					}
					const r = await t.execute(id, args, signal ?? o.signal);
					const full = text(r.content as { type: string; text?: string }[]);
					done((r as { isError?: boolean }).isError !== true, full);
					return r;
				} catch (e) {
					done(false, (e as Error).message);
					throw e;
				} finally {
					// a lane's write lock is freed once its tool has ended, however it ended
					await o.afterToolCall?.({ toolCall: { id } } as never, signal ?? o.signal).catch(() => undefined);
				}
			};
			const next = chain.then(run, run);
			chain = next.catch(() => undefined);
			return next;
		},
	}));
}

function bodyOf(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const parts: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			parts.push(c);
		});
		req.on("end", () => {
			try {
				resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : undefined);
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

function sameToken(given: string, token: string): boolean {
	const a = Buffer.from(given);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Starts the bridge for one run; `close` ends it (and every call still waiting). */
export async function startToolBridge(o: ToolBridgeOptions): Promise<ToolBridge> {
	const token = randomBytes(24).toString("hex");
	const tools = guardedTools(o);
	let n = 0;
	const nextId = () => `ag-${++n}`;
	const reply = (res: ServerResponse, status: number, body: unknown) => {
		if (res.headersSent) return;
		res.writeHead(status, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const server: Server = createServer((req, res) => {
		void (async () => {
			try {
				const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
				// the loopback name only (a page in a browser cannot reach this through a DNS name that points here)
				if (!sameToken(auth, token) || !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? "")) return reply(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null });
				if (req.method !== "POST") return reply(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "method not allowed" }, id: null });
				const body = await bodyOf(req);
				// stateless: one server and one transport per request, the pattern of the SDK for a server with no session
				const mcp = toolServer(BRIDGE_SERVER, tools, nextId, o.signal).server;
				const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
				res.on("close", () => {
					void transport.close();
					void mcp.close();
				});
				await mcp.connect(transport);
				await transport.handleRequest(req, res, body);
			} catch (e) {
				reply(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: (e as Error).message }, id: null });
			}
		})();
	});
	// a tool (reading a long document) may take minutes
	server.requestTimeout = 0;
	server.headersTimeout = 30_000;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const port = (server.address() as AddressInfo).port;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		token,
		names: tools.map((t) => t.name),
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
