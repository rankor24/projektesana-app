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

// One bridge subscription per event name; listeners live here. A function handed back across Electron's context bridge
// is not reliably callable as an effect cleanup (it crashed React with "destroy is not a function"), so unsubscribing
// never crosses the bridge.
const listeners = new Map<string, Set<(p: unknown) => void>>();

export function on<E extends EventName>(event: E, cb: (payload: EventSpec[E]) => void): () => void {
	let set = listeners.get(event);
	if (!set) {
		const s = new Set<(p: unknown) => void>();
		listeners.set(event, s);
		set = s;
		window.bv.on(event, (p) => {
			for (const l of [...s]) l(p);
		});
	}
	const l = cb as (p: unknown) => void;
	set.add(l);
	return () => {
		set.delete(l);
	};
}

/** Electron's IPC wraps thrown errors as "Error invoking remote method 'api': Error: <message>"; show the message. */
export function errText(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
