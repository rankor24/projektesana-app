// The Claude Agent SDK's messages as the RunEvents the side panel and the task runner understand: the same contract as
// pi/events.ts, so the UI never knows which engine ran. Pure and stateless apart from ClaudeState, tested on the SDK's own shapes.
//
//   stream_event message_start            → turn          (the n-th model response)
//   stream_event content_block_delta      → text / thinking (streamed as it arrives)
//   stream_event message_delta            → usage         (input + cache from message_start, output from here; cost null: a subscription)
//   assistant  text / thinking blocks     → text / thinking the stream did not carry
//   assistant  tool_use block             → tool          (id = tool_use id, detail = the input)
//   assistant  with `error`               → error         (the SDK's text, never rewritten)
//   user       tool_result block          → tool_result   (ok = !is_error)
//   system     api_retry                  → retry
//   rate_limit_event (rejected)           → remembered: the next error carries which window refused and when it resets (claude/limits.ts)
//   system     compact_boundary           → compact done  (Claude Code compacts the conversation itself)
//   result                                → done (the answer), or error
//   messages of SDK sub-agents (parent_tool_use_id set) and everything else → nothing
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FailureHint, RunEvent } from "../../shared/types.js";
import { USAGE_LIMIT } from "../failover/classify.js";
import { claudeErrorHint, claudeLimitHint, claudeLimitRefusal, type ClaudeLimit } from "./limits.js";

/** The one in-process MCP server the engine gives Claude: every tool of the run lives there (run.ts). */
export const TOOL_SERVER = "app";
const PREFIX = `mcp__${TOOL_SERVER}__`;

/** The app's own name of a tool: the SDK calls it `mcp__app__<name>`. */
export const toolNameOf = (sdkName: string): string => (sdkName.startsWith(PREFIX) ? sdkName.slice(PREFIX.length) : sdkName);

const OUTPUT_MAX = 2000;
const INPUT_MAX = 600;

export interface ClaudeState {
	turns: number;
	/** the last non-empty assistant text: the answer once the run ends */
	last: string;
	/** an error event was sent; no "done" follows it */
	errored: boolean;
	/** tool_use id → the app's tool name */
	names: Map<string, string>;
	/** per assistant message id: what the stream already carried, and the text so far */
	messages: Map<string, { text: boolean; thinking: boolean; said: string }>;
	/** the input side of the message being streamed (message_start), completed by its message_delta */
	pendingUsage: { input: number; cacheRead: number; cacheWrite: number } | null;
	maxTurns: number;
	/** the window the CLI said is refusing this account, from the last rejected rate_limit_event */
	limit: ClaudeLimit | null;
}

export function newClaudeState(maxTurns: number): ClaudeState {
	return { turns: 0, last: "", errored: false, names: new Map(), messages: new Map(), pendingUsage: null, maxTurns, limit: null };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function msgState(st: ClaudeState, id: string) {
	let m = st.messages.get(id);
	if (!m) st.messages.set(id, (m = { text: false, thinking: false, said: "" }));
	return m;
}

/** Text parts of a tool_result's content (a string or `[{type:"text", text}]`), joined. */
function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : "")).filter(Boolean).join("\n");
}

export function claudeEvents(m: SDKMessage, st: ClaudeState): RunEvent[] {
	const out: RunEvent[] = [];
	const emit = (e: RunEvent) => void out.push(e);
	const fail = (message: string, hint?: FailureHint) => {
		st.errored = true;
		emit({ type: "error", engine: "pi", message, ...(hint ? { hint } : {}) });
	};
	// a sub-agent's own traffic: this engine offers no SDK sub-agents (the app's lanes are tools of their own)
	if ("parent_tool_use_id" in m && m.parent_tool_use_id) return out;

	if (m.type === "stream_event") {
		const ev = m.event;
		if (ev.type === "message_start") {
			emit({ type: "turn", n: ++st.turns });
			msgState(st, ev.message.id);
			const u = ev.message.usage;
			st.pendingUsage = { input: num(u?.input_tokens), cacheRead: num(u?.cache_read_input_tokens), cacheWrite: num(u?.cache_creation_input_tokens) };
		} else if (ev.type === "content_block_delta") {
			const d = ev.delta;
			const cur = [...st.messages.values()].at(-1);
			if (d.type === "text_delta" && d.text) {
				if (cur) {
					cur.text = true;
					cur.said += d.text;
				}
				emit({ type: "text", text: d.text });
			} else if (d.type === "thinking_delta" && d.thinking) {
				if (cur) cur.thinking = true;
				emit({ type: "thinking", text: d.thinking });
			}
		} else if (ev.type === "message_delta") {
			const p = st.pendingUsage;
			const output = num(ev.usage?.output_tokens);
			if (p && p.input + output + p.cacheRead + p.cacheWrite > 0) {
				// a price of null is "no catalogue price" (a subscription), not "free"
				emit({ type: "usage", input: p.input, output, cacheRead: p.cacheRead, cacheWrite: p.cacheWrite, cost: null });
			}
			st.pendingUsage = null;
		}
	} else if (m.type === "assistant") {
		const ms = msgState(st, m.message.id);
		for (const c of m.message.content) {
			if (c.type === "text") {
				if (!ms.text && c.text) {
					ms.said += c.text;
					emit({ type: "text", text: c.text });
				}
			} else if (c.type === "thinking") {
				if (!ms.thinking && c.thinking.trim()) emit({ type: "thinking", text: c.thinking });
			} else if (c.type === "tool_use") {
				const name = toolNameOf(c.name);
				st.names.set(c.id, name);
				emit({ type: "tool", name, id: c.id, detail: JSON.stringify(c.input ?? {}).slice(0, INPUT_MAX) });
			}
		}
		if (ms.said.trim()) st.last = ms.said;
		// the SDK's own failure text (authentication_failed, rate_limit…), shown as written (D11)
		if (m.error && !st.errored) fail(ms.said.trim() || m.error, claudeErrorHint(m.error, st.limit));
	} else if (m.type === "user") {
		const content = m.message.content;
		if (!Array.isArray(content)) return out;
		for (const c of content) {
			if (c.type !== "tool_result") continue;
			const full = resultText(c.content);
			const text = full.slice(0, OUTPUT_MAX);
			const bad = c.is_error === true;
			emit({ type: "tool_result", name: st.names.get(c.tool_use_id) ?? "", id: c.tool_use_id, ok: !bad, detail: bad ? text : undefined, output: text, chars: full.length });
		}
	} else if (m.type === "system") {
		if (m.subtype === "api_retry") emit({ type: "retry", attempt: m.attempt, of: m.max_retries, delayMs: m.retry_delay_ms, message: String(m.error ?? "error") });
		else if (m.subtype === "compact_boundary") emit({ type: "compact", phase: "done", before: m.compact_metadata.pre_tokens, ...(m.compact_metadata.post_tokens !== undefined ? { after: m.compact_metadata.post_tokens } : {}) });
	} else if (m.type === "rate_limit_event") {
		// not an error by itself: a run on extra usage is told "rejected" for a window and still runs. Kept for the error that may follow
		st.limit = claudeLimitRefusal(m.rate_limit_info);
	} else if (m.type === "result") {
		if (st.errored) return out;
		if (m.subtype === "success" && !m.is_error) emit({ type: "done", text: m.result || st.last });
		else if (m.subtype === "error_max_turns") fail(`Sasniegts soļu limits (${st.maxTurns}).`);
		// a limit the CLI named, worded by the CLI: the error carries which window and when it resets
		else if (m.subtype === "success") fail(m.result || "error", st.limit && USAGE_LIMIT.test(m.result ?? "") ? claudeLimitHint(st.limit) : undefined);
		else fail(m.errors?.join("\n") || m.subtype);
	}
	return out;
}
