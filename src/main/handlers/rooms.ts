// Inventory room tables (1.10) and their Excel export. Read from every property document whose text has a room table.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkWrite } from "../../core/guard.js";
import type { Registry } from "../../core/registry.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";
import { totalsCheck } from "../../sources/extract/kl.js";
import { deleteRooms, editRoom, inventoryTables, setCorrectedRooms, withRowIds } from "../../sources/room-table.js";
import { writeXlsx } from "../../sources/export/xlsx.js";
import { geometryCsv, pdfGeometry } from "../../sources/extract/kl-geometry.js";
import { sourceBytes } from "../../sources/bytes.js";

export interface RoomsDeps {
	registry: Registry;
	openPath(p: string): Promise<string>;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
}

type K = "rooms.table" | "rooms.delete" | "rooms.update" | "rooms.restore" | "rooms.exportXlsx" | "rooms.geometry" | "rooms.geometryCsv";

export function roomHandlers(d: RoomsDeps): Pick<Handlers, K> {
	return {
		"rooms.geometry": async (id, sourceId) => (await pdfGeometry(sourceBytes(d.registry.store(id), sourceId))).map((p) => ({ page: p.page, floor: p.floor, fractions: p.fractions, segments: p.segments.length })),
		"rooms.geometryCsv": async (id, sourceId) => {
			const store = d.registry.store(id);
			const s = store.read("sources").find((x) => x.id === sourceId);
			if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
			const csv = geometryCsv(await pdfGeometry(sourceBytes(store, sourceId)));
			const dir = join(store.dir, "exports");
			const file = join(dir, `${id}_geometrija_${s.title.replace(/[^\p{L}\d]+/gu, "_").slice(0, 40)}.csv`);
			const g = checkWrite(store.guard, file);
			if (!g.ok) throw new Error(g.reason);
			mkdirSync(dir, { recursive: true });
			writeFileSync(g.path, "﻿" + csv, "utf8");
			await d.openPath(g.path);
			return g.path;
		},
		"rooms.delete": async (id, sourceId, rowIds) => {
			const r = await deleteRooms(d.registry.store(id), sourceId, rowIds, "user");
			d.emit("data.changed", { projectId: id, what: ["rooms", "findings"] });
			return { removed: r.removed, left: r.left };
		},
		"rooms.update": async (id, sourceId, rowId, patch) => {
			await editRoom(d.registry.store(id), sourceId, rowId, patch, "user");
			d.emit("data.changed", { projectId: id, what: ["rooms", "findings"] });
		},
		"rooms.restore": (id, sourceId) => {
			setCorrectedRooms(d.registry.store(id), sourceId, null, "user");
			d.emit("data.changed", { projectId: id, what: ["rooms", "findings"] });
		},
		"rooms.table": async (id) => {
			const tables = await inventoryTables(d.registry.store(id));
			return tables.map(({ sourceId, title, table: t, state, correctedBy }) => ({ sourceId, title, rows: withRowIds(t.rows).map((r) => ({ id: r.id, floor: r.floor, no: r.no, name: r.name, area: r.area, height: r.height, page: r.page })), totals: totalsCheck(t), unread: t.unread, state, ...(correctedBy ? { correctedBy } : {}) }));
		},
		"rooms.exportXlsx": async (id, sourceId) => {
			const store = d.registry.store(id);
			// the inventory as it stands: corrected rows when the document has them
			const t = (await inventoryTables(store)).find((x) => x.sourceId === sourceId)?.table;
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
			store.log({ kind: "rooms.exported", by: "user", data: { sourceId, rows: t.rows.length } });
			await d.openPath(g.path);
			return g.path;
		},
	};
}
