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
import type { RevitClient } from "../revit/client.js";

export type AppDeps = CoreDeps & Omit<ProjectDeps, "emit" | "openPath" | "afterChange"> & { engine: ProjectEngine; revit: RevitClient; bimcraftApp: string };

export function createHandlers(d: AppDeps): Handlers {
	const afterChange = (store: Parameters<ProjectEngine["afterChange"]>[0], what: string) => d.engine.afterChange(store, what).then(() => undefined);
	const e = { ...d, afterChange };
	return { ...coreHandlers(d), ...projectHandlers(e), ...roomHandlers(d), ...factHandlers(e), ...requirementHandlers(d), ...revitHandlers(d), ...deliveryHandlers(d), ...compareHandlers(d) };
}
