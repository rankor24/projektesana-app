// The handlers behind every IPC method of shared/api.ts. No Electron imports: everything Electron-specific (dialogs,
// shell, safeStorage, the window) is injected, so the contract test builds the real handler set on temp folders.
import type { EventName, EventSpec, Handlers } from "../shared/api.js";
import type { AppSettings } from "./settings.js";

export interface AppDeps {
	version: string;
	settings: AppSettings;
	/** data folder shipped with the app (rules.json, law snapshots) */
	dataDir: string;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	pickFolder(title: string): Promise<string | null>;
	openPath(p: string): Promise<string>;
	openUrl(url: string): void;
}

export function createHandlers(d: AppDeps): Handlers {
	return {
		"app.info": () => ({ version: d.version, dataDir: d.settings.dir, platform: process.platform }),
		"settings.get": () => d.settings.get(),
		"settings.set": (patch) => {
			const s = d.settings.set(patch);
			d.emit("data.changed", { projectId: null, what: ["settings"] });
			return s;
		},
		"dialog.pickFolder": (title) => d.pickFolder(title),
	};
}
