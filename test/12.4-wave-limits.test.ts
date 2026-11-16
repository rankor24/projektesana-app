// 12.4 wave limits: a wave (everything one user action sets off) may start only so many runs and spend only so much;
// past a limit its queued items wait, the wave shows in Gaida tevi, and the user resumes it. Every agent loop is scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mailTools, type MailDeps } from "../src/agent/mail.ts";
import type { Coordinator } from "../src/agent/coordinator.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { DEFAULT_LIMITS, Mailbox, clampLimits, mailDir, type Limits } from "../src/core/messages.ts";
import { pickNext, waveCheck } from "../src/core/queue.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import type { QueueItem, Running, Wave } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { currentWave, waveLine } from "../src/shared/wave.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const wave = (o: Partial<Wave> = {}): Wave => ({ id: "w1", projectId: null, startedAt: "2026-11-16T10:00:00Z", runs: 0, cost: 0, paused: null, ...o });

// ---- pure ---------------------------------------------------------------------------------------------------------------------

test("12.4 waveCheck: runs at the limit, cost at the limit, null cost limit never", () => {
	const l = { ...DEFAULT_LIMITS, runsPerWave: 20, waveCost: 1 };
	assert.equal(waveCheck(wave({ runs: 19 }), l), null);
	assert.equal(waveCheck(wave({ runs: 20 }), l), "runs");
	assert.equal(waveCheck(wave({ cost: 0.99 }), l), null);
	assert.equal(waveCheck(wave({ cost: 1 }), l), "cost");
	assert.equal(waveCheck(wave({ runs: 20, cost: 5 }), l), "runs", "runs are named first");
	assert.equal(waveCheck(wave({ cost: 1e6 }), { ...l, waveCost: null }), null);
});

const item = (id: string, w: string, threadId = id, agent = id): QueueItem => ({ id, threadId, agent, projectId: null, wave: w, at: "t", state: "queued", input: { text: "", focus: [], cause: { by: "user" } } });

test("12.4 pickNext skips what `blocked` names and takes the next one", () => {
	const q = [item("a", "w1"), item("b", "w2")];
	assert.equal(pickNext(q, [], 3, false, (x) => x.wave === "w1")?.id, "b");
	assert.equal(pickNext(q, [], 3, false, () => true), null);
	assert.equal(pickNext(q, [] as Running[], 3, false)?.id, "a", "no filter: as before");
});

test("12.4 clampLimits: ranges, rounding, waveCost null or above zero", () => {
	const c = (p: Record<string, unknown>) => clampLimits(p as Partial<Limits>, DEFAULT_LIMITS);
	assert.deepEqual([c({ exchangesPerTopic: 0 }).exchangesPerTopic, c({ exchangesPerTopic: 99 }).exchangesPerTopic, c({ exchangesPerTopic: 4.6 }).exchangesPerTopic], [1, 10, 5]);
	assert.deepEqual([c({ chainDepth: -3 }).chainDepth, c({ chainDepth: 500 }).chainDepth], [1, 20]);
	assert.deepEqual([c({ runsPerWave: 0 }).runsPerWave, c({ runsPerWave: 1000 }).runsPerWave], [1, 200]);
	assert.deepEqual([c({ taskIterations: 0 }).taskIterations, c({ taskIterations: 11 }).taskIterations], [1, 10]);
	assert.deepEqual([c({ waveCost: 0 }).waveCost, c({ waveCost: -2 }).waveCost, c({ waveCost: 2.5 }).waveCost, c({ waveCost: null }).waveCost], [null, null, 2.5, null]);
	assert.equal(c({ runsPerWave: "abc" }).runsPerWave, DEFAULT_LIMITS.runsPerWave, "not a number: the base value");
	assert.deepEqual(c({}), DEFAULT_LIMITS);
});

test("12.4 settings: limits default, are clamped on set, keep what the patch leaves out, survive a reload", () => {
	const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
	const s = new AppSettings(tmp(), crypto);
	assert.deepEqual(s.get().limits, DEFAULT_LIMITS);
	const out = s.set({ limits: { exchangesPerTopic: 50, chainDepth: 0, runsPerWave: 9999 } as Limits });
	assert.deepEqual([out.limits.exchangesPerTopic, out.limits.chainDepth, out.limits.runsPerWave], [10, 1, 200]);
	assert.equal(out.limits.taskIterations, DEFAULT_LIMITS.taskIterations, "left out: unchanged");
	assert.equal(new AppSettings(s.dir, crypto).get().limits.runsPerWave, 200);
	assert.equal(s.set({ limits: { waveCost: 3 } as Limits }).limits.runsPerWave, 200, "a second patch keeps the first");
	assert.equal(s.set({ limits: { waveCost: null } as Limits }).limits.waveCost, null);
	assert.deepEqual(s.set({ userName: "x" }).limits.waveCost, null, "another key leaves limits alone");
});

test("12.4 the chat's wave line: runs, cost only when there is one; the current wave is the open project's, a running one first", () => {
	assert.equal(waveLine(wave({ runs: 7, cost: 0.42 })), "vilnis: 7 skrējieni · $0.42");
	assert.equal(waveLine(wave({ runs: 7, cost: 0 })), "vilnis: 7 skrējieni");
	const a = wave({ id: "a", projectId: "BD1", startedAt: "2026-11-16T10:00:00Z" });
	const b = wave({ id: "b", projectId: "BD1", startedAt: "2026-11-16T11:00:00Z" });
	const c = wave({ id: "c", projectId: "BD2", startedAt: "2026-11-16T12:00:00Z" });
	const run = (w: string): Running => ({ runId: "r", threadId: "t", agent: "lead", projectId: "BD1", wave: w, waitingConfirm: false });
	assert.equal(currentWave([a, b, c], [], "BD1")?.id, "b", "newest of the open project");
	assert.equal(currentWave([a, b, c], [run("a")], "BD1")?.id, "a", "the one with a run going");
	assert.equal(currentWave([c], [], "BD1"), null);
	assert.equal(currentWave([], [], null), null);
});

// ---- the coordinator -----------------------------------------------------------------------------------------------------------

type Ctx = { agent: string; o: PiRunOptions; n: number };
type Script = (c: Ctx) => Promise<void> | void;

function setup(over: { agents?: AgentSpec[]; limits?: Partial<Limits>; scripts?: Record<string, Script> } = {}) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const agents = over.agents ?? [spec("ekspertize"), spec("parbaude")];
	const calls: Ctx[] = [];
	const seen: Record<string, number> = {};
	let limits: Limits = { ...DEFAULT_LIMITS, ...over.limits };
	const queueEvents: number[] = [];
	let waitingEvents = 0;
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 6, limits }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => agents,
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onQueue: (v) => queueEvents.push(v.waves.length),
		onWaiting: () => waitingEvents++,
		complete: async () => ({ role: "assistant", content: [{ type: "text", text: "## Mērķis\nsaspiests" }], stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 1 }) as never,
		runAgent: async (o) => {
			const m = /AGENT (\S+?)\./.exec(o.systemPrompt ?? "");
			const agent = m ? m[1] : "lead";
			const c: Ctx = { agent, o, n: (seen[agent] = (seen[agent] ?? 0) + 1) };
			calls.push(c);
			await over.scripts?.[agent]?.(c);
			o.onEvent({ type: "done", text: `${agent} #${c.n}` });
		},
	} as never);
	const coordinator = (s as unknown as { coordinator: Coordinator }).coordinator;
	const mail = new Mailbox(mailDir(dir, dir, null));
	/** nothing running, twice in a row (items held back by a limit stay queued: that is the point) */
	const quiet = async () => {
		for (let q = 0, i = 0; q < 3 && i < 400; i++) {
			await tick();
			q = s.queueView().running.length === 0 ? q + 1 : 0;
		}
	};
	const send = (c: Ctx, p: Record<string, unknown>) => c.o.extraTools!.find((t) => t.name === "send_message")!.execute("t", p as never, c.o.signal);
	const usage = (c: Ctx, cost: number | null) => c.o.onEvent({ type: "usage", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost });
	return { s, coordinator, mail, calls, quiet, send, usage, queueEvents, waitingEvents: () => waitingEvents, setLimits: (l: Partial<Limits>) => (limits = { ...limits, ...l }) };
}

const waitingWaves = (s: AgentSession) => s.waiting().filter((w) => w.kind === "wave-paused");

test("12.4 the 21st run of a wave is not started; the wave is paused with runs; another wave still runs; resumeWave starts the rest", async () => {
	const names = Array.from({ length: 25 }, (_, i) => `ag${i}`);
	const t = setup({
		agents: [...names, "extra"].map(spec),
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				for (const to of names) await t.send(c, { to, title: `Temats ${to}`, kind: "ask", text: "?" });
			},
		},
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	const w1 = t.s.queueView().waves.find((w) => w.paused);
	assert.ok(w1, "a wave is paused");
	assert.equal(w1.paused, "runs");
	assert.equal(w1.runs, 20, "20 runs started, the 21st was not");
	assert.equal(t.calls.length, 20);
	const queued = t.s.queueView().queued.filter((q) => q.state === "queued");
	assert.ok(queued.length > 0 && queued.every((q) => q.wave === w1.id), "the rest waits in the queue");
	const items = waitingWaves(t.s);
	assert.deepEqual(items, [{ kind: "wave-paused", wave: w1.id, projectId: null, reason: "runs" }]);

	// another wave (the user starts another thread) goes on
	const other = t.s.openThread(null, "extra");
	const before = t.calls.length;
	await t.s.sendToThread(other.id, null, "cits darbs", [], [], () => undefined);
	await t.quiet();
	assert.ok(t.calls.length > before, "the other wave ran");
	assert.equal(t.s.queueView().queued.filter((q) => q.state === "queued" && q.wave === w1.id).length, queued.length, "the paused wave's items did not move");

	t.coordinator.resumeWave(w1.id);
	await t.quiet();
	assert.equal(t.s.queueView().queued.filter((q) => q.state === "queued" && q.wave === w1.id).length, 0, "all started after the resume");
	assert.equal(waitingWaves(t.s).length, 0);
	for (const n of names) assert.ok(t.calls.some((c) => c.agent === n), `${n} ran`);
});

test("12.4 resumeWave zeroes the counts and the paused flag, and the wave line is told", async () => {
	let seenAfter = false;
	const t = setup({
		limits: { runsPerWave: 2 },
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "T1", kind: "ask", text: "?" });
				// the run the resume starts: its wave's counts are the new ones
				if (c.n === 2) {
					const w = t.s.queueView().waves[0];
					assert.deepEqual([w.paused, w.runs, w.cost], [null, 1, 0]);
					seenAfter = true;
				}
			},
			ekspertize: async (c) => {
				t.usage(c, 0.25);
				await t.send(c, { to: "lead", topic: /tp_\w+/.exec(c.o.prompt)![0], kind: "reply", text: "ok" });
			},
		},
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	const v = t.s.queueView();
	assert.equal(v.waves.length, 1);
	assert.deepEqual([v.waves[0].paused, v.waves[0].runs, v.waves[0].cost], ["runs", 2, 0.25], "lead, ekspertize; the lead's wake was refused");
	assert.equal(t.calls.length, 2);
	t.setLimits({ runsPerWave: 5 });
	const told = t.waitingEvents();
	t.coordinator.resumeWave(v.waves[0].id);
	assert.ok(t.waitingEvents() > told, "waiting.changed fired");
	await t.quiet();
	assert.equal(t.calls.length, 3, "the queued wake of the lead started");
	assert.ok(seenAfter, "counted again from zero inside the resumed run");
});

test("12.4 waveCost 1 pauses after usage events summing to 1; a null provider cost adds nothing", async () => {
	const t = setup({
		limits: { waveCost: 1 },
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "T1", kind: "ask", text: "?" });
			},
			ekspertize: async (c) => {
				t.usage(c, 0.5);
				t.usage(c, null);
				t.usage(c, 0.5);
				await t.send(c, { to: "lead", topic: /tp_\w+/.exec(c.o.prompt)![0], kind: "reply", text: "ok" });
			},
		},
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	assert.equal(t.calls.length, 2, "the lead's wake did not start");
	const w = t.s.queueView().waves[0];
	assert.deepEqual([w.paused, w.cost], ["cost", 1]);
	assert.deepEqual(waitingWaves(t.s).map((x) => x.kind === "wave-paused" && x.reason), ["cost"]);
	assert.equal(t.s.queueView().queued.filter((q) => q.state === "queued").length, 1);
});

test("12.4 waveCost null never pauses on cost", async () => {
	const t = setup({
		limits: { waveCost: null },
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "T1", kind: "ask", text: "?" });
			},
			ekspertize: async (c) => {
				t.usage(c, 1e6);
				await t.send(c, { to: "lead", topic: /tp_\w+/.exec(c.o.prompt)![0], kind: "reply", text: "ok" });
			},
		},
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	assert.equal(t.calls.length, 3, "the lead was woken");
	assert.ok(t.s.queueView().waves.every((w) => w.paused === null));
	assert.equal(waitingWaves(t.s).length, 0);
});

test("12.4 a wave with no running or queued work and no pause is left out of the view", async () => {
	const t = setup();
	await t.s.send(null, "sveiki", []);
	await t.quiet();
	assert.deepEqual(t.s.queueView().waves, []);
});

test("12.4 Stop clears a paused wave: nothing is left to resume", async () => {
	const t = setup({
		limits: { runsPerWave: 1 },
		scripts: { lead: async (c) => { if (c.n === 1) await t.send(c, { to: "ekspertize", title: "T1", kind: "ask", text: "?" }); } },
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	assert.equal(waitingWaves(t.s).length, 1);
	t.s.stop();
	assert.equal(waitingWaves(t.s).length, 0);
	assert.deepEqual(t.s.queueView().waves, []);
});

test("12.4 the mail tools read the limits from the settings", async () => {
	let refusal = "";
	const t = setup({
		limits: { exchangesPerTopic: 1 },
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				const a = await t.send(c, { to: "ekspertize", title: "T1", kind: "ask", text: "viens" });
				assert.ok(!a.isError);
				const topic = t.mail.topics()[0].id;
				const b = await t.send(c, { to: "ekspertize", topic, kind: "ask", text: "divi" });
				refusal = b.content.map((x) => (x as { text?: string }).text ?? "").join("");
			},
		},
	});
	await t.s.send(null, "sāc", []);
	await t.quiet();
	// read outside the scripted run, where a failed assert would be swallowed as a run error
	assert.match(refusal, /jau ir 1 ziņas/);
});

// ---- only the lead closes a notice topic ---------------------------------------------------------------------------------------

test("12.4 close_topic on a \"Nodots:\" notice: the other party is refused, the lead may close it", async () => {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa projekts", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const mailbox = new Mailbox(mailDir(dir, dir, "BD999"));
	const threads = new ThreadStore(threadsDir(dir, dir, "BD999"));
	const mine = threads.create({ projectId: "BD999", agent: "ar", title: "Saruna", startedBy: "user" });
	const d: MailDeps = {
		mailbox, threads, agents: () => [spec("ar"), spec("bk")], limits: () => DEFAULT_LIMITS,
		self: { agent: "ar", threadId: mine.id, projectId: "BD999", wave: "w1", depth: 0 },
		enqueue: () => undefined, note: () => undefined, notes: () => store,
	};
	const signal = new AbortController().signal;
	const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((x) => x.text ?? "").join("");
	const [send, close] = mailTools(d);
	await send.execute("t", { to: "bk", title: "Sienas biezums", kind: "ask", text: "cik?" } as never, signal);
	const topic = mailbox.topics()[0].id;
	await close.execute("t", { topic, outcome: "passed-up", decision: "nevaram vienoties", impact: { cost: false, time: false, norms: false, pu: false } } as never, signal);
	const notice = mailbox.topics().find((x) => x.title.startsWith("Nodots:"))!;
	assert.equal(notice.notice, true, "marked as a notice");
	assert.equal(mailbox.topics().find((x) => x.id === topic)?.notice, undefined, "an ordinary topic is not");

	const refused = await close.execute("t", { topic: notice.id, outcome: "agreed", decision: "gatavs", impact: { cost: false, time: false, norms: false, pu: false } } as never, signal);
	assert.ok(refused.isError);
	assert.equal(text(refused), "Šo tematu slēdz galvenais aģents.");
	assert.equal(mailbox.topics().find((x) => x.id === notice.id)?.state, "open");
	assert.equal(store.notes("decision").length, 0);

	const [, leadClose] = mailTools({ ...d, self: { ...d.self, agent: "lead" } });
	const ok = await leadClose.execute("t", { topic: notice.id, outcome: "agreed", decision: "lēmums", impact: { cost: false, time: false, norms: false, pu: false } } as never, signal);
	assert.ok(!ok.isError, text(ok));
	assert.equal(mailbox.topics().find((x) => x.id === notice.id)?.state, "agreed");
});
