// Which providers are on hold, and who has been told. A provider that refused a run for its usage limit, for want of credit, or because its
// sign-in is gone is put on hold: until the reset time the error named (an hour when it named none), a sign-in hold for a while and then tried again.
// The holds are saved in the app data folder, so every new run of every agent starts on its backup, a restart included; a run that works
// on a provider ends what held it.
//
// Ported from OpenMausBot (Apache-2.0): server/host/limit-takeover.ts (holdModel / modelHeld, noteSignedOut / signedOutHeld / signedIn, worked,
// the SavedHolds file that drops what has run out on load), server/limit-notices.ts (LimitNotices.first: "once per bot for each stretch the
// engine is limited", a stretch ends when its reset passes or the engine works again), server/limit-resets.ts (UNNAMED_LIMIT_MS: an hour when the
// error named no reset). Adapted: OpenMausBot holds an "engine instance" per bot of a team of people; here a hold is a provider id of this one
// installation, and the person told is the one at this agent's chat. Left out: the plan-usage meter that ends a hold early (this app has no meter;
// the user can end a hold in Settings instead) and the Cloud / room paths.
import { readJson, writeAtomic } from "../../core/safe-file.js";
import type { Failure, HoldScope } from "./classify.js";

/** With no reset time named, a usage limit holds its provider this long after its last refusal. (limit-resets.ts UNNAMED_LIMIT_MS) */
export const UNNAMED_LIMIT_MS = 60 * 60_000;
/** One model's own limit holds that model at most this long before it is tried again, in case its window ended early. (limit-takeover.ts MODEL_HOLD_MS) */
export const MODEL_HOLD_MS = 6 * 60 * 60_000;
/** A provider whose sign-in was refused is tried again by a new run no sooner than this after the refusal, in case it was signed in some way this app did not see.
 *  Saving a key or finishing a sign-in ends the hold at once. (limit-takeover.ts SIGNED_OUT_RECHECK_MS) */
export const SIGNED_OUT_RECHECK_MS = UNNAMED_LIMIT_MS;
/** A stretch that named no reset lasts this long after its last refusal: longer than the hour it is held, so the try after that hour, refused again, is the same stretch. (limit-notices.ts) */
const UNNAMED_STRETCH_MS = 3 * UNNAMED_LIMIT_MS;
/** A sign-out's stretch stands until the provider is signed in again or works. */
const SIGNED_OUT_STRETCH_MS = 30 * 24 * 60 * 60_000;

export interface Hold {
	scope: Exclude<HoldScope, "signed-out">;
	/** when the hold ends, epoch ms */
	until: number;
	/** when the provider said the limit resets (the hold may end sooner for a model's window) */
	resetsAt?: number;
}

/** What holds a provider (or one of its models) right now. */
export interface Held {
	scope: HoldScope;
	/** when it is tried again, epoch ms */
	until: number;
	resetsAt?: number;
}

interface Saved {
	/** per provider (a limit of the whole account) or "provider\0model" */
	limits?: Record<string, Hold>;
	/** provider → when it last refused a sign-in */
	signedOut?: Record<string, number>;
	/** "agent\0stretch" → when the stretch ends: the person has been told */
	told?: Record<string, number>;
}

export interface HoldsOptions {
	/** where the holds are kept; none = in memory only (tests) */
	file?: string;
	now?: () => number;
	/** the holds changed (the settings page shows them) */
	onChange?: () => void;
}

export class ProviderHolds {
	private limits = new Map<string, Hold>();
	private signedOut = new Map<string, number>();
	private told = new Map<string, number>();
	private readonly now: () => number;

	constructor(private o: HoldsOptions = {}) {
		this.now = o.now ?? Date.now;
		if (o.file) this.load(o.file);
	}

	private static modelKey = (provider: string, model: string) => `${provider}\u0000${model}`;
	private static stretchKey = (agent: string, provider: string, scope: HoldScope, model: string) => `${agent}\u0000${scope === "signed-out" ? `signed-out\u0000${provider}` : scope === "provider" ? provider : ProviderHolds.modelKey(provider, model)}`;

	/** What a restart left held, without what has run out. */
	private load(file: string): void {
		const saved = readJson<Saved>(file, (v) => !!v && typeof v === "object" && !Array.isArray(v));
		if (!saved) return;
		const at = this.now();
		for (const [k, h] of Object.entries(saved.limits ?? {})) if (Number.isFinite(h?.until) && h.until > at && (h.scope === "provider" || h.scope === "model" || h.scope === "credits")) this.limits.set(k, h);
		for (const [p, t] of Object.entries(saved.signedOut ?? {})) if (Number.isFinite(t) && t > at - SIGNED_OUT_STRETCH_MS) this.signedOut.set(p, t);
		for (const [k, end] of Object.entries(saved.told ?? {})) if (Number.isFinite(end) && end > at) this.told.set(k, end);
	}

	private save(): void {
		this.o.onChange?.();
		if (!this.o.file) return;
		const s: Saved = { limits: Object.fromEntries(this.limits), signedOut: Object.fromEntries(this.signedOut), told: Object.fromEntries(this.told) };
		try {
			writeAtomic(this.o.file, JSON.stringify(s));
		} catch (e) {
			// a locked file: the hold stays in memory, the next change saves it
			console.error(`failover: could not save the provider holds: ${(e as Error).message}`);
		}
	}

	/** What holds this provider (or this model of it) now, or null. A model's own hold never holds the other models of the provider. */
	held(provider: string, model = ""): Held | null {
		const at = this.now();
		const whole = this.limits.get(provider);
		if (whole && whole.until > at) return { scope: whole.scope, until: whole.until, ...(whole.resetsAt ? { resetsAt: whole.resetsAt } : {}) };
		const one = model ? this.limits.get(ProviderHolds.modelKey(provider, model)) : undefined;
		if (one && one.until > at) return { scope: one.scope, until: one.until, ...(one.resetsAt ? { resetsAt: one.resetsAt } : {}) };
		const out = this.signedOut.get(provider);
		if (out !== undefined && at - out < SIGNED_OUT_RECHECK_MS) return { scope: "signed-out", until: out + SIGNED_OUT_RECHECK_MS };
		return null;
	}

	/** Is anything held at all: a run that has no backup and no hold need not look at who is signed in. */
	anyHeld(): boolean {
		const at = this.now();
		return [...this.limits.values()].some((h) => h.until > at) || [...this.signedOut.values()].some((t) => at - t < SIGNED_OUT_RECHECK_MS);
	}

	/** A run on this provider and model failed as `failure`: a limit holds it until its reset (an hour when none was named), a sign-in refusal holds the sign-in. */
	note(provider: string, model: string, failure: Failure): void {
		const at = this.now();
		if (failure.kind === "signed_out") {
			this.signedOut.set(provider, at);
			return this.save();
		}
		if (failure.kind !== "usage_limit" && failure.kind !== "credits") return;
		const named = failure.resetsAt && failure.resetsAt > at ? failure.resetsAt : undefined;
		if (failure.scope === "model" || failure.scope === "credits") {
			// one model's window, or its extra usage credits: that model only, and never longer than MODEL_HOLD_MS (the window may end early)
			this.limits.set(ProviderHolds.modelKey(provider, model), { scope: failure.scope, until: Math.min(named ?? at + UNNAMED_LIMIT_MS, at + MODEL_HOLD_MS), ...(named ? { resetsAt: named } : {}) });
		} else if (failure.kind === "credits") {
			// a provider out of credit: nothing resets it by itself, so it is looked at again in an hour
			this.limits.set(provider, { scope: "credits", until: at + UNNAMED_LIMIT_MS });
		} else {
			this.limits.set(provider, { scope: "provider", until: named ?? at + UNNAMED_LIMIT_MS, ...(named ? { resetsAt: named } : {}) });
		}
		this.save();
	}

	/** A run on this provider worked: whatever held it is over, and the next limit or sign-out of it is a new stretch. */
	worked(agent: string, provider: string, model: string): void {
		let changed = false;
		for (const k of [provider, ProviderHolds.modelKey(provider, model)]) changed = this.limits.delete(k) || changed;
		changed = this.signedOut.delete(provider) || changed;
		for (const k of [...this.told.keys()]) {
			const [who, ...rest] = k.split("\u0000");
			const stretch = rest.join("\u0000");
			if (who === agent && (stretch === provider || stretch === ProviderHolds.modelKey(provider, model) || stretch === `signed-out\u0000${provider}`)) changed = this.told.delete(k) || changed;
		}
		if (changed) this.save();
	}

	/** The provider is signed in again (a key saved, a sign-in finished): every agent's next run may use it, and its next sign-out is told. */
	signedIn(provider: string): void {
		const had = this.signedOut.delete(provider);
		const key = `signed-out\u0000${provider}`;
		let told = false;
		for (const k of [...this.told.keys()]) if (k.endsWith(`\u0000${key}`)) told = this.told.delete(k) || told;
		if (had || told) this.save();
	}

	/** The user ends every hold of this provider by hand (a plan upgraded, a limit reset early). */
	release(provider: string): void {
		let changed = false;
		for (const k of [...this.limits.keys()]) if (k === provider || k.startsWith(`${provider}\u0000`)) changed = this.limits.delete(k) || changed;
		changed = this.signedOut.delete(provider) || changed;
		// a stretch key is agent\0provider, agent\0provider\0model or agent\0signed-out\0provider
		for (const k of [...this.told.keys()]) {
			const parts = k.split("\u0000");
			if ((parts[1] === "signed-out" ? parts[2] : parts[1]) === provider) changed = this.told.delete(k) || changed;
		}
		if (changed) this.save();
	}

	/** True the first time in this stretch of the provider's hold for this agent; the stretch then lasts until the reset (for a sign-out: until it is signed in or works).
	 *  The person is told once per stretch, never once per refused run. (limit-notices.ts LimitNotices.first) */
	first(agent: string, provider: string, model: string, scope: HoldScope, resetsAt?: number): boolean {
		const at = this.now();
		const key = ProviderHolds.stretchKey(agent, provider, scope, model);
		const until = scope === "signed-out" ? at + SIGNED_OUT_STRETCH_MS : resetsAt && resetsAt > at ? resetsAt : at + UNNAMED_STRETCH_MS;
		const known = this.told.get(key);
		for (const [k, end] of [...this.told]) if (end <= at) this.told.delete(k);
		this.told.set(key, Math.max(known && known > at ? known : 0, until));
		this.save();
		return !(known && known > at);
	}

	/** The holds as the settings page lists them. */
	rows(): { provider: string; model?: string; scope: HoldScope; until: number; resetsAt?: number }[] {
		const at = this.now();
		const out: { provider: string; model?: string; scope: HoldScope; until: number; resetsAt?: number }[] = [];
		for (const [k, h] of this.limits) {
			if (h.until <= at) continue;
			const [provider, model] = k.split("\u0000");
			out.push({ provider, ...(model ? { model } : {}), scope: h.scope, until: h.until, ...(h.resetsAt ? { resetsAt: h.resetsAt } : {}) });
		}
		for (const [provider, t] of this.signedOut) if (at - t < SIGNED_OUT_RECHECK_MS) out.push({ provider, scope: "signed-out", until: t + SIGNED_OUT_RECHECK_MS });
		return out;
	}
}
