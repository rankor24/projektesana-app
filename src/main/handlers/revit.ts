// Revit read state for the panels: connection status and the open model's rooms.
import type { RevitClient } from "../../revit/client.js";
import { revitRead } from "../../revit/commands.js";
import type { Handlers } from "../../shared/api.js";

type K = "revit.status" | "revit.rooms";

export function revitHandlers(d: { revit: RevitClient }): Pick<Handlers, K> {
	return {
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
	};
}
