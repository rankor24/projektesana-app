// Inventory room tables of a project (1.10): from every property document whose text has a room table.
// A table read from a scan (OCR) is often wrong: the room type glued to the name, area and height swapped, rooms missing
// (BD424, 2026-11-20). So a document's table can be corrected: the corrected rows (the agent's set_inventory_rooms, read from
// the pages, or the user's) replace the parsed ones everywhere the inventory is used — the Telpas panel, the comparison with
// the model, list_rooms, the checks. A parsed table says how it was read ("teksts" or "skenēts"), a corrected one by whom.
import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { ProjectStore } from "../core/store.js";
import type { Who } from "../core/model.js";
import { sourceBytes } from "./bytes.js";
import { isEksplikacija, roomsFromEksplikacija } from "./extract/eksplikacija.js";
import { pdfLayoutLines, roomsFromLines, type RoomRow, type RoomTable } from "./extract/kl.js";

export const ROOM_ROLES = new Set(["Īpašuma dokumenti", "Iepirkums", "PU", "Info no pasūtītāja", "Cits"]);

/** How a document's table came to be: read by code from a text layer, read by code from a scan, or corrected by a person / the agent. */
export type InventoryState = "teksts" | "skenēts" | "labots";

/** "Telpu grupas kopējā platība …" and the like: a total of a group, not a room. */
const TOTAL_LINE = /kop[eē]j\p{L}*\s+plat|kop[aā]\s*[:(]|platība\s+kopā/iu;

/** The room table of one source as code reads it; PDFs from text positions, everything else from the cached text lines.
 *  A VZD "Būves eksplikācija" (room groups, a room type on every row) has its own reader: its scans move numbers and sizes around. */
export async function roomTableOf(store: ProjectStore, sourceId: string): Promise<RoomTable | null> {
	const s = store.read("sources").find((x) => x.id === sourceId);
	const v = s?.versions[s.versions.length - 1];
	if (!s || !v?.sha256) return null;
	const name = s.container?.inner ?? s.paths[0] ?? "";
	const cached = store.readText(v.sha256);
	let lines: string[][];
	if (extname(name.split("::").pop() ?? "").toLowerCase() === ".pdf" && v.textState === "ok") lines = await pdfLayoutLines(sourceBytes(store, sourceId));
	else if (cached) lines = cached.pages.map((p) => p.split("\n"));
	else return null;
	const pages = lines.map((p) => p.join("\n"));
	const ek = isEksplikacija(pages) ? roomsFromEksplikacija(pages) : null;
	const t = ek?.rows.length ? ek : roomsFromLines(lines);
	t.rows = t.rows.filter((r) => !TOTAL_LINE.test(r.name));
	return t.rows.length ? t : null;
}

// ---- corrections ----

const CORRECTED = "inventory-corrected";
interface Corrected {
	rows: RoomRow[];
	by: Who;
	at: string;
	/** Hashes (roomHash) of rooms a person or the agent deleted. The rows above are already without them; the list stops a later
	 *  full rewrite (the agent's set_inventory_rooms) from quietly putting the same wrong rooms back. Cleared with the correction. */
	deleted?: string[];
}
const corrections = (store: ProjectStore) => store.readMeta<Record<string, Corrected>>(CORRECTED, {});

type Keyed = Pick<RoomRow, "floor" | "no" | "name" | "area" | "page">;
/** A room's identity from what it says (page, floor, number, name, area): the same on every read of the same text. */
const roomHash = (r: Keyed) => createHash("sha1").update([r.page, r.floor, r.no, r.name, r.area].join("\u0001")).digest("hex").slice(0, 8);

/** The rows with an `id` each: the hash, and "-2", "-3" for identical rows. The screen and the agent name rooms by it. */
export function withRowIds<T extends Keyed>(rows: T[]): (T & { id: string })[] {
	const seen = new Map<string, number>();
	return rows.map((r) => {
		const h = roomHash(r);
		const n = (seen.get(h) ?? 0) + 1;
		seen.set(h, n);
		return { ...r, id: n > 1 ? `${h}-${n}` : h };
	});
}

function checkRow(r: Pick<RoomRow, "no" | "area" | "page">): void {
	if (!String(r.no).trim()) throw new Error("Katrai telpai vajag numuru.");
	if (!(r.area > 0)) throw new Error(`Telpai ${r.no} vajag platību (m², > 0).`);
	if (!(r.page >= 1)) throw new Error(`Telpai ${r.no} vajag lapu, kurā tā ir.`);
}

const tidy = (r: Omit<RoomRow, "quote"> & { quote?: string }): RoomRow => ({ ...r, floor: String(r.floor ?? "").trim(), no: String(r.no).trim(), name: String(r.name ?? "").trim(), height: r.height ?? null, quote: r.quote ?? "" });

/** A document's corrected room rows (null = back to what code reads from it, and the deleted rooms are forgotten). Each row cites its
 *  page. Rooms deleted earlier are left out of a full rewrite; `skipped` says how many. */
export function setCorrectedRooms(store: ProjectStore, sourceId: string, rows: Omit<RoomRow, "quote">[] | null, by: Who): { rooms: number; skipped: number } {
	if (!store.read("sources").some((s) => s.id === sourceId)) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const all = { ...corrections(store) };
	let skipped = 0;
	if (rows === null) delete all[sourceId];
	else {
		for (const r of rows) checkRow(r);
		const deleted = all[sourceId]?.deleted ?? [];
		const kept = rows.filter((r) => !deleted.includes(roomHash(r)));
		skipped = rows.length - kept.length;
		all[sourceId] = { rows: kept.map((r) => tidy(r)), by, at: new Date().toISOString(), ...(deleted.length ? { deleted } : {}) };
	}
	store.writeMeta(CORRECTED, all, { kind: "inventory.corrected", by, data: { sourceId, rows: rows ? rows.length - skipped : null, ...(skipped ? { skipped } : {}) } });
	return { rooms: rows === null ? 0 : rows.length - skipped, skipped };
}

/** The inventory table of one source as it stands now (corrected rows if it has them), with an id on each row. */
async function currentRows(store: ProjectStore, sourceId: string) {
	const t = (await inventoryTables(store)).find((x) => x.sourceId === sourceId);
	if (!t) throw new Error("Šajā avotā telpu tabula nav atrasta.");
	return withRowIds(t.table.rows);
}

/**
 * Deletes rooms from a document's inventory: the given row ids, or every row ("all"). The table is first made a correction
 * of its current rows (so a parsed table stops being re-read: re-extraction does not bring the deleted rooms back), then the
 * rows are taken out. "Atjaunot no dokumenta" (setCorrectedRooms null) is the way back.
 */
export async function deleteRooms(store: ProjectStore, sourceId: string, which: string[] | "all", by: Who): Promise<{ removed: number; left: number; unknown: string[] }> {
	const rows = await currentRows(store, sourceId);
	const ids = new Set(which === "all" ? rows.map((r) => r.id) : which);
	const gone = rows.filter((r) => ids.has(r.id));
	const unknown = which === "all" ? [] : which.filter((id) => !rows.some((r) => r.id === id));
	if (!gone.length) throw new Error(`Telpu ar šādiem id nav: ${which === "all" ? "(tabula tukša)" : which.join(", ")}. Id ņem no list_rooms.`);
	const left = rows.filter((r) => !ids.has(r.id));
	const all = { ...corrections(store) };
	const deleted = [...new Set([...(all[sourceId]?.deleted ?? []), ...gone.map((r) => roomHash(r))])];
	all[sourceId] = { rows: left.map(({ id: _id, ...r }) => r), by, at: new Date().toISOString(), deleted };
	store.writeMeta(CORRECTED, all, { kind: "inventory.rooms.deleted", by, data: { sourceId, removed: gone.length, left: left.length, rooms: gone.slice(0, 20).map((r) => r.no) } });
	return { removed: gone.length, left: left.length, unknown };
}

export interface RoomPatch {
	floor?: string;
	no?: string;
	name?: string;
	area?: number;
	height?: number | null;
	page?: number;
}

/** Changes fields of one room of a document's inventory (id from list_rooms / rooms.table); the rest of the table stays. Returns the room with its new id. */
export async function editRoom(store: ProjectStore, sourceId: string, rowId: string, patch: RoomPatch, by: Who): Promise<Keyed & { id: string; height: number | null }> {
	const rows = await currentRows(store, sourceId);
	const at = rows.findIndex((r) => r.id === rowId);
	if (at < 0) throw new Error(`Telpas ar id ${rowId} nav. Id ņem no list_rooms.`);
	const { id: _id, ...old } = rows[at]!;
	const next = tidy({ ...old, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
	checkRow(next);
	const out = rows.map(({ id: _i, ...r }, i) => (i === at ? next : r));
	const all = { ...corrections(store) };
	const deleted = all[sourceId]?.deleted;
	all[sourceId] = { rows: out, by, at: new Date().toISOString(), ...(deleted?.length ? { deleted } : {}) };
	store.writeMeta(CORRECTED, all, { kind: "inventory.rooms.edited", by, data: { sourceId, no: old.no, fields: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) } });
	return withRowIds(out)[at]!;
}

/** Every source with a room table: its corrected rows if it has them, else what code reads, with how it was read. */
export async function inventoryTables(store: ProjectStore): Promise<{ sourceId: string; title: string; table: RoomTable; state: InventoryState; correctedBy?: Who }[]> {
	const out = [];
	const fixed = corrections(store);
	for (const s of store.read("sources")) {
		if (s.kind !== "document") continue;
		const c = fixed[s.id];
		if (c) {
			out.push({ sourceId: s.id, title: s.title, table: { rows: c.rows, totals: (await roomTableOf(store, s.id).catch(() => null))?.totals ?? [], unread: [] }, state: "labots" as const, correctedBy: c.by });
			continue;
		}
		if (!ROOM_ROLES.has(s.role)) continue;
		const v = s.versions[s.versions.length - 1];
		const txt = store.readText(v?.sha256 ?? "");
		if (!txt || !(/eksplikācij|telpas\s+nosaukums|telpu\s+grup/i.test(txt.pages.join(" ")) || isEksplikacija(txt.pages))) continue;
		const t = await roomTableOf(store, s.id);
		if (t) out.push({ sourceId: s.id, title: s.title, table: t, state: v?.textState === "ocr" ? ("skenēts" as const) : ("teksts" as const) });
	}
	return out;
}
