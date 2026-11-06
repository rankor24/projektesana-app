// Typed access to the preload bridge. Every call goes through the contract in shared/api.ts.
import type { ApiName, ApiSpec, EventName, EventSpec } from "../shared/api";

interface Bridge {
	invoke(method: string, ...args: unknown[]): Promise<unknown>;
	on(event: string, cb: (payload: unknown) => void): () => void;
}

declare global {
	interface Window {
		bv: Bridge;
	}
}

export function call<K extends ApiName>(method: K, ...args: Parameters<ApiSpec[K]>): Promise<Awaited<ReturnType<ApiSpec[K]>>> {
	return window.bv.invoke(method, ...args) as Promise<Awaited<ReturnType<ApiSpec[K]>>>;
}

export function on<E extends EventName>(event: E, cb: (payload: EventSpec[E]) => void): () => void {
	return window.bv.on(event, cb as (p: unknown) => void);
}

/** Electron's IPC wraps thrown errors as "Error invoking remote method 'api': Error: <message>"; show the message. */
export function errText(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
