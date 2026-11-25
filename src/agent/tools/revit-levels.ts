// Approval levels of the Revit MCP tools for the agent (work plan "Agent tools"; design doc 4.2).
// Read tools run at once; every tool that creates or changes the model waits for the user's confirmation per batch;
// send_code_to_revit is never offered (levels.ts ALWAYS_NEVER enforces that too). delete_element waits for the user like every change of the model (2.14.4).
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
	// create and modify: the user confirms each batch
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
	// the document tools of the merged Revit MCP (2026-11-25): they open, save and refresh model files, so each batch waits for the user, and like every
	// batch that changes the model it runs only while the active document is the project's working copy (thread-runner.ts, the Revit gate)
	open_document: "confirm",
	save_document: "confirm",
	reload_links: "confirm",
	// never
	delete_element: "confirm",
	send_code_to_revit: "never",
};

export const REVIT_TOOLS = Object.keys(REVIT_LEVELS);
