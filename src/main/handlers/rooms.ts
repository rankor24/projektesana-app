// Inventory room tables (1.10) and their Excel export. Read from every property document whose text has a room table.
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { checkWrite } from "../../core/guard.js";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { Handlers } from "../../shared/api.js";
import { pdfLayoutLines, roomsFromLines, totalsCheck, type RoomTable } from "../../sources/extract/kl.js";
import { writeXlsx } from "../../sources/export/xlsx.js";
import { sourceBytes } from "./projects.js";

export interface RoomsDeps {
	registry: Registry;
	openPath(p: string): Promise<string>;
}

type K = "rooms.table" | "rooms.exportXlsx";

const ROOM_ROLES = new Set(["Īpašuma dokumenti", "Iepirkums", "PU", "Info no pasūtītāja", "Cits"]);

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

export function roomHandlers(d: RoomsDeps): Pick<Handlers, K> {
	return {
		"rooms.table": async (id) => {
			const store = d.registry.store(id);
			const out = [];
			for (const s of store.read("sources")) {
				if (s.kind !== "document" || !ROOM_ROLES.has(s.role)) continue;
				const txt = store.readText(s.versions[s.versions.length - 1]?.sha256 ?? "");
				if (!txt || !/eksplikācij|telpas\s+nosaukums|telpu\s+grup/i.test(txt.pages.join(" "))) continue;
				const t = await roomTableOf(store, s.id);
				if (t) out.push({ sourceId: s.id, title: s.title, rows: t.rows.map((r) => ({ floor: r.floor, no: r.no, name: r.name, area: r.area, height: r.height, page: r.page })), totals: totalsCheck(t), unread: t.unread });
			}
			return out;
		},
		"rooms.exportXlsx": async (id, sourceId) => {
			const store = d.registry.store(id);
			const t = await roomTableOf(store, sourceId);
			if (!t) throw new Error("Šajā avotā telpu tabula nav atrasta.");
			const s = store.read("sources").find((x) => x.id === sourceId)!;
			const rows = [["Stāvs", "Telpas Nr.", "Nosaukums", "Platība, m²", "Augstums, m", "Lapa"], ...t.rows.map((r) => [r.floor, r.no, r.name, r.area, r.height, r.page])];
			const check = [["Stāvs", "Dokumentā kopā, m²", "Rindu summa, m²", "Sakrīt"], ...totalsCheck(t).map((x) => [x.floor === "*" ? "visa ēka" : x.floor, x.stated, x.sum, x.ok ? "jā" : "NĒ"])];
			const buf = writeXlsx([
				{ name: "Telpas", rows, widths: [8, 11, 34, 13, 13, 7] },
				{ name: "Summas", rows: check, widths: [10, 20, 18, 9] },
			]);
			const dir = join(store.dir, "exports");
			const file = join(dir, `${id}_telpas_${s.title.replace(/[^\p{L}\d]+/gu, "_").slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
			const g = checkWrite(store.guard, file);
			if (!g.ok) throw new Error(g.reason);
			mkdirSync(dir, { recursive: true });
			writeFileSync(g.path, buf);
			store.log({ kind: "rooms.exported", by: "boris", data: { sourceId, rows: t.rows.length } });
			await d.openPath(g.path);
			return g.path;
		},
	};
}
