// Inventory rooms vs model rooms (task 3.2): pairs by room number, then compares floor, name and area.
// Area tolerance per room type: the inventory measures to 0.1 m², so small rooms allow ±0.2 m² (one rounding step each
// side plus finish layers), ordinary rooms ±max(0.2 m², 1 %), large halls and open spaces ±1.5 %.
// Missing on either side and duplicate numbers are reported too. Without a model (Revit not connected) the check skips
// and keeps its earlier findings.
import type { Check, CheckResult } from "../registry.js";
import { inventoryTables } from "../../sources/room-table.js";

export interface InvRoom {
	floor: string;
	no: string;
	name: string;
	area: number;
}

export interface ModelRoom {
	number: string;
	name: string;
	level: string;
	area: number;
	id: string;
}

export type RoomDiffKind = "missing-in-model" | "missing-in-inventory" | "area" | "name" | "floor" | "duplicate";

export interface RoomDiff {
	kind: RoomDiffKind;
	no: string;
	inventory?: InvRoom;
	model?: ModelRoom;
	message: string;
	delta?: number;
	tolerance?: number;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const normNo = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");

/** "1. stāvs" → "1", "Cokols" / "Pagrabs" → "pagrabs", "Bēniņi" → "beniņi", "2. stāvs Cokols" → "2". */
export function floorOf(level: string): string {
	const m = /(-?\d{1,2})\s*\.?\s*st[aā]v/i.exec(level) ?? /^(-?\d{1,2})\b/.exec(level.trim());
	if (m) return String(Number(m[1]));
	const f = fold(level);
	if (/pagrab|cokol/.test(f)) return "pagrabs";
	if (/benin|mansard|jumt/.test(f)) return "beniņi";
	return f;
}

const invFloor = (f: string) => (/^\d+$/.test(f) ? String(Number(f)) : floorOf(f));

export function tolerance(name: string, area: number): number {
	const n = fold(name);
	if (area < 5) return 0.2;
	if (area >= 50 || /zale|holl|vestibil|atrij|noliktav|garaz/.test(n)) return Math.round(area * 0.015 * 100) / 100;
	return Math.max(0.2, Math.round(area * 0.01 * 100) / 100);
}

/** Names are the same when equal after folding, or when one contains the other ("WC" vs "Sanitārais mezgls" differ). */
const sameName = (a: string, b: string) => {
	const x = fold(a);
	const y = fold(b);
	return x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)));
};

export function compareRooms(inv: InvRoom[], model: ModelRoom[]): { diffs: RoomDiff[]; matched: number } {
	const diffs: RoomDiff[] = [];
	const byNo = (list: { no: string }[]) => {
		const m = new Map<string, number>();
		for (const r of list) m.set(normNo(r.no), (m.get(normNo(r.no)) ?? 0) + 1);
		return m;
	};
	for (const [no, n] of byNo(inv)) if (n > 1) diffs.push({ kind: "duplicate", no, message: `Inventarizācijā telpas Nr. ${no} ir ${n} reizes` });
	for (const [no, n] of byNo(model.map((r) => ({ no: r.number })))) if (n > 1) diffs.push({ kind: "duplicate", no, message: `Modelī telpas Nr. ${no} ir ${n} reizes` });
	const modelBy = new Map(model.map((r) => [normNo(r.number), r]));
	const invBy = new Map(inv.map((r) => [normNo(r.no), r]));
	let matched = 0;
	for (const r of inv) {
		const no = normNo(r.no);
		const m = modelBy.get(no);
		if (!m) {
			diffs.push({ kind: "missing-in-model", no, inventory: r, message: `Telpa ${r.no} “${r.name}” (${r.area} m²) ir inventarizācijā, modelī nav` });
			continue;
		}
		matched++;
		if (invFloor(r.floor) !== floorOf(m.level)) diffs.push({ kind: "floor", no, inventory: r, model: m, message: `Telpa ${r.no}: inventarizācijā ${r.floor}. stāvs, modelī “${m.level}”` });
		if (!sameName(r.name, m.name)) diffs.push({ kind: "name", no, inventory: r, model: m, message: `Telpa ${r.no}: inventarizācijā “${r.name}”, modelī “${m.name}”` });
		const tol = tolerance(r.name, r.area);
		const delta = Math.round((m.area - r.area) * 100) / 100;
		if (Math.abs(delta) > tol) diffs.push({ kind: "area", no, inventory: r, model: m, delta, tolerance: tol, message: `Telpa ${r.no} “${r.name}”: inventarizācijā ${r.area} m², modelī ${m.area} m² (${delta > 0 ? "+" : ""}${delta}; pielaide ±${tol})` });
	}
	for (const m of model) if (!invBy.has(normNo(m.number))) diffs.push({ kind: "missing-in-inventory", no: normNo(m.number), model: m, message: `Telpa ${m.number} “${m.name}” (${m.area} m²) ir modelī, inventarizācijā nav` });
	return { diffs, matched };
}

export const roomsCheck: Check = {
	id: "rooms",
	title: "Inventarizācijas telpas pret modeļa telpām",
	on: ["rooms", "manual"],
	run: async ({ store, modelRooms }) => {
		if (!modelRooms) return { results: [], skipped: "nav savienojuma ar Revit" };
		const tables = await inventoryTables(store);
		if (!tables.length) return { results: [], skipped: "inventarizācijas telpu tabula nav atrasta" };
		const inv = tables.flatMap((t) => t.table.rows.map((r) => ({ floor: r.floor, no: r.no, name: r.name, area: r.area })));
		const { diffs } = compareRooms(inv, modelRooms);
		const results: CheckResult[] = diffs.map((d) => ({
			key: `${d.kind}:${d.no}`,
			severity: d.kind === "name" ? "warning" : "error",
			message: d.message,
			where: { roomNo: d.no, elementGuid: d.model?.id, sourceId: tables[0].sourceId },
		}));
		return { results };
	},
};
