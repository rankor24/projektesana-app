// Types shared by main, the tools server, the pi harness and the renderer. No Node or DOM imports here.
import type { ChatAttachmentRef } from "./api.js";
import { DEFAULT_LIMITS, type Limits } from "./thread-types.js";

export type RunEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "turn"; n: number }
	/** `detail` = the arguments cut for display; `input` = the whole arguments, only when they were cut. For the agent log: main strips it before the window sees the event (shared/agent-log.ts). */
	| { type: "tool"; name: string; detail?: string; id?: string; input?: string }
	/** `chars` = the tool's whole answer (output is cut for display); it is what the answer costs the context. `full` = the whole answer, only when `output` was cut; for the agent log, stripped like `input` above. */
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; output?: string; chars?: number; full?: string }
	/** The conversation is being summarized because it reached the model's limit; `after` is estimated. */
	| { type: "compact"; phase: "start" | "done" | "failed"; before: number; after?: number; message?: string }
	/** A `confirm` tool is waiting for the user; `batch` names what will run. */
	| { type: "confirm"; id: string; tool: string; batch: string }
	| { type: "done"; text: string }
	/** A message the user wrote while this run was going has reached the agent (steering): it is a line of the chat from here on.
	 *  `starts`: the run was started to deliver the message (the agent had finished) and this is its first event; the chat puts the message above the run's card. Without it the agent read the message mid-run. */
	| { type: "steered"; text: string; attachments?: ChatAttachmentRef[]; starts?: true }
	/** One model turn's token counts (and its price at the catalogue, null when the provider gives none). Task 8.7. */
	| { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; /** `provider/model` when a lane ran on a model other than its run's (13.3) */ model?: string; /** the size of the context the engine's own session holds after this turn (Antigravity's `usage_update`), and the window the server states for the model. The counts above are what the turn billed, which for a turn of many model calls is far more than the context. */ context?: { used: number; window?: number } }
	/** A model turn failed on the wire (fetch failed, 429, 5xx…); the run waits `delayMs` and restarts it. Not the end of the run. */
	| { type: "retry"; attempt: number; of: number; delayMs: number; message: string }
	/** A helper or specialist working beside the main run (task 8.15): one lane per job. `step` replaces the lane's current action; `end` carries its report. */
	| { type: "lane"; id: string; label: string; agent?: string; phase: "start" | "step" | "end"; text?: string; ok?: boolean; report?: string }
	/** Check before done (core/check-work.ts): one check of the answer by a checker, and what it found. `end` carries the verdict and the checker's report; `fix` = the agent is now fixing what the check found (a full turn of its own);
	 *  `fixed` = that fix turn is over. `end` and `fixed` carry the turn's own `usage`; `total` closes the loop with the checks and fixes made and what all of them used. */
	| { type: "check"; n: number; of: number; by: string; phase: "start" | "end" | "fix" | "fixed" | "total"; verdict?: "pass" | "issues" | "cannot" | "unclear"; count?: number; report?: string; usage?: CheckUsage; checks?: number; fixes?: number }
	/** Raw provider error, never rewritten. `hint`: what the engine itself knows about the cause (the Claude CLI names the limit and its reset); the words stay the provider's. */
	| { type: "error"; engine: "pi"; message: string; hint?: FailureHint };

/** What one check or fix turn (or all of them) used: the model turns' tokens, and the catalogue price in US dollars (null = no turn had a price). `turns` model turns, `priced` of them with a price. */
export interface CheckUsage {
	turns: number;
	priced: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number | null;
}

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
	/** the most model responses one run of the main agent may take before it is stopped (Iestatījumi → Aģenti); high on purpose: a modelling task makes hundreds of calls */
	maxTurns: number;
	/** the same for a helper or specialist's run (a lane of the main agent) */
	maxTurnsSub: number;
	/** how far agents may talk to each other and how much one wave may start and spend (task 12.4) */
	limits: Limits;
	/** The AI an agent carries on with when its provider is at its usage limit or signed out; an agent's own backup (AgentSpec.backup) wins. null / absent = none. */
	backup?: ModelChoice | null;
	/** On: a run that fails before any tool ran is tried once more on the backup (limit, expired sign-in, a provider that is down). Off by default. */
	automaticRecovery?: boolean;
	/** a Revit popup that stays open while an agent waits for Revit may be answered by the computer-use helper on the screen (default yes); off = only the user is told */
	revitDialogsOnScreen?: boolean;
	/** Auto mode (the button in the agent chat): the app answers every approval card with yes, except what stays with the user (tools/levels.ts `autoStillAsks`). The hard refusals never lift: office folders, send_code_to_revit, Revit by shell, the working-copy check. Off by default; only the user sets it (settings.set is never the agent's). */
	autoApprove?: boolean;
	/** The folder the team was last imported from (Aģenti → «Importēt BD komandu…»); the picker offers it again. null / absent = never imported. */
	teamFolder?: string | null;
}

/** Run length limits (model responses per run): effectively unlimited, like Claude Code, so an agent works until its task is done. The settings keep them inside 1 – MAX_TURNS_LIMIT. */
export const DEFAULT_MAX_TURNS = 1000;
export const DEFAULT_MAX_TURNS_SUB = 500;
export const MAX_TURNS_LIMIT = 10000;
/** A turn limit as the settings keep it: a whole number in 1 – MAX_TURNS_LIMIT, else the default. */
export function clampTurns(v: unknown, fallback: number): number {
	const n = Math.round(Number(v));
	return Number.isFinite(n) && n >= 1 ? Math.min(MAX_TURNS_LIMIT, n) : fallback;
}

export const DEFAULT_SETTINGS: Settings = { provider: "openai-codex", model: "", effort: "", theme: "auto", language: "en", revitServerJs: null, revitNode: null, officeStandardPdf: null, userName: "", maxParallelAgents: 3, maxTurns: DEFAULT_MAX_TURNS, maxTurnsSub: DEFAULT_MAX_TURNS_SUB, limits: DEFAULT_LIMITS, backup: null, automaticRecovery: false, revitDialogsOnScreen: true, autoApprove: false };

/** One step of a sign-in the person is going through. */
export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };
