// Types shared by main, mcp server, agent-pi and renderer. No Node or DOM imports here.

/** One harness for the whole family of apps: pi (src/agent-pi), with the provider chosen in settings. */
export type EngineId = "pi";

export interface EngineStatus {
	id: EngineId;
	ready: boolean;
	reason: string;
	canLogin: boolean;
}

export type RunEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "turn"; n: number }
	| { type: "tool"; name: string; detail?: string; id?: string }
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; output?: string }
	| { type: "done"; text: string }
	/** Raw provider error, never rewritten. */
	| { type: "error"; engine: EngineId; message: string };

/** Review state of one page or model. Only Boris sets `approved`. */
export type ReviewState = "new" | "commented" | "approved";

export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Settings {
	/** pi provider id (anthropic, openai-codex, xai, openai, google, openrouter) */
	provider: string;
	/** empty = the provider's default model */
	model: string;
	/** empty = the model's default effort */
	effort: Effort | "";
	theme: "auto" | "light" | "dark";
	/** Revit MCP server entry (server/build/index.js of the revit-mcp fork). null = not configured */
	revitServerJs: string | null;
}

export const DEFAULT_SETTINGS: Settings = { provider: "anthropic", model: "", effort: "", theme: "auto", revitServerJs: null };

/** One step of a sign-in the person is going through. */
export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };
