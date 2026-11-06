// 0.2 carried pi harness: event mapping on pi's own event shapes, credential store rules.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { PiCredentialStore } from "../src/agent/pi/credentials.ts";
import { newPiState, piEvents } from "../src/agent/pi/events.ts";
import { effortsOf } from "../src/agent/pi/models.ts";
import { tmp } from "./helpers.ts";

test("pi events: a streamed answer becomes turn, text, done", () => {
	const st = newPiState();
	const out = [
		...piEvents({ type: "turn_start" } as never, st),
		...piEvents({ type: "message_start", message: { role: "assistant" } } as never, st),
		...piEvents({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Labdien" } } as never, st),
		...piEvents({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Labdien" }], stopReason: "stop" } } as never, st),
		...piEvents({ type: "agent_end" } as never, st),
	];
	assert.deepEqual(out, [{ type: "turn", n: 1 }, { type: "text", text: "Labdien" }, { type: "done", text: "Labdien" }]);
});

test("pi events: a provider error is passed through unchanged and no done follows", () => {
	const st = newPiState();
	const out = [
		...piEvents({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate limited" } } as never, st),
		...piEvents({ type: "agent_end" } as never, st),
	];
	assert.deepEqual(out, [{ type: "error", engine: "pi", message: "429 rate limited" }]);
});

test("pi events: tool start and end carry the tool name", () => {
	const st = newPiState();
	const a = piEvents({ type: "tool_execution_start", toolCallId: "t1", toolName: "get_focus", args: {} } as never, st);
	const b = piEvents({ type: "tool_execution_end", toolCallId: "t1", toolName: "get_focus", result: { content: [{ type: "text", text: "nekas" }] }, isError: false } as never, st);
	assert.equal(a[0].type, "tool");
	assert.deepEqual(b[0], { type: "tool_result", name: "get_focus", id: "t1", ok: true, detail: undefined, output: "nekas" });
});

test("credentials: Claude subscription tokens are refused, API key is used", async () => {
	const store = new PiCredentialStore({ path: join(tmp(), "c.json"), apiKey: (p) => (p === "anthropic" ? "sk-test" : null) });
	await assert.rejects(store.modify("anthropic", async () => ({ type: "oauth", access: "a", refresh: "r", expires: 0 }) as never), /not permitted/);
	assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "sk-test" });
	assert.equal(await store.read("openai-codex"), undefined);
});

test("models: effort levels only where the model says so", () => {
	assert.deepEqual(effortsOf({ reasoning: false }), []);
	assert.deepEqual(effortsOf({ reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }), ["off", "minimal", "low", "medium", "high", "xhigh"]);
});
