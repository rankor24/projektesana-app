// The handlers behind every IPC method of shared/api.ts, one module per area. No Electron imports: everything
// Electron-specific (dialogs, shell, safeStorage, the window) is injected, so the contract test builds the real set.
import type { Handlers } from "../shared/api.js";
import { coreHandlers, type CoreDeps } from "./handlers/agent.js";
import { projectHandlers, type ProjectDeps } from "./handlers/projects.js";
import { roomHandlers } from "./handlers/rooms.js";
import { factHandlers } from "./handlers/facts.js";

export type AppDeps = CoreDeps & Omit<ProjectDeps, "emit" | "openPath">;

export function createHandlers(d: AppDeps): Handlers {
	return { ...coreHandlers(d), ...projectHandlers(d), ...roomHandlers(d), ...factHandlers(d) };
}
