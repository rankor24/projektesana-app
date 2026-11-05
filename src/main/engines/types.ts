import type { EngineId, EngineStatus, RunEvent } from "../../shared/types.js";

/** How to start one stdio MCP server, plus the tools the agent may call on it. */
export interface McpLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
	/** allow-list: anything not named here is denied */
	tools: readonly string[];
}

export interface RunOptions {
	/** Full prompt. Important material first: the model prompt cuts the END. */
	prompt: string;
	/** App-owned scratch folder for this run (never a project source folder). */
	runDir: string;
	/** Several servers at once: Revit MCP + projektesana-tools (spec §9). */
	mcp: Record<string, McpLaunch>;
	model?: string;
	signal: AbortSignal;
	onEvent: (e: RunEvent) => void;
}

export interface Engine {
	id: EngineId;
	status(): Promise<EngineStatus>;
	run(opts: RunOptions): Promise<void>;
	login?(): Promise<void>;
}

/** The app's own tools. None of them can set `approved`. */
export const SETUP_TOOLS = ["list_files", "read_doc", "project_brief", "rules_for_stage", "search_sources", "add_note", "set_fact", "mark_unknown"] as const;
/** Gather runs (panels 1–8): read the project, propose facts. No `mark_unknown`: only Boris says he does not know. */
export const GATHER_TOOLS = ["list_files", "read_doc", "project_brief", "rules_for_stage", "search_sources", "add_note", "set_fact", "set_file_role", "add_tr", "cite_law"] as const;
export const MODEL_TOOLS = ["list_files", "read_doc", "project_brief", "rules_for_stage", "search_sources", "add_note", "list_open_pins", "resolve_pin", "finish_revision"] as const;
export const PROJEKTESANA_TOOLS = MODEL_TOOLS;
export const TOOLS_SERVER = "projektesana";
export const REVIT_SERVER = "revit";

/**
 * Revit tools the agent may call. `delete_element` and `send_code_to_revit` are off in the
 * first slice (spec §6); the app calls them itself for export and save.
 */
export const REVIT_AGENT_TOOLS = [
	"create_level",
	"create_grid",
	"create_line_based_element",
	"create_surface_based_element",
	"create_point_based_element",
	"create_room",
	"tag_all_rooms",
	"tag_all_walls",
	"create_dimensions",
	"get_current_view_info",
	"get_current_view_elements",
	"get_available_family_types",
	"analyze_model_statistics",
	"export_room_data",
	"get_material_quantities",
	"ai_element_filter",
	"operate_element",
	"color_elements",
	"store_project_data",
	"store_room_data",
	"query_stored_data",
] as const;

export const REVIT_FORBIDDEN = ["delete_element", "send_code_to_revit"] as const;

/** `mcp__server__tool` names for every server in the run. */
export function allowedToolNames(mcp: Record<string, McpLaunch>): string[] {
	return Object.entries(mcp).flatMap(([server, m]) => m.tools.map((t) => `mcp__${server}__${t}`));
}
