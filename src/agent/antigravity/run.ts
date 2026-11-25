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
import { antigravityContext, antigravityEnd, antigravityEvents, antigravitySignInError, antigravityToolEnded, antigravityToolStarted, antigravityUsage, newAntigravityState, ownToolRequest, permissionOption } from "./events.js";
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
	/** a prompt with no sign of life (no update from the server, no tool call going) for this long is cancelled and the work resumed once in the same session; default 5 minutes */
	stallMs?: number;
	/** how long a cancel may take before the server is left behind (tests make it short) */
	cancelWaitMs?: number;
}

/** The default silence after which a prompt counts as stuck. A model that thinks without streaming its thoughts is quiet for a minute or two; ten minutes of nothing (a stalled call, a quota backoff the server retries silently) must not leave the chat "working" for ever. */
export const STALL_MS = 5 * 60_000;

/** What the resumed prompt says after a stall: the same session still holds the whole task. */
export const STALL_RESUME = "[lietotne] Serveris ilgi neatbildēja, tāpēc pēdējais solis tika pārtraukts. Turpini darbu no vietas, kur apstājies: tas pats uzdevums, tie paši rīki.";

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
		// the context size the server reported last (usage_update): what the thread's meter shows, not the sum the prompt answer bills
		let context: { used: number; window?: number } | null = null;
		// signs of life: the server's updates, the app's own tool calls (one going keeps the run alive however long it takes: a Revit batch, a question to the user)
		let lastAt = Date.now();
		let inFlight = 0;
		const alive = () => {
			lastAt = Date.now();
		};
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
					if (e.type === "tool_result") {
						inFlight = Math.max(0, inFlight - 1);
						antigravityToolEnded(st);
					}
					alive();
				},
				onToolStart: () => {
					inFlight++;
					alive();
					antigravityToolStarted(st).forEach(send);
				},
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
					update: (u) => {
						alive();
						context = antigravityContext(u) ?? context;
						antigravityEvents(u, st).forEach(send);
					},
					permission: async (params) => {
						alive();
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
			const stallMs = cfg.stallMs ?? STALL_MS;
			// One prompt to its end. A stop ends it by itself (session/cancel); a server that does not answer a cancel in time is left behind. A prompt that shows no sign of life for
			// `stallMs` is cancelled by the watchdog: `stalled` with a result = the server honoured the cancel (the session is usable), `stalled` without = it did not.
			const prompt = async (parts: unknown[]): Promise<{ result: Awaited<ReturnType<typeof cfg.host.prompt>> | null; stalled: boolean }> => {
				const inner = new AbortController();
				const onOuter = () => inner.abort();
				if (o.signal.aborted) inner.abort();
				else o.signal.addEventListener("abort", onOuter, { once: true });
				let stalled = false;
				alive();
				const timer = setInterval(() => {
					if (inFlight === 0 && Date.now() - lastAt > stallMs) {
						stalled = true;
						inner.abort();
					}
				}, Math.max(20, Math.min(5_000, Math.floor(stallMs / 4))));
				timer.unref?.();
				const left = new Promise<never>((_resolve, reject) => {
					const onAbort = () => setTimeout(() => reject(new Error(stalled ? "stalled" : "aborted")), cfg.cancelWaitMs ?? 15_000).unref?.();
					if (inner.signal.aborted) onAbort();
					else inner.signal.addEventListener("abort", onAbort, { once: true });
				});
				try {
					return { result: await Promise.race([cfg.host.prompt(opened.sessionId, parts, inner.signal), left]), stalled };
				} catch (e) {
					if (stalled && !o.signal.aborted) return { result: null, stalled: true };
					throw e;
				} finally {
					clearInterval(timer);
					o.signal.removeEventListener("abort", onOuter);
				}
			};
			let r = await prompt(blocks);
			if (r.stalled && r.result) {
				// the server stopped the stuck step: the same session carries on with the task, once
				const first = antigravityUsage(r.result, context);
				if (first) send(first);
				send({ type: "text", text: "[lietotne] Antigravity ilgi neatbildēja: solis pārtraukts, darbs turpinās tajā pašā sesijā.\n\n" });
				r = await prompt([{ type: "text", text: STALL_RESUME }]);
			}
			if (r.stalled || !r.result) throw new Error(`Antigravity ilgi (vairāk nekā ${Math.max(1, Math.round(stallMs / 60_000))} min) neko nedarīja un neatsaucās uz pārtraukšanu vai apstājās atkal. Spied «Sūtīt» vēlreiz vai izvēlies citu modeli.`);
			const usage = antigravityUsage(r.result, context);
			if (usage) send(usage);
			antigravityEnd(r.result, st, o.signal.aborted).forEach(send);
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
