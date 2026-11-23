// The backup of a provider: when an agent's provider is on hold (usage limit, no credit, sign-in gone) its runs start on the agent's backup; a run that
// fails on one of those before any tool ran is, where allowed, tried once more on the backup; the person is told once per stretch. The pure rules are in
// plan.ts, the saved holds in holds.ts, the verdict on an error in classify.ts, the words in notice.ts. This class joins them with the app's facts
// (who is signed in, what a model can see), which the session provides.
//
// Ported from OpenMausBot (Apache-2.0) server/host/limit-takeover.ts (createLimitTakeover: takeoverAtStart = start(), noteRuntimeEvent / carriedOn =
// afterFailure(), worked, tell) and server/host/peer-limit-resend.ts (a bot-to-bot turn that met a usage limit before anything ran is resent once on
// the bot's backup, with the options it had, so it never gains authority) and server/config.ts automaticRecovery (one retry on the backup for a turn that
// failed before any tool ran; off by default). Adapted to a design office: there is one run per agent and the retry happens inside that run (same gate, same
// tool list, same depth, same wave), so a resent run cannot be given more than the first one had; and the lanes `delegate` starts get the same guard.
import type { AgentSpec } from "../../shared/agent-types.js";
import type { FailureHint, Settings } from "../../shared/types.js";
import { classifyFailure, holdsProvider, type Failure, type HoldScope } from "./classify.js";
import type { ProviderHolds } from "./holds.js";
import { holdNotice, type Carry } from "./notice.js";
import { authorProviders, checkerProvider, passOver, type Pass, type Target } from "./plan.js";

export { classifyFailure, holdsProvider } from "./classify.js";
export { ProviderHolds } from "./holds.js";
export { backupFor, targetFor, type Target } from "./plan.js";

export interface FailoverDeps {
	holds: ProviderHolds;
	/** the providers that can run now: a key, a sign-in or a token is stored */
	ready: () => Promise<ReadonlySet<string>>;
	/** the model as the catalogue knows it (the provider's default when none is named); null = unknown */
	describe: (t: Pick<Target, "provider" | "model">) => Promise<{ id: string; images: boolean } | null>;
	/** a provider as the person knows it ("Claude (abonements)") */
	label: (provider: string) => string;
	now?: () => number;
	log?: (line: string) => void;
}

/** How a run ended, for the decision about a retry. */
export interface FailedRun {
	agent: string;
	/** the agent's name, in the notice */
	name: string;
	/** where the run was */
	on: Target;
	/** the model's id as resolved (the default made a name) */
	id: string;
	/** the agent's backup, or null when the run is already on it */
	backup: Target | null;
	error: string;
	hint?: FailureHint;
	/** a tool of this run has run (or a lane's): nothing is resent */
	toolsRan: boolean;
	aborted: boolean;
	/** "peer": work another agent asked for (mail, delegate): a limit before anything ran is resent on the backup, whatever the setting says.
	 *  "direct": the user's own message: a retry only when automatic recovery is on. */
	mode: "peer" | "direct";
	recovery: boolean;
	/** the run carries images (pasted or earlier in the conversation): the backup must see them */
	needImages: boolean;
}

export interface LaneAttempt {
	error: string | null;
	hint?: FailureHint;
	toolCalls: number;
	aborted: boolean;
}

export class Failover {
	constructor(private d: FailoverDeps) {}

	get holds(): ProviderHolds {
		return this.d.holds;
	}

	private now = () => (this.d.now ?? Date.now)();

	/** A provider as the person knows it. */
	label(provider: string): string {
		return this.d.label(provider);
	}

	/** How the held thing is named: a model's own limit names the model. */
	private from(t: Pick<Target, "provider">, id: string, scope: HoldScope): string {
		return scope === "model" || scope === "credits" ? `${this.d.label(t.provider)} ${id}` : this.d.label(t.provider);
	}

	/** The words for this stretch, or undefined when the person was already told. */
	private tell(agent: string, name: string, t: Target, id: string, scope: HoldScope, resetsAt: number | undefined, to: Target | undefined, toId: string, carry: Carry): string | undefined {
		if (!this.d.holds.first(agent, t.provider, id, scope, resetsAt)) return undefined;
		const toLabel = to ? (to.provider === t.provider ? `${this.d.label(to.provider)} ${toId}` : this.d.label(to.provider)) : undefined;
		return holdNotice({ from: this.from(t, id, scope), agent: name, scope, ...(resetsAt ? { resetsAt } : {}), ...(toLabel ? { to: toLabel } : {}), carry, now: this.now() });
	}

	/** Weighs the backup (and for one model's own limit, first the same provider's default model): the one that may take the run over, or why not. */
	private async weigh(from: Target, fromId: string, backup: Target, scope: HoldScope | "failed", needImages: boolean): Promise<{ to: Target; id: string } | { why: Pass }> {
		const ready = await this.d.ready();
		const candidates: Target[] = scope === "model" || scope === "credits" ? [{ provider: from.provider, model: "", effort: "" }, backup] : [backup];
		let why: Pass = "not-ready";
		for (const c of candidates) {
			const info = await this.d.describe(c);
			const verdict = passOver(from, fromId, c, { ready: ready.has(c.provider), held: info ? this.d.holds.held(c.provider, info.id) : null, id: info?.id ?? null, images: info?.images ?? false }, scope, needImages);
			if (!verdict && info) return { to: c, id: info.id };
			if (verdict) why = verdict;
		}
		this.d.log?.(`failover: ${from.provider}/${fromId} cannot hand over to ${backup.provider}/${backup.model || "(default)"}: ${why}`);
		return { why };
	}

	/** Before a run: where it starts. When its provider (or model) is on hold and its backup may take over, there, with the words that tell the person once. */
	async start(a: { agent: string; name: string; primary: Target; backup: Target | null; needImages: boolean }): Promise<{ on: Target; id: string; notice?: string; took?: boolean }> {
		const info = await this.d.describe(a.primary);
		const id = info?.id ?? a.primary.model;
		const held = this.d.holds.held(a.primary.provider, id);
		if (!held || !a.backup) return { on: a.primary, id };
		const w = await this.weigh(a.primary, id, a.backup, held.scope, a.needImages);
		if ("why" in w) return { on: a.primary, id };
		const notice = this.tell(a.agent, a.name, a.primary, id, held.scope, held.resetsAt, w.to, w.id, "now");
		return { on: w.to, id: w.id, took: true, ...(notice ? { notice } : {}) };
	}

	/** After a failed run: puts the provider on hold when the failure says so, says so once, and answers whether the run is tried again, and where. */
	async afterFailure(a: FailedRun): Promise<{ retryOn?: Target; retryId?: string; notice?: string; failure: Failure }> {
		const failure = classifyFailure(a.error, a.hint, this.now());
		const holds = holdsProvider(failure);
		if (holds) this.d.holds.note(a.on.provider, a.id, failure);
		const may = !a.toolsRan && !a.aborted;
		const eligible = a.mode === "peer" ? holds : a.recovery && (holds || failure.kind === "transient");
		const w = a.backup ? await this.weigh(a.on, a.id, a.backup, failure.scope ?? "failed", a.needImages) : null;
		const to = w && !("why" in w) ? w : null;
		const retry = may && eligible && to ? to : null;
		let notice: string | undefined;
		if (holds) notice = this.tell(a.agent, a.name, a.on, a.id, failure.scope ?? "provider", failure.resetsAt, to?.to, to?.id ?? "", retry ? "now" : to ? "next" : "none");
		return { failure, ...(retry ? { retryOn: retry.to, retryId: retry.id } : {}), ...(notice ? { notice } : {}) };
	}

	/** A failure after tools ran, or one that is no business of a retry: the hold is still recorded, so the next run starts on the backup. */
	record(on: Target, id: string, error: string, hint?: FailureHint): Failure {
		const failure = classifyFailure(error, hint, this.now());
		if (holdsProvider(failure)) this.d.holds.note(on.provider, id, failure);
		return failure;
	}

	/** A run worked on this provider and model: whatever held it is over. */
	worked(agent: string, on: Target, id: string): void {
		this.d.holds.worked(agent, on.provider, id);
	}

	/** The provider an agent that checks others' work starts on when it has none of its own (eks): the best signed-in one that none of the authors uses; null = keep the app's. */
	async checkerTarget(spec: Pick<AgentSpec, "id" | "provider">, specs: readonly Pick<AgentSpec, "id" | "provider">[], s: Pick<Settings, "provider">): Promise<Target | null> {
		if (spec.provider?.trim()) return null;
		const ready = [...(await this.d.ready())].filter((p) => !this.d.holds.held(p));
		const pick = checkerProvider(ready, authorProviders(specs, spec.id, s));
		return pick ? { provider: pick, model: "", effort: "" } : null;
	}

	/** The provider that checks one agent's work (check before done): the best signed-in one other than the worker's own, "since a model rarely catches its own mistakes"
	 *  (OpenMausBot server/checker-model.ts `otherProviderSelection`); null when no other is ready, and the checker then stays on the worker's own. */
	async otherProvider(worker: Pick<Target, "provider">): Promise<Target | null> {
		const ready = [...(await this.d.ready())].filter((p) => !this.d.holds.held(p));
		const pick = checkerProvider(ready, [worker.provider]);
		return pick ? { provider: pick, model: "", effort: "" } : null;
	}

	/** One helper or specialist job (a lane of `run_subagent` / `delegate`): starts on the backup while its provider is held, and a limit or sign-in failure before any tool ran is resent once there. */
	async guardLane(a: { agent: string; name: string; primary: Target; backup: Target | null; say: (text: string) => void }, attempt: (t: Target) => Promise<LaneAttempt>): Promise<LaneAttempt> {
		const begin = await this.start({ ...a, needImages: false });
		if (begin.notice) a.say(begin.notice);
		let on = begin.on;
		let id = begin.id;
		let out = await attempt(on);
		if (out.error && !out.aborted) {
			const d = await this.afterFailure({ agent: a.agent, name: a.name, on, id, backup: begin.took ? null : a.backup, error: out.error, hint: out.hint, toolsRan: out.toolCalls > 0, aborted: out.aborted, mode: "peer", recovery: false, needImages: false });
			if (d.notice) a.say(d.notice);
			if (d.retryOn) {
				on = d.retryOn;
				id = d.retryId ?? on.model;
				out = await attempt(on);
				if (out.error && !out.aborted) this.record(on, id, out.error, out.hint);
			}
		}
		if (!out.error) this.worked(a.agent, on, id);
		return out;
	}
}
