// The IPC calls of Grafiks → Rutīnas, Atmiņa → Aģentu atmiņa, the agents' own changes and the app problem log. Routines go through the
// RoutineService (main/routines-scheduler.ts) that main also starts as the timer; the rest are the plain functions of agent/*.
import { RoutineService } from "../routines-scheduler.js";
import { listIssues, setIssueStatus } from "../../agent/app-issues.js";
import { listMemoryFiles, readMemoryFile, writeMemory } from "../../agent/memory-md.js";
import { undoChange } from "../../agent/self-changes.js";
import { listChanges } from "../../agent/self-journal.js";
import type { AgentSession } from "../../agent/session.js";
import type { Registry } from "../../core/registry.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";
import { LEAD_ID } from "../../shared/thread-types.js";
import type { AppSettings } from "../settings.js";

type K = "routines.list" | "routines.preview" | "routines.save" | "routines.setPaused" | "routines.remove" | "routines.runNow" | "routines.occurrences" | "memoryMd.list" | "memoryMd.read" | "memoryMd.write" | "selfChanges.list" | "selfChanges.undo" | "appIssues.list" | "appIssues.setStatus";

export interface RoutineHandlerDeps {
	registry: Registry;
	settings: AppSettings;
	session: AgentSession;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	skillsDir?: string;
	/** the one service main also runs as the timer; tests and the contract test build their own */
	routines?: RoutineService;
}

/** The service for these deps: main passes its own (the one with the timer), anything else gets one that is never started. */
export function routineService(d: RoutineHandlerDeps): RoutineService {
	return (
		d.routines ??
		new RoutineService({
			appDir: d.settings.dir,
			projectsDir: d.settings.projectsDir(),
			projectIds: () => d.registry.list().map((p) => p.id),
			agents: () => d.settings.agentSpecs().specs,
			session: d.session,
			store: (id) => d.registry.store(id),
			changed: (projectId, what) => d.emit("data.changed", { projectId, what }),
		})
	);
}

export function routineHandlers(d: RoutineHandlerDeps): Pick<Handlers, K> {
	const svc = routineService(d);
	const app = () => d.settings.dir;
	const changed = (what: string[]) => d.emit("data.changed", { projectId: null, what });
	const agents = () => [{ id: LEAD_ID, name: "Galvenais aģents" }, ...d.settings.agentSpecs().specs.map((s) => ({ id: s.id, name: s.name }))];
	return {
		"routines.list": (projectId) => svc.list(projectId),
		"routines.preview": (when, tz) => svc.preview(when, tz),
		"routines.save": (projectId, input) => svc.save(projectId, input),
		"routines.setPaused": (projectId, id, paused) => svc.setPaused(projectId, id, paused),
		"routines.remove": (projectId, id) => svc.remove(projectId, id),
		"routines.runNow": (projectId, id) => svc.runNow(projectId, id),
		"routines.occurrences": (projectId, from, to) => svc.occurrences(projectId, from, to),
		"memoryMd.list": () => listMemoryFiles(app(), agents()),
		"memoryMd.read": (kind, id) => readMemoryFile(app(), { kind, id }),
		"memoryMd.write": (kind, id, text, expectedHash) => {
			writeMemory(app(), { kind, id }, text, { by: "user", expectedHash });
			changed(["memory"]);
			return readMemoryFile(app(), { kind, id });
		},
		"selfChanges.list": () => listChanges(app()),
		"selfChanges.undo": (changeId) => {
			const r = undoChange(app(), d.skillsDir ?? "", changeId);
			changed(["memory", "agents", "skills"]);
			return r;
		},
		"appIssues.list": () => listIssues(app()),
		"appIssues.setStatus": (id, status) => setIssueStatus(app(), id, status),
	};
}

