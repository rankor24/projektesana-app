// 0.6 context: what the model carries, the limits it states, dropping old screenshots, trimming tool results, compaction.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { compactMessages, findCut, serializeConversation, summaryOf, SUMMARY_HEADER, type Complete } from "../src/agent/compact.ts";
import { breakdown, compactLine, countImages, estimateContext, estimateMessageTokens, IMAGE_GONE, IMAGE_TOKENS, imageLimits, pruneImages, trimToolResults } from "../src/agent/context.ts";
import { createPiRuntime, lookupPiModel } from "../src/agent/pi/models.ts";
import { tmp } from "./helpers.ts";
import { join } from "node:path";

const T = (text: string, ts = 1) => ({ role: "user", content: [{ type: "text", text }], timestamp: ts }) as AgentMessage;
const TI = (text: string, ts = 1) => ({ role: "user", content: [{ type: "text", text }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: ts }) as AgentMessage;
const usage = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: total, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const A = (text: string, ts = 2, total = 0, stopReason = "stop") => ({ role: "assistant", content: [{ type: "text", text }], usage: usage(total), stopReason, timestamp: ts }) as unknown as AgentMessage;
const CALL = (ts = 2) => ({ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "get_focus", arguments: { a: 1 } }], usage: usage(0), stopReason: "toolUse", timestamp: ts }) as unknown as AgentMessage;
const R = (text: string, ts = 3) => ({ role: "toolResult", toolCallId: "c1", toolName: "get_focus", content: [{ type: "text", text }], isError: false, timestamp: ts }) as unknown as AgentMessage;
const SYS = { role: "system", content: "prompts", toolsAdded: [{ name: "x", description: "y".repeat(350), parameters: {} }], timestamp: 0 } as unknown as AgentMessage;

test("limits: read from the model's own catalog entry, none for a model without images", () => {
	const rt = createPiRuntime({ path: join(tmp(), "pi.json"), apiKey: () => null });
	const claude = imageLimits(lookupPiModel(rt, "anthropic", "claude-sonnet-5-5"))!;
	assert.deepEqual(claude, { maxEdge: 2000, maxBytes: 4_718_592, maxPerRequest: 600, maxRequestBytes: 33_554_432 });
	const gemini = imageLimits(lookupPiModel(rt, "google", "gemini-pro-latest"))!;
	assert.equal(gemini.maxRequestBytes, 20_971_520, "Gemini refuses requests over 20 MB");
	assert.equal(imageLimits(lookupPiModel(rt, "openai", "o3-mini")), null);
});

test("compact line: 80% of the window, never above 200K", () => {
	assert.equal(compactLine(272_000), 200_000);
	assert.equal(compactLine(200_000), 160_000);
	assert.equal(compactLine(1_000_000), 200_000);
	assert.equal(compactLine(100_000), 80_000);
});

test("estimate: the provider's count of the last answer plus an estimate of what came after", () => {
	const ms = [T("sveiki", 1), A("labdien", 2, 5000), T("a".repeat(350), 3)];
	const e = estimateContext(ms);
	assert.equal(e.source, "usage");
	assert.equal(e.trailing, 100);
	assert.equal(e.tokens, 5100);
	assert.equal(estimateContext([T("a".repeat(350))]).source, "estimate");
});

test("estimate: usage from before a summary was inserted is stale and ignored", () => {
	// the kept answer reports 90K; the summary message (newer timestamp) came after it, so 90K is no longer true
	const ms = [T("kopsavilkums + jautājums", 100), A("atbilde", 5, 90_000)];
	const e = estimateContext(ms);
	assert.equal(e.source, "estimate");
	assert.ok(e.tokens < 100);
});

test("estimate: an image counts like pi counts it, a system message counts its tools", () => {
	assert.equal(estimateMessageTokens(TI("")), IMAGE_TOKENS);
	assert.equal(estimateMessageTokens(SYS), Math.ceil((6 + JSON.stringify((SYS as never as { toolsAdded: unknown }).toolsAdded).length) / 3.5));
});

test("breakdown: fixed, chat, attached documents, tools and images are told apart", () => {
	const doc = "--- pielikums: a.txt (TXT) ---\n" + "x".repeat(700) + "\n--- beigas: a.txt ---";
	const b = breakdown([SYS, T("jautājums\n\n" + doc), TI("skaties"), CALL(), R("z".repeat(350)), A("gatavs")]);
	assert.ok(b.fixed > 100 && b.docs >= 200 && b.tools >= 100 && b.chat > 0);
	assert.equal(b.imageCount, 1);
	assert.equal(b.images, IMAGE_TOKENS);
});

test("pruneImages: nothing happens until more than keep + slack messages carry images; then only the newest keep stay", () => {
	const ms = Array.from({ length: 6 }, (_, i) => TI(`ekrāns ${i}`, i));
	assert.equal(pruneImages(ms, { keep: 3, slack: 3 }).pruned, 0, "6 ≤ 3+3: the cache-friendly prefix is untouched");
	const more = [...ms, TI("ekrāns 6", 6)];
	const r = pruneImages(more, { keep: 3, slack: 3 });
	assert.equal(r.pruned, 4);
	assert.equal(countImages(r.messages), 3);
	const first = r.messages[0] as unknown as { content: { type: string; text?: string }[] };
	assert.deepEqual(first.content.map((b) => b.type), ["text", "text"]);
	assert.equal(first.content[1].text, IMAGE_GONE);
	assert.equal(pruneImages(r.messages, { keep: 3, slack: 3 }).pruned, 0, "already pruned stays pruned and costs nothing");
	assert.equal(countImages(more), 7, "the input is not changed");
});

test("trimToolResults: old long results shrink to their beginning, recent ones and short ones stay", () => {
	const big = "k".repeat(9000);
	const ms = [T("a"), CALL(), R(big), A("ok"), ...Array.from({ length: 20 }, (_, i) => T(`z${i}`)), CALL(), R(big)];
	const r = trimToolResults(ms, { recent: 16, maxChars: 4000, headChars: 1500 });
	assert.equal(r.trimmed, 1);
	const old = (r.messages[2] as unknown as { content: { text: string }[] }).content[0].text;
	assert.match(old, /\[… saīsināts vēlāk: 7500 no 9000 zīmēm\]$/);
	assert.equal((r.messages[r.messages.length - 1] as unknown as { content: { text: string }[] }).content[0].text.length, 9000);
});

// ---- compaction ----------------------------------------------------------------------------------------------------

const reply = (text: string, stopReason = "stop", extra: object = {}) => ({ role: "assistant", content: [{ type: "text", text }], stopReason, usage: usage(10), timestamp: 1, ...extra }) as unknown as AssistantMessage;
const model = {} as never;
const base = { model, maxInputTokens: 100_000, keepRecentTokens: 100 };

function chat(turns: number): AgentMessage[] {
	const out: AgentMessage[] = [SYS];
	for (let i = 0; i < turns; i++) out.push(T(`jautājums ${i} ${"v".repeat(200)}`, 10 + i * 10), CALL(11 + i * 10), R(`rezultāts ${i}`, 12 + i * 10), A(`atbilde ${i}`, 13 + i * 10, 1000));
	return out;
}

test("findCut: only at the start of a turn, never splits a tool call from its result; system stays out", () => {
	const ms = chat(6);
	const at = findCut(ms, 150)!;
	assert.equal((ms[at] as { role: string }).role, "user");
	assert.ok(at > 1);
	assert.equal(findCut(chat(1), 10), null, "one turn: nothing to summarize");
	assert.equal(findCut(chat(6), 1_000_000), null, "everything fits in the recent part");
});

test("serializeConversation: images become a marker, thinking is left out, tool results are cut", () => {
	const s = serializeConversation([TI("skaties"), A("redzu"), CALL(), R("q".repeat(5000))]);
	assert.match(s, /\[Lietotājs\]: skaties\n\[attēls\]/);
	assert.match(s, /\[Aģents\]: redzu/);
	assert.match(s, /\[Aģenta rīku izsaukumi\]: get_focus\(a=1\)/);
	assert.match(s, /\[… vēl 3000 zīmes\]/);
});

test("compact: the old part becomes a summary merged into the first kept user message; system and the recent turns stay", async () => {
	const asked: string[] = [];
	const complete: Complete = async (_m, system, user) => (asked.push(user), reply("## Mērķis\nTelpu pārbaude"));
	const ms = chat(6);
	const r = (await compactMessages(ms, { ...base, complete, now: 99_999 }))!;
	assert.ok(r);
	assert.equal((r.messages[0] as { role: string }).role, "system", "the system message (prompt + tools) is kept");
	const first = r.messages[1] as unknown as { role: string; timestamp: number; content: { text: string }[] };
	assert.equal(first.role, "user");
	assert.equal(first.timestamp, 99_999, "newer than every kept answer");
	assert.ok(first.content[0].text.startsWith(SUMMARY_HEADER));
	assert.match(first.content[0].text, /Telpu pārbaude/);
	assert.match(first.content[1].text, /^jautājums \d/, "the user's own words follow, unchanged");
	assert.ok(r.messages.length < ms.length);
	assert.ok(r.tokensAfter < r.tokensBefore);
	assert.match(asked[0], /<conversation>[\s\S]*jautājums 0[\s\S]*<\/conversation>/);
	assert.doesNotMatch(asked[0], /previous-summary/);
	assert.equal(estimateContext(r.messages).source, "estimate", "the kept answers' old usage no longer counts");
});

test("compact twice: the second summary updates the first instead of summarizing a summary", async () => {
	const prompts: string[] = [];
	const complete: Complete = async (_m, _s, user) => (prompts.push(user), reply(prompts.length === 1 ? "## Mērķis\nPIRMAIS" : "## Mērķis\nPIRMAIS + JAUNAIS"));
	const once = (await compactMessages(chat(6), { ...base, complete }))!;
	const longer = [...once.messages, ...chat(6).slice(1)];
	const twice = (await compactMessages(longer, { ...base, complete }))!;
	assert.match(prompts[1], /<previous-summary>\nUzr[\s\S]*|<previous-summary>\n## Mērķis\nPIRMAIS\n<\/previous-summary>/);
	assert.match(prompts[1], /Iepriekš ir JAUNI sarunas ziņojumi/);
	assert.doesNotMatch(prompts[1].split("<conversation>")[1].split("</conversation>")[0], /KOPSAVILKUMA BEIGAS/, "the old summary is not part of the conversation text");
	const text = (twice.messages[1] as unknown as { content: { text: string }[] }).content[0].text;
	assert.equal(summaryOf(twice.messages[1]), "## Mērķis\nPIRMAIS + JAUNAIS");
	assert.equal(text.split(SUMMARY_HEADER).length, 2, "exactly one summary block");
});

test("compact: a summary that stopped on error or length, or has no text, is never used", async () => {
	const fail = (r: AssistantMessage): Complete => async () => r;
	await assert.rejects(compactMessages(chat(6), { ...base, complete: fail(reply("", "error", { errorMessage: "429 pārslodze" })) }), /Kopsavilkums neizdevās: 429 pārslodze/);
	await assert.rejects(compactMessages(chat(6), { ...base, complete: fail(reply("## Mērķ", "length")) }), /pārtrūka/);
	await assert.rejects(compactMessages(chat(6), { ...base, complete: fail(reply("   ")) }), /neatbildēja ar tekstu/);
	await assert.rejects(compactMessages(chat(6), { ...base, complete: fail({ ...reply(""), content: [{ type: "toolCall", id: "x", name: "y", arguments: {} }] } as never) }), /izsaukt rīku/);
	assert.equal(await compactMessages(chat(1), { ...base, complete: async () => reply("x") }), null);
});
