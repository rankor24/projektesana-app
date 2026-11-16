// Process mode per project (task 14.2): the mode switch and the profile. The rules live in core/process.ts; this file reads the agents that
// exist (Iestatījumi → Aģenti), calls them as the user and tells the renderer to refresh.
import { type ProcessState, changeProfile, decideGate, readProcess, switchMode } from "../../core/process.js";
import { exportDir, exportRegisters } from "../../core/registers.js";
import type { Registry } from "../../core/registry.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "process.get" | "process.setMode" | "process.setProfile" | "process.gate" | "process.export";

export function processHandlers(d: { registry: Registry; settings: AppSettings; emit: (e: "data.changed", p: { projectId: string | null; what: string[] }) => void; /** the agent session: told when a gate was decided, so "Gaida tevi" is sent again */ session?: { notesChanged(): void } }): Pick<Handlers, K> {
	const existing = () => d.settings.agentSpecs().specs.map((s) => s.id);
	// a call that changed nothing announces nothing
	const changed = (id: string, before: ProcessState | null, after: ProcessState) => {
		if (JSON.stringify(before) !== JSON.stringify(after)) d.emit("data.changed", { projectId: id, what: ["process"] });
	};
	return {
		"process.get": (id) => readProcess(d.registry.store(id)),
		"process.setMode": (id, mode) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = switchMode(store, mode, existing(), "user");
			changed(id, before, s);
			return s;
		},
		"process.setProfile": (id, p) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = changeProfile(store, p, existing(), "user");
			changed(id, before, s);
			return s;
		},
		// the user only: no agent tool calls decideGate
		"process.gate": (id, decision) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = decideGate(store, decision, new Date());
			changed(id, before, s);
			d.session?.notesChanged();
			return s;
		},
		// the registers as files in <project data>/export/00_vadiba, from the state as it is now; the generated copy, nothing is read back from it
		"process.export": (id) => {
			const store = d.registry.store(id);
			const s = readProcess(store);
			if (!s) throw new Error("Procesa režīms nav ieslēgts.");
			return exportRegisters(store, exportDir(store), s);
		},
	};
}
