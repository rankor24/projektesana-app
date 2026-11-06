// Narrow bridge: one invoke for the contract methods, one subscription for the contract events.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bv", {
	invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke("api", method, ...args),
	on: (event: string, cb: (payload: unknown) => void) => {
		const l = (_e: unknown, payload: unknown) => cb(payload);
		ipcRenderer.on(`ev:${event}`, l);
		return () => ipcRenderer.removeListener(`ev:${event}`, l);
	},
});
