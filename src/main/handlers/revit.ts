// Revit read state for the panels: connection status and the open model's rooms.
import type { RevitClient } from "../../revit/client.js";
import { revitRead, revitSelect, writeInvArea } from "../../revit/commands.js";
import type { Registry } from "../../core/registry.js";
import { compareRooms, normNo } from "../../checks/checks/rooms.js";
import { inventoryTables } from "../../sources/room-table.js";
import type { Handlers } from "../../shared/api.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRead } from "../../core/guard.js";
import { listModels } from "../../sources/models.js";

type K = "models.list" | "models.bytes" | "revisions.list" | "revisions.ifc" | "revit.status" | "revit.rooms" | "revit.select" | "rooms.compare" | "rooms.invAreaPlan" | "rooms.writeInvArea";

export function revitHandlers(d: { revit: RevitClient; registry: Registry }): Pick<Handlers, K> {
	return {
		"models.list": (id) => listModels(d.registry.get(id).root),
		"models.bytes": (id, rel) => {
			const store = d.registry.store(id);
			const g = checkRead(store.guard, rel);
			if (!g.ok) throw new Error(g.reason);
			if (!/\.ifc$/i.test(g.path)) throw new Error("Tikai IFC faili.");
			return new Uint8Array(readFileSync(g.path));
		},
		"revisions.list": (id) => d.registry.store(id).read("revisions"),
		"revisions.ifc": (id, revisionId) => {
			const store = d.registry.store(id);
			const r = store.read("revisions").find((x) => x.id === revisionId);
			if (!r?.ifc) throw new Error(`Revīzijai ${revisionId} nav IFC.`);
			const g = checkRead(store.guard, join(store.dir, r.ifc));
			if (!g.ok) throw new Error(g.reason);
			return new Uint8Array(readFileSync(g.path));
		},
		"revit.status": async () => {
			if (!d.revit.configured()) return { state: "nav konfigurēts", document: null, activeView: null, version: null, message: "Revit MCP serveris nav atrasts (Iestatījumi → Revit MCP)." };
			try {
				const r = await revitRead.instances(d.revit);
				const i = r.instances.find((x) => x.pid === r.selectedPid) ?? r.instances[0];
				if (!i) return { state: "nav savienojuma", document: null, activeView: null, version: null, message: "Neviena Revit sesija ar ieslēgtu MCP." };
				return { state: "savienots", document: i.document, activeView: i.activeView, version: i.version };
			} catch (e) {
				return { state: "nav savienojuma", document: null, activeView: null, version: null, message: (e as Error).message };
			}
		},
		"revit.rooms": async () => (await revitRead.rooms(d.revit)).map((r) => ({ id: r.id, uniqueId: r.uniqueId, number: r.number, name: r.name, level: r.level, areaM2: r.areaM2, phase: r.phase })),
		"revit.select": (ids) => revitSelect(d.revit, ids),
		"rooms.invAreaPlan": async (id) => {
			const tables = await inventoryTables(d.registry.store(id));
			const inv = new Map(tables.flatMap((t) => t.table.rows).map((r) => [normNo(r.no), r]));
			const model = await revitRead.rooms(d.revit);
			// only rooms whose number is in the inventory; the value is the inventory area as written there
			return model.filter((m) => inv.has(normNo(m.number))).map((m) => ({ elementId: Number(m.id), number: m.number, name: m.name, areaM2: inv.get(normNo(m.number))!.area }));
		},
		"rooms.writeInvArea": async (id, items) => {
			const store = d.registry.store(id);
			const r = await writeInvArea(d.revit, items);
			store.log({ kind: "revit.invArea.written", by: "boris", data: { written: r.written, noParam: r.noParam.length } });
			return r;
		},
		"rooms.compare": async (id) => {
			const tables = await inventoryTables(d.registry.store(id));
			const inv = tables.flatMap((t) => t.table.rows.map((r) => ({ floor: r.floor, no: r.no, name: r.name, area: r.area })));
			if (!inv.length) return { state: "nav inventarizācijas", inventory: 0, model: 0, matched: 0, diffs: [] };
			let model;
			try {
				model = (await revitRead.rooms(d.revit)).map((r) => ({ number: r.number, name: r.name, level: r.level, area: r.areaM2, id: r.id }));
			} catch (e) {
				return { state: "nav savienojuma", message: (e as Error).message, inventory: inv.length, model: 0, matched: 0, diffs: [] };
			}
			const c = compareRooms(inv, model);
			return { state: "ok", inventory: inv.length, model: model.length, matched: c.matched, diffs: c.diffs };
		},
	};
}
