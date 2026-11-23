// What a failed run was: the provider's usage limit, an account out of credit, a sign-in that is gone, or a hiccup of the wire.
// Pure text and numbers in, a verdict out, so the decision about a backup can be tested without an engine.
//
// Ported from OpenMausBot (Apache-2.0): server/drivers/retry.ts (USAGE_LIMIT, the auth / transient patterns, the order they are read in),
// server/drivers/engine-errors.ts (OUT_OF_CREDITS, httpStatusOf, engineFailureKind), server/drivers/claude-limits.ts (claudeLimitRefusal /
// claudeLimitFacts: the Claude CLI's `rate_limit_info`, which window refused and when it resets, are in claude/limits.ts here).
// Adapted: OpenMausBot reads its own drivers' error shapes (ACP, Codex CLI, Grok); this app's engines are pi (whose providers word a limit
// differently, e.g. "You have hit your ChatGPT usage limit (plus plan). Try again in ~120 min.") and the Claude Agent SDK. A word the vendor's own
// text has for "subscription" is not a limit here: pi's "subscription sign-in is not permitted for third-party apps" is a refusal to sign in, not a quota.
import type { FailureHint } from "../../shared/types.js";

export type FailureKind =
	/** the account's plan allowance is used up; it resets */
	| "usage_limit"
	/** no credit or payment left; it does not reset by itself */
	| "credits"
	/** the sign-in is gone or was refused (expired token, no key, a key the provider rejects) */
	| "signed_out"
	/** the provider is busy or the wire dropped: a wait or a try on another provider helps, holding the provider does not */
	| "transient"
	/** anything else: a bad request, a stop by the user, the step limit. Never a reason to change provider */
	| "other";

/** What a limit stops: the whole provider's account, or one model of it. A sign-in is the provider's too. */
export type HoldScope = "provider" | "model" | "credits" | "signed-out";

export interface Failure {
	kind: FailureKind;
	/** provider / model / credits for a limit; signed-out for a sign-in */
	scope?: HoldScope;
	/** when the limit resets, epoch ms; absent = the provider did not say */
	resetsAt?: number;
	status?: number;
}

/** A subscription's usage running out: terminal even when phrased as a rate limit. Claude Code says "You've hit your weekly limit · resets …",
 *  "…your session limit", "You're out of extra usage"; pi's Codex provider "You have hit your ChatGPT usage limit". (retry.ts USAGE_LIMIT) */
export const USAGE_LIMIT = /\busage limit\b|\bhit your (?:(?!rate\b)[\w'’-]+ ){0,3}(?:limit|budget)\b|\b(?:weekly|daily|monthly|subscription|usage|session|5-hour) limit reached\b|\bout of (?:usage(?: credits)?|extra usage|credits)\b/i;

/** Quota words of the API providers pi talks to (pi-ai utils/retry.ts NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN): a wait of seconds does not help. */
const API_QUOTA = /\binsufficient_quota\b|\bquota exceeded\b|\bout of budget\b|\bmonthly usage limit reached\b|\b(?:go|free)usagelimiterror\b|subscription_sharing\w*usage_limit_exceeded|\bresource_exhausted\b.*\bquota\b|\bexceeded your current quota\b/i;

/** A provider refusing for want of credit or payment, in its own words (402 is read from the status). (engine-errors.ts OUT_OF_CREDITS) */
const OUT_OF_CREDITS = /\bpayment required\b|\binsufficient (?:account )?(?:funds|balance|credits?)\b|\b(?:credit|account) balance is too low\b|\bout of credits?\b|\bno credits? (?:left|remaining)\b|\bused all (?:available |of (?:your|its) )?credits\b|\bbilling\b/i;

/** The sign-in is gone. retry.ts's auth pattern, without 403/forbidden (a region or policy refusal is not a sign-in problem), plus the words of this app's engines:
 *  pi's "No API key for provider", the SDK's `authentication_failed`, an expired or revoked OAuth token, our own "nav pieslēgts". */
const SIGNED_OUT = /\b401\b|\bunauthori[sz]ed\b|\binvalid (?:x-)?api[ _-]?key\b|\bincorrect api key\b|\bmissing bearer\b|\bauthentication[ _](?:required|failed|error)\b|\bnot logged in\b|\blogged out\b|\bplease run \/login\b|\bno api key for provider\b|\b(?:oauth |access |refresh )?token (?:has )?(?:expired|was revoked|is invalid)\b|\bexpired (?:oauth |access |refresh )?token\b|\binvalid_grant\b|\binvalid bearer token\b|\bnav pieslēgts\b/i;

const OVERLOADED = /\boverloaded\b|\bcapacity\b/i;
const RATE_LIMIT = /\b(?:429|rate.?limit|too many requests)\b/i;
const SERVER = /\b5\d{2}\b|\binternal server error\b|\binternal service failure\b|\bbad gateway\b|\bservice unavailable\b|\bserver.?error\b/i;
const WIRE = /\b(?:econnreset|econnrefused|epipe|etimedout|eai_again|enotfound|connection reset|connection refused|socket hang up|network error|fetch failed|stream disconnected|other side closed)\b|\btimeout(?:ed)?\b|\btimed? out\b/i;

/** Grok / xAI "(status 402 …)", chat drivers' "HTTP 402", Claude Code's "API Error: 529 …". (engine-errors.ts STATUS) */
const STATUS = /\(status (\d{3})\b[^)]*\)|\bHTTP (\d{3})\b|^API Error:? (\d{3})\b/i;

export function httpStatusOf(text: string): number | null {
	const m = STATUS.exec(text.trim());
	const status = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
	return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}

const UNITS: Record<string, number> = { s: 1_000, sec: 1_000, second: 1_000, m: 60_000, min: 60_000, minute: 60_000, h: 3_600_000, hr: 3_600_000, hour: 3_600_000, d: 86_400_000, day: 86_400_000 };

/** "Try again in ~120 min." (pi's Codex provider), "resets in 3 hours", "retry-after-ms=90000": when the limit is over, epoch ms; null when the text names no time. */
export function resetFromText(text: string, now: number): number | null {
	const ms = /retry-after-ms[=:]\s*(\d+)/i.exec(text);
	if (ms) return now + Number(ms[1]);
	const m = /\b(?:try again|resets?|retry)(?: again)? in\s*~?\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i.exec(text);
	if (!m) return null;
	const unit = UNITS[m[2].toLowerCase().replace(/s$/, "")] ?? (m[2].toLowerCase() === "s" ? 1_000 : undefined);
	return unit ? now + Math.round(Number(m[1]) * unit) : null;
}

/** A hold never reaches past this: a reset a month away is a misread. */
const MAX_HOLD_MS = 35 * 24 * 60 * 60_000;

/** The verdict on an error event: the engine's own hint first (it knows which window refused), then the words. `now` is when the error arrived. */
export function classifyFailure(text: string, hint?: FailureHint, now = Date.now()): Failure {
	const named = (at: number | undefined | null) => (at && at > now && at - now <= MAX_HOLD_MS ? at : undefined);
	if (hint?.kind === "signed_out") return { kind: "signed_out", scope: "signed-out" };
	if (hint?.kind === "credits") return { kind: "credits", scope: "credits" };
	if (hint?.kind === "usage_limit") {
		const resetsAt = named(hint.resetsAt) ?? named(resetFromText(text, now));
		return { kind: "usage_limit", scope: hint.scope === "model" ? "model" : "provider", ...(resetsAt ? { resetsAt } : {}) };
	}
	const status = httpStatusOf(text) ?? undefined;
	const withStatus = <T extends Failure>(f: T): T => (status ? { ...f, status } : f);
	if (status === 402 || OUT_OF_CREDITS.test(text)) return withStatus({ kind: "credits", scope: "credits" });
	if (USAGE_LIMIT.test(text) || API_QUOTA.test(text)) {
		const resetsAt = named(resetFromText(text, now));
		return withStatus({ kind: "usage_limit", scope: "provider", ...(resetsAt ? { resetsAt } : {}) });
	}
	if (SIGNED_OUT.test(text)) return withStatus({ kind: "signed_out", scope: "signed-out" });
	if (status === 529 || OVERLOADED.test(text) || status === 429 || RATE_LIMIT.test(text) || (status !== undefined && status >= 500) || SERVER.test(text) || WIRE.test(text)) return withStatus({ kind: "transient" });
	return withStatus({ kind: "other" });
}

/** Does this failure put its provider on hold: a limit, a missing credit or a sign-in that is gone. A hiccup never does. */
export const holdsProvider = (f: Failure): boolean => f.kind === "usage_limit" || f.kind === "credits" || f.kind === "signed_out";
