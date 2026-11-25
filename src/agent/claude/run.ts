// One agent run on the Claude Agent SDK, for users who connect their own Claude subscription (a Sign in by `claude auth login`, or a pasted `claude setup-token`).
// Same contract as pi/run.ts (PiRunOptions in, RunEvents out, never throws), so ThreadRunner and the lanes use either engine.
//
// What stays the app's: the tool servers (connected through pi-mcp, as pi does), the approval gate and the write locks
// (beforeToolCall / afterToolCall, called from the SDK's canUseTool and from the tool results), the system prompt, the
// skills (in the standing prompt and read_skill). What is Claude Code's: the loop, retries, and compaction of a long conversation.
// Claude Code's own tools, settings files, CLAUDE.md and auto mode are all switched off: the run sees only the app's tools.
//
// SDK surface from @anthropic-ai/claude-agent-sdk 0.3.322 sdk.d.ts: query, Options (tools, mcpServers, canUseTool, permissionMode,
// settingSources, includePartialMessages, resume, env, pathToClaudeCodeExecutable), CanUseTool (toolUseID), SDKUserMessage.
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { query, type CanUseTool, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunEvent } from "../../shared/types.js";
import { connectMcpServers } from "../pi/mcp.js";
import { effortFor, lookupPiModel } from "../pi/models.js";
import { DEFAULT_MAX_TURNS, DEFAULT_SYSTEM_PROMPT, type PiRunOptions } from "../pi/run.js";
import { claudeEvents, newClaudeState, toolNameOf, TOOL_SERVER } from "./events.js";
import { claudeBaseEnv } from "./login.js";
import { catalogProvider, claudeEffort, CLAUDE_SUB, NOT_CONNECTED } from "./provider.js";
import { toolServer } from "./tools.js";
import { STALL_MS, STALL_NOTE, STALL_RESUME, StallWatch, stallError } from "../stall.js";

export interface ClaudeEngineConfig {
	/** The user's setup-token (stored encrypted by the settings); null = none pasted. */
	token: () => string | null;
	/** Is there a login made by Sign in in `configDir`? Asked only when there is no setup-token (a pasted token wins); absent = no login offered. */
	login?: () => Promise<boolean>;
	/** claude.exe of the SDK's platform package, outside the asar in a packaged app; undefined = the SDK finds it (development). */
	executable?: string;
	/** Claude Code's own config folder for this app (sessions, caches): never the user's ~/.claude, so none of their settings, hooks or memory reach a run. */
	configDir: string;
	/** Working folder of every run: fixed, because a session is resumed by the folder it was started in. */
	cwd: string;
	/** "projektesana/2.5.0": named in the SDK's User-Agent. */
	clientApp: string;
	/** Claude Code's stderr lines (diagnostics). */
	log?: (line: string) => void;
	/** The SDK's `query`; tests inject a scripted one. */
	query?: typeof query;
}

export interface ClaudeRunOptions extends PiRunOptions {
	/** The SDK session to continue (the thread's conversation); absent = a new one. */
	resume?: string;
	/** The session this run wrote to, for the next turn of the thread. */
	onSession?: (sessionId: string) => void;
}

/** The environment of claude.exe: the app's config folder and, when there is one, the setup-token; nothing that would switch the account or the endpoint.
 * No token = the run uses the login in the config folder, so a `CLAUDE_CODE_OAUTH_TOKEN` of the user's shell must not reach it either. */
export function claudeEnv(token: string | null, cfg: Pick<ClaudeEngineConfig, "configDir" | "clientApp">, base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
	// a colleague's own key or proxy settings must not change which account a run uses (same rule as pi's createPiRuntime)
	// The SDK would compact a long session inside itself and lose the original. The app compacts instead (thread-runner `compactSession`): the old session stays, the work goes on in a new one.
	return { ...claudeBaseEnv(cfg.configDir, base), ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}), CLAUDE_AGENT_SDK_CLIENT_APP: cfg.clientApp, DISABLE_AUTO_COMPACT: "1" };
}

type Block = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

/**
 * The batches the approval gate asks about. pi hands the gate the assistant message, and the gate asks once for all its `confirm`
 * tools (tools/levels.ts Gate.before). The SDK asks per tool, and may start a tool before the message has all its tool calls,
 * so a batch is what the message holds at the first ask; a tool call that arrives after it starts a batch of its own and is asked
 * about again. Nothing is ever run on an answer given before the user saw it.
 */
export class Batches {
	private blocks = new Map<string, Block[]>();
	private msgOf = new Map<string, string>();
	private groups = new Map<string, { msg: object; ids: Set<string> }[]>();

	add(messageId: string, b: Block) {
		const list = this.blocks.get(messageId) ?? [];
		if (!list.some((x) => x.id === b.id)) list.push(b);
		this.blocks.set(messageId, list);
		this.msgOf.set(b.id, messageId);
	}

	/** The message object the gate keys its answer on, for this tool call. */
	messageFor(id: string, fallback: Block): object {
		const mid = this.msgOf.get(id);
		if (!mid) return { role: "assistant", content: [fallback] };
		const groups = this.groups.get(mid) ?? [];
		const g = groups.find((x) => x.ids.has(id));
		if (g) return g.msg;
		const asked = new Set(groups.flatMap((x) => [...x.ids]));
		const content = (this.blocks.get(mid) ?? []).filter((b) => !asked.has(b.id));
		const ng = { msg: { role: "assistant", content }, ids: new Set(content.map((b) => b.id)) };
		groups.push(ng);
		this.groups.set(mid, groups);
		return ng.msg;
	}
}

/** The engine, bound to the user's token and the app's folders; the result has runPi's shape. */
export function createClaudeRun(cfg: ClaudeEngineConfig) {
	return async function runClaude(o: ClaudeRunOptions): Promise<void> {
		const maxTurns = o.maxTurns ?? DEFAULT_MAX_TURNS;
		const st = newClaudeState(maxTurns);
		let reported = false;
		const send = (e: RunEvent) => {
			if (e.type === "error") reported = true;
			o.onEvent(e);
		};
		const abort = new AbortController();
		const stop = () => abort.abort();
		if (o.signal.aborted) stop();
		else o.signal.addEventListener("abort", stop, { once: true });
		// the input stays open until the result: the in-process tool server talks over the same channel
		let finish: () => void = () => undefined;
		const finished = new Promise<void>((r) => (finish = r));
		abort.signal.addEventListener("abort", () => finish(), { once: true });
		let closeTools: (() => Promise<void>) | undefined;
		let session: string | null = null;
		try {
			const token = cfg.token();
			if (!token && !(await cfg.login?.())) throw new Error(NOT_CONNECTED);
			// the model and effort as pi's Claude catalog knows them: an effort the model lacks becomes its default
			const model = o.model ?? lookupPiModel(o.runtime, catalogProvider(o.provider ?? CLAUDE_SUB), o.modelId);
			const effort = claudeEffort(effortFor(model, o.effort));

			const mcp = await connectMcpServers(o.mcp, { maxResultChars: 200_000 });
			closeTools = mcp.close;
			const missingOwn = mcp.missing.filter((m) => m.startsWith("projektesana-tools:"));
			if (missingOwn.length) throw new Error(`The tool servers did not offer: ${missingOwn.join(", ")}`);

			// the tool_use id the permission check saw, per tool and in order: the tool runs with that id (tools run one at a time)
			const ids = new Map<string, string[]>();
			let anon = 0;
			const nextId = (tool: string) => ids.get(tool)?.shift() ?? `call-${++anon}`;
			const bridge = toolServer(TOOL_SERVER, [...mcp.tools, ...(o.extraTools ?? [])], nextId, abort.signal);
			const offered = new Set(bridge.names);
			const batches = new Batches();

			const canUseTool: CanUseTool = async (sdkName, input, opt) => {
				const name = toolNameOf(sdkName);
				if (!offered.has(name)) return { behavior: "deny", message: `Rīks ${sdkName} šajā lietotnē nav pieejams.` };
				const call: Block = { type: "toolCall", id: opt.toolUseID, name, arguments: input };
				const ctx = { assistantMessage: batches.messageFor(opt.toolUseID, call), toolCall: call, args: input, context: undefined } as unknown as BeforeToolCallContext;
				const r = o.beforeToolCall ? await o.beforeToolCall(ctx, opt.signal) : undefined;
				if (r?.block) return { behavior: "deny", message: r.reason ?? "Bloķēts." };
				ids.set(name, [...(ids.get(name) ?? []), opt.toolUseID]);
				return { behavior: "allow", updatedInput: input };
			};

			// a turn that shows no sign of life (no message from the SDK, no tool going) is stopped and the session asked to carry on, once; the second silence ends the run in words
			const stallMs = o.stallMs ?? STALL_MS;
			let current = new AbortController();
			const watch = new StallWatch(stallMs, () => current.abort());
			const going = new Set<string>();
			const once = async (resume: string | undefined, text: string, images: ClaudeRunOptions["images"]): Promise<void> => {
				const ac = new AbortController();
				current = ac;
				const link = () => ac.abort();
				if (abort.signal.aborted) link();
				else abort.signal.addEventListener("abort", link, { once: true });
				let done: () => void = () => undefined;
				const over = new Promise<void>((r) => (done = r));
				ac.signal.addEventListener("abort", () => done(), { once: true });
				const content = [
					{ type: "text" as const, text },
					...(images ?? []).map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mimeType as "image/png", data: i.data } })),
				];
				async function* input(): AsyncIterable<SDKUserMessage> {
					yield { type: "user", parent_tool_use_id: null, message: { role: "user", content } };
					await over;
				}

				const q = (cfg.query ?? query)({
					prompt: input(),
					options: {
						abortController: ac,
						cwd: cfg.cwd,
						model: model.id,
						...(effort ? { effort } : {}),
						systemPrompt: o.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
						// no built-in tools (Bash, Edit, Task…), no settings files or CLAUDE.md, no other MCP servers: the app's tools only
						tools: [],
						settingSources: [],
						strictMcpConfig: true,
						mcpServers: { [TOOL_SERVER]: { type: "sdk", name: TOOL_SERVER, instance: bridge.server } },
						// every call goes through canUseTool; omitted, the mode could be "auto" and a classifier would approve
						permissionMode: "default",
						canUseTool,
						includePartialMessages: true,
						maxTurns,
						...(resume ? { resume } : {}),
						...(cfg.executable ? { pathToClaudeCodeExecutable: cfg.executable } : {}),
						env: claudeEnv(token, cfg),
						stderr: (d) => cfg.log?.(d),
					},
				});

				try {
					for await (const m of q) {
						// the watchdog stopped this turn: what the stopped query still says is not the run's end
						if (watch.stalled) break;
						watch.alive();
						if (!session && "session_id" in m && typeof m.session_id === "string" && m.session_id) {
							session = m.session_id;
							o.onSession?.(session);
						}
						if (m.type === "assistant" && !m.parent_tool_use_id) {
							for (const c of m.message.content)
								if (c.type === "tool_use") {
									going.add(c.id);
									watch.tool(1);
									batches.add(m.message.id, { type: "toolCall", id: c.id, name: toolNameOf(c.name), arguments: (c.input ?? {}) as Record<string, unknown> });
								}
						}
						// a tool's result frees the lock its call took in the gate
						if (m.type === "user" && !m.parent_tool_use_id && Array.isArray(m.message.content)) {
							for (const c of m.message.content)
								if (c.type === "tool_result") {
									if (going.delete(c.tool_use_id)) watch.tool(-1);
									await o.afterToolCall?.({ toolCall: { id: c.tool_use_id } } as never, abort.signal);
								}
						}
						for (const e of claudeEvents(m, st)) send(e);
						if (m.type === "result") done();
					}
				} catch (e) {
					// an abort by the watchdog ends the loop with an error: not the run's failure
					if (!watch.stalled) throw e;
				} finally {
					done();
					abort.signal.removeEventListener("abort", link);
				}
			};

			try {
				watch.start();
				await once(o.resume, o.prompt, o.images);
				if (watch.stalled && !abort.signal.aborted) {
					if (!session) throw new Error(stallError(stallMs));
					going.clear();
					send({ type: "text", text: STALL_NOTE });
					watch.start();
					await once(session, STALL_RESUME, undefined);
					if (watch.stalled && !abort.signal.aborted) throw new Error(stallError(stallMs));
				}
			} finally {
				watch.stop();
			}
		} catch (e) {
			if (!reported) send({ type: "error", engine: "pi", message: abort.signal.aborted ? "aborted" : (e as Error).message });
		} finally {
			finish();
			o.signal.removeEventListener("abort", stop);
			// no AgentMessages to hand back (onMessages is not called): the conversation lives in the SDK session, see onSession
			await closeTools?.().catch(() => undefined);
		}
		if (!reported && !st.errored && abort.signal.aborted) send({ type: "error", engine: "pi", message: "aborted" });
	};
}
