// What the Claude CLI says about a usage limit, as the hint the failover reads (src/agent/failover): which window refused and when it resets.
//
// Ported from OpenMausBot (Apache-2.0) server/drivers/claude-limits.ts: claudeLimitRefusal (the `rate_limit_info` of a `rate_limit_event`),
// claudeEngineReset / claudeLimitFacts (only a window every model shares stops the whole account; one model family's weekly window, or extra
// usage credits, stops that model alone). Left out: its notice texts (this app words its own in failover/notice.ts) and the ACP / api-error frame readers.
// Pure, tested on the SDK's own shapes (SDKRateLimitInfo in sdk.d.ts).
import type { FailureHint } from "../../shared/types.js";

export interface ClaudeLimit {
	/** the CLI's rateLimitType: five_hour, seven_day, seven_day_opus, seven_day_sonnet, seven_day_overage_included or overage */
	window: string | null;
	/** epoch seconds */
	resetsAt: number | null;
	/** The plan still had room: this model runs on extra usage and its credits are used up, so `resetsAt` is the billing period's reset and other models keep working. */
	credits?: true;
}

/** The window refusing this account per the CLI's `rate_limit_info` ("allowed", "allowed_warning", "rejected"), or null. A rejected window with extra usage in use still runs the turn on credits. */
export function claudeLimitRefusal(info: unknown): ClaudeLimit | null {
	if (!info || typeof info !== "object") return null;
	const { status, rateLimitType, resetsAt, isUsingOverage, errorCode, overageDisabledReason } = info as Record<string, unknown>;
	if (status !== "rejected" || isUsingOverage === true) return null;
	return {
		window: typeof rateLimitType === "string" ? rateLimitType : null,
		resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
		...(errorCode === "credits_required" || overageDisabledReason === "out_of_credits" ? { credits: true as const } : {}),
	};
}

/** A weekly window for one model family (seven_day_opus, seven_day_sonnet…), not the overage windows. */
const modelWindow = (window: string | null | undefined): boolean => /^seven_day_(?!overage)[a-z]+$/.test(window ?? "");

/** The hint a limit refusal gives the failover: the whole account, one model, or the extra usage credits. */
export function claudeLimitHint(limit: ClaudeLimit | null | undefined): FailureHint {
	if (limit?.credits) return { kind: "credits" };
	const resetsAt = limit?.resetsAt ? limit.resetsAt * 1000 : undefined;
	return { kind: "usage_limit", scope: modelWindow(limit?.window) ? "model" : "provider", ...(resetsAt ? { resetsAt } : {}) };
}

/** Claude Code's api-error kinds (the assistant frame's `error`) that say the cause outright, as a hint; others are read from the words. */
export function claudeErrorHint(kind: unknown, limit: ClaudeLimit | null | undefined): FailureHint | undefined {
	if (kind === "authentication_failed") return { kind: "signed_out" };
	if (kind === "billing_error") return { kind: "credits" };
	if (kind === "rate_limit" && limit) return claudeLimitHint(limit);
	return undefined;
}
