// One IPC channel: invoke("api", method, ...args). Every public AppApi method is callable; "_"-prefixed ones are not.
import { dialog, ipcMain, type BrowserWindow } from "electron";
import { AppApi } from "./api.js";

export function apiMethods(): string[] {
	return Object.getOwnPropertyNames(AppApi.prototype).filter((n) => n !== "constructor" && !n.startsWith("_"));
}

export function registerIpc(api: AppApi, win: () => BrowserWindow | null, _openUrl: (url: string) => void) {
	const allowed = new Set(apiMethods());
	ipcMain.handle("api", async (_e, method: string, ...args: unknown[]) => {
		if (!allowed.has(method)) throw new Error(`Nezināma metode: ${method}`);
		return (api as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args);
	});
	// native dialogs live here because they need the window
	ipcMain.handle("dialog:folder", async (_e, title: string) => {
		const r = await dialog.showOpenDialog(win()!, { title, properties: ["openDirectory", "createDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle("dialog:files", async (_e, title: string, filters?: { name: string; extensions: string[] }[]) => {
		const r = await dialog.showOpenDialog(win()!, { title, properties: ["openFile", "multiSelections"], filters });
		return r.canceled ? [] : r.filePaths;
	});
}
