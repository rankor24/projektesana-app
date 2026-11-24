// The Telpas page (task 9.10): the floor strip with each floor's sum check, the rooms of the picked floor coloured by how they
// differ from the model, and the plan they are laid out on. The plan is a TILE plan: each room a rectangle sized by its area
// (a squarified treemap), because the data the app has — the inventory table and the model's room list — holds areas, not
// boundaries. Revit's room boundaries or the vector PDF's lines would give a real plan; neither is in the data read so far, and a
// plan with invented positions would be worse than none. Pure and node-free.
import type { InventoryTable, RoomCompareRow } from "./api.js";

export type DiffKind = "missing-in-model" | "missing-in-inventory" | "area" | "name" | "floor" | "duplicate";
export type Tone = "ok" | "warn" | "bad";

/** How loud each kind of difference is. */
export const DIFF_TONE: Record<DiffKind, Tone> = { "missing-in-model": "bad", "missing-in-inventory": "bad", area: "bad", duplicate: "bad", name: "warn", floor: "warn" };
export const DIFF_LABEL: Record<DiffKind, string> = { "missing-in-model": "nav modelī", "missing-in-inventory": "nav inventarizācijā", area: "platība", name: "nosaukums", floor: "stāvs", duplicate: "dubults Nr." };
const WORST: DiffKind[] = ["missing-in-model", "missing-in-inventory", "duplicate", "area", "floor", "name"];

export interface FloorChip {
	floor: string;
	rooms: number;
	/** the rows' sum, m² */
	sum: number;
	/** the figure the document states, when it states one for this floor */
	stated: number | null;
	/** false when a stated total does not equal the rows' sum */
	ok: boolean;
	/** rooms of this floor that differ from the model (0 when no comparison was made) */
	diffs: number;
}

type Diff = RoomCompareRow["diffs"][number];
const knownKind = (k: string): k is DiffKind => (WORST as string[]).includes(k);

/** The worst difference of each room number, from the compare rows. */
export function diffByRoom(diffs: Diff[]): Map<string, DiffKind> {
	const out = new Map<string, DiffKind>();
	for (const d of diffs) {
		if (!knownKind(d.kind)) continue;
		const have = out.get(d.no);
		if (!have || WORST.indexOf(d.kind) < WORST.indexOf(have)) out.set(d.no, d.kind);
	}
	return out;
}

const floorOfDiff = (d: Diff): string | null => d.inventory?.floor ?? null;

/** One chip per floor of the inventory, in the order the document lists them, with the sum check of that floor. */
export function floorStrip(tables: InventoryTable[], diffs: Diff[] = []): FloorChip[] {
	const chips = new Map<string, FloorChip>();
	for (const t of tables) {
		for (const r of t.rows) {
			const c = chips.get(r.floor) ?? { floor: r.floor, rooms: 0, sum: 0, stated: null, ok: true, diffs: 0 };
			c.rooms++;
			c.sum = Math.round((c.sum + r.area) * 100) / 100;
			chips.set(r.floor, c);
		}
		for (const x of t.totals) {
			if (x.floor === "*") continue; // the document's grand total belongs to no floor
			const c = chips.get(x.floor);
			if (!c) continue;
			c.stated = x.stated;
			if (!x.ok) c.ok = false;
		}
	}
	const byRoom = diffByRoom(diffs);
	const floorOf = new Map<string, string>(tables.flatMap((t) => t.rows.map((r) => [r.no, r.floor] as const)));
	for (const [no] of byRoom) {
		const f = floorOf.get(no) ?? diffs.map(floorOfDiff).find((x) => x !== null && diffs.some((d) => d.no === no && d.inventory?.floor === x));
		if (f && chips.has(f)) chips.get(f)!.diffs++;
	}
	return [...chips.values()];
}

/** The floor the plan opens on: the one the user picked if it exists, else the first floor whose sum does not check, else the first. */
export function pickFloor(strip: FloorChip[], current: string | null = null): string | null {
	if (current && strip.some((c) => c.floor === current)) return current;
	return (strip.find((c) => !c.ok) ?? strip[0])?.floor ?? null;
}

export interface PlanRoom {
	no: string;
	name: string;
	area: number;
	floor: string;
	diff: DiffKind | null;
	/** the model's element for the room (Revit select), when the compare found one */
	modelId?: string;
	/** only the model has this room */
	modelOnly?: boolean;
}

/**
 * The rooms of one floor: every inventory row, each with the worst difference it has; and the rooms only the model has (the
 * compare says "nav inventarizācijā") on the floor whose name they carry as their level. Biggest first.
 */
export function planRooms(tables: InventoryTable[], diffs: Diff[], floor: string): PlanRoom[] {
	const byRoom = diffByRoom(diffs);
	const modelIds = new Map<string, string>();
	for (const d of diffs) if (d.model?.id) modelIds.set(d.no, d.model.id);
	const rooms: PlanRoom[] = tables.flatMap((t) => t.rows.filter((r) => r.floor === floor).map((r) => ({ no: r.no, name: r.name, area: r.area, floor, diff: byRoom.get(r.no) ?? null, ...(modelIds.has(r.no) ? { modelId: modelIds.get(r.no) } : {}) })));
	const have = new Set(rooms.map((r) => r.no));
	for (const d of diffs) {
		if (d.kind !== "missing-in-inventory" || !d.model || have.has(d.no)) continue;
		if (d.model.level !== floor && d.model.level.replace(/\D+/g, "") !== floor.replace(/\D+/g, "")) continue;
		have.add(d.no);
		rooms.push({ no: d.no, name: d.model.name, area: d.model.area, floor, diff: "missing-in-inventory", modelId: d.model.id, modelOnly: true });
	}
	return rooms.sort((a, b) => b.area - a.area || a.no.localeCompare(b.no, "lv", { numeric: true }));
}

/** How the plan orders its rooms: the layout fills row by row from the first room, so the order decides where each one sits. */
export type SortKey = "area-desc" | "area-asc" | "no" | "name" | "diff";
export const SORT_KEYS: SortKey[] = ["area-desc", "area-asc", "no", "name", "diff"];
/** Which rooms the plan shows: all, those with any difference, those without, or those with one kind of difference. */
export type StatusFilter = "all" | "diffs" | "ok" | DiffKind;
export interface PlanFilter {
	/** matches the room number or the name, any case */
	text: string;
	status: StatusFilter;
}
export const NO_FILTER: PlanFilter = { text: "", status: "all" };

const byNo = (a: PlanRoom, b: PlanRoom) => a.no.localeCompare(b.no, "lv", { numeric: true });

/** The rooms in the order asked for; ties fall back to the number, so the order is always the same for the same rooms. */
export function sortRooms(rooms: PlanRoom[], key: SortKey): PlanRoom[] {
	const rank = (r: PlanRoom) => (r.diff ? WORST.indexOf(r.diff) : WORST.length);
	const cmp: Record<SortKey, (a: PlanRoom, b: PlanRoom) => number> = {
		"area-desc": (a, b) => b.area - a.area,
		"area-asc": (a, b) => a.area - b.area,
		no: byNo,
		name: (a, b) => a.name.localeCompare(b.name, "lv"),
		diff: (a, b) => rank(a) - rank(b) || b.area - a.area,
	};
	return [...rooms].sort((a, b) => cmp[key](a, b) || byNo(a, b));
}

/** The rooms that pass the filter. */
export function filterRooms(rooms: PlanRoom[], f: PlanFilter): PlanRoom[] {
	const q = f.text.trim().toLocaleLowerCase("lv");
	return rooms.filter((r) => {
		if (q && !r.no.toLocaleLowerCase("lv").includes(q) && !r.name.toLocaleLowerCase("lv").includes(q)) return false;
		if (f.status === "all") return true;
		if (f.status === "diffs") return r.diff !== null;
		if (f.status === "ok") return r.diff === null;
		return r.diff === f.status;
	});
}

/** The kinds of difference these rooms have, worst first: what the status filter can offer for this floor. */
export function kindsPresent(rooms: PlanRoom[]): DiffKind[] {
	const have = new Set(rooms.map((r) => r.diff).filter((d): d is DiffKind => d !== null));
	return WORST.filter((k) => have.has(k));
}

export interface Tile {
	room: PlanRoom;
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * A squarified treemap of the rooms in a w × h box: each tile's area is proportional to the room's area, tiles do not overlap
 * and fill the box (rooms with no area get a small fixed share so they can still be seen and clicked).
 */
export function tiles(rooms: PlanRoom[], w: number, h: number): Tile[] {
	const items = rooms.map((room) => ({ room, v: Math.max(room.area, 0) }));
	const min = Math.max(0.5, (items.reduce((s, i) => s + i.v, 0) / Math.max(items.length, 1)) * 0.05);
	for (const i of items) if (i.v < min) i.v = min;
	const total = items.reduce((s, i) => s + i.v, 0);
	if (!items.length || total <= 0 || w <= 0 || h <= 0) return [];
	const scale = (w * h) / total;
	const out: Tile[] = [];
	const worst = (row: number[], side: number) => {
		const s = row.reduce((a, b) => a + b, 0);
		return Math.max(...row.map((r) => Math.max((side * side * r) / (s * s), (s * s) / (side * side * r))));
	};
	let rest = [...items];
	let x = 0;
	let y = 0;
	let bw = w;
	let bh = h;
	while (rest.length) {
		const side = Math.min(bw, bh);
		const row: typeof items = [rest[0]];
		let k = 1;
		while (k < rest.length && worst([...row, rest[k]].map((i) => i.v * scale), side) <= worst(row.map((i) => i.v * scale), side)) row.push(rest[k++]);
		const rowArea = row.reduce((s, i) => s + i.v * scale, 0);
		const thick = rowArea / side;
		let off = 0;
		for (const i of row) {
			const len = (i.v * scale) / thick;
			out.push(bw >= bh ? { room: i.room, x: x, y: y + off, w: thick, h: len } : { room: i.room, x: x + off, y: y, w: len, h: thick });
			off += len;
		}
		if (bw >= bh) {
			x += thick;
			bw -= thick;
		} else {
			y += thick;
			bh -= thick;
		}
		rest = rest.slice(k);
	}
	return out;
}
