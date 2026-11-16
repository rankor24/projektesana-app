// Specialists and the settings page that edits them (task 8.15; spec v2 in 13.1). Node-free: the renderer imports this file.
import type { Effort } from "./types.js";

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
	/** who this agent may message / take messages from: ids or "lead"; absent = everyone, [] = nobody */
	mayMessage?: string[];
	acceptsFrom?: string[];
	/** skill names this agent is told about; absent = the synced Revit skills, as today (13.6 checks the names) */
	skills?: string[];
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
	/** every tool that is not read-only and needs no batch confirmation: what can be ticked */
	tools: AgentToolRow[];
	maxParallel: number;
}
