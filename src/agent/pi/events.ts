// pi's agent events as the RunEvents the side panel and the task runner understand.
// Pure and stateless apart from PiState, so it is tested on pi's own event shapes
// (pi-agent-core AgentEvent, pi-ai AssistantMessageEvent), like claudeEvents / codexEvents / grokEvents.
//
//   turn_start                      → turn          (the n-th model response)
//   message_update text_delta       → text          (streamed as it arrives)
//   message_update thinking_delta   → thinking      (streamed as it arrives)
//   message_end (assistant)         → text / thinking the stream did not carry; error when stopReason is error|aborted
//   tool_execution_start            → tool          (id = toolCallId, detail = the arguments)
//   tool_execution_end              → tool_result   (ok = !isError, output = the tool's text)
//   agent_end                       → done          (the last assistant text), unless an error was already reported
//   everything else (agent_start, message_start, tool_execution_update, turn_end, toolcall_*) → nothing
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { RunEvent } from "../../shared/types.js";

/** How much of a tool's output the side panel keeps. */
const OUTPUT_MAX = 2000;
const INPUT_MAX = 600;

/** State the mapper needs between events of one run. */
export interface PiState {
	turns: number;
	/** the last non-empty assistant text: the answer once the run ends */
	last: string;
	/** an error event was sent; no "done" follows it */
	errored: boolean;
	/** tool call id → tool name, so a result can say which tool it belongs to */
	names: Map<string, string>;
	/** the message being streamed sent text / thinking deltas, so message_end must not repeat them */
	streamed: { text: boolean; thinking: boolean };
}

export function newPiState(): PiState {
	return { turns: 0, last: "", errored: false, names: new Map(), streamed: { text: false, thinking: false } };
}

const textOf = (m: AssistantMessage) => m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");

/** Text parts of a tool result (`{ content: [{type:"text", text}] }`), joined. */
function resultText(result: unknown): string {
	const content = (result as { content?: unknown } | null | undefined)?.content;
	if (!Array.isArray(content)) return typeof result === "string" ? result : "";
	return content.map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : "")).filter(Boolean).join("\n");
}

export function piEvents(ev: AgentEvent, st: PiState): RunEvent[] {
	const out: RunEvent[] = [];
	const emit = (e: RunEvent) => void out.push(e);

	if (ev.type === "turn_start") {
		emit({ type: "turn", n: ++st.turns });
	} else if (ev.type === "message_start") {
		if ((ev.message as { role?: string }).role === "assistant") st.streamed = { text: false, thinking: false };
	} else if (ev.type === "message_update") {
		const a = ev.assistantMessageEvent;
		if (a.type === "text_delta" && a.delta) {
			st.streamed.text = true;
			emit({ type: "text", text: a.delta });
		} else if (a.type === "thinking_delta" && a.delta) {
			st.streamed.thinking = true;
			emit({ type: "thinking", text: a.delta });
		}
	} else if (ev.type === "message_end") {
		const m = ev.message as AssistantMessage;
		if (m.role !== "assistant") return out;
		// providers that do not stream: the finished message carries the whole text / reasoning
		if (!st.streamed.thinking) {
			for (const c of m.content) if (c.type === "thinking" && !c.redacted && c.thinking.trim()) emit({ type: "thinking", text: c.thinking });
		}
		const text = textOf(m);
		if (!st.streamed.text && text) emit({ type: "text", text });
		if (text.trim()) st.last = text;
		// a provider error is shown exactly as the provider wrote it (D11)
		if (m.stopReason === "error" || m.stopReason === "aborted") {
			st.errored = true;
			emit({ type: "error", engine: "pi", message: m.errorMessage || m.stopReason });
		}
	} else if (ev.type === "tool_execution_start") {
		st.names.set(ev.toolCallId, ev.toolName);
		emit({ type: "tool", name: ev.toolName, id: ev.toolCallId, detail: JSON.stringify(ev.args ?? {}).slice(0, INPUT_MAX) });
	} else if (ev.type === "tool_execution_end") {
		const full = resultText(ev.result);
		const text = full.slice(0, OUTPUT_MAX);
		emit({ type: "tool_result", name: st.names.get(ev.toolCallId) ?? ev.toolName, id: ev.toolCallId, ok: !ev.isError, detail: ev.isError ? text : undefined, output: text, chars: full.length });
	} else if (ev.type === "agent_end") {
		if (!st.errored) emit({ type: "done", text: st.last });
	}
	return out;
}
