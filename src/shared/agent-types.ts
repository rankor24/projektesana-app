// Specialists and the settings page that edits them (task 8.15). Node-free: the renderer imports this file.

export interface AgentSpec {
	id: string;
	name: string;
	description: string;
	prompt: string;
	/** tools beyond reading (every read tool is always available); each at most `run` */
	tools: string[];
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

export interface AgentsView {
	specs: AgentSpec[];
	/** the shipped list is in use (nothing saved yet) */
	shipped: boolean;
	defaults: AgentSpec[];
	/** every tool that is not read-only and needs no batch confirmation: what can be ticked */
	tools: AgentToolRow[];
	maxParallel: number;
}
