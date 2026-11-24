// The agent log (Žurnāls): everything a run does and receives, one entry after another, like a verbose transcript.
// Shared by the main process (core/agent-log.ts writes it) and the window (panels/AgentLog.tsx shows it).
// Pure and node-free. The activity lines (shared/activity.ts) are the short, readable story; this is the raw one:
// the whole system text and prompt, the model's reasoning and answer, every tool call with its arguments, every tool
// answer, errors, retries, timings and what each turn cost.

import type { RunEvent } from "./types.js";

export type LogKind =
	| "run" // the run began or ended (who, where, how long)
	| "system" // the system text the model got
	| "prompt" // what the model was asked (the user's message with the pins, Fokuss, plan and open topics)
	| "thinking" // the model's reasoning
	| "text" // the model's answer text
	| "tool" // a tool call with its arguments
	| "result" // what the tool answered (or its error)
	| "usage" // one model turn's tokens and price
	| "retry" // a turn failed on the wire and is tried again
	| "compact" // the older conversation was summarized
	| "confirm" // a batch waits for the user
	| "lane" // a helper or specialist working beside the run
	| "check" // check before done
	| "error" // the provider's own error text
	| "note"; // the app's own remark

export const LOG_KINDS: readonly LogKind[] = ["run", "system", "prompt", "thinking", "text", "tool", "result", "usage", "retry", "compact", "confirm", "lane", "check", "error", "note"];

/** A helper or specialist (a lane) the entry belongs to; absent = the run's own agent. */
export interface LogLane {
	id: string;
	label: string;
	agent?: string;
}

export interface LogUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** the catalogue price in US dollars; null = no price (a subscription) */
	cost: number | null;
	/** `provider/model` when a lane ran on another model than the run */
	model?: string;
}

/** One line of the log. Entries with the same `n` of one run are one thing that grows (a streamed answer): the newest replaces the older. */
export interface LogEntry {
	n: number;
	/** epoch ms */
	at: number;
	kind: LogKind;
	lane?: LogLane;
	/** one line: what this is */
	title: string;
	/** the whole body: the text, the arguments, the answer; secrets are masked (shared/agent-log.ts redact) */
	text?: string;
	/** the body was cut at MAX_BODY characters */
	cut?: boolean;
	/** tool call id: a `result` carries the id of its `tool` */
	id?: string;
	/** tool name */
	name?: string;
	/** result: did the tool succeed */
	ok?: boolean;
	/** result: the whole answer in characters (the body may be shorter) */
	chars?: number;
	/** result: milliseconds since its call; run end: since the start */
	ms?: number;
	usage?: LogUsage;
	/** still being written (a streamed block that has not ended) */
	open?: boolean;
}

export type LogStatus = "running" | "ok" | "failed" | "stopped";

/** A run in the list on the left of the log. */
export interface LogRun {
	runId: string;
	threadId: string;
	agent: string;
	projectId: string | null;
	wave: string;
	startedAt: number;
	endedAt?: number;
	status: LogStatus;
	/** the first line of what it was asked */
	title: string;
	/** `provider/model`, as the run started on it */
	model?: string;
	effort?: string;
	entries: number;
	tools: number;
	errors: number;
	usage: { turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null };
}

/** What the window is told after each new or changed entry (the event `agentlog.entry`); `entry` null = the run's own numbers changed. */
export interface LogNotice {
	run: LogRun;
	entry: LogEntry | null;
}

/** What the engine and the thread runner tell the log when an attempt of a run starts. */
export interface LogStart {
	provider: string;
	model: string;
	effort?: string;
	/** which engine ran it: "claude" (the Claude subscription, Agent SDK) or "pi" */
	engine: string;
	system: string;
	prompt: string;
	/** the tools offered, by name */
	tools: string[];
	/** earlier messages of the conversation the model carries (0 = a fresh conversation, or a resumed Claude session) */
	history: number;
	resumed?: boolean;
	/** a run restarted on the backup provider */
	backup?: boolean;
	images?: number;
}

/** Longest body kept per entry; a longer one is cut and marked. The tool answer's own length stays in `chars`. */
export const MAX_BODY = 200_000;

// ---- secrets never reach the log ----

const SECRET_PATTERNS: RegExp[] = [
	// Anthropic / OpenAI / generic "sk-" keys, GitHub, Google, Slack, AWS
	/\bsk-[A-Za-z0-9_-]{12,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bAIza[0-9A-Za-z_-]{30,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	// a JWT, an OAuth token
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g,
	// "Authorization: Bearer abc…" and "Bearer abc…"
	/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];
// `"api_key": "…"`, `api_key=…`, `CLAUDE_CODE_OAUTH_TOKEN=…`, `password: …`: the value goes, the name stays
const KEYED = /((?:["']?)[\w-]*(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|authorization|credential)[\w-]*(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|[^\s"',;}{)\]]{6,})/gi;

export const REDACTED = "[***]";

/** The text with keys, tokens and passwords masked. Applied to every body before it is kept or shown. */
export function redact(s: string): string {
	let out = s;
	for (const p of SECRET_PATTERNS) out = out.replace(p, REDACTED);
	return out.replace(KEYED, (_m, name: string) => `${name}${REDACTED}`);
}

// ---- reading an entry ----

/** A tool's arguments as the log shows them: pretty JSON when the text is JSON, else as it is. */
export function prettyArgs(text: string | undefined): string {
	if (!text) return "";
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
/** 12:03:07.412 (local time) */
export function clockMs(at: number): string {
	const d = new Date(at);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 850 ms, 4.2 s, 1:05 */
export function spanText(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
	const s = ms / 1000;
	if (s < 10) return `${s.toFixed(1)} s`;
	if (s < 60) return `${Math.round(s)} s`;
	return `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;
}

/** The kinds an entry can be filtered by in the window: the user's groups, not every kind (usage and run count as "info"). */
export type LogGroup = "prompt" | "reasoning" | "answer" | "tool" | "error" | "info";
export const LOG_GROUPS: readonly LogGroup[] = ["prompt", "reasoning", "answer", "tool", "error", "info"];
export function groupOf(kind: LogKind): LogGroup {
	switch (kind) {
		case "system":
		case "prompt":
			return "prompt";
		case "thinking":
			return "reasoning";
		case "text":
			return "answer";
		case "tool":
		case "result":
			return "tool";
		case "error":
		case "retry":
			return "error";
		default:
			return "info";
	}
}

/** Does the entry pass the group filter and the search text? A result follows its call's name, so searching a tool name finds both. */
export function matches(e: LogEntry, groups: ReadonlySet<LogGroup>, query: string): boolean {
	if (!groups.has(groupOf(e.kind))) return false;
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return `${e.title}\n${e.name ?? ""}\n${e.text ?? ""}`.toLowerCase().includes(q);
}

/** A whole run as Markdown, for a person or for pasting to someone: the header, then every entry with its time. */
export function logMarkdown(run: LogRun, entries: LogEntry[]): string {
	const out = [`# ${run.agent} · ${new Date(run.startedAt).toISOString()}`, "", `- run: ${run.runId}`, `- thread: ${run.threadId}`, `- status: ${run.status}`, ...(run.model ? [`- model: ${run.model}${run.effort ? ` (${run.effort})` : ""}`] : []), `- entries: ${entries.length}`, `- tokens: in ${run.usage.input} · out ${run.usage.output} · cache read ${run.usage.cacheRead} · cache write ${run.usage.cacheWrite}${run.usage.cost !== null ? ` · $${run.usage.cost.toFixed(4)}` : ""}`, ""];
	const t0 = run.startedAt;
	for (const e of entries) {
		const lane = e.lane ? ` [${e.lane.agent ? `${e.lane.agent}: ` : ""}${e.lane.label}]` : "";
		const extra = [e.ok === false ? "FAILED" : "", e.ms !== undefined ? spanText(e.ms) : "", e.chars !== undefined ? `${e.chars} chars` : ""].filter(Boolean).join(" · ");
		out.push(`## +${spanText(e.at - t0)} · ${e.kind}${lane} · ${e.title}${extra ? ` · ${extra}` : ""}`, "");
		if (e.text) out.push("```", e.text.replace(/```/g, "``​`"), "```", "");
		if (e.cut) out.push("_(cut)_", "");
	}
	return out.join("\n");
}

/** A RunEvent without the whole arguments and answers the log keeps (`input`, `full`): what the dock, the activity lines and the window get. */
export function forWindow(e: RunEvent): RunEvent {
	if (e.type === "tool" && e.input !== undefined) {
		const { input: _input, ...rest } = e;
		return rest;
	}
	if (e.type === "tool_result" && e.full !== undefined) {
		const { full: _full, ...rest } = e;
		return rest;
	}
	return e;
}
