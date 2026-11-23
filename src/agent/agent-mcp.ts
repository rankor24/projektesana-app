// An agent's own MCP servers (AgentSpec.mcp): what a run connects, at which level each tool runs, listing a server's tools for the settings dialog, and keeping the secrets
// of a server (env values, headers) out of the window.
//
// Ported from OpenMausBot (Apache-2.0) docs/custom-mcp-servers.md: a server is added by pasting its command (shared/mcp-paste.ts does the reading), it is tried at once ("Connected:
// 12 tools" / "Saved, but off: the test failed" with the reason, `probeMcpTools` here), its keys are write-only (the window sees "set", never the value: `maskMcp`,
// `restoreSecrets`), and a server that does not answer is off, not an error in every conversation.
// Adapted: OpenMausBot turns a server on for the whole team or a bot; here a server belongs to one agent and no other agent sees its tools. Every tool of it is a `confirm`
// tool (the user is asked per batch, like a Revit change) unless the user marked it read in the dialog; a tool the server adds later stays out until the dialog lists the
// server again (the allow-list is the listed `tools`, as the app's own server and Revit's are held to theirs). The tools carry the server's name as a prefix
// (`<server>__<tool>`), so two servers cannot offer one name.
import { MCP_SECRET_SET, type AgentMcpServer, type AgentSpec } from "../shared/agent-types.js";
import { connectMcpTools, prefixedToolName, type McpLaunchSpec } from "./pi/mcp.js";
import type { Level } from "./tools/levels.js";

/** The name the model sees for a tool of an agent's server. */
export const mcpToolName = (server: string, tool: string): string => prefixedToolName(server, tool);

/** How a run connects one server of an agent (the prefix and `optional` are described in pi/mcp.ts). `allow` is the listed tools, by the server's own names. */
export function launchOf(s: AgentMcpServer): McpLaunchSpec & { allow: string[] } {
	const base = { allow: [...(s.tools ?? [])], prefix: s.name, optional: true };
	return s.url ? { ...base, command: "", args: [], env: {}, url: s.url, ...(s.headers ? { headers: s.headers } : {}) } : { ...base, command: s.command ?? "", args: s.args ?? [], env: s.env ?? {} };
}

/** What a run of this agent connects beside the app's own server, and the level of each tool it offers: `confirm`, or `read` for a tool the user marked. A server with no
 *  listed tool is not connected (nothing would be offered). */
export function agentMcpRun(spec: Pick<AgentSpec, "mcp">): { servers: Record<string, McpLaunchSpec & { allow: string[] }>; levels: Record<string, Level> } {
	const servers: Record<string, McpLaunchSpec & { allow: string[] }> = {};
	const levels: Record<string, Level> = {};
	for (const s of spec.mcp ?? []) {
		if (!s.tools?.length) continue;
		servers[s.name] = launchOf(s);
		for (const t of s.tools) levels[mcpToolName(s.name, t)] = s.read?.includes(t) ? "read" : "confirm";
	}
	return { servers, levels };
}

/** The tools a server offers, found by connecting to it once (the dialog's "Pārbaudīt"). Rejects with the server's own reason; nothing is kept running. */
export async function probeMcpTools(s: AgentMcpServer, timeoutMs = 25_000): Promise<{ name: string; description: string }[]> {
	// the listing is the point here: no allow-list (every tool the server has), and no prefix
	const { allow: _a, prefix: _p, optional: _o, ...spec } = launchOf(s);
	let timer: NodeJS.Timeout | undefined;
	let hung = false;
	const connecting = connectMcpTools(spec, { clientName: "projektesana-probe", callTimeoutMs: timeoutMs });
	try {
		const t = await Promise.race([
			connecting,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					hung = true;
					reject(new Error(`Serveris neatbild ${Math.round(timeoutMs / 1000)} s.`));
				}, timeoutMs);
			}),
		]);
		const out = t.tools.map((x) => ({ name: x.name, description: (x.description ?? "").split(/(?<=\.)\s/)[0]?.slice(0, 200) ?? "" }));
		await t.close();
		return out;
	} finally {
		clearTimeout(timer);
		// a server that answered after the time ran out must still be stopped
		if (hung) void connecting.then((t) => t.close()).catch(() => undefined);
	}
}

// ---- secrets -------------------------------------------------------------------------------------------------------------------

const maskPairs = (p: Record<string, string> | undefined) => (p ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ? MCP_SECRET_SET : ""])) : p);

/** The specs as the window gets them: every env value and header value that is set is the mask, so a secret never reaches the page. */
export function maskMcp<T extends Pick<AgentSpec, "mcp">>(spec: T): T {
	if (!spec.mcp?.length) return spec;
	return { ...spec, mcp: spec.mcp.map((s) => ({ ...s, ...(s.env ? { env: maskPairs(s.env) } : {}), ...(s.headers ? { headers: maskPairs(s.headers) } : {}) })) };
}

/** A save or a probe from the window: a value that is still the mask is the saved one of the same server and name (the user did not touch it); one with no saved value is dropped. */
export function restoreSecrets(next: AgentMcpServer[] | undefined, saved: readonly AgentMcpServer[] | undefined): AgentMcpServer[] | undefined {
	if (!next) return next;
	const back = (now: Record<string, string> | undefined, was: Record<string, string> | undefined) => {
		if (!now) return now;
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(now)) {
			if (v !== MCP_SECRET_SET) out[k] = v;
			else if (was && Object.hasOwn(was, k) && was[k]) out[k] = was[k]!;
		}
		return out;
	};
	return next.map((s) => {
		const was = saved?.find((x) => x.name === s.name);
		return { ...s, ...(s.env ? { env: back(s.env, was?.env) } : {}), ...(s.headers ? { headers: back(s.headers, was?.headers) } : {}) };
	});
}
