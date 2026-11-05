// Subscription sign-in through pi: ChatGPT (openai-codex) and SuperGrok (xai).
//
// Borrowed from BIM Crew apps/server/src/cli/login-openai-codex.ts, login-xai.ts and login-shared.ts, which run
// the same `Models.login(provider, "oauth", interaction)` with a terminal. Here the interaction talks to a
// window: the app opens the browser, shows a device code, and may ask for a pasted redirect URL.
import type { AuthEvent, AuthInteraction, AuthPrompt, MutableModels } from "@earendil-works/pi-ai";
import type { PiProviderId } from "./providers.js";
import { piProviderInfo } from "./providers.js";

/** What the person sees during a sign-in. */
export type LoginNotice =
	| { type: "url"; url: string; text?: string }
	| { type: "code"; userCode: string; url: string }
	| { type: "info"; message: string };

export interface LoginUi {
	/** Open an address in the person's browser. The caller decides which schemes it allows. */
	openUrl(url: string): void;
	notify(notice: LoginNotice): void;
	/**
	 * Ask for pasted text, e.g. the redirect address when the browser could not reach this computer.
	 * Must reject when `signal` aborts. Optional: without it that prompt just waits until pi no longer needs it.
	 */
	ask?(message: string, signal?: AbortSignal): Promise<string>;
}

/** pi's flows talk in `AuthEvent`s and `AuthPrompt`s; this maps them onto a LoginUi. */
export function interactionFor(ui: LoginUi, signal?: AbortSignal): AuthInteraction {
	return {
		signal,
		notify(event: AuthEvent) {
			if (event.type === "auth_url") {
				ui.notify({ type: "url", url: event.url, text: event.instructions });
				ui.openUrl(event.url);
			} else if (event.type === "device_code") {
				ui.notify({ type: "code", userCode: event.userCode, url: event.verificationUri });
				ui.openUrl(event.verificationUri);
			} else {
				ui.notify({ type: "info", message: event.message });
			}
		},
		async prompt(prompt: AuthPrompt): Promise<string> {
			// The ChatGPT flow asks which method to use; the browser method needs nothing typed.
			if (prompt.type === "select") return (prompt.options.find((o) => o.id === "browser") ?? prompt.options[0]).id;
			if (ui.ask) return await ui.ask(prompt.message, prompt.signal ?? signal);
			// No way to ask: stay pending until pi stops needing the answer (the browser callback arrived), then reject.
			return await new Promise<string>((_resolve, reject) => {
				const s = prompt.signal ?? signal;
				const stop = () => reject(new Error("Sign-in cancelled"));
				if (!s) return;
				if (s.aborted) stop();
				else s.addEventListener("abort", stop, { once: true });
			});
		},
	};
}

/** Signs in with the provider's subscription OAuth and stores the tokens. Rejects when cancelled or refused; the message is pi's own. */
export async function loginProvider(models: MutableModels, provider: PiProviderId, ui: LoginUi, signal?: AbortSignal): Promise<void> {
	if (!piProviderInfo(provider).auth.includes("oauth")) throw new Error(`${provider}: no subscription sign-in; it uses an API key.`);
	// No agentName: BIM Crew's working logins use pi's own name, and the provider's originator check is only proven for that.
	await models.login(provider, "oauth", interactionFor(ui, signal));
}

export async function logoutProvider(models: MutableModels, provider: PiProviderId): Promise<void> {
	await models.logout(provider);
}
