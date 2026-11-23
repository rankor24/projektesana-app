// Phase A: a provider's backup. Two tests: the decision rules (a usage limit read from the provider's words, the hold and its reset, who may take a run over, which provider checks
// the others), and the real flow through the session with a scripted engine (a limit before any tool ran, once with automatic recovery off and once on, the hold surviving a restart).
// Invented agents, no provider is called.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { classifyFailure } from "../src/agent/failover/classify.ts";
import { ProviderHolds } from "../src/agent/failover/holds.ts";
import { authorProviders, backupFor, checkerProvider, passOver, targetFor, type Facts } from "../src/agent/failover/plan.ts";
import { claudeLimitHint, claudeLimitRefusal } from "../src/agent/claude/limits.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS, type RunEvent, type Settings } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const T0 = Date.parse("2026-11-23T10:00:00Z");
const MIN = 60_000;

test("failover rules: the limit and its reset from the words, the hold, the backup that may take over, the checker's provider", () => {
	// pi's Codex provider words a limit with minutes; the Claude CLI names the window and the reset in `rate_limit_info`
	const codex = classifyFailure("You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.", undefined, T0);
	assert.deepEqual([codex.kind, codex.scope, codex.resetsAt], ["usage_limit", "provider", T0 + 90 * MIN]);
	const weeklyOpus = claudeLimitRefusal({ status: "rejected", rateLimitType: "seven_day_opus", resetsAt: (T0 + 5 * 60 * MIN) / 1000 });
	const hint = claudeLimitHint(weeklyOpus);
	assert.deepEqual(classifyFailure("You've hit your weekly limit", hint, T0), { kind: "usage_limit", scope: "model", resetsAt: T0 + 300 * MIN });
	assert.equal(claudeLimitRefusal({ status: "rejected", isUsingOverage: true }), null, "a rejected window that still runs on extra usage refuses nothing");
	assert.equal(classifyFailure("No API key for provider: xai", undefined, T0).kind, "signed_out");
	assert.equal(classifyFailure("subscription sign-in is not permitted for third-party apps", undefined, T0).kind, "other", "a refusal to sign in is not a quota");
	assert.equal(classifyFailure("Your credit balance is too low", undefined, T0).kind, "credits");
	assert.equal(classifyFailure("fetch failed", undefined, T0).kind, "transient");
	assert.equal(classifyFailure("aborted", undefined, T0).kind, "other");

	// the hold: until the named reset, an hour when none was named, kept across a restart, ended by a run that works; the person is told once per stretch
	const file = join(tmp(), "holds.json");
	let now = T0;
	const holds = new ProviderHolds({ file, now: () => now });
	holds.note("openai-codex", "gpt-x", codex);
	assert.equal(holds.held("openai-codex", "gpt-x")?.until, T0 + 90 * MIN);
	assert.equal(holds.held("xai"), null, "another provider is not held");
	assert.equal(holds.first("bpv", "openai-codex", "gpt-x", "provider", T0 + 90 * MIN), true);
	assert.equal(holds.first("bpv", "openai-codex", "gpt-x", "provider", T0 + 90 * MIN), false, "told once");
	assert.equal(holds.first("ar", "openai-codex", "gpt-x", "provider", T0 + 90 * MIN), true, "each agent hears it in its own chat");
	now = T0 + 30 * MIN;
	assert.equal(new ProviderHolds({ file, now: () => now }).held("openai-codex")?.scope, "provider", "a restart keeps the hold");
	now = T0 + 91 * MIN;
	assert.equal(new ProviderHolds({ file, now: () => now }).held("openai-codex"), null, "and drops it once it has run out");
	const unnamed = new ProviderHolds({ now: () => T0 });
	unnamed.note("xai", "", classifyFailure("usage limit reached", undefined, T0));
	assert.equal(unnamed.held("xai")?.until, T0 + 60 * MIN);
	unnamed.note("anthropic", "", { kind: "signed_out", scope: "signed-out" });
	assert.equal(unnamed.held("anthropic")?.scope, "signed-out");
	unnamed.signedIn("anthropic");
	assert.equal(unnamed.held("anthropic"), null, "a finished sign-in ends the hold at once");
	unnamed.worked("bpv", "xai", "grok");
	assert.equal(unnamed.held("xai"), null, "a run that works ends what held the provider");

	// the agent's own provider and backup win over the app's; the app's model belongs to the app's provider
	const app: Pick<Settings, "provider" | "model" | "effort" | "backup"> = { provider: "openai-codex", model: "gpt-x", effort: "high", backup: { provider: "xai", model: "" } };
	assert.deepEqual(targetFor(null, app), { provider: "openai-codex", model: "gpt-x", effort: "high" });
	assert.deepEqual(targetFor({ provider: "xai" }, app), { provider: "xai", model: "", effort: "" });
	assert.deepEqual(targetFor({ model: "other" }, app), { provider: "openai-codex", model: "other", effort: "high" }, "a model without a provider stays on the app's provider, as before");
	assert.deepEqual(backupFor(null, app), { provider: "xai", model: "", effort: "" });
	assert.deepEqual(backupFor({ backup: { provider: "anthropic", model: "m" } }, app), { provider: "anthropic", model: "m", effort: "" });
	assert.equal(backupFor(null, { backup: null }), null);
	const ok: Facts = { ready: true, held: null, id: "grok", images: true };
	const from = { provider: "openai-codex", model: "gpt-x", effort: "" };
	const to = { provider: "xai", model: "", effort: "" };
	assert.equal(passOver(from, "gpt-x", to, ok, "provider", true), null);
	assert.equal(passOver(from, "gpt-x", to, { ...ok, ready: false }, "provider", false), "not-ready");
	assert.equal(passOver(from, "gpt-x", to, { ...ok, held: { scope: "provider", until: T0 + MIN } }, "provider", false), "held");
	assert.equal(passOver(from, "gpt-x", to, { ...ok, images: false }, "provider", true), "no-images");
	assert.equal(passOver(from, "gpt-x", to, { ...ok, id: null }, "provider", false), "unknown-model");
	assert.equal(passOver(from, "gpt-x", { ...to, provider: "openai-codex" }, { ...ok, id: "gpt-y" }, "provider", false), "same-provider", "the account's own limit is the account's: another model of it does not help");
	assert.equal(passOver(from, "gpt-x", { ...to, provider: "openai-codex" }, { ...ok, id: "gpt-y" }, "model", false), null, "one model's limit may be carried by another model of the provider");

	// the checker: the best signed-in provider that none of the authors runs on; none = keeps the app's
	const specs = [{ id: "eks" }, { id: "ar", provider: "claude-sub" }, { id: "bk" }];
	const authors = authorProviders(specs, "eks", { provider: "openai-codex" });
	assert.deepEqual(authors.sort(), ["claude-sub", "openai-codex"]);
	assert.equal(checkerProvider(["openai-codex", "claude-sub", "xai", "google"], authors), "google", "ranked: google before xai");
	assert.equal(checkerProvider(["openai-codex", "claude-sub"], authors), null);
});

const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: `apraksts ${id}`, prompt: `You are AGENT ${id}.`, tools: [], ...extra });
const LIMIT = "You have hit your ChatGPT usage limit (plus plan). Try again in ~90 min.";

function rig(settings: Partial<Settings>, script: (o: PiRunOptions, call: number) => void) {
	const dir = tmp();
	const events: RunEvent[] = [];
	const calls: { provider?: string; modelId?: string; prompt: string }[] = [];
	const make = () =>
		new AgentSession({
			runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }),
			settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
			toolsServer: () => ({ command: "node", args: [], env: {} }),
			revit: () => null,
			ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
			agents: () => [spec("ar")],
			runsDir: join(dir, "runs"),
			chatDir: join(dir, "chat"),
			emit: (_id, e) => void events.push(e),
			ready: async () => new Set(["openai-codex", "xai"]),
			runAgent: async (o: PiRunOptions) => {
				calls.push({ provider: o.provider, modelId: o.modelId, prompt: o.prompt });
				script(o, calls.length);
			},
		});
	const settle = async (s: AgentSession) => {
		for (let i = 0; i < 400 && (s.queueView().running.length || s.queueView().queued.length); i++) await new Promise((r) => setTimeout(r, 5));
		await new Promise((r) => setTimeout(r, 20));
	};
	return { dir, events, calls, make, settle };
}

test("failover flow: a limit before any tool ran holds the provider; the next run starts on the backup; automatic recovery tries the same run once there; nothing is resent after a tool ran", async () => {
	const backup = { provider: "xai", model: "" };
	// 1. automatic recovery off: the error is shown as written, the provider is held, the person told once, and the next message runs on the backup
	const a = rig({ backup }, (o, n) => o.onEvent(n === 1 ? { type: "error", engine: "pi", message: LIMIT } : { type: "done", text: "gatavs" }));
	const s = a.make();
	await s.send(null, "sveiki", []);
	await a.settle(s);
	assert.deepEqual(a.calls.map((c) => c.provider), ["openai-codex"], "no retry with automatic recovery off");
	assert.ok(a.events.some((e) => e.type === "error" && e.message === LIMIT), "the provider's own words are shown");
	const told = a.events.filter((e) => e.type === "text" && e.text.includes("sasniedza lietojuma limitu"));
	assert.equal(told.length, 1);
	assert.deepEqual(s.holds().map((h) => h.provider), ["openai-codex"]);
	await s.send(null, "vēlreiz", []);
	await a.settle(s);
	assert.deepEqual(a.calls.map((c) => c.provider), ["openai-codex", "xai"], "the next run starts on the backup, with no refused try first");
	assert.equal(a.events.filter((e) => e.type === "text" && e.text.includes("sasniedza lietojuma limitu")).length, 1, "told once for the stretch");
	// a restart keeps the hold: a new session on the same folder starts on the backup at once
	const again = a.make();
	await again.send(null, "pēc restartes", []);
	await a.settle(again);
	assert.equal(a.calls.at(-1)!.provider, "xai");
	again.releaseHold("openai-codex");
	assert.deepEqual(again.holds(), []);

	// 2. automatic recovery on: the same run is tried once on the backup, the first error is not shown, and the run ends well
	const b = rig({ backup, automaticRecovery: true }, (o, n) => o.onEvent(n === 1 ? { type: "error", engine: "pi", message: LIMIT } : { type: "done", text: "gatavs" }));
	const sb = b.make();
	await sb.send(null, "sveiki", []);
	await b.settle(sb);
	assert.deepEqual(b.calls.map((c) => c.provider), ["openai-codex", "xai"]);
	assert.equal(b.events.some((e) => e.type === "error"), false);
	assert.ok(b.events.some((e) => e.type === "done"));

	// 3. a tool had run: nothing is resent, whatever the setting; the hold is still recorded
	const c = rig({ backup, automaticRecovery: true }, (o, n) => {
		if (n === 1) {
			o.onEvent({ type: "tool", name: "write_note", id: "t1" });
			o.onEvent({ type: "error", engine: "pi", message: LIMIT });
		} else o.onEvent({ type: "done", text: "gatavs" });
	});
	const sc = c.make();
	await sc.send(null, "sveiki", []);
	await c.settle(sc);
	assert.deepEqual(c.calls.map((x) => x.provider), ["openai-codex"]);
	assert.ok(c.events.some((e) => e.type === "error"));
	assert.deepEqual(sc.holds().map((h) => h.provider), ["openai-codex"]);

	// 4. no backup chosen: the error stands, and the run is not moved anywhere
	const d = rig({}, (o) => o.onEvent({ type: "error", engine: "pi", message: LIMIT }));
	const sd = d.make();
	await sd.send(null, "sveiki", []);
	await d.settle(sd);
	assert.deepEqual(d.calls.map((x) => x.provider), ["openai-codex"]);
	assert.ok(d.events.some((e) => e.type === "text" && e.text.includes("nav izvēlēta rezerves AI")));
});
