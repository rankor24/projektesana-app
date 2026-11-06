// Types shared by main, the tools server, the pi harness and the renderer. No Node or DOM imports here.

export type RunEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "turn"; n: number }
	| { type: "tool"; name: string; detail?: string; id?: string }
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; output?: string }
	/** A `confirm` tool is waiting for Boris; `batch` names what will run. */
	| { type: "confirm"; id: string; tool: string; batch: string }
	| { type: "done"; text: string }
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
}

export const DEFAULT_SETTINGS: Settings = { provider: "openai-codex", model: "", effort: "", theme: "auto", revitServerJs: null, revitNode: null };

/** One step of a sign-in the person is going through. */
export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };
