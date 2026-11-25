// The decisions about which provider and model an agent runs on, as pure functions: the agent's own choice, its backup, whether a backup may take a
// run over, and which provider checks the others' work. Facts (who is signed in, what is held, what a model can see) come in as arguments, so this
// file is tested without an engine, a clock or a disk.
//
// Ported from OpenMausBot (Apache-2.0): server/host/limit-takeover.ts (weighBackups / skipped: a backup is passed over when it is not ready, is held,
// is the provider that refused, or cannot take what the run carries; for one model's own limit the same provider's default model goes first),
// server/automatic-recovery.ts (chosenBackups: the agent's own backup, else the app-wide one; recoveryCapabilityError: a backup that cannot take
// the run's attachments is not used), server/checker-model.ts (otherProviderSelection: the checker starts on the best ready provider other than the
// worker's, "since a model rarely catches its own mistakes"; null when none is ready).
// Adapted: OpenMausBot's "engine instances" and approval modes are this app's providers and agent specs; its capability list (MCP kinds, workspace files)
// shrinks to the one capability here that differs between providers: images. The tools an agent has come from its spec, never from its provider.
import type { AgentSpec } from "../../shared/agent-types.js";
import { ANTIGRAVITY } from "../antigravity/provider.js";
import { CLAUDE_SUB } from "../claude/provider.js";
import { isPiProvider } from "../pi/providers.js";
import type { ModelChoice, Settings } from "../../shared/types.js";
import type { HoldScope } from "./classify.js";
import type { Held } from "./holds.js";

/** Where a run goes: a provider, a model of it ("" = the provider's default) and an effort ("" = the model's default). */
export interface Target {
	provider: string;
	model: string;
	effort: string;
}

export const sameProvider = (a: { provider: string }, b: { provider: string }) => a.provider === b.provider;

/** An agent's own provider, model and effort, else the app's. `spec.model` names a model of the agent's own provider; when the agent names a provider other than the
 *  app's, the app's model and effort belong to the other provider and are not carried over. */
export function targetFor(spec: Pick<AgentSpec, "provider" | "model" | "effort"> | null, s: Pick<Settings, "provider" | "model" | "effort">): Target {
	const own = spec?.provider?.trim() ?? "";
	const sameAsApp = !own || own === s.provider;
	return {
		provider: own || s.provider,
		model: spec?.model?.trim() || (sameAsApp ? s.model : ""),
		effort: spec?.effort || (sameAsApp ? s.effort : ""),
	};
}

/** A provider id this app can run: a pi provider, or the Claude subscription. */
export const isKnownProvider = (p: string): boolean => p === CLAUDE_SUB || p === ANTIGRAVITY || isPiProvider(p);

const usable = (c: ModelChoice | null | undefined): c is ModelChoice => !!c && typeof c.provider === "string" && c.provider.trim() !== "";

/** The backup of an agent: its own, else the app-wide one; null when neither is set. */
export function backupFor(spec: Pick<AgentSpec, "backup"> | null, s: Pick<Settings, "backup">): Target | null {
	const b = usable(spec?.backup) ? spec!.backup : usable(s.backup) ? s.backup : null;
	return b ? { provider: b.provider.trim(), model: (b.model ?? "").trim(), effort: "" } : null;
}

// ---- may a backup take the run over ------------------------------------------------------------------------------------------------------

export type Pass = "same-model" | "same-provider" | "not-ready" | "held" | "unknown-model" | "no-images";

/** What is known about a candidate backup. */
export interface Facts {
	/** signed in (a key, a sign-in, a token) */
	ready: boolean;
	held: Held | null;
	/** the model's id once the provider's default is resolved; null = the catalogue does not know the model */
	id: string | null;
	images: boolean;
}

/** Why a candidate may not take the run over from `from` (whose resolved model is `fromId`), or null when it may. `scope`: what stopped `from`. */
export function passOver(from: Target, fromId: string, candidate: Target, f: Facts, scope: HoldScope | "failed", needImages: boolean): Pass | null {
	if (f.id === null) return "unknown-model";
	if (candidate.provider === from.provider) {
		// the same provider shares its account's limit and its sign-in: only a limit of one model is carried by another model of it
		if (f.id === fromId) return "same-model";
		if (scope !== "model" && scope !== "credits") return "same-provider";
	}
	if (!f.ready) return "not-ready";
	if (f.held) return "held";
	if (needImages && !f.images) return "no-images";
	return null;
}

// ---- the checker ---------------------------------------------------------------------------------------------------------------------------

/** The providers in the order the checker prefers them: the strongest models first. A product choice (Boris can change the order here), not a fact of any provider. */
export const CHECKER_RANK: readonly string[] = ["claude-sub", "anthropic", "openai-codex", "openai", "antigravity", "google", "xai", "openrouter"];

/** The provider an agent that checks others' work (eks) starts on when it has none of its own: the best ready provider that none of the authors runs on.
 *  Null when no such provider is ready; the checker then keeps the app's provider. */
export function checkerProvider(ready: readonly string[], authors: readonly string[]): string | null {
	const free = ready.filter((p) => !authors.includes(p));
	if (!free.length) return null;
	const rank = (p: string) => (CHECKER_RANK.includes(p) ? CHECKER_RANK.indexOf(p) : CHECKER_RANK.length);
	return [...free].sort((a, b) => rank(a) - rank(b))[0];
}

/** The providers the authors of the work run on: every agent but the checker, on its own provider or the app's, and the lead on the app's. */
export function authorProviders(specs: readonly Pick<AgentSpec, "id" | "provider">[], checker: string, s: Pick<Settings, "provider">): string[] {
	return [...new Set([s.provider, ...specs.filter((a) => a.id !== checker).map((a) => a.provider?.trim() || s.provider)])];
}
