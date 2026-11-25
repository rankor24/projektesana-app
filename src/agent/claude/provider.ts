// The Claude subscription engine as a provider the settings can choose (approved by Anthropic for this app, 2026-11-19).
// Plain data, no SDK imports, so the renderer and the settings can read it too.
//
// pi stays the engine for every other provider and for Claude by API key. This id runs the Claude Agent SDK instead,
// signed in with each user's own Claude Pro/Max/Team seat: by Sign in (the unmodified `claude auth login`, a login kept in the app's own
// Claude folder, src/agent/claude/login.ts) or by a `claude setup-token` the user pastes (a long-lived OAuth token). A pasted token wins.
// Model facts (context window, images, efforts) come from pi's `anthropic` catalog: same models, same ids.

import { ANTIGRAVITY } from "../antigravity/provider.js";

export const CLAUDE_SUB = "claude-sub";

export const CLAUDE_SUB_LABEL = "Claude (abonements)";

/** The model used when none is chosen: the same default as Claude by API key. */
export const CLAUDE_SUB_DEFAULT_MODEL = "claude-sonnet-5-5";

/** How the person gets the token: one command in any terminal where Claude Code is installed, then paste the printed token. */
export const CLAUDE_SUB_TOKEN_HELP = "Terminālī palaid: claude setup-token — un ielīmē izdrukāto atslēgu.";

export const NOT_CONNECTED = "Claude abonements nav pieslēgts: Iestatījumi → Claude (abonements) → Pieslēgties (vai ielīmē atslēgu no `claude setup-token`).";

export const isClaudeSub = (provider: string): boolean => provider === CLAUDE_SUB;

/** The pi provider whose catalog describes this provider's models: Claude's for the subscription, Gemini's for Antigravity (its models come from the server and are
 *  not in any catalog, so a model pi does not know is made up with the same window and image support), the provider itself for the rest. */
export const catalogProvider = (provider: string): string => (provider === CLAUDE_SUB ? "anthropic" : provider === ANTIGRAVITY ? "google" : provider);

/** The SDK's effort levels; pi's "off" and "minimal" have no SDK equivalent (then the model's default). */
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export function claudeEffort(e: string | undefined): ClaudeEffort | undefined {
	return e === "low" || e === "medium" || e === "high" || e === "xhigh" || e === "max" ? e : undefined;
}
