// The two IPC calls behind the Settings window's list of what an agent changed (appSettings.recent) and its Undo button
// (appSettings.undo), and the one place the host is made, so main.ts and createHandlers share it.
import type { Handlers } from "../../shared/api.js";
import { createAppSettingsHost, type AppSettingsHost, type HostDeps } from "./host.js";

export function appSettingsHandlers(host: AppSettingsHost): Pick<Handlers, "appSettings.recent" | "appSettings.undo"> {
	return {
		"appSettings.recent": () => host.recent(),
		"appSettings.undo": (id) => host.undo(id, "user"),
	};
}

export { createAppSettingsHost, type AppSettingsHost, type HostDeps };
