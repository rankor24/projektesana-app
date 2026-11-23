// Types shared by main, the tools server, the pi harness and the renderer. No Node or DOM imports here.
import { DEFAULT_LIMITS, type Limits } from "./thread-types.js";

export type RunEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "turn"; n: number }
	| { type: "tool"; name: string; detail?: string; id?: string }
	/** `chars` = the tool's whole answer (output is cut for display); it is what the answer costs the context. */
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; output?: string; chars?: number }
	/** The conversation is being summarized because it reached the model's limit; `after` is estimated. */
	| { type: "compact"; phase: "start" | "done" | "failed"; before: number; after?: number; message?: string }
	/** A `confirm` tool is waiting for the user; `batch` names what will run. */
	| { type: "confirm"; id: string; tool: string; batch: string }
	| { type: "done"; text: string }
	/** One model turn's token counts (and its price at the catalogue, null when the provider gives none). Task 8.7. */
	| { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; /** `provider/model` when a lane ran on a model other than its run's (13.3) */ model?: string }
	/** A model turn failed on the wire (fetch failed, 429, 5xx…); the run waits `delayMs` and restarts it. Not the end of the run. */
	| { type: "retry"; attempt: number; of: number; delayMs: number; message: string }
	/** A helper or specialist working beside the main run (task 8.15): one lane per job. `step` replaces the lane's current action; `end` carries its report. */
	| { type: "lane"; id: string; label: string; agent?: string; phase: "start" | "step" | "end"; text?: string; ok?: boolean; report?: string }
	/** Raw provider error, never rewritten. `hint`: what the engine itself knows about the cause (the Claude CLI names the limit and its reset); the words stay the provider's. */
	| { type: "error"; engine: "pi"; message: string; hint?: FailureHint };

/** Why a run failed, as an engine knows it beyond the provider's words: src/agent/failover reads it before it reads the text. */
export interface FailureHint {
	kind?: "usage_limit" | "credits" | "signed_out";
	/** a usage limit that stops the whole provider, or only one model (a weekly window of one model family) */
	scope?: "provider" | "model";
	/** when the limit resets, epoch ms */
	resetsAt?: number;
}

/** A provider and a model of it; an empty model is the provider's default. */
export interface ModelChoice {
	provider: string;
	model: string;
}

export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Settings {
	/** pi provider id. Each user sets their own default; the ChatGPT/Codex subscription is the shipped default. */
	provider: string;
	/** empty = the provider's default model */
	model: string;
	/** empty = the model's default effort */
	effort: Effort | "";
	theme: "auto" | "light" | "dark";
	/** interface language (what the AI writes stays Latvian) */
	language: "lv" | "en";
	/** Revit MCP server entry (build/index.js). null = not configured */
	revitServerJs: string | null;
	/** node.exe that runs the Revit MCP server. null = Electron's own node */
	revitNode: string | null;
	/** the office standard (projekta mapju koks) PDF; its text gives the office rules their quotes. null = not set */
	officeStandardPdf: string | null;
	/** the person using the app: stamped on their decisions, shown in BCF comments, told to the agent. "" = not set */
	userName: string;
	/** how many helpers / specialists may work at once (task 8.15), 1–6 */
	maxParallelAgents: number;
	/** how far agents may talk to each other and how much one wave may start and spend (task 12.4) */
	limits: Limits;
	/** The AI an agent carries on with when its provider is at its usage limit or signed out; an agent's own backup (AgentSpec.backup) wins. null / absent = none. */
	backup?: ModelChoice | null;
	/** On: a run that fails before any tool ran is tried once more on the backup (limit, expired sign-in, a provider that is down). Off by default. */
	automaticRecovery?: boolean;
	/** The folder the team was last imported from (Aģenti → «Importēt BD komandu…»); the picker offers it again. null / absent = never imported. */
	teamFolder?: string | null;
}

export const DEFAULT_SETTINGS: Settings = { provider: "openai-codex", model: "", effort: "", theme: "auto", language: "en", revitServerJs: null, revitNode: null, officeStandardPdf: null, userName: "", maxParallelAgents: 3, limits: DEFAULT_LIMITS, backup: null, automaticRecovery: false };

/** One step of a sign-in the person is going through. */
export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };
