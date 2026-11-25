// 22.1 a conversation too big for its engine session: the old session stays, the original is kept whole in the threads database, and the work goes on in a new,
// compacted session. Pure helpers (seed, plan, archive text), the database's archive table, and a whole thread run on a scripted Antigravity engine.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { archiveBody, archiveText, planSessionCompaction, SEED_TAIL, seedFromTranscript } from "../src/agent/session-compact.ts";
import { ThreadRunner } from "../src/agent/thread-runner.ts";
import { ANTIGRAVITY } from "../src/agent/antigravity/provider.ts";
import { CLAUDE_SUB } from "../src/agent/claude/provider.ts";
import type { AntigravityRunOptions } from "../src/agent/antigravity/run.ts";
import { ThreadStore } from "../src/core/threads.ts";
import type { ChatEntry } from "../src/shared/api.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const at = (n: number) => new Date(Date.UTC(2026, 10, 25, 8, n)).toISOString();
/** n lines alternating user / assistant, numbered, starting with a user line */
const chat = (n: number, from = 0): ChatEntry[] => Array.from({ length: n }, (_, i) => ({ role: (i + from) % 2 === 0 ? "user" : "assistant", text: `rinda ${i + from}`, at: at(i + from) }) as ChatEntry);

test("seed: without a compaction line it is the ten lines before the message being answered (as before)", () => {
	const all = chat(15);
	const s = seedFromTranscript(all);
	assert.equal(s.summary, null);
	assert.deepEqual(s.earlier.map((e) => e.text), all.slice(4, 14).map((e) => e.text));
});

test("seed: after a compaction line only the lines after it count; a line with `keep` brings back the lines it kept word for word", () => {
	// an old-style compaction line (the pi engine): nothing before it is replayed
	const old = [...chat(6), { role: "assistant", kind: "compaction", text: "SUMMARY", at: at(6) } as ChatEntry, ...chat(3, 7)];
	const a = seedFromTranscript(old);
	assert.equal(a.summary, "SUMMARY");
	assert.deepEqual(a.earlier.map((e) => e.text), ["rinda 7", "rinda 8"]);
	// a session compaction made while answering "rinda 11" (the last line before the compaction line): the 4 lines before it were kept
	const lines = chat(12);
	const made = [...lines, { role: "assistant", kind: "compaction", text: "SUMMARY 2", at: at(12), keep: 4 } as ChatEntry];
	// the run that opens the new session: the message is the last real line before the compaction line, so the seed is the 4 kept lines
	assert.deepEqual(seedFromTranscript(made).earlier.map((e) => e.text), lines.slice(7, 11).map((e) => e.text));
	// the next run: its new message follows the compaction line; the kept lines and the old message are still in the seed
	const next = [...made, { role: "user", text: "jauna", at: at(13) } as ChatEntry];
	assert.deepEqual(seedFromTranscript(next).earlier.map((e) => e.text), [...lines.slice(7, 12).map((e) => e.text)]);
	assert.equal(seedFromTranscript(next).summary, "SUMMARY 2");
});

test("plan: everything since the last compaction except the newest ten lines and the message being answered becomes summary", () => {
	const all = chat(30);
	const p = planSessionCompaction(all);
	assert.equal(p.previous, null);
	assert.equal(p.kept, SEED_TAIL);
	assert.equal(p.old.length, 29 - SEED_TAIL);
	assert.equal(p.covered.length, 29, "the archive covers the summarized and the kept lines");
	assert.equal(p.old[0].text, "rinda 0");
	// a second compaction continues from the first summary and does not summarize its lines again
	const second = [...all, { role: "assistant", kind: "compaction", text: "S1", at: at(30), keep: p.kept } as ChatEntry, ...chat(4, 31)];
	const p2 = planSessionCompaction(second);
	assert.equal(p2.previous, "S1");
	assert.ok(p2.old.every((e) => e.kind !== "compaction"));
	// a short conversation has nothing to summarize
	assert.deepEqual(planSessionCompaction(chat(5)).old, []);
});

test("archive: a pi conversation keeps its tool calls and results whole, screenshots become a marker; the readable text shows them", () => {
	const msgs = [
		{ role: "user", content: [{ type: "text", text: "Pārbaudi sienu" }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "Skatos." }, { type: "toolCall", id: "t1", name: "read_parameters", arguments: { id: 7 } }], timestamp: 2 },
		{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "X".repeat(9000) }], timestamp: 3 },
	] as never;
	const body = archiveBody(msgs);
	assert.ok(!body.includes("AAAA"), "no screenshot bytes in the database");
	const text = archiveText(body);
	assert.match(text, /\[Lietotājs\]: Pārbaudi sienu\n\[attēls\]/);
	assert.match(text, /\[Aģenta rīka izsaukums\]: read_parameters\(\{"id":7\}\)/);
	assert.ok(text.includes("X".repeat(9000)), "a tool answer is not cut");
	// an engine session's archive is the chat lines
	assert.match(archiveText(JSON.stringify(chat(2))), /^\[Lietotājs [^\]]+\]: rinda 0\n\n\[Aģents [^\]]+\]: rinda 1$/);
	assert.equal(archiveText("not json"), "not json");
});

test("threads database: an original is stored once and read back whole, only through its own thread", () => {
	const store = new ThreadStore(join(tmp("arch-"), "threads"));
	try {
		const a = store.create({ projectId: "BD999", agent: "lead", title: "A", startedBy: "user" });
		const b = store.create({ projectId: "BD999", agent: "lead", title: "B", startedBy: "user" });
		const id = store.archive(a.id, { engine: "antigravity", sessionId: "sess-1", tokens: { before: 250_000, after: 3_000 }, summary: "KOPSAVILKUMS", body: JSON.stringify(chat(4)) });
		const back = store.readArchive(a.id, id)!;
		assert.deepEqual({ engine: back.engine, sessionId: back.sessionId, tokens: back.tokens, summary: back.summary, threadId: back.threadId }, { engine: "antigravity", sessionId: "sess-1", tokens: { before: 250_000, after: 3_000 }, summary: "KOPSAVILKUMS", threadId: a.id });
		assert.equal(JSON.parse(back.body).length, 4);
		assert.equal(store.readArchive(b.id, id), null, "another thread cannot read it");
		assert.equal(store.readArchive(a.id, id + 99), null);
		const second = store.archive(a.id, { engine: "pi", tokens: { before: 1, after: 1 }, summary: "S", body: "[]" });
		assert.ok(second > id, "a second compaction is a new row; the first stays");
		assert.equal(store.readArchive(a.id, id)!.summary, "KOPSAVILKUMS");
	} finally {
		store.close();
	}
});

/** A runner whose Antigravity engine is a script: each real run opens a numbered session and reports a context size; a summarizer call (a session without the app's tools) answers with a fixed summary. */
function rig(contexts: number[], window?: number, provider: string = ANTIGRAVITY) {
	const dir = tmp("agy-compact-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `th-${p ?? "_"}`))), stores.get(p)!);
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec: AgentSpec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const seen: { resume?: string; system?: string; prompt: string; summarizer: boolean }[] = [];
	let sessions = 0;
	let run = 0;
	const antigravityRun = async (o: AntigravityRunOptions) => {
		const summarizer = /kopsavilkuma asistents/.test(o.systemPrompt ?? "");
		seen.push({ resume: o.resume, system: o.systemPrompt, prompt: o.prompt, summarizer });
		if (summarizer) {
			o.onEvent({ type: "done", text: "## Mērķis\nTESTA KOPSAVILKUMS" });
			return;
		}
		o.onSession?.(`sess-${++sessions}`);
		// the turn's billed counts are far above the window (many model calls); the context size is the server's own figure
		// the Claude engine reports one usage per model call, and the last one is the context; Antigravity states it apart
		const used = contexts[run++] ?? 1000;
		o.onEvent(provider === CLAUDE_SUB ? { type: "usage", input: 2, output: 500, cacheRead: used - 500 - 2 - 1000, cacheWrite: 1000, cost: null } : { type: "usage", input: 1_700_000, output: 13_000, cacheRead: 1_500_000, cacheWrite: 0, cost: null, context: { used, ...(window ? { window } : {}) } });
		o.onEvent({ type: "done", text: `atbilde ${run}` });
	};
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, provider, model: provider === CLAUDE_SUB ? "claude-sonnet-5-5" : "gemini-3.8-flash" }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		...(provider === CLAUDE_SUB ? { claudeRun: antigravityRun as never } : { antigravityRun: antigravityRun as never }),
		threads,
		locks: new LockRegistry(),
	});
	const thread = threads(null).create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	const send = async (text: string) => {
		const events: RunEvent[] = [];
		await runner.run({ runId: `r${seen.length}`, thread, spec, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async () => false });
		return events;
	};
	return { runner, thread, threads, seen, send, store: () => threads(null) };
}

test("meter: a turn that billed millions of tokens shows the context size the server reported, in the server's window", async () => {
	const r = rig([118_000], 1_000_000);
	await r.send("Sveiki");
	const c = await r.runner.context(r.thread);
	assert.equal(c.used, 118_000, "not input + cache + output of the turn");
	assert.equal(c.window, 1_000_000, "the window the server states");
	assert.equal(c.compactAt, 200_000);
	assert.equal(c.source, "usage");
	assert.ok(c.parts && c.parts.fixed > 0 && c.parts.fixed + c.parts.chat === 118_000, "base and conversation add up to the size, so a long conversation is not all called base");
});

test("a session past the line: the next message opens a NEW session from the summary; the old session id and the whole original are kept", async () => {
	const r = rig([250_000, 40_000]);
	const store = r.store();
	// a conversation with enough lines for a summary (everything before the last ten lines)
	for (const e of chat(24)) store.append(r.thread.id, e);
	await r.send("Pirmā ziņa");
	assert.deepEqual(r.seen.map((s) => s.resume), [undefined], "the first run opens a session");
	assert.equal((await r.runner.context(r.thread)).used, 250_000);

	const events = await r.send("Otrā ziņa");
	// the summarizer ran, then the real run on a NEW session (no resume) that carries the summary and the last lines
	assert.deepEqual(r.seen.map((s) => s.summarizer), [false, true, false]);
	const second = r.seen[2];
	assert.equal(second.resume, undefined, "not the old session");
	assert.match(second.system ?? "", /TESTA KOPSAVILKUMS/, "the new session starts from the summary");
	assert.match(second.system ?? "", /Iepriekšējā saruna šajā projektā/, "and the last lines word for word");
	assert.ok(events.some((e) => e.type === "compact" && e.phase === "done"));

	const log = store.transcript(r.thread.id);
	const line = log.find((e) => e.kind === "compaction")!;
	assert.equal(line.keep, SEED_TAIL);
	assert.equal(typeof line.archive, "number");
	const original = store.readArchive(r.thread.id, line.archive!)!;
	assert.equal(original.engine, "antigravity");
	assert.equal(original.sessionId, "sess-1", "the old session stays with the engine; its id is recorded");
	assert.equal(original.tokens.before, 250_000);
	const covered = JSON.parse(original.body) as ChatEntry[];
	assert.equal(covered[0].text, "rinda 0", "the original has the conversation from its start, not only what was summarized");
	assert.ok(covered.length >= 24);
	assert.equal((await r.runner.context(r.thread)).used, 40_000, "the new session's own size");
	assert.equal((await r.runner.context(r.thread)).compactions, 1);
});

test("a session under the line is left alone: the same session is resumed, nothing is archived", async () => {
	const r = rig([60_000, 61_000]);
	await r.send("a");
	await r.send("b");
	assert.deepEqual(r.seen.map((s) => [s.resume, s.summarizer]), [[undefined, false], ["sess-1", false]]);
	assert.equal(r.store().transcript(r.thread.id).some((e) => e.kind === "compaction"), false);
});

test("a summary that fails leaves the thread as it was: the run goes on in the old session and nothing is stored", async () => {
	const dir = tmp("agy-compact-fail-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `th-${p ?? "_"}`))), stores.get(p)!);
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec: AgentSpec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const resumes: (string | undefined)[] = [];
	let n = 0;
	const antigravityRun = async (o: AntigravityRunOptions) => {
		if (/kopsavilkuma asistents/.test(o.systemPrompt ?? "")) return void o.onEvent({ type: "error", engine: "pi", message: "modelis nepieejams" });
		resumes.push(o.resume);
		o.onSession?.("sess-1");
		o.onEvent({ type: "usage", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: null, context: { used: n++ === 0 ? 250_000 : 1000 } });
		o.onEvent({ type: "done", text: "ok" });
	};
	const runner = new ThreadRunner({ runtime: async () => rt, settings: () => ({ ...DEFAULT_SETTINGS, provider: ANTIGRAVITY, model: "gemini-3.8-flash" }), toolsServer: () => ({ command: "node", args: [], env: {} }), revit: () => null, ctx: { projectsDir: dir, dataDir: dir, appDir: dir }, agents: () => [spec], runsDir: join(dir, "runs"), chatDir: join(dir, "chat"), emit: () => undefined, antigravityRun: antigravityRun as never, threads, locks: new LockRegistry() });
	const thread = threads(null).create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	for (const e of chat(24)) threads(null).append(thread.id, e);
	const events: RunEvent[] = [];
	const go = (text: string) => runner.run({ runId: `r${resumes.length}`, thread, spec, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async () => false });
	await go("a");
	await go("b");
	assert.deepEqual(resumes, [undefined, "sess-1"], "the second run resumed the old session");
	assert.ok(events.some((e) => e.type === "compact" && e.phase === "failed"));
	assert.equal(threads(null).transcript(thread.id).some((e) => e.kind === "compaction"), false, "no compaction line without a summary");
	assert.equal(threads(null).readArchive(thread.id, 1), null, "nothing archived");
});

test("the Claude subscription follows the same rule: past the line the old session stays, the original is stored, a new session starts from the summary", async () => {
	const r = rig([250_000, 40_000], undefined, CLAUDE_SUB);
	const store = r.store();
	for (const e of chat(24)) store.append(r.thread.id, e);
	await r.send("Pirmā ziņa");
	assert.equal((await r.runner.context(r.thread)).used, 250_000, "the last model call's own count");
	await r.send("Otrā ziņa");
	assert.deepEqual(r.seen.map((s) => [s.summarizer, s.resume]), [[false, undefined], [true, undefined], [false, undefined]], "summary, then a NEW session (no resume)");
	assert.match(r.seen[2].system ?? "", /TESTA KOPSAVILKUMS/);
	const line = store.transcript(r.thread.id).find((e) => e.kind === "compaction")!;
	const original = store.readArchive(r.thread.id, line.archive!)!;
	assert.deepEqual({ engine: original.engine, sessionId: original.sessionId }, { engine: "claude", sessionId: "sess-1" });
	assert.equal(JSON.parse(original.body)[0].text, "rinda 0");
	// the manual button does the same
	const before = store.transcript(r.thread.id).filter((e) => e.kind === "compaction").length;
	await r.runner.compactNow(r.thread);
	assert.equal(store.transcript(r.thread.id).filter((e) => e.kind === "compaction").length, before + 1);
});
