// Approval levels of the Revit MCP tools for the agent (work plan "Agent tools"; design doc 4.2).
// Read tools run at once; every tool that creates, changes or deletes in the model is `confirm` in this table, but since 2.15.0 the gate asks no click for it: it checks that the active document is the project's working copy (thread-runner.ts) and refuses otherwise;
// send_code_to_revit is never offered (levels.ts ALWAYS_NEVER enforces that too). delete_element is a change like any other (2.14.4, no click since 2.15.0).
import type { Level } from "./levels.js";

export const REVIT_LEVELS: Record<string, Level> = {
	// read
	list_revit_instances: "read",
	select_revit_instance: "read",
	get_current_view_info: "read",
	get_current_view_elements: "read",
	get_selected_elements: "read",
	get_available_family_types: "read",
	export_room_data: "read",
	analyze_model_statistics: "read",
	get_material_quantities: "read",
	ai_element_filter: "read",
	query_stored_data: "read",
	say_hello: "never",
	// create, modify, delete: no click, working copy only
	create_level: "confirm",
	create_grid: "confirm",
	create_line_based_element: "confirm",
	create_surface_based_element: "confirm",
	create_point_based_element: "confirm",
	create_room: "confirm",
	create_structural_framing_system: "confirm",
	tag_all_rooms: "confirm",
	tag_all_walls: "confirm",
	create_dimensions: "confirm",
	operate_element: "confirm",
	color_elements: "confirm",
	store_project_data: "confirm",
	store_room_data: "confirm",
	// the document tools of the merged Revit MCP (2026-11-25): they open, save and refresh model files, so a click is asked only for an open_document of a file that is not the working copy; like every
	// batch that changes the model it runs only while the active document is the project's working copy (thread-runner.ts, the Revit gate)
	open_document: "confirm",
	save_document: "confirm",
	reload_links: "confirm",
	delete_element: "confirm",
	// never
	send_code_to_revit: "never",
};

export const REVIT_TOOLS = Object.keys(REVIT_LEVELS);
