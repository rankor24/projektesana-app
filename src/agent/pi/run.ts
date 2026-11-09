// One agent run on pi: connect the tool servers, build an Agent, stream its events as RunEvents.
//
// Borrowed from BIM Crew apps/server/src/runtime/runtime.ts (runAgent), via konkurss-app/src/agent-pi/run.ts:
// new Agent({ initialState, streamFn, toolExecution }), agent.subscribe, finishTurn for a turn limit,
// agent.abort on the caller's signal. Carried from projektesana-app v1. Changed for v2: the approval gate runs on pi's
// beforeToolCall hook; the previous messages of the conversation are passed in and handed back, so a chat keeps its context.
// A turn that fails on the wire is restarted with backoff (retry.ts) instead of ending the run.
import { Agent, type AgentMessage, type BeforeToolCallContext, type BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, ImageContent, Model, RetryPolicy } from "@earendil-works/pi-ai";
import type { RunEvent } from "../../shared/types.js";
import { newPiState, piEvents } from "./events.js";
import { connectMcpServers, type McpLaunchSpec } from "./mcp.js";
import { effortFor, lookupPiModel, streamFn, type PiEffort, type PiRuntime } from "./models.js";
import { RUN_RETRY, dropFailedTail, retryDelay, sleep, willRetry } from "./retry.js";

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
	/** Messages of the conversation so far (same model family). */
	history?: AgentMessage[];
	/** Receives the conversation after the run, for the next turn. */
	onMessages?: (messages: AgentMessage[]) => void;
	/** Restarts of a turn that failed on the wire (default RUN_RETRY: 4 restarts, 2–16 s apart). */
	retry?: RetryPolicy;
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
				tools: mcp.tools,
				messages: o.history ?? [],
			},
			streamFn: streamFn(o.runtime.models),
			// tools write project state and drive one Revit: one at a time
			toolExecution: "sequential",
			beforeToolCall: o.beforeToolCall,
			...(identity ? { identity: { attribution: { name: identity.name, url: identity.url } } } : {}),
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
		agent.subscribe((ev) => {
			if (ev.type === "message_end" && !o.signal.aborted && willRetry(ev.message, restarts + 1, policy)) held = ev.message;
			if (held && (ev.type === "message_end" || ev.type === "turn_end" || ev.type === "agent_end")) return;
			for (const r of piEvents(ev, st)) send(r);
		});

		const a = agent;
		const stop = () => a.abort();
		if (o.signal.aborted) stop();
		else o.signal.addEventListener("abort", stop, { once: true });
		try {
			await agent.prompt(o.prompt, o.images?.length ? o.images : undefined);
			// restart the failed turn from the same transcript: the user's prompt and every tool result so far stay
			while (held) {
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
			o.signal.removeEventListener("abort", stop);
		}
		if (!reported && !st.errored && agent.state.errorMessage) send({ type: "error", engine: "pi", message: agent.state.errorMessage });
	} catch (e) {
		if (!reported) send({ type: "error", engine: "pi", message: (e as Error).message });
	} finally {
		// a failed last turn is not carried into the next message: it holds no answer, only an empty assistant turn
		if (agent) o.onMessages?.(dropFailedTail(agent.state.messages));
		await closeTools?.().catch(() => undefined);
	}
}
