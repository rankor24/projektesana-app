// The agent's coordination tool (task 8.10): the shared-coordinates guide for this project, to walk the user through it with the
// revit-shared-coordinates-z skill. Read-only: it writes nothing (the panel's button keeps the guide as a note).
import { guideInput, coordinatesGuide } from "../../rules/coordinates-guide.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

export const coordinationTools: ToolDef[] = [
	tool({
		name: "coordinates_guide",
		level: "read",
		description: "The shared-coordinates guide for this project: the base point and storey heights of its coordination reference, the topography they come from, the Revit steps, the IFC export setting, and which models still have placement remarks. Use it with the revit-shared-coordinates-z skill.",
		input: {},
		run: (ctx) => {
			const input = guideInput(storeOf(ctx), new Date().toISOString().slice(0, 10));
			return input ? coordinatesGuide(input) : "no data: projektam nav koordinācijas atsauces (Prasības → Koordinācija).";
		},
	}),
];
