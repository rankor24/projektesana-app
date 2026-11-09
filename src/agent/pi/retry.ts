// When a model turn fails on the wire (fetch failed, connection reset, 429, 5xx, overloaded), the run waits and
// restarts that one turn instead of ending. Deterministic failures (bad request, quota/billing, auth) still end it.
//
// Borrowed from pi-ai utils/retry.ts: the transient-error classifier (isRetryableAssistantError, the same pattern list
// pi's coding agent uses) and the backoff formula (retryDelayMs: baseDelayMs * 2^(attempt-1), capped). pi's own
// retryAssistantCall wraps a single produce() call; here the failed turn lives inside the Agent's transcript, so the
// restart is: drop the failed assistant message, sleep, agent.continue() — pi's "restart the last assistant turn".
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { isRetryableAssistantError, retryDelayMs, type AssistantMessage, type RetryPolicy } from "@earendil-works/pi-ai";

/** 4 restarts after 2, 4, 8, 16 s: about half a minute of a dropped connection before the run gives up. */
export const RUN_RETRY: RetryPolicy = { enabled: true, maxRetries: 4, baseDelayMs: 2_000, maxAgentDelayMs: 30_000 };

const isAssistant = (m: AgentMessage | undefined): m is AssistantMessage => (m as { role?: string } | undefined)?.role === "assistant";

/** The failed turn to restart, or null: the last message is an assistant error that looks transient. */
export function retryableFailure(messages: readonly AgentMessage[]): AssistantMessage | null {
	const last = messages[messages.length - 1];
	return isAssistant(last) && isRetryableAssistantError(last) ? last : null;
}

/** True when this failed message would be restarted at this attempt (1-based) under the policy. */
export function willRetry(m: AgentMessage, attempt: number, policy: RetryPolicy = RUN_RETRY): boolean {
	return policy.enabled && attempt <= policy.maxRetries && isAssistant(m) && isRetryableAssistantError(m);
}

export const retryDelay = (attempt: number, policy: RetryPolicy = RUN_RETRY) => retryDelayMs(policy, attempt);

/**
 * The transcript without its trailing failed assistant messages. A failed message carries no answer and no executed
 * tool call (pi stops the loop on it), so dropping it loses nothing; keeping it would hand the next request an empty
 * assistant turn, and `continue()` refuses to start from an assistant message.
 */
export function dropFailedTail(messages: readonly AgentMessage[]): AgentMessage[] {
	let end = messages.length;
	while (end > 0) {
		const m = messages[end - 1];
		if (!isAssistant(m) || m.stopReason !== "error") break;
		end--;
	}
	return messages.slice(0, end);
}

/** Sleeps, or resolves false at once when the signal aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve(false);
		const done = (ok: boolean) => {
			clearTimeout(t);
			signal.removeEventListener("abort", onAbort);
			resolve(ok);
		};
		const onAbort = () => done(false);
		const t = setTimeout(() => done(true), Math.max(0, ms));
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
