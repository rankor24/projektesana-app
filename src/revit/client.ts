// One path into Revit: an MCP client that starts the Revit MCP server (mcp-server-for-revit) over stdio.
// Carried from v1 src/main/revit/client.ts; changed: the server's own node runtime can be used (the installer puts one
// next to the server), the connection is kept and re-opened when it drops, and every call has a timeout.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface RevitCaller {
	call(tool: string, args?: Record<string, unknown>): Promise<string>;
}

export interface RevitLaunch {
	serverJs: string;
	/** node.exe for the server; null = Electron's own node (ELECTRON_RUN_AS_NODE) */
	node: string | null;
	/** where it was found: Boris's path in Iestatījumi, or the standard install in %LOCALAPPDATA%\Revit-MCP-Node */
	source?: "iestatījumi" | "automātiski";
}

/** The installer's standard location (Revit-MCP-Node in the user's local app data). */
export function defaultRevitLaunch(localAppData = process.env.LOCALAPPDATA ?? ""): RevitLaunch | null {
	const base = join(localAppData, "Revit-MCP-Node");
	const serverJs = join(base, "node-server", "build", "index.js");
	if (!localAppData || !existsSync(serverJs)) return null;
	const node = join(base, "node-runtime", "node.exe");
	return { serverJs, node: existsSync(node) ? node : null, source: "automātiski" };
}

export function resolveRevitLaunch(settings: { revitServerJs: string | null; revitNode: string | null }): RevitLaunch | null {
	if (settings.revitServerJs) return existsSync(settings.revitServerJs) ? { serverJs: settings.revitServerJs, node: settings.revitNode && existsSync(settings.revitNode) ? settings.revitNode : null, source: "iestatījumi" } : null;
	return defaultRevitLaunch();
}

/** The MCP launch spec (for the agent run and for the app's own client). */
export function launchSpec(l: RevitLaunch, electronNode: string): { command: string; args: string[]; env: Record<string, string> } {
	return l.node ? { command: l.node, args: [l.serverJs], env: {} } : { command: electronNode, args: [l.serverJs], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export class RevitClient implements RevitCaller {
	private client: Promise<Client> | null = null;

	constructor(
		private launch: () => RevitLaunch | null,
		private electronNode: string,
		private timeoutMs = 120_000,
	) {}

	configured(): boolean {
		return this.launch() !== null;
	}

	/** the server this client starts, for Iestatījumi to show (null = not found) */
	where(): RevitLaunch | null {
		return this.launch();
	}

	private connect(): Promise<Client> {
		const l = this.launch();
		if (!l) return Promise.reject(new Error("nav konfigurēts: Revit MCP serveris nav atrasts"));
		return (this.client ??= (async () => {
			const spec = launchSpec(l, this.electronNode);
			const transport = new StdioClientTransport({ command: spec.command, args: spec.args, env: { ...(process.env as Record<string, string>), ...spec.env }, stderr: "pipe" });
			const c = new Client({ name: "projektesana", version: "2.0.0" });
			transport.onclose = () => (this.client = null);
			await c.connect(transport);
			return c;
		})().catch((e) => {
			this.client = null;
			throw e;
		}));
	}

	async call(tool: string, args: Record<string, unknown> = {}): Promise<string> {
		const c = await this.connect();
		const res = (await c.callTool({ name: tool, arguments: args }, undefined, { timeout: this.timeoutMs })) as { content?: { type: string; text?: string }[]; isError?: boolean };
		const text = (res.content ?? []).map((x) => (x.type === "text" ? (x.text ?? "") : "")).join("\n");
		if (res.isError) throw new Error(text || `Revit rīks ${tool} atgrieza kļūdu.`);
		return text;
	}

	async close(): Promise<void> {
		const c = this.client;
		this.client = null;
		if (c) await (await c).close().catch(() => undefined);
	}
}
