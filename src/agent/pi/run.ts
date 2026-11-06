// One agent run on pi: connect the tool servers, build an Agent, stream its events as RunEvents.
//
// Borrowed from BIM Crew apps/server/src/runtime/runtime.ts (runAgent), via konkurss-app/src/agent-pi/run.ts:
// new Agent({ initialState, streamFn, toolExecution }), agent.subscribe, finishTurn for a turn limit,
// agent.abort on the caller's signal. Carried from projektesana-app v1. Changed for v2: the approval gate runs on pi's
// beforeToolCall hook; the previous messages of the conversation are passed in and handed back, so a chat keeps its context.
import { Agent, type AgentMessage, type BeforeToolCallContext, type BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { RunEvent } from "../../shared/types.js";
import { newPiState, piEvents } from "./events.js";
import { connectMcpServers, type McpLaunchSpec } from "./mcp.js";
import { effortFor, lookupPiModel, streamFn, type PiEffort, type PiRuntime } from "./models.js";

export interface PiRunOptions {
	runtime: PiRuntime;
	provider?: string;
	/** Empty = the provider's default model. */
	modelId?: string;
	/** A model already looked up; wins over provider and modelId. */
	model?: Model<Api>;
	prompt: string;
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
		if (mcp.missing.length) throw new Error(`The tool servers did not offer: ${mcp.missing.join(", ")}`);

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
		agent.subscribe((ev) => {
			for (const r of piEvents(ev, st)) send(r);
		});

		const a = agent;
		const stop = () => a.abort();
		if (o.signal.aborted) stop();
		else o.signal.addEventListener("abort", stop, { once: true });
		try {
			await agent.prompt(o.prompt);
		} finally {
			o.signal.removeEventListener("abort", stop);
		}
		if (!reported && !st.errored && agent.state.errorMessage) send({ type: "error", engine: "pi", message: agent.state.errorMessage });
	} catch (e) {
		if (!reported) send({ type: "error", engine: "pi", message: (e as Error).message });
	} finally {
		if (agent) o.onMessages?.([...agent.state.messages]);
		await closeTools?.().catch(() => undefined);
	}
}
