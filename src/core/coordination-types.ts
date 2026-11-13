// The shapes of the coordination audit (task 8.9). Types only, no node imports: the renderer imports them through
// shared/api.ts. The audit logic is in coordination.ts; reading the facts out of an IFC is in sources/ifc-facts.ts.
// Ported from BIM Crew apps/server/src/ito/types.ts, with the facts read from each IFC instead of from Solibri ITO tables.

/** A thing with a position in the model's world coordinates, in millimetres. */
export interface Placed {
	name: string;
	x: number;
	y: number;
	z: number;
}

/** What one model says about itself: the header, the spatial hierarchy, the storeys and the coordination marker(s). */
export interface ModelFacts {
	/** the discipline from the file name (AR, BK, …) */
	code: string;
	file: string;
	/** where the facts come from: an IFC file, or the open Revit document */
	source: "ifc" | "revit";
	/** the authoring application the header names, and the day it was written */
	app: string;
	ts: string;
	/** FILE_SCHEMA, e.g. "IFC4"; null when unknown */
	schema: string | null;
	/** the names of IfcProject / IfcSite / IfcBuilding; null = the model has no such entity */
	project: string | null;
	site: Placed | null;
	building: Placed | null;
	/** IfcBuildingStorey: name and world elevation (mm), lowest first */
	storeys: { name: string; elevation: number | null }[];
	/** elements whose name or type names the coordination marker (the "kubs") */
	cubes: Placed[];
}

export interface StoreyScheme {
	id: string;
	label: string;
	storeys: string[];
	/** expected elevation (mm, as text) per storey name; a storey without one is only checked by name */
	elevations?: Record<string, string>;
	/** disciplines that use this scheme instead of the default (the first scheme is the default and needs no list) */
	disciplines: string[];
}

/** The curated "what everything must match" values of a project: seeded from the models (and the BIP, typed in), then edited. */
export interface CoordReference {
	basePoint: { x: string; y: string; z: string };
	/** family / type names that count as the coordination marker */
	cubeNames: string[];
	/** coordinate tolerance, mm */
	tolerance: number;
	hierarchy: { project: string; site: string; building: string; schema: string };
	/** the file-name prefix every model must start with (catches a typo in one model's name); empty = not checked */
	filePrefix: string;
	storeySchemes: StoreyScheme[];
	seededFrom: string | null;
	updatedAt: string | null;
}

/** What the user can type in from the BIP, which this app does not read tables out of yet. */
export interface Declared {
	basePoint?: { x?: string; y?: string; z?: string };
	schema?: string;
	/** storeys by building, in order, with the height when the BIP gives one */
	storeys?: { building?: string; name: string; elevation?: string }[];
}

export type ReportGroupName = "Novietne" | "Hierarhija" | "Stāvi";

export interface ReportLine {
	/** stable between runs: built from what the line is about, never from its position */
	id: string;
	kind: string;
	/** the action or property, the leftmost column */
	w: string;
	now: string;
	to: string;
	/** an open question for the discipline lead */
	ask?: string;
	/** stack now over to: for long lists */
	wide?: boolean;
}

export interface ReportGroup {
	g: ReportGroupName;
	lines: ReportLine[];
}

export interface ModelReport {
	code: string;
	file: string;
	source: "ifc" | "revit";
	app: string;
	ts: string;
	groups: ReportGroup[];
}

export interface AuditReport {
	models: ModelReport[];
	reference: CoordReference;
	totalLines: number;
	date: string;
}
