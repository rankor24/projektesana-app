// Inventory room tables of a project (1.10): from every property document whose text has a room table.
// A table read from a scan (OCR) is often wrong: the room type glued to the name, area and height swapped, rooms missing
// (BD424, 2026-11-20). So a document's table can be corrected: the corrected rows (the agent's set_inventory_rooms, read from
// the pages, or the user's) replace the parsed ones everywhere the inventory is used — the Telpas panel, the comparison with
// the model, list_rooms, the checks. A parsed table says how it was read ("teksts" or "skenēts"), a corrected one by whom.
import { extname } from "node:path";
import type { ProjectStore } from "../core/store.js";
import type { Who } from "../core/model.js";
import { sourceBytes } from "./bytes.js";
import { pdfLayoutLines, roomsFromLines, type RoomRow, type RoomTable } from "./extract/kl.js";

export const ROOM_ROLES = new Set(["Īpašuma dokumenti", "Iepirkums", "PU", "Info no pasūtītāja", "Cits"]);

/** How a document's table came to be: read by code from a text layer, read by code from a scan, or corrected by a person / the agent. */
export type InventoryState = "teksts" | "skenēts" | "labots";

/** "Telpu grupas kopējā platība …" and the like: a total of a group, not a room. */
const TOTAL_LINE = /kop[eē]j\p{L}*\s+plat|kop[aā]\s*[:(]|platība\s+kopā/iu;

/** The room table of one source as code reads it; PDFs from text positions, everything else from the cached text lines. */
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
	const t = roomsFromLines(lines);
	t.rows = t.rows.filter((r) => !TOTAL_LINE.test(r.name));
	return t.rows.length ? t : null;
}

// ---- corrections ----

const CORRECTED = "inventory-corrected";
interface Corrected {
	rows: RoomRow[];
	by: Who;
	at: string;
}
const corrections = (store: ProjectStore) => store.readMeta<Record<string, Corrected>>(CORRECTED, {});

/** A document's corrected room rows (null = back to what code reads from it). Each row cites its page. */
export function setCorrectedRooms(store: ProjectStore, sourceId: string, rows: Omit<RoomRow, "quote">[] | null, by: Who): number {
	if (!store.read("sources").some((s) => s.id === sourceId)) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const all = { ...corrections(store) };
	if (rows === null) delete all[sourceId];
	else {
		for (const r of rows) {
			if (!String(r.no).trim()) throw new Error("Katrai telpai vajag numuru.");
			if (!(r.area > 0)) throw new Error(`Telpai ${r.no} vajag platību (m², > 0).`);
			if (!(r.page >= 1)) throw new Error(`Telpai ${r.no} vajag lapu, kurā tā ir.`);
		}
		all[sourceId] = { rows: rows.map((r) => ({ ...r, floor: String(r.floor ?? "").trim(), no: String(r.no).trim(), name: String(r.name ?? "").trim(), height: r.height ?? null, quote: "" })), by, at: new Date().toISOString() };
	}
	store.writeMeta(CORRECTED, all, { kind: "inventory.corrected", by, data: { sourceId, rows: rows?.length ?? null } });
	return rows?.length ?? 0;
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
		if (!txt || !/eksplikācij|telpas\s+nosaukums|telpu\s+grup/i.test(txt.pages.join(" "))) continue;
		const t = await roomTableOf(store, s.id);
		if (t) out.push({ sourceId: s.id, title: s.title, table: t, state: v?.textState === "ocr" ? ("skenēts" as const) : ("teksts" as const) });
	}
	return out;
}
