// Thin typed wrapper over the preload bridge. Results are typed by the caller; the main process owns the shapes.
import type { AgentEvent, GatherEvent, LoginNotice } from "./types";

declare global {
	interface Window {
		bv: {
			api: (method: string, ...args: unknown[]) => Promise<unknown>;
			pickFolder: (title: string) => Promise<string | null>;
			pickFiles: (title: string, filters?: { name: string; extensions: string[] }[]) => Promise<string[]>;
			onAgent: (cb: (e: AgentEvent) => void) => () => void;
			onLogin: (cb: (e: LoginNotice) => void) => () => void;
			onGather: (cb: (e: GatherEvent) => void) => () => void;
		};
	}
}

export const api = <T = unknown>(method: string, ...args: unknown[]) => window.bv.api(method, ...args) as Promise<T>;
export const pickFolder = (t: string) => window.bv.pickFolder(t);
export const pickFiles = (t: string, filters?: { name: string; extensions: string[] }[]) => window.bv.pickFiles(t, filters);
export const onAgent = (cb: (e: AgentEvent) => void) => window.bv.onAgent(cb);
export const onLogin = (cb: (e: LoginNotice) => void) => window.bv.onLogin(cb);
export const onGather = (cb: (e: GatherEvent) => void) => window.bv.onGather(cb);

/** Error text without Electron's "Error invoking remote method" wrapper. */
export const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
