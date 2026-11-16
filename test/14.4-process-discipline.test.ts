// 14.4 task discipline in process mode: who may give a task, to whom, for which stage, and when not; the same messages pass in cowork; a pass-up
// goes to bpv instead of the lead, an iteration overflow straight to the user. Invented project and agents; nothing leaves the machine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mailTools, type MailDeps } from "../src/agent/mail.ts";
import { DEFAULT_LIMITS, Mailbox, canSend, mailDir, type Topic } from "../src/core/messages.ts";
import { type ProcessState, initial } from "../src/core/process.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const IDS = ["bpv", "eks", "ar", "bk"];
const SPECS = [...IDS, "ek"].map(spec);
const PROFILE = ["bpv", "eks", "ar", "bk"];
const signal = new AbortController().signal;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((x) => x.text ?? "").join("");

const proc = (o: Partial<ProcessState> = {}): ProcessState => ({ ...initial("buvprojekts", PROFILE), ...o });
const waiting = (stage: ProcessState["stage"] & string = "S1"): ProcessState["gates"] => [{ id: "H1", stage: stage as "S1", iteration: 1, state: "waiting", noteId: "n1", at: "2026-11-16T10:00:00Z" }];

type M = { from: string; to: string; kind: "task" | "ask" | "reply"; topic: Topic | null; depth: number; iteration?: number; stage?: string };
const msg = (o: Partial<M> = {}): M => ({ from: "bpv", to: "ar", kind: "task", topic: null, depth: 1, ...o });
const ctx = (process: ProcessState | null | undefined) => ({ agents: SPECS, limits: DEFAULT_LIMITS, messages: [], process });
const refusal = (m: M, p: ProcessState | null | undefined) => {
	const r = canSend(m, ctx(p));
	assert.equal(r.ok, false, "refused");
	return r as Extract<ReturnType<typeof canSend>, { ok: false }>;
};

// ---- canSend ----------------------------------------------------------------------------------------------------------------

test("14.4 only the stage's leader gives a task: bpv in S1, eks in S5", () => {
	assert.equal(canSend(msg({ from: "bpv", to: "ar" }), ctx(proc())).ok, true);
	const r = refusal(msg({ from: "ar", to: "bk" }), proc());
	assert.deepEqual([r.code, r.passUp], ["process", false]);
	assert.equal(r.reason, "Procesa režīmā uzdevumus dod tikai stadijas vadītājs (bpv).");

	const s5 = proc({ stage: "S5" });
	assert.equal(canSend(msg({ from: "eks", to: "ar" }), ctx(s5)).ok, true, "eks leads S5");
	const b = refusal(msg({ from: "bpv", to: "ar" }), s5);
	assert.equal(b.reason, "Procesa režīmā uzdevumus dod tikai stadijas vadītājs (eks).");
});

test("14.4 an agent outside the profile cannot be written to, and cannot write, for every kind", () => {
	const p = proc({ profile: { ...proc().profile, agents: ["bpv", "ar"] } });
	for (const kind of ["task", "ask", "reply"] as const) {
		const to = refusal(msg({ kind, from: "bpv", to: "bk" }), p);
		assert.deepEqual([to.code, to.reason], ["process", "Aģents bk nav procesa profilā."], kind);
		const from = refusal(msg({ kind, from: "bk", to: "ar" }), p);
		assert.deepEqual([from.code, from.reason], ["process", "Aģents bk nav procesa profilā."], kind);
	}
});

test("14.4 the lead is no party of the process unless the profile lists it", () => {
	assert.equal(refusal(msg({ kind: "ask", from: "ar", to: "lead" }), proc()).reason, "Aģents lead nav procesa profilā.");
	assert.equal(canSend(msg({ kind: "ask", from: "ar", to: "lead" }), ctx(proc({ profile: { ...proc().profile, agents: [...PROFILE, "lead"] } }))).ok, true);
});

test("14.4 a task is for the current stage", () => {
	assert.equal(canSend(msg({ stage: "S1" }), ctx(proc())).ok, true);
	assert.equal(refusal(msg({ stage: "S3" }), proc()).reason, "Uzdevums ir stadijai S3, bet pašlaik ir S1.");
	// no stage given: the tool stamps the current one, the rule has nothing to compare
	assert.equal(canSend(msg(), ctx(proc())).ok, true);
});

test("14.4 while a gate waits no task is given, an ask and a reply pass", () => {
	const p = proc({ gates: waiting("S1") });
	assert.equal(refusal(msg(), p).reason, "Kamēr gaida gate H1, jaunus uzdevumus nedod.");
	assert.equal(canSend(msg({ kind: "ask", from: "ar", to: "bk" }), ctx(p)).ok, true);
	assert.equal(canSend(msg({ kind: "reply", from: "ar", to: "bpv" }), ctx(p)).ok, true);
	// a decided gate no longer blocks
	assert.equal(canSend(msg(), ctx(proc({ gates: [{ ...waiting("S1")[0], state: "approved" }] }))).ok, true);
});

test("14.4 an escalated stage gives no task; asks pass", () => {
	const p = proc({ escalated: "S1" });
	assert.equal(refusal(msg(), p).reason, "Stadija S1 eskalēta; gaida cilvēka lēmumu.");
	assert.equal(canSend(msg({ kind: "ask", from: "ar", to: "bk" }), ctx(p)).ok, true);
});

test("14.4 a task over the iteration limit keeps the iterations code and passes up", () => {
	const r = refusal(msg({ iteration: 4 }), proc());
	assert.deepEqual([r.code, r.passUp], ["iterations", true]);
	assert.equal(canSend(msg({ iteration: 3 }), ctx(proc())).ok, true);
});

test("14.4 ask and reply between agents of the profile are free, still under the topic limit", () => {
	const p = proc({ stage: "S4" });
	for (const kind of ["ask", "reply"] as const) assert.equal(canSend(msg({ kind, from: "ar", to: "bk" }), ctx(p)).ok, true, kind);
	const topic: Topic = { id: "tp_1", title: "Siena", parties: ["ar", "bk"], parent: null, state: "open", openedAt: "2026-11-16T10:00:00Z" };
	const sent = Array.from({ length: DEFAULT_LIMITS.exchangesPerTopic }, (_, i) => ({ id: `m${i}`, topic: "tp_1", from: "ar" })) as never;
	const r = canSend(msg({ kind: "ask", from: "ar", to: "bk", topic }), { ...ctx(p), messages: sent });
	assert.deepEqual([r.ok, !r.ok && r.code], [false, "exchanges"]);
});

test("14.4 cowork, no state and a finished process: none of the process rules apply", () => {
	const same = [msg({ from: "ar", to: "bk" }), msg({ to: "lead" }), msg({ stage: "S9" }), msg({ kind: "ask", from: "ar", to: "ek" })];
	for (const p of [proc({ mode: "cowork", gates: waiting(), escalated: "S1" }), null, undefined]) {
		for (const m of same) assert.equal(canSend(m, ctx(p)).ok, true, JSON.stringify([p?.mode, m]));
	}
	assert.equal(refusal(msg({ from: "bpv" }), proc({ stage: "done" })).code, "process", "a finished process gives no tasks");
});

test("14.4 the process rules come after self, unknown-agent and acl, before closed", () => {
	assert.equal(refusal(msg({ from: "bpv", to: "bpv" }), proc()).code, "self");
	assert.equal(refusal(msg({ to: "nav" }), proc()).code, "unknown-agent");
	const acl = SPECS.map((s) => (s.id === "ar" ? { ...s, acceptsFrom: ["eks"] } : s));
	assert.equal(canSend(msg({ from: "bpv", to: "ar" }), { ...ctx(proc()), agents: acl }).ok === false && (canSend(msg({ from: "bpv", to: "ar" }), { ...ctx(proc()), agents: acl }) as { code: string }).code, "acl");
	const closed: Topic = { id: "tp_1", title: "Siena", parties: ["ar", "bk"], parent: null, state: "agreed", openedAt: "2026-11-16T10:00:00Z" };
	assert.equal(refusal(msg({ kind: "ask", from: "ar", to: "bk", topic: closed }), proc({ profile: { ...proc().profile, agents: ["bpv", "ar"] } })).code, "process");
	assert.equal(refusal(msg({ kind: "ask", from: "ar", to: "bk", topic: closed }), proc()).code, "closed");
});

// ---- the mail tools ---------------------------------------------------------------------------------------------------------

function rig(o: { agent?: string; process?: ProcessState | null; depth?: number } = {}) {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa projekts", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const mailbox = new Mailbox(mailDir(dir, dir, "BD999"));
	const threads = new ThreadStore(threadsDir(dir, dir, "BD999"));
	const agent = o.agent ?? "bpv";
	const mine = threads.create({ projectId: "BD999", agent, title: "Saruna", startedBy: "user" });
	let current = o.process ?? null;
	let changed = 0;
	let woken = 0;
	const d: MailDeps = {
		mailbox, threads, agents: () => SPECS, limits: () => DEFAULT_LIMITS,
		self: { agent, threadId: mine.id, projectId: "BD999", wave: "w1", depth: o.depth ?? 0 },
		enqueue: () => woken++, note: () => undefined, notes: () => store, notesChanged: () => changed++,
		process: () => current,
	};
	const [send, close] = mailTools(d);
	const sendMsg = (p: Record<string, unknown>) => send.execute("t", p as never, signal);
	const closeTopic = (p: Record<string, unknown>) => close.execute("t", p as never, signal);
	return { store, mailbox, threads, d, sendMsg, closeTopic, set: (p: ProcessState | null) => (current = p), changed: () => changed, woken: () => woken, mine };
}

const TASK = { goal: "Sagatavot sienu sarakstu", expects: "saraksts", iteration: 1 };

test("14.4 send_message refuses in process mode with the Latvian reason and writes nothing; the state is read at each call", async () => {
	const r = rig({ agent: "ar", process: proc() });
	const out = await r.sendMsg({ to: "bk", title: "Darbs", kind: "task", text: "dari", task: TASK });
	assert.equal(out.isError, true);
	assert.equal(text(out), "Procesa režīmā uzdevumus dod tikai stadijas vadītājs (bpv).");
	assert.deepEqual(r.mailbox.messages(), []);
	// the user switches to cowork between two calls: the next call is free
	r.set(proc({ mode: "cowork" }));
	assert.ok(!(await r.sendMsg({ to: "bk", title: "Darbs", kind: "task", text: "dari", task: TASK })).isError);
	r.set(null);
	assert.ok(!(await r.sendMsg({ to: "bk", title: "Darbs 2", kind: "task", text: "dari", task: TASK })).isError);
});

test("14.4 the leader's task is stamped with the current stage; another stage is refused", async () => {
	const r = rig({ agent: "eks", process: proc({ stage: "S5" }) });
	assert.ok(!(await r.sendMsg({ to: "ar", title: "Pārbaude", kind: "task", text: "dari", task: TASK })).isError);
	assert.equal(r.mailbox.messages()[0].task?.stage, "S5");
	const wrong = await r.sendMsg({ to: "ar", title: "Cita", kind: "task", text: "dari", task: { ...TASK, stage: "S2" } });
	assert.equal(text(wrong), "Uzdevums ir stadijai S2, bet pašlaik ir S5.");
	assert.equal(r.mailbox.messages().length, 1);
});

test("14.4 in cowork a task carries no stage of its own", async () => {
	const r = rig({ agent: "ar", process: proc({ mode: "cowork" }) });
	assert.ok(!(await r.sendMsg({ to: "bk", title: "Darbs", kind: "task", text: "dari", task: TASK })).isError);
	assert.equal(r.mailbox.messages()[0].task?.stage, undefined);
});

test("14.4 an iterations refusal in process mode writes the question to the user, not to bpv", async () => {
	const r = rig({ agent: "bpv", process: proc() });
	const out = await r.sendMsg({ to: "ar", title: "Darbs", kind: "task", text: "vēlreiz", task: { ...TASK, iteration: 4 } });
	assert.equal(out.isError, true);
	const qs = r.store.notes("question");
	assert.equal(qs.length, 1);
	assert.deepEqual([qs[0].to, qs[0].status, qs[0].agent], ["user", "open", "bpv"]);
	assert.equal(r.changed(), 1, "the window hears of it");
	assert.deepEqual(r.mailbox.messages(), [], "no notice to anybody");
	assert.equal(r.mailbox.topics()[0].state, "passed-up");
});

test("14.4 a pass-up in process mode goes to bpv: a notice on bpv's newest open thread, made when missing", async () => {
	const r = rig({ agent: "ar", process: proc({ stage: "S4" }) });
	await r.sendMsg({ to: "bk", title: "Siena", kind: "ask", text: "cik bieza?" });
	const topic = r.mailbox.topics()[0].id;
	const out = await r.closeTopic({ topic, outcome: "passed-up", decision: "Nevaram vienoties.", impact: { cost: false, time: false, norms: false, pu: false } });
	assert.ok(!out.isError, text(out));
	const q = r.store.notes("question")[0];
	assert.deepEqual([q.to, q.agent], ["bpv", "ar"]);
	const notice = r.mailbox.messages().at(-1)!;
	assert.deepEqual([notice.from, notice.to, notice.kind], ["ar", "bpv", "ask"]);
	const th = r.threads.get(notice.toThread)!;
	assert.deepEqual([th.agent, th.startedBy], ["bpv", "ar"]);
	assert.equal(r.changed(), 0, "a question for bpv is not the user's to answer");
	// the next pass-up lands on the same thread
	await r.sendMsg({ to: "bk", title: "Siena 2", kind: "ask", text: "vēl?" });
	await r.closeTopic({ topic: r.mailbox.topics().at(-1)!.id, outcome: "passed-up", decision: "Atkal.", impact: { cost: false, time: false, norms: false, pu: false } });
	assert.equal(r.mailbox.messages().at(-1)!.toThread, th.id);
	assert.equal(r.threads.list({ agent: "bpv" }).length, 1);
});

test("14.4 bpv's own pass-up goes to the user; in cowork a pass-up still goes to the lead", async () => {
	const r = rig({ agent: "bpv", process: proc() });
	await r.sendMsg({ to: "ar", title: "Siena", kind: "ask", text: "cik bieza?" });
	await r.closeTopic({ topic: r.mailbox.topics()[0].id, outcome: "passed-up", decision: "Vajag lēmumu.", impact: { cost: false, time: false, norms: false, pu: false } });
	assert.equal(r.store.notes("question")[0].to, "user");
	assert.equal(r.changed(), 1);

	const c = rig({ agent: "ar", process: proc({ mode: "cowork" }) });
	await c.sendMsg({ to: "bk", title: "Siena", kind: "ask", text: "cik bieza?" });
	await c.closeTopic({ topic: c.mailbox.topics()[0].id, outcome: "passed-up", decision: "Nevaram.", impact: { cost: false, time: false, norms: false, pu: false } });
	assert.equal(c.store.notes("question")[0].to, "lead");
});

test("14.4 a send that hits the topic limit in process mode passes up to bpv", async () => {
	const r = rig({ agent: "ar", process: proc({ stage: "S4" }) });
	for (let i = 0; i < DEFAULT_LIMITS.exchangesPerTopic; i++) {
		const out = await r.sendMsg(i === 0 ? { to: "bk", title: "Siena", kind: "ask", text: `${i}` } : { to: "bk", topic: r.mailbox.topics()[0].id, kind: "ask", text: `${i}` });
		assert.ok(!out.isError, text(out));
	}
	const over = await r.sendMsg({ to: "bk", topic: r.mailbox.topics()[0].id, kind: "ask", text: "vēl" });
	assert.equal(over.isError, true);
	assert.equal(r.store.notes("question")[0].to, "bpv");
});
