// One path into Revit (spec §9): a small MCP client that starts the Revit MCP server over stdio.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RevitCaller } from "./commands.js";

export interface RevitConnection extends RevitCaller {
	close(): Promise<void>;
}

/** Starts the server and connects. Throws when the server cannot start; the caller shows `not connected`. */
export async function connectRevit(serverJs: string): Promise<RevitConnection> {
	const transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: "1" } });
	const client = new Client({ name: "projektesana-app", version: "0.1.0" });
	await client.connect(transport);
	return {
		async call(tool, args) {
			const res = (await client.callTool({ name: tool, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
			const text = (res.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
			if (res.isError) throw new Error(text || `Revit rīks ${tool} atgrieza kļūdu.`);
			return text;
		},
		close: () => client.close(),
	};
}
