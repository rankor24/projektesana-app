// Specialists and the settings page that edits them (task 8.15; spec v2 in 13.1). Node-free: the renderer imports this file.
import type { Effort } from "./types.js";

/** Limits the settings page shows and src/agent/agents.ts enforces (one place, so the two cannot drift). */
export const ROLE_MAX = 16_000; // characters of a role text
export const SHARED_MAX = 6_000; // characters of the shared rules
/** What a specialist's requests carry before the conversation starts (its standing text + tool declarations); a save past it is refused. */
export const SPECIALIST_FIXED_MAX = 16_000; // tokens
/** The same for the lead (standing text with the roster and skills list + its declarations); the 0.6 guard holds it, and saving specialists is refused past it (R49). */
export const LEAD_FIXED_MAX = 10_000; // tokens

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
	/** check before done: after this agent's final answer a checker turn reads it against the request (up to 3 checks and 2 fixes). `agent`: another agent checks; `provider` / `model`: a checker on that model;
	 *  none given = another provider than this agent's (failover/plan.ts). Absent = no check. */
	check?: { agent?: string; provider?: string; model?: string; maxChecks?: number };
}

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
