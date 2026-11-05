// pi engine — the family's agent loop (src/agent-pi) behind the app's Engine seam.
// The only place that knows both sides: the app's settings and Latvian wording, and the app-neutral agent-pi package.
// pi is loaded on first use, so starting the app does not import it.
//
// Follows konkurss-app/src/main/engines/pi.ts (createPiEngine, PiLogin). Differences: several MCP servers per run,
// effort from settings, more providers, live model lists.
import { mkdirSync } from "node:fs";
import type { Effort, LoginNotice } from "../../shared/types.js";
import type { Engine } from "./types.js";
import type { LoginNotice as PiNotice, PiProviderId, PiRuntime } from "../../agent-pi/index.js";

const lib = () => import("../../agent-pi/index.js");

export interface PiSelection {
	provider: string;
	model: string;
	effort: Effort | "";
}

export interface PiDeps {
	runtime(): Promise<PiRuntime>;
	selection(): PiSelection;
}

export interface ProviderStatus {
	id: PiProviderId;
	label: string;
	auth: readonly ("api_key" | "oauth")[];
	configured: boolean;
	/** how it is configured right now: "api_key" | "oauth" */
	method: string | null;
	keyUrl: string | null;
	/** plain Latvian: what works, or what to do next */
	reason: string;
}

function notReadyReason(id: PiProviderId, auth: readonly string[]): string {
	if (id === "anthropic") return "Ievadi Anthropic API atslēgu. (Claude.ai abonementu trešo pušu lietotnēm izmantot nav atļauts.)";
	if (auth[0] === "oauth") return auth.includes("api_key") ? "Spied „Pieslēgties” vai ievadi API atslēgu." : "Spied „Pieslēgties”.";
	return "Ievadi API atslēgu.";
}

export async function providerStatuses(runtime: PiRuntime): Promise<ProviderStatus[]> {
	const pi = await lib();
	return Promise.all(
		pi.PI_PROVIDERS.map(async (p): Promise<ProviderStatus> => {
			const a = await pi.piAuthState(runtime, p.id);
			return {
				id: p.id,
				label: p.label,
				auth: p.auth,
				configured: a.configured,
				method: a.configured ? (a.method ?? null) : null,
				keyUrl: p.keyUrl ?? null,
				reason: a.configured ? (a.method === "oauth" ? "Pieslēgts ar abonementu." : "API atslēga saglabāta.") : notReadyReason(p.id, p.auth),
			};
		}),
	);
}

export function createPiEngine(deps: PiDeps): Engine {
	return {
		id: "pi",
		async status() {
			const pi = await lib();
			const { provider, model } = deps.selection();
			if (!pi.isPiProvider(provider)) return { id: "pi", ready: false, reason: `Nezināms pakalpojums: ${provider}`, canLogin: false };
			const rt = await deps.runtime();
			const a = await pi.piAuthState(rt, provider);
			if (!a.configured) return { id: "pi", ready: false, reason: `${pi.piProviderInfo(provider).label}: ${notReadyReason(provider, pi.piProviderInfo(provider).auth)}`, canLogin: false };
			return { id: "pi", ready: true, reason: `${pi.piProviderInfo(provider).label}, ${model || pi.defaultPiModel(rt, provider) || "—"}`, canLogin: false };
		},
		async run(o) {
			const sel = deps.selection();
			try {
				const pi = await lib();
				if (!pi.isPiProvider(sel.provider)) throw new Error(`Nezināms pakalpojums: ${sel.provider}`);
				const rt = await deps.runtime();
				const a = await pi.piAuthState(rt, sel.provider);
				if (!a.configured) {
					o.onEvent({ type: "error", engine: "pi", message: notReadyReason(sel.provider, pi.piProviderInfo(sel.provider).auth) });
					return;
				}
				mkdirSync(o.runDir, { recursive: true });
				await pi.runPi({
					runtime: rt,
					provider: sel.provider,
					modelId: o.model || sel.model,
					effort: sel.effort || undefined,
					prompt: o.prompt,
					mcp: Object.fromEntries(Object.entries(o.mcp).map(([name, m]) => [name, { command: m.command, args: m.args, env: m.env, allow: m.tools }])),
					signal: o.signal,
					onEvent: o.onEvent,
				});
			} catch (e) {
				o.onEvent({ type: "error", engine: "pi", message: (e as Error).message });
			}
		},
	};
}

/**
 * One sign-in at a time. What the person must see goes out through `emit`; a pasted answer comes back through `answer`.
 * Copied from konkurss-app/src/main/engines/pi.ts (PiLogin).
 */
export class PiLogin {
	private abort: AbortController | null = null;
	private pending: { resolve(text: string): void; reject(e: Error): void } | null = null;

	constructor(private readonly deps: { runtime(): Promise<PiRuntime>; emit(n: LoginNotice): void; openUrl(url: string): void }) {}

	get busy(): boolean {
		return this.abort !== null;
	}

	async login(provider: PiProviderId): Promise<void> {
		if (this.abort) throw new Error("Pieslēgšanās jau notiek.");
		const abort = new AbortController();
		this.abort = abort;
		const { emit } = this.deps;
		try {
			const pi = await lib();
			const rt = await this.deps.runtime();
			await pi.loginProvider(
				rt.models,
				provider,
				{
					openUrl: (url) => this.deps.openUrl(url),
					notify: (n: PiNotice) => emit(n.type === "url" ? { provider, type: "url", url: n.url } : { ...n, provider }),
					ask: (message, signal) =>
						new Promise<string>((resolve, reject) => {
							this.pending = { resolve, reject };
							signal?.addEventListener("abort", () => reject(new Error("Pieslēgšanās atcelta.")), { once: true });
							emit({ provider, type: "ask", message });
						}),
				},
				abort.signal,
			);
			emit({ provider, type: "done" });
		} catch (e) {
			emit({ provider, type: "error", message: (e as Error).message });
			throw e;
		} finally {
			this.abort = null;
			this.pending = null;
		}
	}

	answer(text: string): void {
		this.pending?.resolve(text);
		this.pending = null;
	}

	cancel(): void {
		this.pending?.reject(new Error("Pieslēgšanās atcelta."));
		this.pending = null;
		this.abort?.abort();
	}
}
