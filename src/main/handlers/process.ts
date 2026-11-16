// Process mode per project (task 14.2): the mode switch and the profile. The rules live in core/process.ts; this file reads the agents that
// exist (Iestatījumi → Aģenti), calls them as the user and tells the renderer to refresh.
import { changeProfile, readProcess, switchMode } from "../../core/process.js";
import type { Registry } from "../../core/registry.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "process.get" | "process.setMode" | "process.setProfile";

export function processHandlers(d: { registry: Registry; settings: AppSettings; emit: (e: "data.changed", p: { projectId: string | null; what: string[] }) => void }): Pick<Handlers, K> {
	const existing = () => d.settings.agentSpecs().specs.map((s) => s.id);
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["process"] });
	return {
		"process.get": (id) => readProcess(d.registry.store(id)),
		"process.setMode": (id, mode) => {
			const s = switchMode(d.registry.store(id), mode, existing(), "user");
			changed(id);
			return s;
		},
		"process.setProfile": (id, p) => {
			const s = changeProfile(d.registry.store(id), p, existing(), "user");
			changed(id);
			return s;
		},
	};
}
