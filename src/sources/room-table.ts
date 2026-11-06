// Inventory room tables of a project (1.10): from every property document whose text has a room table.
import { extname } from "node:path";
import type { ProjectStore } from "../core/store.js";
import { sourceBytes } from "./bytes.js";
import { pdfLayoutLines, roomsFromLines, type RoomTable } from "./extract/kl.js";

export const ROOM_ROLES = new Set(["Īpašuma dokumenti", "Iepirkums", "PU", "Info no pasūtītāja", "Cits"]);

/** The room table of one source; PDFs from text positions, everything else from the cached text lines. */
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
	return t.rows.length ? t : null;
}


/** Every source with a room table, with its table. */
export async function inventoryTables(store: ProjectStore): Promise<{ sourceId: string; title: string; table: RoomTable }[]> {
	const out = [];
	for (const s of store.read("sources")) {
		if (s.kind !== "document" || !ROOM_ROLES.has(s.role)) continue;
		const txt = store.readText(s.versions[s.versions.length - 1]?.sha256 ?? "");
		if (!txt || !/eksplikācij|telpass+nosaukums|telpus+grup/i.test(txt.pages.join(" "))) continue;
		const t = await roomTableOf(store, s.id);
		if (t) out.push({ sourceId: s.id, title: s.title, table: t });
	}
	return out;
}
