// One agent run on pi: connect the tool servers, build an Agent, stream its events as RunEvents.
//
// Borrowed from BIM Crew apps/server/src/runtime/runtime.ts (runAgent), via konkurss-app/src/agent-pi/run.ts:
// new Agent({ initialState, streamFn, toolExecution }), agent.subscribe, finishTurn for a turn limit,
// agent.abort on the caller's signal. Carried from projektesana-app v1. Changed for v2: the approval gate runs on pi's
// beforeToolCall hook; the previous messages of the conversation are passed in and handed back, so a chat keeps its context.
// A turn that fails on the wire is restarted with backoff (retry.ts) instead of ending the run.
import { Agent, type AfterToolCallContext, type AfterToolCallResult, type AgentMessage, type AgentTool, type BeforeToolCallContext, type BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, ImageContent, Model, RetryPolicy, TextContent } from "@earendil-works/pi-ai";
import type { RunEvent } from "../../shared/types.js";
import { newPiState, piEvents } from "./events.js";
import { connectMcpServers, type McpLaunchSpec } from "./mcp.js";
import { effortFor, lookupPiModel, streamFn, type PiEffort, type PiRuntime } from "./models.js";
import { RUN_RETRY, dropFailedTail, dropStoppedTail, retryDelay, sleep, willRetry } from "./retry.js";
import { STALL_MS, STALL_NOTE, StallWatch, stallError } from "../stall.js";

/** A way into a running agent: a message the user wrote meanwhile is queued and read after the agent's current step (pi's `steer`). */
export interface SteerHandle {
	/** Queues one user message. `taken` is called when the agent loop has taken it into the conversation (it is then part of what the agent has read). */
	push(m: { text: string; images?: ImageContent[] }, taken: () => void): void;
	/** Takes back what the agent has not read yet. True when it was still waiting: it will never reach the agent. False when there is nothing, or it is being read now. */
	withdraw(): boolean;
}

export interface PiRunOptions {
	runtime: PiRuntime;
	provider?: string;
	/** Empty = the provider's default model. */
	modelId?: string;
	/** A model already looked up; wins over provider and modelId. */
	model?: Model<Api>;
	prompt: string;
	/** images that go with the prompt (pasted screenshots); the caller checks the model takes images */
	images?: ImageContent[];
	systemPrompt?: string;
	/** server name → how to start it and which of its tools the model may use */
	mcp: Record<string, McpLaunchSpec & { allow: readonly string[] }>;
	signal: AbortSignal;
	onEvent: (e: RunEvent) => void;
	/** Stop after this many model responses (default 80: a modelling batch makes many tool calls). */
	maxTurns?: number;
	/** Chosen effort; ignored when the model does not support it (then the model's default). */
	effort?: PiEffort;
	/** The approval gate. */
	beforeToolCall?: (ctx: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	/** After every tool call (a lane frees its write lock here). */
	afterToolCall?: (ctx: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
	/** Tools of the main process, offered next to the tool servers' tools (sub-agents and delegate, task 8.15). */
	extraTools?: AgentTool<any>[];
	/** Messages of the conversation so far (same model family). */
	history?: AgentMessage[];
	/** Receives the conversation after the run, for the next turn. */
	onMessages?: (messages: AgentMessage[]) => void;
	/** Restarts of a turn that failed on the wire (default RUN_RETRY: 4 restarts, 2–16 s apart). */
	retry?: RetryPolicy;
	/** Silence after which a model turn is stopped and asked again once (default 5 minutes, agent/stall.ts); tests make it short. */
	stallMs?: number;
	/** The model call; defaults to the runtime's. Tests inject a scripted one. */
	streamFn?: ReturnType<typeof streamFn>;
	/** Steering: called with a handle once the agent exists, and with null when the run is over (a message not read by then is the caller's to deliver another way).
	 *  An engine that cannot take a message mid-run never calls it. */
	onSteer?: (h: SteerHandle | null) => void;
}

export const DEFAULT_MAX_TURNS = 80;

export const DEFAULT_SYSTEM_PROMPT =
	"You work inside a desktop application for architectural design. Use only the tools you are given. Follow the task exactly, and answer in the language the task is written in.";

/** Runs the task to the end. Never throws: every failure is reported as an `error` event with the provider's own text. */
export async function runPi(o: PiRunOptions): Promise<void> {
	const st = newPiState();
	let reported = false;
	const send = (e: RunEvent) => {
		if (e.type === "error") reported = true;
		o.onEvent(e);
	};
	let closeTools: (() => Promise<void>) | undefined;
	let agent: Agent | undefined;
	try {
		const model = o.model ?? lookupPiModel(o.runtime, o.provider ?? "", o.modelId);
		const mcp = await connectMcpServers(o.mcp, { maxResultChars: 200_000 });
		closeTools = mcp.close;
		// the app's own tools must all be there; an external server (Revit) of another version may lack some: they are just not offered
		const missingOwn = mcp.missing.filter((m) => m.startsWith("projektesana-tools:"));
		if (missingOwn.length) throw new Error(`The tool servers did not offer: ${missingOwn.join(", ")}`);

		const maxTurns = o.maxTurns ?? DEFAULT_MAX_TURNS;
		const identity = o.runtime.identity;
		agent = new Agent({
			initialState: {
				systemPrompt: o.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
				model,
				thinkingLevel: effortFor(model, o.effort),
				tools: [...mcp.tools, ...(o.extraTools ?? [])],
				messages: o.history ?? [],
			},
			streamFn: o.streamFn ?? streamFn(o.runtime.models),
			// tools write project state and drive one Revit: one at a time
			toolExecution: "sequential",
			beforeToolCall: o.beforeToolCall,
			afterToolCall: o.afterToolCall,
			...(identity ? { identity: { attribution: { name: identity.name, url: identity.url } } } : {}),
		});

		// steering: the agent loop reads a queued message after the current assistant turn and its tool calls. The caller queues one message at a time, but a second can follow
		// while the loop is already reading the first, so the messages not yet announced are a list (the newest is the only one that can still be taken back)
		let queued: { message: AgentMessage; taken: () => void }[] = [];
		const a0 = agent;
		o.onSteer?.({
			push: (m, taken) => {
				const content: (TextContent | ImageContent)[] = [{ type: "text", text: m.text }, ...(m.images ?? [])];
				const message: AgentMessage = { role: "user", content, timestamp: Date.now() };
				queued.push({ message, taken });
				a0.steer(message);
			},
			withdraw: () => {
				// drained but not yet announced: the loop is reading it now, so it can no longer be taken back
				if (!queued.length || !a0.hasQueuedMessages()) return false;
				a0.clearSteeringQueue();
				queued.pop();
				return true;
			},
		});

		let turns = 0;
		agent.finishTurn = async (turn) => {
			if (++turns >= maxTurns && turn.toolResults.length > 0) {
				send({ type: "error", engine: "pi", message: `Sasniegts soļu limits (${maxTurns}).` });
				st.errored = true;
				return { action: "end" };
			}
			return undefined;
		};
		// a turn that failed on the wire (fetch failed, 429, 5xx…) is held back instead of shown as the run's end:
		// its message_end / turn_end / agent_end would tell the side panel the run is over
		const policy = o.retry ?? RUN_RETRY;
		let restarts = 0;
		let held = null as AgentMessage | null;
		// a model turn that shows no sign of life is stopped (the abort ends its message) and asked again, once; its end events are not shown as the run's end
		let stallHold = false;
		const stallMs = o.stallMs ?? STALL_MS;
		const watch = new StallWatch(stallMs, () => {
			stallHold = true;
			agent?.abort();
		});
		agent.subscribe((ev) => {
			watch.alive();
			if (ev.type === "tool_execution_start") watch.tool(1);
			else if (ev.type === "tool_execution_end") watch.tool(-1);
			if (stallHold && (ev.type === "message_end" || ev.type === "turn_end" || ev.type === "agent_end")) return;
			if (ev.type === "message_end" && !o.signal.aborted && willRetry(ev.message, restarts + 1, policy)) held = ev.message;
			if (queued.length && ev.type === "message_start" && ev.message.role === "user") {
				const at = queued.findIndex((q) => q.message === ev.message || (q.message as { timestamp?: number }).timestamp === (ev.message as { timestamp?: number }).timestamp);
				if (at >= 0) queued.splice(at, 1)[0].taken();
			}
			if (held && (ev.type === "message_end" || ev.type === "turn_end" || ev.type === "agent_end")) return;
			for (const r of piEvents(ev, st)) send(r);
		});

		const a = agent;
		const stop = () => a.abort();
		if (o.signal.aborted) stop();
		else o.signal.addEventListener("abort", stop, { once: true });
		try {
			watch.start();
			await agent.prompt(o.prompt, o.images?.length ? o.images : undefined);
			let resumed = false;
			// restart the failed turn from the same transcript: the user's prompt and every tool result so far stay
			while (held || (watch.stalled && !o.signal.aborted)) {
				if (watch.stalled) {
					// a stuck turn: stopped by the watchdog, asked again from what came before; the second silence ends the run in words
					stallHold = false;
					agent.state.messages = dropStoppedTail(agent.state.messages);
					if (resumed) {
						st.errored = true;
						send({ type: "error", engine: "pi", message: stallError(stallMs) });
						break;
					}
					resumed = true;
					send({ type: "text", text: STALL_NOTE });
					watch.start();
					await agent.continue();
					continue;
				}
				const failed = held as AssistantMessage;
				held = null;
				restarts++;
				const delayMs = retryDelay(restarts, policy);
				send({ type: "retry", attempt: restarts, of: policy.maxRetries, delayMs, message: failed.errorMessage || "error" });
				if (!(await sleep(delayMs, o.signal))) {
					st.errored = true;
					send({ type: "error", engine: "pi", message: "aborted" });
					break;
				}
				agent.state.messages = dropFailedTail(agent.state.messages);
				await agent.continue();
			}
		} finally {
			watch.stop();
			o.signal.removeEventListener("abort", stop);
		}
		if (!reported && !st.errored && agent.state.errorMessage) send({ type: "error", engine: "pi", message: agent.state.errorMessage });
	} catch (e) {
		if (!reported) send({ type: "error", engine: "pi", message: (e as Error).message });
	} finally {
		// a failed last turn is not carried into the next message: it holds no answer, only an empty assistant turn
		if (agent) o.onMessages?.(dropFailedTail(agent.state.messages));
		// the agent is gone: a message it did not read is the caller's to deliver another way (a new attempt gets a handle of its own)
		o.onSteer?.(null);
		await closeTools?.().catch(() => undefined);
	}
}
