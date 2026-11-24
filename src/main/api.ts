// The handlers behind every IPC method of shared/api.ts, one module per area. No Electron imports: everything
// Electron-specific (dialogs, shell, safeStorage, the window) is injected, so the contract test builds the real set.
import type { Handlers } from "../shared/api.js";
import { coreHandlers, type CoreDeps } from "./handlers/agent.js";
import { projectHandlers, type ProjectDeps } from "./handlers/projects.js";
import { roomHandlers } from "./handlers/rooms.js";
import { factHandlers } from "./handlers/facts.js";
import { requirementHandlers } from "./handlers/requirements.js";
import type { ProjectEngine } from "./engine.js";
import { revitHandlers } from "./handlers/revit.js";
import { deliveryHandlers } from "./handlers/deliveries.js";
import { compare2dHandlers } from "./handlers/compare2d.js";
import { compareHandlers } from "./handlers/compare.js";
import { libraryHandlers, type LibraryDeps } from "./handlers/library.js";
import { fileHandlers } from "./handlers/files.js";
import { todoHandlers } from "./handlers/todos.js";
import { coordinationHandlers } from "./handlers/coordination.js";
import { expertHandlers } from "./handlers/expert.js";
import { agentHandlers } from "./handlers/agents.js";
import { skillHandlers } from "./handlers/skills.js";
import { layoutHandlers } from "./handlers/layout.js";
import { planHandlers } from "./handlers/plan.js";
import { threadHandlers } from "./handlers/threads.js";
import { agentLogHandlers, type AgentLogDeps } from "./handlers/agent-log.js";
import { processHandlers } from "./handlers/process.js";
import { routineHandlers } from "./handlers/routines.js";
import type { RoutineService } from "./routines-scheduler.js";
import { searchHandlers, type SearchDeps } from "./handlers/search.js";
import { FIRST_SCAN_TASK } from "../agent/tasks.js";
import type { RevitClient } from "../revit/client.js";
import type { PopoutManager } from "./windows.js";
import { appSettingsHandlers, createAppSettingsHost, type AppSettingsHost } from "./app-settings/handlers.js";

export type AppDeps = CoreDeps & AgentLogDeps & Omit<ProjectDeps, "emit" | "openPath" | "afterChange"> & { engine: ProjectEngine; revit: RevitClient; bimcraftApp: string; popouts?: PopoutManager; /** the synced skills folder, for the settings page's measure of an agent's standing text */ skillsDir?: string; /** the agent settings tool's host, shared with the agent bridge (main.ts); made here when absent (tests) */ appSettings?: AppSettingsHost; /** the routine scheduler main also starts as the timer */ routines?: RoutineService } & Pick<LibraryDeps, "fetchPage"> & SearchDeps;

export function createHandlers(d: AppDeps): Handlers {
	const afterChange = (store: Parameters<ProjectEngine["afterChange"]>[0], what: string) => d.engine.afterChange(store, what).then(() => undefined);
	const userName = () => d.settings.get().userName.trim() || undefined;
	// a project's first scan: the agent does what the user otherwise asked for message by message (agent/tasks.ts FIRST_SCAN_TASK),
	// once per project and only when a provider is signed in; without one the task stays in the dock's suggested tasks
	const onFirstScan = async (projectId: string) => {
		const store = d.registry.store(projectId);
		if (store.readMeta<boolean>("first-scan-task", false) || !(await d.session.status()).signedIn) return;
		store.writeMeta("first-scan-task", true, { kind: "first-scan.task", by: "app" });
		await d.session.send(projectId, FIRST_SCAN_TASK, []);
	};
	const e = { ...d, afterChange, userName, onFirstScan };
	const core = coreHandlers(d);
	const appSettings = d.appSettings ?? createAppSettingsHost({ settings: d.settings, providers: async () => core["agent.providers"](), holds: async () => core["agent.holds"](), emit: (ev) => d.emit("appSettings.changed", ev), changed: () => d.emit("data.changed", { projectId: null, what: ["settings"] }) });
	const projects = projectHandlers(e);
	return { ...core, ...appSettingsHandlers(appSettings), ...projects, ...roomHandlers(d), ...factHandlers(e), ...requirementHandlers({ ...d, userName }), ...revitHandlers(d), ...deliveryHandlers(d), ...compareHandlers(d), ...compare2dHandlers(d), ...libraryHandlers(d), ...fileHandlers(d), ...todoHandlers(d), ...coordinationHandlers(d), ...expertHandlers({ ...d, setRole: projects["sources.setRole"] }), ...agentHandlers(d), ...skillHandlers(d), ...layoutHandlers(d), ...planHandlers(d), ...threadHandlers(d), ...agentLogHandlers(d), ...processHandlers(d), ...routineHandlers(d), ...searchHandlers(d) };
}
