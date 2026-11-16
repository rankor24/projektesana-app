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
import { processHandlers } from "./handlers/process.js";
import type { RevitClient } from "../revit/client.js";
import type { PopoutManager } from "./windows.js";

export type AppDeps = CoreDeps & Omit<ProjectDeps, "emit" | "openPath" | "afterChange"> & { engine: ProjectEngine; revit: RevitClient; bimcraftApp: string; popouts?: PopoutManager; /** the synced skills folder, for the settings page's measure of an agent's standing text */ skillsDir?: string } & Pick<LibraryDeps, "fetchPage">;

export function createHandlers(d: AppDeps): Handlers {
	const afterChange = (store: Parameters<ProjectEngine["afterChange"]>[0], what: string) => d.engine.afterChange(store, what).then(() => undefined);
	const userName = () => d.settings.get().userName.trim() || undefined;
	const e = { ...d, afterChange, userName };
	const projects = projectHandlers(e);
	return { ...coreHandlers(d), ...projects, ...roomHandlers(d), ...factHandlers(e), ...requirementHandlers({ ...d, userName }), ...revitHandlers(d), ...deliveryHandlers(d), ...compareHandlers(d), ...libraryHandlers(d), ...fileHandlers(d), ...todoHandlers(d), ...coordinationHandlers(d), ...expertHandlers({ ...d, setRole: projects["sources.setRole"] }), ...agentHandlers(d), ...skillHandlers(d), ...layoutHandlers(d), ...planHandlers(d), ...threadHandlers(d), ...processHandlers(d) };
}
