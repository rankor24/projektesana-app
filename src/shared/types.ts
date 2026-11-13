// Types shared by main, the tools server, the pi harness and the renderer. No Node or DOM imports here.

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
	| { type: "usage"; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null }
	/** A model turn failed on the wire (fetch failed, 429, 5xx…); the run waits `delayMs` and restarts it. Not the end of the run. */
	| { type: "retry"; attempt: number; of: number; delayMs: number; message: string }
	/** Raw provider error, never rewritten. */
	| { type: "error"; engine: "pi"; message: string };

export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Settings {
	/** pi provider id. Each user sets their own default; the ChatGPT/Codex subscription is the shipped default. */
	provider: string;
	/** empty = the provider's default model */
	model: string;
	/** empty = the model's default effort */
	effort: Effort | "";
	theme: "auto" | "light" | "dark";
	/** Revit MCP server entry (build/index.js). null = not configured */
	revitServerJs: string | null;
	/** node.exe that runs the Revit MCP server. null = Electron's own node */
	revitNode: string | null;
	/** the office standard (projekta mapju koks) PDF; its text gives the office rules their quotes. null = not set */
	officeStandardPdf: string | null;
	/** the person using the app: stamped on their decisions, shown in BCF comments, told to the agent. "" = not set */
	userName: string;
}

export const DEFAULT_SETTINGS: Settings = { provider: "openai-codex", model: "", effort: "", theme: "auto", revitServerJs: null, revitNode: null, officeStandardPdf: null, userName: "" };

/** One step of a sign-in the person is going through. */
export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };
