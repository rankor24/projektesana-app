// 0.2 pi harness: a model turn that fails on the wire (fetch failed, socket hang up) is restarted, not the end of the run.
// Driven through the real runPi and pi's real Agent; only the model's stream is scripted.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, type RetryPolicy } from "@earendil-works/pi-ai";
import { runPi } from "../src/agent/pi/run.ts";
import { dropFailedTail } from "../src/agent/pi/retry.ts";
import type { RunEvent } from "../src/shared/types.ts";

const FAST: RetryPolicy = { enabled: true, maxRetries: 2, baseDelayMs: 5, maxAgentDelayMs: 20 };
const model = { id: "fake", name: "fake", api: "fake", provider: "fake", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, baseUrl: "" } as never;

type Step = { throw: string } | { error: string } | { text: string };

/** A runtime whose model plays the steps in order: throw = the request fails, error = the stream fails, text = an answer. */
function scripted(steps: Step[]) {
	let calls = 0;
	const streamSimple = async () => {
		const s = steps[Math.min(calls++, steps.length - 1)];
		if ("throw" in s) throw new TypeError(s.throw);
		const stream = createAssistantMessageEventStream();
		if ("error" in s) stream.push({ type: "error", reason: "error", error: fauxAssistantMessage("", { stopReason: "error", errorMessage: s.error }) });
		else stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage(s.text) });
		return stream;
	};
	return { runtime: { models: { streamSimple } } as never, calls: () => calls };
}

async function run(steps: Step[], signal = new AbortController().signal) {
	const m = scripted(steps);
	const events: RunEvent[] = [];
	let kept: AgentMessage[] = [];
	await runPi({ runtime: m.runtime, model, prompt: "Pārskati vēlreiz", mcp: {}, signal, retry: FAST, onEvent: (e) => events.push(e), onMessages: (ms) => (kept = ms) });
	return { events, kept, calls: m.calls(), types: events.map((e) => e.type) };
}

const failedTurns = (ms: AgentMessage[]) => ms.filter((m) => (m as { stopReason?: string }).stopReason === "error").length;

test("retry: fetch failed, then an answer — the run restarts the turn and ends with done, not error", async () => {
	const r = await run([{ throw: "fetch failed" }, { text: "Labdien" }]);
	assert.equal(r.calls, 2);
	assert.ok(!r.types.includes("error"), `no error event: ${r.types.join(",")}`);
	assert.deepEqual(r.events.find((e) => e.type === "retry"), { type: "retry", attempt: 1, of: 2, delayMs: 5, message: "fetch failed" });
	assert.deepEqual(r.events.at(-1), { type: "done", text: "Labdien" });
	assert.equal(failedTurns(r.kept), 0, "the failed turn is not kept in the conversation");
	assert.equal((r.kept.at(-1) as { role: string }).role, "assistant");
});

test("retry: a stream that dies mid-way is restarted too", async () => {
	const r = await run([{ error: "socket hang up" }, { text: "Gatavs" }]);
	assert.equal(r.calls, 2);
	assert.deepEqual(r.events.at(-1), { type: "done", text: "Gatavs" });
});

test("retry: gives up after the budget with the provider's own text, and the next message starts clean", async () => {
	const r = await run([{ throw: "fetch failed" }]);
	assert.equal(r.calls, 3, "first try + 2 restarts");
	assert.deepEqual(r.events.filter((e) => e.type === "retry").map((e) => (e as { attempt: number }).attempt), [1, 2]);
	assert.deepEqual(r.events.at(-1), { type: "error", engine: "pi", message: "fetch failed" });
	assert.ok(!r.types.includes("done"));
	assert.equal(failedTurns(r.kept), 0);
});

test("retry: a deterministic error (bad request, quota) is not retried", async () => {
	for (const msg of ["400 invalid_request_error: messages: text content blocks must be non-empty", "429 insufficient_quota"]) {
		const r = await run([{ error: msg }, { text: "nekad" }]);
		assert.equal(r.calls, 1, msg);
		assert.deepEqual(r.types, ["turn", "error"], msg);
	}
});

test("retry: Apturēt during the wait ends the run without another request", async () => {
	const ac = new AbortController();
	const slow: RetryPolicy = { ...FAST, baseDelayMs: 5_000, maxAgentDelayMs: 5_000 };
	const m = scripted([{ throw: "fetch failed" }, { text: "nekad" }]);
	const events: RunEvent[] = [];
	const done = runPi({ runtime: m.runtime, model, prompt: "x", mcp: {}, signal: ac.signal, retry: slow, onEvent: (e) => (events.push(e), e.type === "retry" && ac.abort()) });
	await done;
	assert.equal(m.calls(), 1);
	assert.deepEqual(events.at(-1), { type: "error", engine: "pi", message: "aborted" });
});

test("dropFailedTail: only trailing failed assistant turns go", () => {
	const u = { role: "user", content: "a" } as never;
	const ok = { role: "assistant", stopReason: "stop", content: [] } as never;
	const bad = { role: "assistant", stopReason: "error", content: [] } as never;
	assert.deepEqual(dropFailedTail([u, bad, ok, u, bad, bad]), [u, bad, ok, u]);
	assert.deepEqual(dropFailedTail([u, ok]), [u, ok]);
});
