// 22.2 a model turn that goes silent: the pi and the Claude engines stop it and ask again once, a second silence ends the run in words, a running tool is never a stall.
// (The Antigravity engine's own watchdog is tested in 22.0.)
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { createClaudeRun } from "../src/agent/claude/run.ts";
import { createPiRuntime, lookupPiModel, runPi } from "../src/agent/pi/index.ts";
import { dropStoppedTail } from "../src/agent/pi/retry.ts";
import { STALL_RESUME, StallWatch, stallError } from "../src/agent/stall.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("watchdog: silence past the limit fires once; a sign of life, or a tool going, holds it off; reset by start", async () => {
	let fired = 0;
	const w = new StallWatch(120, () => void fired++);
	w.start();
	await wait(70);
	w.alive();
	await wait(70);
	assert.equal(fired, 0, "a sign of life restarts the count");
	w.tool(1);
	await wait(300);
	assert.equal(fired, 0, "a tool that is going is not silence");
	w.tool(-1);
	await wait(300);
	assert.equal(fired, 1);
	assert.equal(w.stalled, true);
	await wait(200);
	assert.equal(fired, 1, "it fires once until it is started again");
	w.start();
	assert.equal(w.stalled, false);
	w.stop();
});

test("a transcript loses its trailing aborted or failed assistant turns, nothing else", () => {
	const a = (stopReason: string) => ({ role: "assistant", content: [], stopReason }) as never;
	const user = { role: "user", content: "x" } as never;
	assert.deepEqual(dropStoppedTail([user, a("stop"), user, a("aborted"), a("error")]).length, 3);
	assert.equal(dropStoppedTail([user, a("stop")]).length, 2);
});

const message = (text: string, stopReason: "stop" | "aborted" = "stop"): AssistantMessage =>
	({ role: "assistant", content: text ? [{ type: "text", text }] : [], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason, timestamp: Date.now() }) as AssistantMessage;

/** A scripted model: `behaviours` per call: "silent" starts a message and says nothing more until it is aborted; "answer" answers. */
function scripted(behaviours: ("silent" | "answer")[]) {
	let n = 0;
	const calls: { messages: number }[] = [];
	const fn = async (_model: unknown, context: { messages: unknown[] }, options?: { signal?: AbortSignal }) => {
		const stream = createAssistantMessageEventStream();
		const kind = behaviours[n++] ?? "answer";
		calls.push({ messages: context.messages.length });
		stream.push({ type: "start", partial: message("") });
		if (kind === "answer") {
			queueMicrotask(() => {
				stream.push({ type: "text_start", contentIndex: 0, partial: message("") });
				stream.push({ type: "text_delta", contentIndex: 0, delta: "gatavs", partial: message("gatavs") });
				stream.push({ type: "text_end", contentIndex: 0, content: "gatavs", partial: message("gatavs") });
				stream.push({ type: "done", reason: "stop", message: message("gatavs") });
			});
		} else {
			options?.signal?.addEventListener("abort", () => stream.push({ type: "error", reason: "aborted", error: { ...message("", "aborted"), errorMessage: "aborted" } }), { once: true });
		}
		return stream;
	};
	return { fn: fn as never, calls };
}

const piRun = async (behaviours: ("silent" | "answer")[], stallMs = 300) => {
	const rt = createPiRuntime({ path: join(tmp("stall-pi-"), "pi.json"), apiKey: () => null });
	const model = lookupPiModel(rt, "anthropic", "claude-sonnet-5-5");
	const { fn, calls } = scripted(behaviours);
	const events: RunEvent[] = [];
	await runPi({ runtime: rt, model, prompt: "Sveiki", mcp: {}, signal: new AbortController().signal, onEvent: (e) => events.push(e), streamFn: fn, stallMs });
	return { events, calls };
};

test("pi: a silent model turn is stopped and asked again once; the chat says so and the run ends with the answer, not an error", async () => {
	const { events, calls } = await piRun(["silent", "answer"]);
	assert.equal(events.some((e) => e.type === "error"), false, JSON.stringify(events.filter((e) => e.type === "error")));
	assert.ok(events.some((e) => e.type === "text" && /ilgi neatbildēja/.test(e.text)));
	assert.deepEqual(events.filter((e) => e.type === "done").map((e) => (e as { text: string }).text), ["gatavs"], "one end, with the answer");
	assert.equal(calls.length, 2);
	assert.equal(calls[1].messages, calls[0].messages, "the second call carries the same transcript: the stopped turn is not in it");
});

test("pi: silent twice ends as an error in words", async () => {
	const { events } = await piRun(["silent", "silent"]);
	const errors = events.filter((e) => e.type === "error") as Extract<RunEvent, { type: "error" }>[];
	assert.deepEqual(errors.map((e) => e.message), [stallError(300)]);
	assert.equal(events.some((e) => e.type === "done"), false);
});

// ---- the Claude engine, over a scripted SDK `query` ----------------------------------------------------------------------------------------------

/** What the SDK's query returns: an async iterable of messages. "silent": the session starts, then nothing until its abort controller fires (the loop then throws, as the SDK's does). */
function scriptedQuery(behaviours: ("silent" | "answer")[]) {
	let n = 0;
	const resumes: (string | undefined)[] = [];
	const prompts: string[] = [];
	const fn = ({ prompt, options }: { prompt: AsyncIterable<{ message: { content: { type: string; text?: string }[] } }>; options: { abortController: AbortController; resume?: string } }) => {
		const kind = behaviours[n++] ?? "answer";
		resumes.push(options.resume);
		void (async () => {
			for await (const m of prompt) prompts.push(m.message.content.find((c) => c.type === "text")?.text ?? "");
		})();
		return (async function* () {
			yield { type: "system", subtype: "init", session_id: "cs-1" };
			if (kind === "silent") {
				await new Promise<void>((resolve) => options.abortController.signal.addEventListener("abort", () => resolve(), { once: true }));
				throw new Error("aborted by the watchdog");
			}
			yield { type: "result", subtype: "success", is_error: false, result: "gatavs", session_id: "cs-1" };
		})();
	};
	return { fn: fn as never, resumes, prompts };
}

const claudeRun = async (behaviours: ("silent" | "answer")[], stallMs = 300, extra: { signal?: AbortSignal } = {}) => {
	const rt = createPiRuntime({ path: join(tmp("stall-cl-"), "pi.json"), apiKey: () => null });
	const model = lookupPiModel(rt, "anthropic", "claude-sonnet-5-5");
	const { fn, resumes, prompts } = scriptedQuery(behaviours);
	const run = createClaudeRun({ token: () => "x", configDir: tmp("cfg-"), cwd: tmp("cwd-"), clientApp: "test/0", query: fn });
	const events: RunEvent[] = [];
	const sessions: string[] = [];
	await run({ runtime: rt, model, prompt: "Sveiki", mcp: {}, signal: extra.signal ?? new AbortController().signal, onEvent: (e) => events.push(e), onSession: (s) => sessions.push(s), stallMs } as never);
	return { events, resumes, prompts, sessions };
};

test("claude: a silent turn is stopped and the same session is asked to carry on, once", async () => {
	const { events, resumes, prompts, sessions } = await claudeRun(["silent", "answer"]);
	assert.equal(events.some((e) => e.type === "error"), false, JSON.stringify(events.filter((e) => e.type === "error")));
	assert.ok(events.some((e) => e.type === "text" && /ilgi neatbildēja/.test(e.text)));
	assert.deepEqual(events.filter((e) => e.type === "done").map((e) => (e as { text: string }).text), ["gatavs"]);
	assert.deepEqual(resumes, [undefined, "cs-1"], "the second query resumes the session");
	assert.equal(prompts[1], STALL_RESUME);
	assert.deepEqual(sessions, ["cs-1"], "the session is announced once");
});

test("claude: silent twice ends as an error in words; a stop by the user is still just a stop", async () => {
	const twice = await claudeRun(["silent", "silent"]);
	assert.deepEqual((twice.events.filter((e) => e.type === "error") as Extract<RunEvent, { type: "error" }>[]).map((e) => e.message), [stallError(300)]);
	const ac = new AbortController();
	setTimeout(() => ac.abort(), 100);
	const stopped = await claudeRun(["silent"], 60_000, { signal: ac.signal });
	assert.deepEqual((stopped.events.filter((e) => e.type === "error") as Extract<RunEvent, { type: "error" }>[]).map((e) => e.message), ["aborted"]);
});
