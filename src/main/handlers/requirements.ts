// Requirements and findings: list, Boris's decisions, override with reason, re-run.
import { overrideFinding, reopenFinding } from "../../checks/run.js";
import { newId } from "../../core/model.js";
import { addPin, closePin, commentPin, reopenPin } from "../../core/pins.js";
import type { Registry } from "../../core/registry.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";
import type { ProjectEngine } from "../engine.js";

export interface RequirementDeps {
	registry: Registry;
	engine: ProjectEngine;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
}

type K = "requirements.list" | "requirements.notes" | "requirements.decide" | "requirements.refresh" | "findings.list" | "findings.override" | "findings.reopen" | "findings.runAll" | "notes.list" | "notes.write" | "pins.list" | "pins.add" | "pins.comment" | "pins.close" | "pins.reopen";

export function requirementHandlers(d: RequirementDeps): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["requirements", "findings"] });
	return {
		"requirements.list": (id) => d.registry.store(id).read("requirements"),
		"requirements.notes": (id) => d.registry.store(id).readMeta<string[]>("requirements-notes", []),
		"requirements.decide": async (id, reqId, state) => {
			const store = d.registry.store(id);
			store.update(
				"requirements",
				(all) => {
					if (!all.some((r) => r.id === reqId)) throw new Error(`Prasība ${reqId} nav atrasta.`);
					return all.map((r) => (r.id === reqId ? { ...r, state } : r));
				},
				{ kind: `requirement.${state}`, by: "boris", data: { id: reqId } },
			);
			await d.engine.afterChange(store, "requirements");
			changed(id);
		},
		"requirements.refresh": async (id) => {
			const store = d.registry.store(id);
			await d.engine.afterChange(store, "manual");
			changed(id);
			return store.read("requirements").length;
		},
		"findings.list": (id) => d.registry.store(id).read("findings"),
		"findings.override": (id, findingId, reason) => {
			overrideFinding(d.registry.store(id), findingId, reason, "boris");
			changed(id);
		},
		"findings.reopen": (id, findingId) => {
			reopenFinding(d.registry.store(id), findingId);
			changed(id);
		},
		"findings.runAll": async (id) => {
			const r = await d.engine.afterChange(d.registry.store(id), "manual");
			changed(id);
			return r.open;
		},
		"pins.list": (id) => d.registry.store(id).read("pins"),
		"pins.add": (id, target, text) => {
			const p = addPin(d.registry.store(id), target, text, "boris");
			d.emit("data.changed", { projectId: id, what: ["pins"] });
			return p;
		},
		"pins.comment": (id, pinId, text) => {
			commentPin(d.registry.store(id), pinId, text, "boris");
			d.emit("data.changed", { projectId: id, what: ["pins"] });
		},
		"pins.close": async (id, pinId) => {
			const store = d.registry.store(id);
			closePin(store, pinId, "boris");
			await d.engine.afterChange(store, "pins");
			d.emit("data.changed", { projectId: id, what: ["pins"] });
		},
		"pins.reopen": (id, pinId) => {
			reopenPin(d.registry.store(id), pinId);
			d.emit("data.changed", { projectId: id, what: ["pins"] });
		},
		"notes.list": (id, type) => d.registry.store(id).notes(type),
		"notes.write": (id, type, title, body) => {
			if (title.trim().length < 3) throw new Error("Virsraksts ir pārāk īss.");
			const note = { id: newId("n"), type, title: title.trim(), body, refs: [], by: "boris" as const, at: new Date().toISOString() };
			d.registry.store(id).writeNote(note);
			d.emit("data.changed", { projectId: id, what: ["notes"] });
			return note;
		},
	};
}
