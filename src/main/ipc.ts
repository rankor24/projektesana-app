// One IPC channel per contract method name. Anything not in API_NAMES is refused, so the renderer cannot reach main code
// that the contract does not list.
import { ipcMain } from "electron";
import { API_NAMES, type Handlers } from "../shared/api.js";

export function registerIpc(handlers: Handlers, log: (line: string) => void) {
	const allowed = new Set<string>(API_NAMES);
	ipcMain.handle("api", async (_e, method: string, ...args: unknown[]) => {
		if (!allowed.has(method)) throw new Error(`Nezināma metode: ${method}`);
		try {
			return await (handlers as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...args);
		} catch (e) {
			log(`api ${method} failed: ${(e as Error).stack ?? e}`);
			throw e;
		}
	});
}
