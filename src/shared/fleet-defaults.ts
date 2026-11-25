// The tools and skills each BD role gets by default (the user's ruling of 2026-11-25: every agent properly set up, "logically", by role: AR models
// architecture, BK structures, the engineering roles their own disciplines, BPV coordinates and edits the fleet; nobody left with an empty list).
// Node-free: agent/team-import.ts (a new or empty agent) and main/handlers/agents.ts (the one-time set-up of an existing fleet) read it.
//
// What is NOT listed, because every agent has it already: every read tool of the app (sources, law, memory_read, pins, rooms…), the mail tools,
// the self tools (memory_write, edit_own_role, draft_skill, routines) and, for bpv and eks, their process tools. What IS listed: the tools beyond
// reading, and the Revit MCP's own reading tools. Those are never given by themselves (agent/subagents.ts specialistTools), so an agent
// that is not named here has no Revit at all, and an agent that has any Revit tool holds the Revit seat for its run (one Revit, one connection).
// `send_code_to_revit` is in no list: it is `never` for every agent (tools/levels.ts ALWAYS_NEVER). `delete_element` (confirm, one click per batch, working copy only) is in the lists of the roles that model
// (AR, BK, UK, AVK, GA, EL, ESS): the user's ruling of 2026-11-25, "obviously how else it can fix mistakes".

/** The tools of a coding agent beyond reading, for files on the PC (2026-11-25: "it should have all tools you have as an agent"): write, edit, copy, move, run a command. Each batch waits
 *  for the user's click (a text note in the agent's own work folder does not; the office project folders are refused whatever the click: tools/project-write.ts). Converting files, unpacking archives and the spreadsheet (tools/media.ts) write only
 *  new files in the app's own folders, so they run at once. Reading, searching, viewing images, archive listing and reading drawings are read tools every agent has already. */
const FILES = ["write_file", "edit_file", "copy_file", "move_file", "run_command"];
const NEW_FILES = ["convert_file", "archive_extract", "write_spreadsheet"];

/** Every agent: notes, facts, requirements, tasks, pins and comments, the viewer, documents and spreadsheets for a delivery, the checks, files. */
const COMMON = [
	"write_note", "set_fact", "add_requirement", "propose_justification", "create_task", "update_task",
	"add_pin", "add_comment", "resolve_pin", "open_panel", "show_source", "highlight", "draw_sketch",
	"viewer_fly_to", "viewer_select", "viewer_isolate", "viewer_colour", "viewer_split",
	"write_document", "docx_apply", "stage_source_file", "run_check", ...NEW_FILES, ...FILES,
];

/** What the independent expert may use besides its own tools: remarks and the report, never facts, tasks or requirements, and no file writes except new converted files. */
const EXPERT = [
	"expert_import", "expert_add", "expert_edit", "write_note", "add_pin", "add_comment", "resolve_pin", "open_panel", "show_source", "highlight", "draw_sketch",
	"viewer_fly_to", "viewer_select", "viewer_isolate", "viewer_colour", "viewer_split", "write_document", "docx_apply", "run_check", "convert_file", "archive_extract",
];

/** Reading a live Revit model: the Revit MCP's reading tools and the app's own `revit_*` readers (views, models, view settings, schedules, parameters, geometry). All within `run`. */
export const REVIT_READ = [
	"list_revit_instances", "select_revit_instance", "get_current_view_info", "get_current_view_elements", "get_selected_elements", "get_available_family_types",
	"export_room_data", "analyze_model_statistics", "get_material_quantities", "ai_element_filter", "query_stored_data",
	"revit_list_views", "revit_list_models", "revit_get_view_settings", "revit_get_schedule", "revit_read_parameters", "revit_view_geometry", "revit_open_view", "export_room_table",
];

/** Models of the user's own discipline: elements, dimensions, tags, parameters, view settings, sheets, saving and opening documents, exports. Each batch of `confirm` tools waits for the user. */
const REVIT_WORK = [
	"create_line_based_element", "create_point_based_element", "create_surface_based_element", "create_dimensions", "operate_element", "color_elements", "store_project_data", "store_room_data",
	"revit_set_parameter", "revit_set_view_settings", "revit_set_schedule_filter", "revit_set_view_scale", "revit_create_plans", "revit_create_sheet",
	"open_document", "save_document", "reload_links", "revit_save_copy", "revit_export_pdf", "revit_export_ifc",
	"delete_element",
];

export interface FleetDefault {
	/** tools beyond reading (tool names; the set-up keeps only those that exist) */
	tools: string[];
	/** a tool of the list is `confirm`: the agent needs level cap "confirm" (its gate asks the user per batch) */
	confirm: boolean;
	/** synced skills (always ready) this agent is told about in addition to the skills it already has */
	skills: string[];
}

const SYNCED_IFC = ["revit-ifc-export-classes", "ifc-property-set-txt"];

const uniq = (...lists: string[][]): string[] => [...new Set(lists.flat())];

export const FLEET_DEFAULTS: Readonly<Record<string, FleetDefault>> = {
	// coordinates: reads every model, opens and refreshes the linked ones, makes the sheets of the explanatory part and the exports, runs the project (stages, clock, deliveries, rooms); no modelling
	bpv: {
		tools: uniq(COMMON, REVIT_READ, ["app_change", "app_confirm", "app_settings", "plan_delivery", "set_stage_dates", "set_clock", "set_source_role", "set_inventory_rooms", "edit_inventory_room",
			"stage_revit_sheets", "stage_ifc", "rename_staged", "start_delivery", "unstage_file",
			"open_document", "reload_links", "revit_save_copy", "revit_export_pdf", "revit_export_ifc", "revit_create_sheet"]),
		confirm: true,
		skills: uniq(["revit-shared-coordinates-z"], SYNCED_IFC),
	},
	// architecture: the full model of the building (levels, grids, walls, rooms, tags, sheets, views) and the room inventory
	ar: {
		tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["create_level", "create_grid", "create_room", "tag_all_rooms", "tag_all_walls", "revit_create_elevations", "set_inventory_rooms", "edit_inventory_room", "stage_revit_sheets", "stage_ifc", "rename_staged"]),
		confirm: true,
		skills: uniq(["revit-room-dimension-chains", "revit-shared-coordinates-z"], SYNCED_IFC),
	},
	// structures: levels and grids of the structure, framing, the structural model
	bk: {
		tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["create_level", "create_grid", "create_structural_framing_system", "tag_all_walls", "stage_ifc"]),
		confirm: true,
		skills: SYNCED_IFC,
	},
	// the engineering roles: their own model (lines, points, surfaces, dimensions, parameters, sheets), no levels, grids or rooms
	uk: { tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["stage_ifc"]), confirm: true, skills: SYNCED_IFC },
	avk: { tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["stage_ifc"]), confirm: true, skills: SYNCED_IFC },
	ga: { tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["stage_ifc"]), confirm: true, skills: SYNCED_IFC },
	el: { tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["stage_ifc"]), confirm: true, skills: SYNCED_IFC },
	ess: { tools: uniq(COMMON, REVIT_READ, REVIT_WORK, ["stage_ifc"]), confirm: true, skills: SYNCED_IFC },
	// fire safety: marks and colours compartments, writes the fire parameters, filters schedules, exports the fire plans
	ud: { tools: uniq(COMMON, REVIT_READ, ["color_elements", "operate_element", "revit_set_parameter", "revit_set_view_settings", "revit_set_schedule_filter", "revit_export_pdf"]), confirm: true, skills: [] },
	// cost estimator: quantities and schedules from the model (filters a schedule), the delivery's documents
	tam: { tools: uniq(COMMON, REVIT_READ, ["revit_set_schedule_filter"]), confirm: true, skills: [] },
	// the independent expert: reads, never changes a model, facts or tasks
	eks: { tools: uniq(EXPERT, REVIT_READ), confirm: false, skills: [] },
	// the specialists that read the model for areas, volumes, levels and quantities and write their part as documents
	aa: { tools: uniq(COMMON, REVIT_READ), confirm: true, skills: [] },
	cd: { tools: uniq(COMMON, REVIT_READ), confirm: true, skills: [] },
	ea: { tools: uniq(COMMON, REVIT_READ), confirm: true, skills: [] },
	ak: { tools: uniq(COMMON, REVIT_READ), confirm: true, skills: [] },
	// land improvement: documents and the project's data, no Revit
	mel: { tools: uniq(COMMON), confirm: true, skills: [] },
};

/** The spec with its defaults. Tools: only when the list is empty (a list the user made is theirs), filtered to the tools that exist. The level cap becomes `confirm`
 *  when the defaults hold a confirm tool and the spec did not already say so (an empty list is a spec nobody set up, so a `run` cap on it is not a choice). Skills: the
 *  default synced names that the library has are added to the agent's own, in order, without repeats. Other fields are untouched. A spec without a default is returned as it is. */
export function withFleetDefaults<T extends { id: string; tools: string[]; maxLevel?: "run" | "confirm"; skills?: string[] }>(spec: T, have: { tools: ReadonlySet<string>; skills: ReadonlySet<string> }): T {
	const d = FLEET_DEFAULTS[spec.id];
	if (!d) return spec;
	const next = { ...spec };
	if (spec.tools.length === 0) {
		next.tools = d.tools.filter((n) => have.tools.has(n));
		if (d.confirm) next.maxLevel = "confirm";
	}
	const add = d.skills.filter((n) => have.skills.has(n));
	if (add.length) next.skills = [...new Set([...(spec.skills ?? []), ...add])];
	return next;
}

/** What was added to the roles' lists after the first set-up (each has its marker file in agents\, shared/fleet-defaults.ts users: main/handlers/agents.ts setupFleet): the version, and for each role the tools
 *  an existing agent of it gets once. An agent that has no `operate_element` (it does not model: it was never given the model tools) or no level cap "confirm" is left as it is. */
export const FLEET_ADDITIONS: { marker: string; tools: Readonly<Record<string, readonly string[]>> }[] = [
	{ marker: ".fleet-setup-2", tools: Object.fromEntries(["ar", "bk", "uk", "avk", "ga", "el", "ess"].map((id) => [id, ["delete_element"]])) },
];

/** The spec with the tools of one addition: only a modeller (it has `operate_element`) with the level cap `confirm`, only tools that exist, no repeats. */
export function withFleetAddition<T extends { id: string; tools: string[]; maxLevel?: "run" | "confirm" }>(spec: T, add: Readonly<Record<string, readonly string[]>>, have: { tools: ReadonlySet<string> }): T {
	const more = (add[spec.id] ?? []).filter((n) => have.tools.has(n) && !spec.tools.includes(n));
	if (!more.length || !spec.tools.includes("operate_element") || spec.maxLevel !== "confirm") return spec;
	return { ...spec, tools: [...spec.tools, ...more] };
}
