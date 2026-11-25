// One Google sign-in at a time for the Antigravity account, run by the server's own `authenticate`: the app starts the server, takes the sign-in link it
// announces, gives it to the person, and waits. Google redirects the browser to the server's own listener on 127.0.0.1, which ends the sign-in; a person
// whose browser cannot reach it may paste the address Google redirected to (`complete`). The app never sees a Google password or a token.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/antigravity-auth.ts, which adapts pingdotgg/t3code@b9bc03869e (MIT, Copyright (c) 2026 T3 Tools
// Inc., third_party/t3-code/LICENSE) apps/server/src/provider/AntigravityAuth.ts: the phases, the fixed failure lines (the server's own words can carry an
// authorization code, so only these reach the person), the expiry, and one accepted redirect per sign-in. Changed: no relay into a bot box.
import {
	AntigravityAcpClient,
	STARTUP_TIMEOUT_MS,
	forwardAntigravityCallback,
	parseAntigravityAuthorizationUrl,
	validateAntigravityCallbackUrl,
	type AntigravityProfile,
} from "./acp.js";
import type { AntigravityRuntime } from "./runtime.js";

const AUTH_TIMEOUT_MS = 5 * 60_000;

export const SIGN_IN_EXPIRED = "Google pieteikšanās beidzās. Sāc pieteikšanos vēlreiz.";
export const SIGN_IN_CANCELLED = "Google pieteikšanās atcelta.";
const FAILED = "Google pieteikšanās neizdevās. Sāc to vēlreiz.";
const NOT_APPROVED = "Google pieteikšanās netika apstiprināta. Sāc to vēlreiz.";
const NOT_ELIGIBLE = "Google šim kontam prasa derīgu Antigravity abonementu.";
const NOT_DELIVERED = "Google atbildi neizdevās nodot. Ja pārlūkā viss jau pabeigts, pagaidi brīdi; citādi nosūti to vēlreiz.";
const ALREADY_SENT = "Google atbilde jau nosūtīta. Pagaidi, kamēr Google pabeidz.";

class SignInExpired extends Error {}

/** Only these fixed lines reach the person: the server's own words can carry an authorization code. */
export function signInFailureLine(error: unknown): { phase: "failed" | "expired"; message: string } {
	if (error instanceof SignInExpired) return { phase: "expired", message: SIGN_IN_EXPIRED };
	const words = error instanceof Error ? error.message : "";
	if (words.includes("SUBSCRIPTION_REQUIRED")) return { phase: "failed", message: NOT_ELIGIBLE };
	if (/access_denied|denied access|cancelled/iu.test(words)) return { phase: "failed", message: NOT_APPROVED };
	return { phase: "failed", message: FAILED };
}

export type SignInEnd = { ok: true } | { ok: false; cancelled: boolean; message: string };

interface Flow {
	id: number;
	client: AntigravityAcpClient;
	pending: { redirectUri: string; state: string };
	expiresAt: number;
	/** the server's listener takes one response: a second would be read as another sign-in's. Cleared when a delivery fails. */
	callbackSent: boolean;
	cancelled: boolean;
}

export class AntigravityAuthController {
	private flow: Flow | null = null;
	private seq = 0;

	/** `onEnd` is called once for every sign-in that got as far as waiting for Google (success, failure, expiry or cancel). */
	constructor(private readonly onEnd: (r: SignInEnd) => void) {}

	get busy(): boolean {
		return this.flow !== null;
	}

	/** Starts the server and returns the link to open, or null when the stored sign-in turned out to be good already (then `onEnd` is called with ok). */
	async start(runtime: AntigravityRuntime, profile: AntigravityProfile): Promise<{ url: string | null }> {
		this.cancel();
		let foundUrl!: (v: ReturnType<typeof parseAntigravityAuthorizationUrl>) => void;
		let failUrl!: (e: Error) => void;
		const urlPromise = new Promise<ReturnType<typeof parseAntigravityAuthorizationUrl>>((resolve, reject) => {
			foundUrl = resolve;
			failUrl = reject;
		});
		const client = new AntigravityAcpClient(runtime, profile, profile.directory, (url) => {
			try {
				foundUrl(parseAntigravityAuthorizationUrl(url));
			} catch (e) {
				failUrl(e instanceof Error ? e : new Error(String(e)));
			}
		});
		try {
			await client.initialize();
			const expiresAt = Date.now() + AUTH_TIMEOUT_MS;
			const authenticated = client.request("authenticate", { methodId: "oauth-personal" }, AUTH_TIMEOUT_MS, async () => new SignInExpired());
			let startupTimer: ReturnType<typeof setTimeout> | undefined;
			const startupTimeout = new Promise<never>((_resolve, reject) => {
				startupTimer = setTimeout(() => reject(new Error("Google sign-in did not start in time.")), STARTUP_TIMEOUT_MS);
				startupTimer.unref?.();
			});
			const outcome = await Promise.race([urlPromise.then((request) => ({ kind: "url" as const, request })), authenticated.then(() => ({ kind: "done" as const })), startupTimeout]).finally(() => {
				if (startupTimer) clearTimeout(startupTimer);
			});
			if (outcome.kind === "done") {
				client.close();
				this.onEnd({ ok: true });
				return { url: null };
			}
			const flow: Flow = { id: ++this.seq, client, pending: { redirectUri: outcome.request.redirectUri, state: outcome.request.state }, expiresAt, callbackSent: false, cancelled: false };
			this.flow = flow;
			void authenticated.then(
				() => this.end(flow, { ok: true }),
				(error) => this.end(flow, { ok: false, cancelled: false, message: signInFailureLine(error).message }),
			);
			return { url: outcome.request.authorizationUrl };
		} catch (e) {
			client.close();
			throw e;
		}
	}

	private end(flow: Flow, r: SignInEnd): void {
		if (this.flow !== flow) return;
		this.flow = null;
		flow.client.close();
		this.onEnd(r);
	}

	/** The person pasted the address Google redirected to (the browser could not reach the server's own listener). */
	async complete(callbackUrl: string): Promise<void> {
		const flow = this.flow;
		if (!flow || Date.now() >= flow.expiresAt) throw new Error("Šī Google pieteikšanās vairs nav aktīva. Sāc no jauna.");
		if (flow.callbackSent) throw new Error(ALREADY_SENT);
		const callback = validateAntigravityCallbackUrl(flow.pending, callbackUrl);
		flow.callbackSent = true;
		try {
			await forwardAntigravityCallback(callback);
		} catch {
			flow.callbackSent = false;
			throw new Error(NOT_DELIVERED);
		}
	}

	cancel(): void {
		const flow = this.flow;
		if (!flow) return;
		flow.cancelled = true;
		this.end(flow, { ok: false, cancelled: true, message: SIGN_IN_CANCELLED });
	}
}
