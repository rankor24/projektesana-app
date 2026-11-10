// 0.6 the session's context handling: the meter's numbers, compaction at the line and by hand, and what happens when the
// model still says the request is too big. The model and the agent loop are scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { measureAttachment, prepareAttachments } from "../src/agent/attachments.ts";
import { SUMMARY_HEADER, type Complete } from "../src/agent/compact.ts";
import { compactLine, estimateContext, IMAGE_TOKENS, imageLimits } from "../src/agent/context.ts";
import { createPiRuntime, lookupPiModel, type PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { ChatAttachment } from "../src/shared/api.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { FIX, tmp } from "./helpers.ts";

type Run = (o: PiRunOptions) => Promise<void>;

const T = (text: string, ts: number) => ({ role: "user", content: [{ type: "text", text }], timestamp: ts }) as AgentMessage;
const A = (text: string, ts: number) => ({ role: "assistant", content: [{ type: "text", text }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: ts }) as unknown as AgentMessage;
const SYS = { role: "system", content: "prompts", timestamp: 0 } as unknown as AgentMessage;
/** n turns of about `tokens` each (3.5 chars per token) */
const turns = (n: number, tokens: number): AgentMessage[] => [SYS, ...Array.from({ length: n }, (_, i) => [T(`jautājums ${i} ${"v".repeat(Math.floor(tokens * 3.5))}`, 10 + i * 10), A(`atbilde ${i}`, 11 + i * 10)]).flat()];
const reply = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 1 }) as unknown as AssistantMessage;

function setup(runAgent?: Run, complete?: Complete) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const events: RunEvent[] = [];
	let finish!: () => void;
	const finished = new Promise<void>((r) => (finish = r));
	const asked: string[] = [];
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: (_id, e) => {
			events.push(e);
			if (e.type === "done" || e.type === "error") finish();
		},
		complete: complete ?? (async (_m, _s, user) => (asked.push(user), reply("## Mērķis\nTelpu pārbaude"))),
		runAgent,
	});
	const key = () => `${DEFAULT_SETTINGS.provider}/${DEFAULT_SETTINGS.model}`;
	// the in-memory conversation of the open chat of "no project"
	const inner = s as unknown as { conversations: Map<string, { messages: AgentMessage[] }>; convKey: (p: string | null) => string };
	const seed = (messages: AgentMessage[]) => inner.conversations.set(inner.convKey(null), { key: key(), messages, lastAdded: null } as never);
	const stored = () => inner.conversations.get(inner.convKey(null))!.messages;
	return { s, dir, rt, events, finished, asked, seed, stored };
}

test("context: before any conversation only the fixed part is known, and it is the measured 5K", async () => {
	const { s, rt } = setup();
	const c = await s.context(null, { text: "sveiki", focus: [] });
	const m = lookupPiModel(rt, DEFAULT_SETTINGS.provider, DEFAULT_SETTINGS.model);
	assert.equal(c.window, m.contextWindow);
	assert.equal(c.compactAt, compactLine(m.contextWindow));
	assert.equal(c.used, null);
	assert.equal(c.source, "none");
	assert.ok(c.fixedEstimate > 4500 && c.fixedEstimate < 9000, `fixed ${c.fixedEstimate} (prompt + rules + skills + 36 tool declarations)`);
	assert.equal(c.draft?.text, 2);
	assert.ok(c.draft!.focus > 0, "'Fokuss: nekas' is sent with every message too");
});

test("context: with a conversation the provider's count wins and the parts add up to where it went", async () => {
	const { s, seed } = setup();
	const ms = turns(3, 1000);
	(ms[ms.length - 1] as unknown as { usage: { totalTokens: number } }).usage.totalTokens = 7000;
	seed(ms);
	const c = await s.context(null);
	assert.equal(c.source, "usage");
	assert.equal(c.used, 7000);
	assert.equal(c.messages, ms.length);
	assert.ok(c.parts!.chat > 2500);
});

test("compact by hand: summary replaces the old turns, the transcript keeps the summary, the meter drops", async () => {
	const { s, seed, stored } = setup();
	seed(turns(6, 15_000));
	const before = (await s.context(null)).used!;
	const r = await s.compactNow(null);
	assert.ok(r.after < r.before && r.before === before);
	const kept = stored();
	assert.equal((kept[0] as { role: string }).role, "system");
	assert.ok(JSON.stringify(kept[1]).includes(SUMMARY_HEADER), "the summary block is in the history");
	const h = s.history(null);
	assert.equal(h[h.length - 1].kind, "compaction");
	assert.match(h[h.length - 1].text, /Telpu pārbaude/);
	assert.deepEqual(h[h.length - 1].tokens, { before: r.before, after: r.after });
	const c = await s.context(null);
	assert.equal(c.compactions, 1);
	assert.ok(c.used! < before);
	await assert.rejects(setup().s.compactNow(null), /Nav ko saspiest/, "no conversation in memory");
});

test("run: above the line the older conversation is summarized before the request, and the run gets the short history", async () => {
	let got: AgentMessage[] = [];
	const run: Run = async (o) => {
		got = o.history ?? [];
		o.onMessages?.([...got, T("x", 1)]);
		o.onEvent({ type: "done", text: "gatavs" });
	};
	const t = setup(run);
	t.seed(turns(7, 30_000)); // ≈ 210K: over the 200K line
	assert.ok(estimateContext(t.stored()).tokens > compactLine(272_000));
	await t.s.send(null, "turpini", []);
	await t.finished;
	assert.deepEqual(t.events.filter((e) => e.type === "compact").map((e) => (e as { phase: string }).phase), ["start", "done"]);
	assert.ok(JSON.stringify(got[1]).includes(SUMMARY_HEADER), "the summary block is in the history");
	assert.ok(estimateContext(got).tokens < 60_000);
	assert.equal(t.asked.length, 1);
});

test("run: below the line nothing is summarized", async () => {
	const run: Run = async (o) => o.onEvent({ type: "done", text: "gatavs" });
	const t = setup(run);
	t.seed(turns(3, 10_000));
	await t.s.send(null, "turpini", []);
	await t.finished;
	assert.equal(t.events.filter((e) => e.type === "compact").length, 0);
	assert.equal(t.asked.length, 0);
});

const OVERFLOW = "prompt is too long: 312000 tokens > 200000 maximum";

test("run: the model says too big before any tool ran → the error is held back, the history is summarized harder, the run repeated once", async () => {
	const calls: AgentMessage[][] = [];
	const run: Run = async (o) => {
		calls.push(o.history ?? []);
		if (calls.length === 1) return o.onEvent({ type: "error", engine: "pi", message: OVERFLOW });
		o.onEvent({ type: "done", text: "gatavs pēc saspiešanas" });
	};
	const t = setup(run);
	t.seed(turns(6, 30_000)); // ≈ 180K: under the line, so the estimate did not catch it
	await t.s.send(null, "turpini", []);
	await t.finished;
	assert.equal(calls.length, 2);
	assert.ok(JSON.stringify(calls[1][1]).includes(SUMMARY_HEADER), "the summary block is in the history");
	assert.deepEqual(t.events.map((e) => e.type).filter((x) => x !== "compact"), ["done"], "the user never sees the first error");
});

test("run: overflow after a tool already ran is NOT repeated (tools may have changed the model); the error says what to do", async () => {
	let n = 0;
	const run: Run = async (o) => {
		n++;
		o.onEvent({ type: "tool", name: "create_level", id: "t1" });
		o.onEvent({ type: "error", engine: "pi", message: OVERFLOW });
	};
	const t = setup(run);
	t.seed(turns(6, 30_000));
	await t.s.send(null, "turpini", []);
	await t.finished;
	assert.equal(n, 1);
	const err = t.events.find((e) => e.type === "error") as { message: string };
	assert.match(err.message, /prompt is too long[\s\S]*saspiest/);
});

test("run: still too big after the one retry → the error comes through, no loop", async () => {
	let n = 0;
	const run: Run = async (o) => (n++, o.onEvent({ type: "error", engine: "pi", message: OVERFLOW }));
	const t = setup(run);
	t.seed(turns(6, 30_000));
	await t.s.send(null, "turpini", []);
	await t.finished;
	assert.equal(n, 2);
	assert.equal(t.events.filter((e) => e.type === "error").length, 1);
});

test("run: a summary that fails does not stop the run", async () => {
	const run: Run = async (o) => o.onEvent({ type: "done", text: "gatavs" });
	const t = setup(run, async () => ({ ...reply(""), stopReason: "error", errorMessage: "429 pārslodze" }) as AssistantMessage);
	t.seed(turns(7, 30_000));
	await t.s.send(null, "turpini", []);
	await t.finished;
	const c = t.events.filter((e) => e.type === "compact") as { phase: string; message?: string }[];
	assert.deepEqual(c.map((e) => e.phase), ["start", "failed"]);
	assert.match(c[1].message!, /429 pārslodze/);
	assert.ok(t.events.some((e) => e.type === "done"));
});

test("run: a restarted app seeds the model with the last summary from the transcript", async () => {
	let system = "";
	const run: Run = async (o) => ((system = o.systemPrompt ?? ""), o.onEvent({ type: "done", text: "gatavs" }));
	const t = setup(run);
	t.seed(turns(6, 15_000));
	await t.s.compactNow(null);
	(t.s as unknown as { conversations: Map<string, unknown> }).conversations.clear(); // restart
	await t.s.send(null, "kur mēs palikām?", []);
	await t.finished;
	assert.match(system, /Iepriekšējās sarunas kopsavilkums:\n## Mērķis\nTelpu pārbaude/);
});

// ---- attachments against the model's limits ------------------------------------------------------------------------

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const img = (i = 0): ChatAttachment => ({ name: `e${i}.png`, mimeType: "image/png", data: PNG });
const lim = { maxEdge: 2000, maxBytes: 4_718_592, maxPerRequest: 3, maxRequestBytes: null };

test("attachments: the model's own limits are enforced — too many images in one request, a file over its byte limit", async () => {
	const o = { seesImages: true, model: "m", limits: lim };
	await prepareAttachments([img(1), img(2)], { ...o, imagesInContext: 1 });
	await assert.rejects(prepareAttachments([img(1), img(2)], { ...o, imagesInContext: 2 }), /pieņem līdz 3 attēliem.*sarunā jau ir 2/);
	await assert.rejects(prepareAttachments([img()], { ...o, limits: { ...lim, maxBytes: 10 } }), /modelis m pieņem līdz 1 kB/);
	await assert.rejects(prepareAttachments([img(), img(1)], { ...o, limits: { ...lim, maxRequestBytes: 100 } }), /pārsniedz to, ko m pieņem vienā pieprasījumā/);
});

test("attachments: a model without images gets no limits and no images", async () => {
	const rt = createPiRuntime({ path: join(tmp(), "pi.json"), apiKey: () => null });
	assert.equal(imageLimits(lookupPiModel(rt, "openai", "o3-mini")), null);
});

test("measure: an image costs pi's flat estimate, a PDF its text with page count, a scan is refused, a long text says it is cut", async () => {
	assert.deepEqual(await measureAttachment(img()), { kind: "image", tokens: IMAGE_TOKENS });
	const pdf = await measureAttachment({ name: "text-lv.pdf", mimeType: "application/pdf", data: readFileSync(join(FIX, "text-lv.pdf")).toString("base64") });
	assert.equal(pdf.kind, "document");
	assert.equal(pdf.pages, 2);
	assert.ok(pdf.tokens > 50 && pdf.tokens < 400);
	await assert.rejects(measureAttachment({ name: "scan-lv.pdf", mimeType: "application/pdf", data: readFileSync(join(FIX, "scan-lv.pdf")).toString("base64") }), /ekrānuzņēmumu/);
	const long = await measureAttachment({ name: "liels.txt", mimeType: "text/plain", data: Buffer.from("ā".repeat(100_000)).toString("base64") });
	assert.equal(long.cut, true);
	assert.ok(long.tokens > 15_000 && long.tokens < 20_000, `60K chars ≈ 17K tokens, got ${long.tokens}`);
	assert.ok(existsSync(FIX));
});
