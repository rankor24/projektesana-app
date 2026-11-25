// One agent run on Google's Antigravity ACP server, for people who connect their own Google account. Same contract as pi/run.ts and claude/run.ts
// (PiRunOptions in, RunEvents out, never throws), so ThreadRunner and the lanes use any of the three engines.
//
// What stays the app's: the tool servers (connected through pi-mcp, as the other engines do) and the main process's own tools, offered to the server as one
// MCP server by the bridge (bridge.ts); the approval gate and the write locks (they run where a tool runs, in the bridge); the system prompt; the skills
// (in the standing prompt and read_skill). What is Antigravity's: the model loop, its retries and its context.
// The server also has tools of its own (a shell, file edits, a browser). This app's agents work through the app's tools only, so: the session is opened on
// `mode: default` (the server asks before it acts), every permission request that is not for one of the bridge's tools is refused, and the folder it works
// in is an empty one of the app's. Whether a tool of the server's own asks first is the server's rule, not this app's: see docs/ui-complaints.md.
import { connectMcpServers } from "../pi/mcp.js";
import type { RunEvent } from "../../shared/types.js";
import type { PiRunOptions } from "../pi/run.js";
import { BRIDGE_SERVER, startToolBridge } from "./bridge.js";
import { antigravityEnd, antigravityEvents, antigravitySignInError, antigravityToolEnded, antigravityToolStarted, antigravityUsage, newAntigravityState, ownToolRequest, permissionOption } from "./events.js";
import { AntigravitySignInRequired, noteAntigravitySignInRequired } from "./acp.js";
import type { AntigravityHost } from "./host.js";
import { ANTIGRAVITY_NOT_CONNECTED, ANTIGRAVITY_SIGN_IN_AGAIN } from "./provider.js";

export interface AntigravityEngineConfig {
	host: AntigravityHost;
	/** the app's own node (Electron's exe) that runs the relay with ELECTRON_RUN_AS_NODE=1 */
	nodePath: string;
	/** dist\agent\antigravity\bridge-stdio.js */
	bridgeScript: string;
	/** arguments of node before the script (a test runs the TypeScript source through tsx) */
	nodeArgs?: string[];
	log?: (line: string) => void;
}

export interface AntigravityRunOptions extends PiRunOptions {
	/** the ACP session to continue (the thread's conversation); absent = a new one */
	resume?: string;
	/** the session this run wrote to, for the next turn of the thread */
	onSession?: (sessionId: string) => void;
}

/** The turn's prompt: the standing instructions go with a new session only (a resumed one holds them already). */
export function antigravityPrompt(systemPrompt: string | undefined, prompt: string, resumed: boolean): string {
	if (resumed || !systemPrompt?.trim()) return prompt;
	return `[Norādes šai sarunai — ievēro tās visu sarunu]\n${systemPrompt.trim()}\n\n[Uzdevums]\n${prompt}`;
}

/** The env of the relay: only what node needs on Windows, and the bridge's address and token. */
export function relayEnv(bridge: { url: string; token: string }, base: NodeJS.ProcessEnv = process.env): { name: string; value: string }[] {
	const keep = ["SystemRoot", "SYSTEMROOT", "windir", "PATH", "Path", "TEMP", "TMP"];
	const env = keep.flatMap((k) => (base[k] ? [{ name: k, value: String(base[k]) }] : []));
	return [...env, { name: "ELECTRON_RUN_AS_NODE", value: "1" }, { name: "PROJEKTESANA_BRIDGE_URL", value: bridge.url }, { name: "PROJEKTESANA_BRIDGE_TOKEN", value: bridge.token }];
}

/** The engine, bound to the app's folders; the result has runPi's shape. */
export function createAntigravityRun(cfg: AntigravityEngineConfig) {
	return async function runAntigravity(o: AntigravityRunOptions): Promise<void> {
		const st = newAntigravityState();
		let reported = false;
		const send = (e: RunEvent) => {
			if (e.type === "error") reported = true;
			o.onEvent(e);
		};
		let closeTools: (() => Promise<void>) | undefined;
		let closeBridge: (() => Promise<void>) | undefined;
		let session: string | null = null;
		try {
			if (!(await cfg.host.installed()) || !(await cfg.host.signedIn())) throw new Error(ANTIGRAVITY_NOT_CONNECTED);
			const mcp = await connectMcpServers(o.mcp, { maxResultChars: 200_000 });
			closeTools = mcp.close;
			const missingOwn = mcp.missing.filter((m) => m.startsWith("projektesana-tools:"));
			if (missingOwn.length) throw new Error(`The tool servers did not offer: ${missingOwn.join(", ")}`);

			const bridge = await startToolBridge({
				tools: [...mcp.tools, ...(o.extraTools ?? [])],
				beforeToolCall: o.beforeToolCall,
				afterToolCall: o.afterToolCall,
				signal: o.signal,
				emit: (e) => {
					send(e);
					if (e.type === "tool_result") antigravityToolEnded(st);
				},
				onToolStart: () => antigravityToolStarted(st).forEach(send),
			});
			closeBridge = bridge.close;
			const offered = new Set(bridge.names);
			const folders = cfg.host.folders;

			const opened = await cfg.host.openSession(
				{
					...(o.resume ? { resume: o.resume } : {}),
					cwd: folders.work,
					mcpServers: [{ name: BRIDGE_SERVER, command: cfg.nodePath, args: [...(cfg.nodeArgs ?? []), cfg.bridgeScript], env: relayEnv(bridge) }],
					model: o.modelId?.trim() ?? "",
					variant: o.effort ?? "",
				},
				{
					update: (u) => antigravityEvents(u, st).forEach(send),
					permission: async (params) => {
						const tool = ownToolRequest(params.toolCall, BRIDGE_SERVER, offered);
						const option = permissionOption(params.options, tool ? "allow" : "reject");
						if (!tool) cfg.log?.(`antigravity: refused a tool of the server's own (${String(params.toolCall?.kind ?? "?")}: ${String(params.toolCall?.title ?? "").slice(0, 80)})`);
						return option ? { outcome: { outcome: "selected", optionId: option } } : { outcome: { outcome: "cancelled" } };
					},
				},
			);
			session = opened.sessionId;
			o.onSession?.(opened.sessionId);
			if (o.resume && !opened.resumed) send({ type: "text", text: "[lietotne] Antigravity iepriekšējo sarunu vairs neatrada: šī sākas no jauna.\n\n" });

			const blocks = [
				{ type: "text", text: antigravityPrompt(o.systemPrompt, o.prompt, opened.resumed) },
				...(o.images ?? []).map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType })),
			];
			// a stop ends the prompt by itself (session/cancel); a server that does not answer in time is left behind
			const stopped = new Promise<never>((_resolve, reject) => {
				const onAbort = () => setTimeout(() => reject(new Error("aborted")), 15_000).unref?.();
				if (o.signal.aborted) onAbort();
				else o.signal.addEventListener("abort", onAbort, { once: true });
			});
			const result = await Promise.race([cfg.host.prompt(opened.sessionId, blocks, o.signal), stopped]);
			const usage = antigravityUsage(result);
			if (usage) send(usage);
			antigravityEnd(result, st, o.signal.aborted).forEach(send);
		} catch (e) {
			if (!reported) {
				const err = e as Error;
				if (o.signal.aborted) send({ type: "error", engine: "pi", message: "aborted" });
				else if (err instanceof AntigravitySignInRequired || antigravitySignInError(err)) {
					await noteAntigravitySignInRequired(cfg.host.tokenPath);
					send({ type: "error", engine: "pi", message: ANTIGRAVITY_SIGN_IN_AGAIN });
				} else send({ type: "error", engine: "pi", message: err.message });
			}
		} finally {
			if (session) cfg.host.release(session);
			await closeBridge?.().catch(() => undefined);
			await closeTools?.().catch(() => undefined);
		}
	};
}
