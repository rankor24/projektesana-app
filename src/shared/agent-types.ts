// Specialists and the settings page that edits them (task 8.15; spec v2 in 13.1). Node-free: the renderer imports this file.
import type { Effort } from "./types.js";

/** Limits the settings page shows and src/agent/agents.ts enforces (one place, so the two cannot drift). */
export const ROLE_MAX = 16_000; // characters of a role text
export const SHARED_MAX = 6_000; // characters of the shared rules
/** What a specialist's requests carry before the conversation starts (its standing text + tool declarations); a save past it is refused. */
export const SPECIALIST_FIXED_MAX = 16_000; // tokens
/** The same for the lead (standing text with the roster and skills list + its declarations); the 0.6 guard holds it, and saving specialists is refused past it (R49).
 *  16 000 since the team import: the lead's declarations alone (the app's tools and the app_calls catalog) measure ~12 100 tokens and its standing text ~1 400, so the old
 *  10 000 refused every added agent ("a save that makes the lead heavier is refused while it is over") and the 16 BD roles could not be saved. A roster line costs ~12 tokens, so
 *  16 000 leaves room for ~120 more agents. 18 000 since 2.8.0: the Chief's tools (tasks, incidents), memory, routines and search added ~2 000 to the declarations,
 *  and the 16 roles with their descriptions came to 16 011; a guard against a runaway text, far under any model's context. */
export const LEAD_FIXED_MAX = 18_000; // tokens

export interface AgentSpec {
	id: string;
	name: string;
	description: string;
	prompt: string;
	/** tools beyond reading (every read tool is always available); each at most `run` */
	tools: string[];
	/** <appDir>/agents/<id>.md exists and is the role text; then `prompt` may be empty or a short addition */
	roleFile?: boolean;
	/** the highest level of a tool this agent may be given; absent = "run" (never above what the user confirms per batch) */
	maxLevel?: "run" | "confirm";
	/** a model id and effort of its own; empty or absent = the run's. Checked when the run starts, not on save */
	model?: string;
	effort?: Effort | "";
	/** the provider this agent runs on (a pi provider id or "claude-sub"); absent = the app's provider. `model` then names a model of this provider (empty = its default). */
	provider?: string;
	/** where this agent carries on when its provider is at its usage limit or signed out; absent = the app-wide backup (settings.backup), none when that is not set either */
	backup?: { provider: string; model: string };
	/** who this agent may message / take messages from: ids or "lead"; absent = everyone, [] = nobody */
	mayMessage?: string[];
	acceptsFrom?: string[];
	/** skill names this agent is told about; absent = the synced Revit skills, as today (13.6 checks the names) */
	skills?: string[];
	/** the department (shared/departments.ts) the agent is filed in: an id of the app's department list; absent = the default of its id (BD roles), "" = in none */
	department?: string;
	/** the LBN 202-18 markas this agent writes (shared/markas.ts codes: AR, BK, AVK-A …); absent = the default of its id (`DEFAULT_MARKAS_OF`, the BD roles), [] = none */
	markas?: string[];
	/** check before done (docs/BD adoption plan, "Check before done"): who reads this agent's finished answer against the request before it is handed on. `agent` = another agent of
	 *  the list, else `provider` + `model` = a model of its own (another provider than the author's by default, set here); `maxChecks` = the most checks a task gets (1-3).
	 *  Absent = no check. This file only holds and validates the fields; the logic that runs the check is the runner's. */
	check?: { agent?: string; provider?: string; model?: string; maxChecks?: number };
	/** MCP servers this agent alone may use (ported from OpenMausBot docs/custom-mcp-servers.md), pasted as `claude mcp add …` and parsed (shared/mcp-paste.ts). */
	mcp?: AgentMcpServer[];
}

/** One MCP server of one agent: a program to start (`command`, `args`, `env`) or an address (`url`, `headers`). The tools it offers are listed once by the settings dialog (`tools`)
 *  and only those are offered to the agent: a tool the server adds later stays out until the user lists it again. Every tool needs the user's confirmation per batch
 *  (level `confirm`) unless the user marked it in `read` (a tool that only looks things up). */
export interface AgentMcpServer {
	/** lower case letters, digits, "-" and "_"; the tools reach the model as `<name>__<tool>` */
	name: string;
	command?: string;
	args?: string[];
	/** environment of the program; values are secrets: the window gets them masked (MCP_SECRET_SET) and sends the mask back to keep one */
	env?: Record<string, string>;
	url?: string;
	/** request headers of a `url` server (an Authorization token is a secret like `env`) */
	headers?: Record<string, string>;
	/** the server's tool names as the dialog listed them: the ones offered to the agent */
	tools?: string[];
	/** the listed tools the user marked as read-only: they run without the per-batch confirmation */
	read?: string[];
}

/** What the window shows and sends back for a secret value that is saved: the real value never leaves the main process. */
export const MCP_SECRET_SET = "••• saglabāts";
export const MCP_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const AGENT_CHECKS_MAX = 3;

/** Lower case, no diacritics, letters and digits only: "Ekspertīzes lasītājs" and "ekspertizeslasitajs" are the same. */
export const normRef = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** A specialist by id or by name (loosely: case, diacritics, a prefix). Here, not in agent/subagents.ts, so the renderer-side `@` parser can use it. */
export function findSpec(specs: readonly AgentSpec[], ref: string): AgentSpec | undefined {
	const q = normRef(ref);
	if (!q) return undefined;
	return specs.find((s) => normRef(s.id) === q || normRef(s.name) === q) ?? specs.find((s) => normRef(s.id).startsWith(q) || normRef(s.name).startsWith(q));
}

/** A tool a specialist can be given, for the settings page. */
export interface AgentToolRow {
	name: string;
	level: string;
	description: string;
}

/** A spec as the settings page lists it: with what its requests carry before the conversation starts (standing text + tool declarations, estimated tokens). */
export type AgentSpecRow = AgentSpec & { fixedTokens: number };

export interface AgentsView {
	specs: AgentSpecRow[];
	/** the shipped list is in use (nothing saved yet) */
	shipped: boolean;
	defaults: AgentSpec[];
	/** every tool a specialist can be given, with its level: `run` ones always, `confirm` ones only for an agent with maxLevel "confirm" (the page filters) */
	tools: AgentToolRow[];
	maxParallel: number;
}

/** What «Importēt BD komandu…» did, for the page to show (agents.importTeam). */
export interface TeamImportReport {
	folder: string;
	/** agent ids made new / updated (the user's own settings kept) */
	created: string[];
	updated: string[];
	/** a role that could not be saved, and why */
	skipped: { id: string; why: string }[];
	/** role numbers (01–16) that had no file in the folder */
	missing: string[];
	skills: {
		/** put into the office library now */
		imported: string[];
		/** already in the library: left as they were (their tested mark stays) */
		kept: string[];
		refused: { name: string; why: string }[];
		/** skills of the team still waiting for the user's «tested» mark in Prasmes: an agent is told about a ready skill only */
		notReady: number;
	};
	/** skill names now on the imported agents' lists, in all */
	assigned: number;
}

/** The tools an MCP server listed when the dialog tried it. */
export interface McpProbe {
	tools: { name: string; description: string }[];
}
