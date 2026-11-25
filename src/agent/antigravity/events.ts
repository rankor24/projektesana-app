// Antigravity's ACP updates and prompt answer as the RunEvents the side panel and the task runner understand: the same contract as pi/events.ts and
// claude/events.ts, so the UI never knows which engine ran. Pure and stateless apart from AntigravityState, tested on ACP's own shapes.
//
//   session/update agent_message_chunk (text)   → text            (the answer; streamed as it arrives)
//   session/update agent_thought_chunk          → thinking
//   the tool bridge's calls                     → tool / tool_result (bridge.ts reports them: the server's own tool_call updates are ignored, they would be a second copy)
//   session/prompt answer, stopReason end_turn  → done            (the text since the last tool call; the whole text when there was none)
//   session/prompt answer, anything else        → error / aborted
//
// agy_acp_server opens a text run after a tool call with `&_a_m_p_;_` tokens — `&` escaped entity-style — which Markdown then parses as emphasis; they are
// never real reply text (OpenMausBot cleanAntigravityTextStart). The server also writes its own system notes into the text stream: those are dropped.
import type { RunEvent } from "../../shared/types.js";

export interface AntigravityState {
	turns: number;
	/** the text since the last tool call: the answer once the run ends */
	last: string;
	/** all the text of the run, for a run that ends right after a tool */
	all: string;
	/** a model response starts at the next text, thought or tool */
	needTurn: boolean;
	/** an error event was sent: no "done" follows it */
	errored: boolean;
	/** the first text of a stretch is cleaned of the escape tokens */
	runStart: boolean;
}

export const newAntigravityState = (): AntigravityState => ({ turns: 0, last: "", all: "", needTurn: true, errored: false, runStart: true });

/** The tokens the server opens a text run with. */
export function cleanAntigravityTextStart(delta: string): string {
	return delta.replace(/^(?:&_a_m_p_;_\s*)+/u, "");
}

const SYSTEM_NOTE = /^\s*(?:<SYSTEM_MESSAGE|The following is a <SYSTEM_MESSAGE|<SYSTEM_NOTIFICATION)/;

const turnEvent = (st: AntigravityState, out: RunEvent[]) => {
	if (!st.needTurn) return;
	st.needTurn = false;
	out.push({ type: "turn", n: ++st.turns });
};

/** The tool bridge started a call: the next text is a new response, and what the model said so far was not the answer. */
export function antigravityToolStarted(st: AntigravityState): RunEvent[] {
	const out: RunEvent[] = [];
	turnEvent(st, out);
	st.last = "";
	st.runStart = true;
	return out;
}

/** A call's result came back: the model answers it in a new response. */
export function antigravityToolEnded(st: AntigravityState): void {
	st.needTurn = true;
	st.runStart = true;
}

/** One `session/update`. Tool calls and everything else are not the text: they return nothing here. */
export function antigravityEvents(update: Record<string, any>, st: AntigravityState): RunEvent[] {
	const out: RunEvent[] = [];
	const kind = update.sessionUpdate;
	if (kind === "agent_message_chunk") {
		const c = update.content;
		if (c?.type === "image" || typeof c?.text !== "string" || !c.text) return out;
		let delta: string = c.text;
		if (st.runStart) {
			delta = cleanAntigravityTextStart(delta);
			if (!delta) return out;
			if (SYSTEM_NOTE.test(delta)) return out;
			st.runStart = false;
		}
		turnEvent(st, out);
		st.last += delta;
		st.all += delta;
		out.push({ type: "text", text: delta });
	} else if (kind === "agent_thought_chunk") {
		const t = update.content?.text;
		if (typeof t !== "string" || !t) return out;
		turnEvent(st, out);
		out.push({ type: "thinking", text: t });
		st.runStart = true;
	}
	return out;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The size of the context the session holds, from the server's `usage_update` notification (`used` tokens of a window of `size`). The server computes it as the
 * prompt of the newest model call, so it is the real occupancy. The prompt answer's `usage` is something else: the sum over every model call of the turn (each call
 * resends the whole history), which a long tool turn makes several times the window.
 */
export function antigravityContext(update: Record<string, any>): { used: number; window?: number } | null {
	if (update?.sessionUpdate !== "usage_update") return null;
	const used = num(update.used);
	if (used <= 0) return null;
	const size = num(update.size);
	return { used, ...(size > 0 ? { window: size } : {}) };
}

/** The usage the prompt answer carries, when it does (ACP's `usage`, camelCase; a subscription has no price, cost null), with the context size the server last reported for the session. */
export function antigravityUsage(result: { usage?: Record<string, unknown>; _meta?: Record<string, unknown> } | null | undefined, context?: { used: number; window?: number } | null): RunEvent | null {
	const u = (result?.usage ?? (result?._meta as { usage?: Record<string, unknown> } | undefined)?.usage) as Record<string, unknown> | undefined;
	const input = num(u?.inputTokens ?? u?.input_tokens);
	const output = num(u?.outputTokens ?? u?.output_tokens);
	const cacheRead = num(u?.cachedReadTokens ?? u?.cacheReadTokens ?? u?.cached_read_tokens);
	const cacheWrite = num(u?.cachedWriteTokens ?? u?.cacheWriteTokens ?? u?.cached_write_tokens);
	// no counts but a context size: the meter still learns it (a zero row of counts costs nothing)
	if (input + output + cacheRead + cacheWrite <= 0 && !context) return null;
	return { type: "usage", input, output, cacheRead, cacheWrite, cost: null, ...(context ? { context } : {}) };
}

/** The end of the prompt: the answer, or why there is none. `aborted`: the user stopped the run. */
export function antigravityEnd(result: { stopReason?: string } | null | undefined, st: AntigravityState, aborted: boolean): RunEvent[] {
	if (st.errored) return [];
	const reason = result?.stopReason ?? "end_turn";
	if (aborted || reason === "cancelled") {
		st.errored = true;
		return [{ type: "error", engine: "pi", message: "aborted" }];
	}
	if (reason === "end_turn") return [{ type: "done", text: (st.last.trim() ? st.last : st.all).trim() }];
	st.errored = true;
	if (reason === "max_tokens") return [{ type: "error", engine: "pi", message: "Antigravity: modeļa izvades limits sasniegts (max_tokens)." }];
	if (reason === "max_turn_requests") return [{ type: "error", engine: "pi", message: "Sasniegts soļu limits." }];
	if (reason === "refusal") return [{ type: "error", engine: "pi", message: "Antigravity: modelis atteicās atbildēt (refusal)." }];
	return [{ type: "error", engine: "pi", message: `Antigravity: gājiens beidzās ar „${reason}”.` }];
}

/** Words the server's own errors carry for a Google sign-in that is gone (JSON-RPC -32000 is ACP's `auth_required`, which an agent may reuse for other failures). */
const SIGN_IN_WORDS = /\bauthenticat|\bunauthenticated\b|\bsign(?:ed)?[ -]?in\b|\blog(?:ged)?[ -]?in\b|\bcredentials?\b/iu;

export function antigravitySignInError(error: unknown): boolean {
	const e = error as { code?: unknown; message?: unknown; data?: unknown } | null;
	if (e?.code !== -32000) return false;
	const data = typeof e.data === "string" ? e.data : e.data && typeof e.data === "object" ? JSON.stringify(e.data) : "";
	return SIGN_IN_WORDS.test(`${typeof e.message === "string" ? e.message : ""} ${data.slice(0, 2_000)}`);
}

/** The permission a request names: the answer option for allow / reject, or null when the server offers none of that kind. */
export function permissionOption(options: unknown, want: "allow" | "reject"): string | null {
	const list = (Array.isArray(options) ? options : []) as { optionId?: unknown; kind?: unknown }[];
	const id = (kind: string) => list.find((o) => o.kind === kind && typeof o.optionId === "string")?.optionId as string | undefined;
	return id(`${want}_once`) ?? (list.find((o) => String(o.kind ?? "").startsWith(want) && typeof o.optionId === "string")?.optionId as string | undefined) ?? null;
}

/** Whether a permission request is for one of this run's own tools (`mcp__app__<tool>`): only those are allowed, the server's native tools never. */
export function ownToolRequest(toolCall: { title?: unknown; kind?: unknown } | undefined, server: string, offered: ReadonlySet<string>): string | null {
	const title = typeof toolCall?.title === "string" ? toolCall.title : "";
	const m = new RegExp(`^(?:mcp__${server}__|${server}[.:/_]+)([\\w.-]+)$`).exec(title);
	if (m && offered.has(m[1])) return m[1];
	// a title in another spelling: an MCP call has the kind "other", and its title is the tool's own name
	if (toolCall?.kind === "other" && offered.has(title)) return title;
	return null;
}
