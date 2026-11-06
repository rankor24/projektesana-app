// The providers this package offers and how each one signs in. Plain data, no pi imports,
// so the renderer can read it too.
//
// Lifted from konkurss-app/src/agent-pi (same family of apps). Difference: API-key providers beyond Claude,
// and xAI accepts either the SuperGrok sign-in or an API key.

export type PiProviderId = "anthropic" | "openai-codex" | "xai" | "openai" | "google" | "openrouter";

export type PiAuthKind = "api_key" | "oauth";

export interface PiProviderInfo {
	id: PiProviderId;
	/** Ways the person can get access. The first one is what the settings screen leads with. */
	auth: readonly PiAuthKind[];
	/** Model used when none is chosen. Falls back to the newest model in the catalog when it is no longer listed. */
	defaultModel?: string;
	/** Name as the person sees it. */
	label: string;
	/** Where the person gets a key, for API-key providers. */
	keyUrl?: string;
}

export const PI_PROVIDERS: readonly PiProviderInfo[] = [
	// Claude: API key only. Claude.ai subscription OAuth is not allowed for third-party apps.
	{ id: "anthropic", auth: ["api_key"], defaultModel: "claude-sonnet-5-5", label: "Claude", keyUrl: "https://console.anthropic.com/settings/keys" },
	// ChatGPT subscription (Plus/Pro) through pi's OpenAI Codex OAuth.
	{ id: "openai-codex", auth: ["oauth"], label: "ChatGPT / Codex" },
	// SuperGrok / X Premium subscription through pi's xAI device-code OAuth, or an xAI API key.
	{ id: "xai", auth: ["oauth", "api_key"], label: "Grok (SuperGrok)", keyUrl: "https://console.x.ai" },
	{ id: "openai", auth: ["api_key"], label: "OpenAI API", keyUrl: "https://platform.openai.com/api-keys" },
	{ id: "google", auth: ["api_key"], label: "Gemini", keyUrl: "https://aistudio.google.com/apikey" },
	{ id: "openrouter", auth: ["api_key"], label: "OpenRouter", keyUrl: "https://openrouter.ai/keys" },
];

export const PI_PROVIDER_IDS: readonly PiProviderId[] = PI_PROVIDERS.map((p) => p.id);

/** Providers whose key the app stores itself (encrypted). */
export const KEY_PROVIDERS: readonly PiProviderId[] = PI_PROVIDERS.filter((p) => p.auth.includes("api_key")).map((p) => p.id);

export function isPiProvider(x: unknown): x is PiProviderId {
	return typeof x === "string" && (PI_PROVIDER_IDS as readonly string[]).includes(x);
}

export function piProviderInfo(id: PiProviderId): PiProviderInfo {
	return PI_PROVIDERS.find((p) => p.id === id)!;
}
