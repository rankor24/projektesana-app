// Named Revit read commands the app itself calls (task 3.1), each one short MCP call to a dedicated read tool of
// mcp-server-for-revit. The reply shapes were recorded from a live Revit 2026 on 2026-11-06; the add-in reports areas in
// square feet, lengths in feet (ExportRoomDataEventHandler.cs: "Already in square feet"), so every value is converted here.
import type { RevitCaller } from "./client.js";

export const SQFT_TO_M2 = 0.09290304;
export const FT_TO_MM = 304.8;

export interface RevitInstance {
	pid: number;
	version: string;
	document: string | null;
	documentPath: string | null;
	activeView: string | null;
}

export interface RevitRoom {
	id: string;
	uniqueId: string;
	number: string;
	name: string;
	level: string;
	areaM2: number;
	perimeterM: number;
	heightMm: number;
	phase: string;
	department: string;
	comments: string;
}

export interface RevitLevel {
	name: string;
	elevationMm: number;
	elements: number;
}

const json = (text: string): Record<string, unknown> => {
	const i = text.indexOf("{");
	if (i < 0) throw new Error(`Revit atbilde nav JSON: ${text.slice(0, 200)}`);
	return JSON.parse(text.slice(i)) as Record<string, unknown>;
};

const fail = (j: Record<string, unknown>, what: string) => {
	if (j.success === false) throw new Error(`${what}: ${String(j.message ?? "Revit kļūda")}`);
};

export function parseInstances(text: string): { selectedPid: number | null; instances: RevitInstance[] } {
	const j = json(text) as { selectedPid?: number | null; instances?: { pid: number; revitVersion?: string; activeDocument?: { title?: string; path?: string } | null; activeView?: string | null }[] };
	return {
		selectedPid: j.selectedPid ?? null,
		instances: (j.instances ?? []).map((x) => ({ pid: x.pid, version: x.revitVersion ?? "", document: x.activeDocument?.title ?? null, documentPath: x.activeDocument?.path ?? null, activeView: x.activeView ?? null })),
	};
}

export function parseRooms(text: string): RevitRoom[] {
	const j = json(text);
	fail(j, "Telpas");
	const rooms = (j.rooms ?? []) as { id: number; uniqueId: string; number: string; name: string; level: string; area: number; perimeter: number; unboundedHeight: number; phase?: string; department?: string; comments?: string }[];
	return rooms.map((r) => ({
		id: String(r.id),
		uniqueId: r.uniqueId,
		number: r.number ?? "",
		name: r.name ?? "",
		level: r.level ?? "",
		areaM2: Math.round(r.area * SQFT_TO_M2 * 100) / 100,
		perimeterM: Math.round(r.perimeter * FT_TO_MM) / 1000,
		heightMm: Math.round(r.unboundedHeight * FT_TO_MM),
		phase: r.phase ?? "",
		department: r.department ?? "",
		comments: r.comments ?? "",
	}));
}

export function parseLevels(text: string): RevitLevel[] {
	const j = json(text);
	fail(j, "Līmeņi");
	return ((j.levels ?? []) as { levelName: string; elevation: number; elementCount: number }[]).map((l) => ({ name: l.levelName, elevationMm: Math.round(l.elevation * FT_TO_MM) + 0, elements: l.elementCount })).sort((a, b) => a.elevationMm - b.elevationMm);
}

export const revitRead = {
	instances: async (r: RevitCaller) => parseInstances(await r.call("list_revit_instances", {})),
	rooms: async (r: RevitCaller) => parseRooms(await r.call("export_room_data", { includeUnplacedRooms: false, includeNotEnclosedRooms: false })),
	levels: async (r: RevitCaller) => parseLevels(await r.call("analyze_model_statistics", { includeDetailedTypes: false })),
};
