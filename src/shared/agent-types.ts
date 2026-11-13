// Specialists and the settings page that edits them (task 8.15). Node-free: the renderer imports this file.

export interface AgentSpec {
	id: string;
	name: string;
	description: string;
	prompt: string;
	/** tools beyond reading (every read tool is always available); each at most `run` */
	tools: string[];
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
