// The one pi `Models` collection for the app: catalog, auth, streaming — plus live model lists.
//
// Borrowed from BIM Crew apps/server/src/runtime/models.ts (lookupModel, synthesizeLiveModel), model-catalog.ts
// (effortsOf, defaultEffort, LEGACY) and model-cache.ts (fetchLiveModels): pi's catalog is fixed per pi version, so
// a model released after it would be "Unknown model". Each provider's own /models list is fetched and cached (with the
// stored key, or the subscription's OAuth token: ChatGPT/Codex and SuperGrok too), refreshed when older than a day; an id
// pi does not know is built by cloning the newest catalog model of the same provider (same API, URL and auth).
// Nobody types model names: where a provider gave its live list, the picker is that list (retired models drop out).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Api, AssistantMessageEventStream, Model, MutableModels, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { PiCredentialStore, type PiCredentialOptions } from "./credentials.js";
import { KEY_PROVIDERS, isPiProvider, piProviderInfo, type PiProviderId } from "./providers.js";

export interface PiIdentity {
	name: string;
	url: string;
}

export interface PiModelsOptions extends PiCredentialOptions {
	identity?: PiIdentity;
	/** Where live model lists are cached. Without it, only pi's catalog is used. */
	modelCachePath?: string;
}

export interface LiveModel {
	id: string;
	name?: string;
	contextWindow?: number;
	/** Unix seconds */
	created?: number;
	/** the provider's own order (Codex: lower first) where it gives no dates */
	priority?: number;
}

interface CacheFile {
	fetchedAt: Record<string, number>;
	providers: Record<string, LiveModel[]>;
}

export interface PiRuntime {
	models: MutableModels;
	credentials: PiCredentialStore;
	identity?: PiIdentity;
	/** live lists per provider (empty until refreshed) */
	live: CacheFile;
	cachePath?: string;
}

export function createPiRuntime(opts: PiModelsOptions): PiRuntime {
	const credentials = new PiCredentialStore({ keyProviders: KEY_PROVIDERS, ...opts });
	const identity = opts.identity;
	const models = builtinModels({
		credentials,
		// Only what the app stored counts. A colleague's ANTHROPIC_API_KEY in the environment must not silently change which account pays.
		authContext: { env: async () => undefined, fileExists: async () => false },
		...(identity ? { identity: { attribution: { name: identity.name, url: identity.url } } } : {}),
	});
	let live: CacheFile = { fetchedAt: {}, providers: {} };
	if (opts.modelCachePath && existsSync(opts.modelCachePath)) {
		try {
			live = JSON.parse(readFileSync(opts.modelCachePath, "utf8")) as CacheFile;
		} catch {
			// unreadable cache = no live models yet; a refresh rewrites it
		}
	}
	return { models, credentials, identity, live, cachePath: opts.modelCachePath };
}

/** Stream function handed to the pi Agent: the Models collection resolves and refreshes auth per provider. */
export function streamFn(models: MutableModels) {
	return async (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): Promise<AssistantMessageEventStream> => models.streamSimple(model, context, options);
}

// ---- effort ---------------------------------------------------------------------

export type PiEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly PiEffort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Effort levels a model really supports: off..high unless its map says null; xhigh and max only when listed. */
export function effortsOf(model: Pick<Model<Api>, "reasoning"> & { thinkingLevelMap?: Record<string, string | null> }): PiEffort[] {
	if (!model.reasoning) return [];
	const map = model.thinkingLevelMap ?? {};
	return EFFORTS.filter((level) => {
		const v = map[level];
		if (v === null) return false;
		if (level === "xhigh" || level === "max") return v !== undefined;
		return true;
	});
}

export function defaultEffort(efforts: readonly PiEffort[]): PiEffort {
	if (efforts.length === 0) return "off";
	if (efforts.includes("medium")) return "medium";
	return efforts.find((e) => e !== "off") ?? efforts[0];
}

/** The chosen effort if the model supports it, else the model's default. */
export function effortFor(model: Model<Api>, wanted?: PiEffort): PiEffort {
	const e = effortsOf(model as never);
	return wanted && e.includes(wanted) ? wanted : defaultEffort(e);
}

// ---- catalog ----------------------------------------------------------------------

export interface PiModelInfo {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	efforts: PiEffort[];
	defaultEffort: PiEffort;
	/** older generation or dated snapshot: folded away in the picker */
	legacy: boolean;
	/** found in the provider's live list, not in pi's catalog */
	live: boolean;
	created?: number;
}

const LEGACY = [/-\d{8}$/, /^claude-3/, /^claude-(opus|sonnet|haiku)-4(-[0-4])?$/, /^gpt-5(\.[0-3])?(-|$)/, /^gpt-4/, /^gpt-3/, /^o[134](-|$)/, /^gemini-(1|2)\./, /^gemini-3-/];
const isLegacy = (id: string) => LEGACY.some((re) => re.test(id));

/** A model the provider lists live but pi's catalog does not know: clone the newest catalog model of that provider. */
function synthesize(rt: PiRuntime, provider: string, id: string): Model<Api> | undefined {
	const live = rt.live.providers[provider]?.find((m) => m.id === id);
	if (!live) return undefined;
	const siblings = rt.models.getModels(provider);
	const template = siblings[siblings.length - 1];
	if (!template) return undefined;
	return { ...template, id, name: live.name ?? id, contextWindow: live.contextWindow ?? template.contextWindow } as Model<Api>;
}

/**
 * The models of one provider. With a live list: exactly the provider's list (catalog details where pi knows the model), newest or
 * the provider's own order first. Without one: pi's catalog.
 */
export function listPiModels(rt: PiRuntime, provider: PiProviderId): PiModelInfo[] {
	const liveList = rt.live.providers[provider] ?? [];
	const hasLive = liveList.length > 0;
	const liveById = new Map(liveList.map((m) => [m.id, m]));
	const fromCatalog = rt.models.getModels(provider).map((m): PiModelInfo => {
		const efforts = effortsOf(m as never);
		return { id: m.id, name: m.name || m.id, reasoning: m.reasoning, contextWindow: m.contextWindow, efforts, defaultEffort: defaultEffort(efforts), legacy: isLegacy(m.id), live: false, created: liveById.get(m.id)?.created };
	});
	const known = new Set(fromCatalog.map((m) => m.id));
	const extra = liveList
		.filter((m) => !known.has(m.id))
		.map((m): PiModelInfo | null => {
			const s = synthesize(rt, provider, m.id);
			if (!s) return null;
			const efforts = effortsOf(s as never);
			return { id: m.id, name: m.name || m.id, reasoning: s.reasoning, contextWindow: s.contextWindow, efforts, defaultEffort: defaultEffort(efforts), legacy: isLegacy(m.id), live: true, created: m.created };
		})
		.filter((m): m is PiModelInfo => m !== null);
	if (!hasLive) return fromCatalog.reverse();
	const order = new Map(liveList.map((m, i) => [m.id, m.priority ?? i]));
	const rank = (m: PiModelInfo) => order.get(m.id) ?? Number.MAX_SAFE_INTEGER;
	return [...extra, ...fromCatalog.filter((m) => liveById.has(m.id))].sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || rank(a) - rank(b));
}

/** The model a provider uses when none is chosen: the provider's default if listed, else the newest non-legacy one. */
export function defaultPiModel(rt: PiRuntime, provider: PiProviderId): string | undefined {
	const list = listPiModels(rt, provider);
	const wanted = piProviderInfo(provider).defaultModel;
	if (wanted && list.some((m) => m.id === wanted)) return wanted;
	return (list.find((m) => !m.legacy) ?? list[0])?.id;
}

export function lookupPiModel(rt: PiRuntime, provider: string, modelId?: string): Model<Api> {
	if (!isPiProvider(provider)) throw new Error(`Unknown provider "${provider}"`);
	const id = modelId?.trim() || defaultPiModel(rt, provider);
	const model = id ? (rt.models.getModel(provider, id) ?? synthesize(rt, provider, id)) : undefined;
	if (!model) throw new Error(`Unknown model "${id ?? ""}" for provider "${provider}"`);
	return model;
}

/** Does the model take images? pi replaces images with "(image omitted)" for a model that does not, so the app asks first. */
export function seesImages(model: Model<Api>): boolean {
	return model.input.includes("image");
}

// ---- live lists ---------------------------------------------------------------------

const NOT_CHAT = /(audio|realtime|transcribe|tts|image|embedding|moderation|whisper|dall-e|sora|speech|search-preview|computer-use)/i;

async function getJson(url: string, headers: Record<string, string>): Promise<{ data?: unknown[]; models?: unknown[] }> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`${new URL(url).host} atbildēja ${res.status}`);
	return (await res.json()) as { data?: unknown[]; models?: unknown[] };
}

/** The ChatGPT account id inside a Codex OAuth token (pi's extractAccountId, api/openai-codex-responses.ts). */
function codexAccountId(token: string): string | undefined {
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, Record<string, unknown> | undefined>;
		const id = payload["https://api.openai.com/auth"]?.chatgpt_account_id;
		return typeof id === "string" ? id : undefined;
	} catch {
		return undefined;
	}
}

/** Codex's model list answers per client version; the newest Codex CLI release is asked for, this when GitHub cannot be reached. */
const CODEX_CLIENT_FALLBACK = "0.171.0";
async function codexClientVersion(): Promise<string> {
	try {
		const res = await fetch("https://api.github.com/repos/openai/codex/releases/latest", { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(5_000) });
		const tag = res.ok ? String(((await res.json()) as { tag_name?: string }).tag_name ?? "") : "";
		return /(\d+\.\d+\.\d+)/.exec(tag)?.[1] ?? CODEX_CLIENT_FALLBACK;
	} catch {
		return CODEX_CLIENT_FALLBACK;
	}
}

/**
 * The provider's own model list, with its API key or (ChatGPT/Codex, SuperGrok) the subscription's OAuth access token.
 * null = no list endpoint reachable with what the app holds.
 */
export async function fetchLiveModels(provider: PiProviderId, apiKey: string | undefined): Promise<LiveModel[] | null> {
	if (!apiKey) return null;
	type R = Record<string, unknown>;
	switch (provider) {
		case "anthropic": {
			const j = await getJson("https://api.anthropic.com/v1/models?limit=1000", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" });
			return (j.data as R[]).map((m) => ({ id: String(m.id), name: m.display_name as string | undefined, created: m.created_at ? Math.floor(Date.parse(String(m.created_at)) / 1000) : undefined }));
		}
		case "openai": {
			const j = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` });
			return (j.data as R[]).filter((m) => /^(gpt|o\d|chatgpt)/.test(String(m.id)) && !NOT_CHAT.test(String(m.id))).map((m) => ({ id: String(m.id), created: m.created as number }));
		}
		case "xai": {
			const j = await getJson("https://api.x.ai/v1/models", { Authorization: `Bearer ${apiKey}` });
			return (j.data as R[]).filter((m) => !NOT_CHAT.test(String(m.id))).map((m) => ({ id: String(m.id), created: m.created as number }));
		}
		case "google": {
			const j = await getJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`, {});
			return (j.models as R[])
				.filter((m) => ((m.supportedGenerationMethods as string[]) ?? []).includes("generateContent") && !NOT_CHAT.test(String(m.name)))
				.map((m) => ({ id: String(m.name).replace(/^models\//, ""), name: m.displayName as string, contextWindow: m.inputTokenLimit as number }));
		}
		case "openrouter": {
			const j = await getJson("https://openrouter.ai/api/v1/models", { Authorization: `Bearer ${apiKey}` });
			return (j.data as R[]).map((m) => ({ id: String(m.id), name: m.name as string, contextWindow: m.context_length as number, created: m.created as number }));
		}
		case "openai-codex": {
			// what the Codex CLI does (openai/codex codex-rs/codex-api/src/endpoint/models.rs): GET <base>/models?client_version=…,
			// the models it shows in its picker are the ones with visibility "list"
			const account = codexAccountId(apiKey);
			const url = `https://chatgpt.com/backend-api/codex/models?client_version=${await codexClientVersion()}`;
			const j = await getJson(url, { Authorization: `Bearer ${apiKey}`, originator: "pi", ...(account ? { "chatgpt-account-id": account } : {}) });
			return (j.models as R[])
				.filter((m) => m.visibility === "list" && typeof m.slug === "string")
				.map((m) => ({ id: String(m.slug), name: m.display_name as string | undefined, contextWindow: typeof m.context_window === "number" ? m.context_window : undefined, priority: typeof m.priority === "number" ? m.priority : undefined }));
		}
		default:
			return null;
	}
}

/** Refreshes the live list of every provider the app is signed in to (key or subscription); the others keep pi's catalog. */
export async function refreshLiveModels(rt: PiRuntime, providers: readonly PiProviderId[]): Promise<Record<string, string>> {
	const report: Record<string, string> = {};
	for (const p of providers) {
		try {
			// pi resolves the key, or the OAuth access token (refreshed when it has expired)
			const key = (await rt.models.getAuth(p))?.auth.apiKey;
			const list = await fetchLiveModels(p, key);
			if (list === null) {
				report[p] = key ? "nav saraksta" : "pi katalogs (nav pieslēgts)";
				continue;
			}
			// an empty answer is not a list to show: the catalog stays
			if (!list.length) {
				report[p] = "tukšs saraksts";
				continue;
			}
			rt.live.providers[p] = list;
			rt.live.fetchedAt[p] = Date.now();
			report[p] = `${list.length} modeļi`;
		} catch (e) {
			report[p] = `neizdevās: ${(e as Error).message}`;
		}
	}
	if (rt.cachePath) {
		mkdirSync(dirname(rt.cachePath), { recursive: true });
		writeFileSync(rt.cachePath, JSON.stringify(rt.live), "utf8");
	}
	return report;
}

/** A live list older than this is fetched again the next time the providers are listed. */
export const LIVE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** a fetch that failed (offline, a provider down) is tried again after this, not on every listing */
const RETRY_MS = 10 * 60 * 1000;
const tried = new Map<string, number>();
let refreshing: Promise<unknown> | null = null;
/**
 * Refreshes, one run at a time, the providers whose list is missing or older than a day (and the `force`d ones). Resolves to the
 * providers it refreshed (empty when none was due). A provider that failed keeps its old list and is tried again next time.
 */
export function refreshStaleModels(rt: PiRuntime, providers: readonly PiProviderId[], force: readonly PiProviderId[] = []): Promise<PiProviderId[]> {
	const now = Date.now();
	const due = providers.filter((p) => force.includes(p) || (now - (rt.live.fetchedAt[p] ?? 0) > LIVE_MAX_AGE_MS && now - (tried.get(p) ?? 0) > RETRY_MS));
	if (!due.length) return Promise.resolve([]);
	for (const p of due) tried.set(p, now);
	const run = (refreshing ?? Promise.resolve()).then(() => refreshLiveModels(rt, due));
	const done = run.then(
		() => due,
		() => due,
	);
	refreshing = done.finally(() => {
		if (refreshing === done) refreshing = null;
	});
	return done;
}

// ---- auth state ---------------------------------------------------------------------

export interface PiAuthState {
	configured: boolean;
	/** "api_key" or "oauth" */
	method?: string;
	source?: string;
}

/** Whether a provider can be used right now, without refreshing tokens or calling the network. */
export async function piAuthState(runtime: PiRuntime, provider: PiProviderId): Promise<PiAuthState> {
	try {
		const check = await runtime.models.checkAuth(provider);
		if (!check) return { configured: false };
		// Claude is key-only: a subscription token for it never counts, even if something wrote one.
		if (check.type === "oauth" && !piProviderInfo(provider).auth.includes("oauth")) return { configured: false };
		return { configured: true, method: check.type, source: check.source };
	} catch (e) {
		return { configured: false, source: `error: ${(e as Error).message}` };
	}
}
