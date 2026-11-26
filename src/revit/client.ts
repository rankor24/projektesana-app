// One path into Revit: an MCP client that starts the Revit MCP server (mcp-server-for-revit) over stdio.
// Carried from v1 src/main/revit/client.ts; changed: the server's own node runtime can be used (the installer puts one
// next to the server), the connection is kept and re-opened when it drops, and every call has a timeout.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
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
	/** where it was found: the user's path in Iestatījumi, or the standard install in %LOCALAPPDATA%\Revit-MCP-Node */
	source?: "iestatījumi" | "automātiski" | "iekļauts";
}

/** %LOCALAPPDATA%; when a launcher dropped it from the environment, the same folder under the user's home. */
export function localAppDataDir(): string {
	return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
}

/** Where the installer puts the server's entry file (the path the "not found" message names). */
export function defaultServerJs(localAppData = localAppDataDir()): string {
	return join(localAppData, "Revit-MCP-Node", "node-server", "build", "index.js");
}

/** The Revit MCP server shipped inside the app (resources/revit-mcp: node-server, node-runtime, addins). Set once by main; the tools server gets it by environment. */
let bundledDir: string | null = null;
export function setBundledRevitDir(dir: string | null): void {
	bundledDir = dir;
}
export function bundledRevitDir(): string | null {
	return bundledDir;
}
export function bundledRevitLaunch(dir = bundledDir): RevitLaunch | null {
	if (!dir) return null;
	const serverJs = join(dir, "node-server", "build", "index.js");
	if (!existsSync(serverJs)) return null;
	const node = join(dir, "node-runtime", "node.exe");
	return { serverJs, node: existsSync(node) ? node : null, source: "iekļauts" };
}

/** The standard install of the Revit MCP bundle (Revit-MCP-Node in the user's local app data): used only when the app has no server of its own. */
export function defaultRevitLaunch(localAppData = localAppDataDir()): RevitLaunch | null {
	const base = join(localAppData, "Revit-MCP-Node");
	const serverJs = defaultServerJs(localAppData);
	if (!localAppData || !existsSync(serverJs)) return null;
	const node = join(base, "node-runtime", "node.exe");
	return { serverJs, node: existsSync(node) ? node : null, source: "automātiski" };
}

export function resolveRevitLaunch(settings: { revitServerJs: string | null; revitNode: string | null }): RevitLaunch | null {
	if (settings.revitServerJs) return existsSync(settings.revitServerJs) ? { serverJs: settings.revitServerJs, node: settings.revitNode && existsSync(settings.revitNode) ? settings.revitNode : null, source: "iestatījumi" } : null;
	// the server shipped inside the app first (2026-11-24): it is the version this app's tools and add-in were made for; an older Revit-MCP-Node install next to it no longer wins
	return bundledRevitLaunch() ?? defaultRevitLaunch();
}

/** The MCP launch spec (for the agent run and for the app's own client). */
export function launchSpec(l: RevitLaunch, electronNode: string): { command: string; args: string[]; env: Record<string, string> } {
	return l.node ? { command: l.node, args: [l.serverJs], env: {} } : { command: electronNode, args: [l.serverJs], env: { ELECTRON_RUN_AS_NODE: "1" } };
}

export class RevitClient implements RevitCaller {
	private client: Promise<Client> | null = null;
	/** The Revit session the agent chose (the arguments of its select_revit_instance), when this client works for an agent's run. The agent's own Revit server is another process with its own choice,
	 *  so every call of this client first makes the same choice on its connection (again after a reconnect or when the agent changes it). With two Revit sessions open the server otherwise
	 *  answers "2 Revit sessions are running. Call select_revit_instance first" to every call. A choice the server does not accept stops the call: nothing is done in another session. */
	choice?: (raw: (tool: string, args: Record<string, unknown>) => Promise<string>) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
	/** true: a choice the server does not accept stops the call (an agent's tool). false: the call goes on in the session the server has (a screen's call). */
	strictChoice = true;
	private applied: string | null = null;
	private explicit = 0;

	/** Runs `fn` with no automatic choice: its calls go to the session already selected on this connection (the agent's check of the working copy, which selects explicitly). */
	async explicitly<T>(fn: () => Promise<T>): Promise<T> {
		this.explicit++;
		try {
			return await fn();
		} finally {
			this.explicit--;
		}
	}

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
			transport.onclose = () => {
				this.client = null;
				this.applied = null;
			};
			await c.connect(transport);
			return c;
		})().catch((e) => {
			this.client = null;
			throw e;
		}));
	}

	async call(tool: string, args: Record<string, unknown> = {}): Promise<string> {
		const c = await this.connect();
		// a caller moving the session itself (the agent's check, the revision) ends what the automatic choice had made: the next call that wants one selects it again
		if (tool === "select_revit_instance") this.applied = null;
		const want = tool === "select_revit_instance" || this.explicit > 0 ? null : ((await this.choice?.((t, a) => this.callOn(c, t, a))) ?? null);
		// an explicit run (the agent's check) began while the choice was being worked out: it selects for itself, and this call must not move the session under it
		if (want && this.explicit === 0) {
			const key = JSON.stringify(want);
			if (key !== this.applied) {
				this.applied = null;
				const said = await this.callOn(c, "select_revit_instance", want);
				if (/^Selected:/.test(said.trim())) this.applied = key;
				else if (this.strictChoice) throw new Error(`select_revit_instance: lietotne nevarēja izvēlēties to pašu Revit sesiju, ko aģents (${said.trim().slice(0, 200)}). Nekas netika darīts citā sesijā.`);
			}
		}
		return this.callOn(c, tool, args);
	}

	private async callOn(c: Client, tool: string, args: Record<string, unknown>): Promise<string> {
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
