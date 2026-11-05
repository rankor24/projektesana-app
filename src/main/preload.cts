// Narrow bridge: the renderer can call the api channel, two dialogs, and listen to agent and sign-in events.
import { contextBridge, ipcRenderer } from "electron";

function listen(channel: string, cb: (e: unknown) => void) {
	const l = (_e: unknown, e: unknown) => cb(e);
	ipcRenderer.on(channel, l);
	return () => ipcRenderer.removeListener(channel, l);
}

contextBridge.exposeInMainWorld("bv", {
	api: (method: string, ...args: unknown[]) => ipcRenderer.invoke("api", method, ...args),
	pickFolder: (title: string) => ipcRenderer.invoke("dialog:folder", title),
	pickFiles: (title: string, filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke("dialog:files", title, filters),
	onAgent: (cb: (e: unknown) => void) => listen("agent:event", cb),
	onLogin: (cb: (e: unknown) => void) => listen("pi:login", cb),
	onGather: (cb: (e: unknown) => void) => listen("gather:event", cb),
});
