// 12.3 close_topic and the registers in Atmiņa: an agreement becomes a decision note, a pass-up an open question, an impact flag turns an
// agreement into a question for the user; the user's questions appear in "Gaida tevi". Every agent loop is scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mailTools, type MailDeps } from "../src/agent/mail.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { DEFAULT_LIMITS, Mailbox, mailDir } from "../src/core/messages.ts";
import type { Note } from "../src/core/model.ts";
import { cancelDecision, reviewDecision, setNoteStatus, waitingQuestions } from "../src/core/notes.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import type { WaitingItem } from "../src/shared/thread-types.ts";
import { waitingItems } from "../src/shared/waiting.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const NONE = { cost: false, time: false, norms: false, pu: false };
const signal = new AbortController().signal;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((x) => x.text ?? "").join("");

/** A project with data, its mailbox and threads, and the mail tools of one agent writing into it. */
function rig(o: { agent?: string; withProject?: boolean; depth?: number } = {}) {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa projekts", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const mailbox = new Mailbox(mailDir(dir, dir, "BD999"));
	const threads = new ThreadStore(threadsDir(dir, dir, "BD999"));
	const agent = o.agent ?? "ar";
	const mine = threads.create({ projectId: "BD999", agent, title: "Saruna", startedBy: "user" });
	let changed = 0;
	const d: MailDeps = {
		mailbox, threads, agents: () => [spec("ar"), spec("bk")], limits: () => DEFAULT_LIMITS,
		self: { agent, threadId: mine.id, projectId: "BD999", wave: "w1", depth: o.depth ?? 0 },
		enqueue: () => undefined, note: () => undefined,
		...(o.withProject === false ? {} : { notes: () => store }),
		notesChanged: () => changed++,
	};
	const [send, close] = mailTools(d);
	const sendMsg = (p: Record<string, unknown>) => send.execute("t", p as never, signal);
	const closeTopic = (p: Record<string, unknown>) => close.execute("t", p as never, signal);
	/** the agent opens a topic with `to` and returns its id */
	const open = async (to: string, title = "Sienas biezums") => {
		await sendMsg({ to, title, kind: "ask", text: "cik bieza?" });
		return mailbox.topics().at(-1)!.id;
	};
	return { dir, store, mailbox, threads, d, sendMsg, closeTopic, open, changed: () => changed };
}

// ---- close_topic -------------------------------------------------------------------------------------------------------------

test("12.3 agreed with no impact: one decision note with both parties, the topic agreed with its noteId", async () => {
	const r = rig({ agent: "ar" });
	const topic = await r.open("bk");
	const ids = r.mailbox.messages().map((m) => m.id);
	const out = await r.closeTopic({ topic, outcome: "agreed", decision: "Siena 300 mm.", impact: NONE });
	assert.ok(!out.isError, text(out));
	const notes = r.store.notes();
	assert.equal(notes.length, 1);
	const n = notes[0];
	assert.deepEqual([n.type, n.agent, n.to, n.topic, n.reviewed, n.title, n.body, n.by], ["decision", "ar", "bk", topic, false, "Sienas biezums", "Siena 300 mm.", "agent"]);
	assert.deepEqual(n.refs, ids, "the topic's message ids");
	const t = r.mailbox.topics()[0];
	assert.deepEqual([t.state, t.noteId], ["agreed", n.id]);
	assert.match(text(out), new RegExp(n.id));
	assert.equal(r.changed(), 0, "no question for the user");
});

test("12.3 agreed with an impact flag is no agreement: a question to the user holds the proposal and the flags, the topic is passed-up", async () => {
	const r = rig({ agent: "ar" });
	const topic = await r.open("bk");
	const out = await r.closeTopic({ topic, outcome: "agreed", decision: "Siena 300 mm.", impact: { ...NONE, cost: true, pu: true } });
	assert.ok(!out.isError, text(out));
	assert.deepEqual(r.store.notes("decision"), [], "no decision note");
	const qs = r.store.notes("question");
	assert.equal(qs.length, 1);
	const q = qs[0];
	assert.deepEqual([q.to, q.status, q.agent, q.topic, q.by], ["user", "open", "ar", topic, "agent"]);
	assert.match(q.body, /Siena 300 mm\./);
	assert.match(q.body, /izmaksas/);
	assert.match(q.body, /PU/);
	assert.doesNotMatch(q.body, /termiņ/, "only the flags that were set");
	const t = r.mailbox.topics()[0];
	assert.deepEqual([t.state, t.noteId], ["passed-up", q.id]);
	assert.equal(r.changed(), 1, "the window is told a question waits");
});

test("12.3 passed-up: an open question to the lead, or to the user when the lead closes it", async () => {
	const specialist = rig({ agent: "ar" });
	const t1 = await specialist.open("bk");
	assert.ok(!(await specialist.closeTopic({ topic: t1, outcome: "passed-up", decision: "Nevaram vienoties par asi.", impact: NONE })).isError);
	const q1 = specialist.store.notes("question")[0];
	assert.deepEqual([q1.to, q1.status, q1.agent, q1.body, q1.topic], ["lead", "open", "ar", "Nevaram vienoties par asi.", t1]);
	assert.equal(specialist.mailbox.topics()[0].state, "passed-up");
	assert.equal(specialist.changed(), 0, "a question to the lead is not the user's to answer");

	const lead = rig({ agent: "lead" });
	const t2 = await lead.open("ar");
	assert.ok(!(await lead.closeTopic({ topic: t2, outcome: "passed-up", decision: "Vajag lietotāja lēmumu.", impact: NONE })).isError);
	const q2 = lead.store.notes("question")[0];
	assert.deepEqual([q2.to, q2.status, q2.agent], ["user", "open", "lead"]);
	assert.equal(lead.changed(), 1);
});

test("12.3 only a party may close a topic, and a closed topic is refused", async () => {
	const r = rig({ agent: "ar" });
	const topic = await r.open("bk");
	// the same mailbox seen by a third agent
	const [, other] = mailTools({ ...r.d, self: { ...r.d.self, agent: "lead" } });
	const refused = await other.execute("t", { topic, outcome: "agreed", decision: "x", impact: NONE } as never, signal);
	assert.ok(refused.isError);
	assert.match(text(refused), /ir starp ar un bk/);
	assert.equal(r.mailbox.topics()[0].state, "open");
	assert.deepEqual(r.store.notes(), []);

	assert.ok(!(await r.closeTopic({ topic, outcome: "agreed", decision: "Siena 300 mm.", impact: NONE })).isError);
	const again = await r.closeTopic({ topic, outcome: "passed-up", decision: "tomēr nē", impact: NONE });
	assert.ok(again.isError);
	assert.match(text(again), /jau ir slēgts \(vienošanās panākta\)/);
	assert.equal(r.store.notes().length, 1, "no second note");

	const unknown = await r.closeTopic({ topic: "tp_nav", outcome: "agreed", decision: "x", impact: NONE });
	assert.ok(unknown.isError);
	assert.match(text(unknown), /nav atrasts/);
});

test("12.3 a thread with no open project cannot close a topic", async () => {
	const r = rig({ agent: "ar", withProject: false });
	const topic = await r.open("bk");
	const out = await r.closeTopic({ topic, outcome: "agreed", decision: "x", impact: NONE });
	assert.ok(out.isError);
	assert.equal(text(out), "Temata slēgšanai vajag atvērtu projektu.");
	assert.equal(r.mailbox.topics()[0].state, "open");
});

test("12.3 close_topic declares all four impact flags as required booleans", () => {
	const [, close] = mailTools({} as MailDeps);
	const p = close.parameters as { required: string[]; properties: { impact: { required: string[]; properties: Record<string, { type: string }> } } };
	assert.deepEqual(p.required.sort(), ["decision", "impact", "outcome", "topic"]);
	assert.deepEqual(p.properties.impact.required.sort(), ["cost", "norms", "pu", "time"]);
	assert.ok(Object.values(p.properties.impact.properties).every((x) => x.type === "boolean"));
});

// ---- the automatic pass-up ---------------------------------------------------------------------------------------------------

test("12.3 the exchange limit passes the topic up: one open question to the lead, the topic passed-up, the refusal says so", async () => {
	const r = rig({ agent: "ar" });
	const topic = await r.open("bk");
	for (const n of ["divi", "trīs"]) assert.ok(!(await r.sendMsg({ to: "bk", topic, kind: "ask", text: n })).isError);
	const out = await r.sendMsg({ to: "bk", topic, kind: "ask", text: "četri" });
	assert.ok(out.isError);
	assert.match(text(out), /jau ir 3 ziņas no ar; temats nodots tālāk\./);
	const qs = r.store.notes("question");
	assert.equal(qs.length, 1, "exactly one question");
	assert.deepEqual([qs[0].to, qs[0].status, qs[0].agent, qs[0].topic], ["lead", "open", "ar", topic]);
	assert.match(qs[0].body, /jau ir 3 ziņas/);
	assert.match(qs[0].body, /četri/, "the message that was not sent is kept");
	assert.equal(r.mailbox.topics()[0].state, "passed-up");
	assert.equal(r.mailbox.messages().length, 3, "the refused message was not added");
	// a send onto the passed-up topic is now plainly closed, and writes nothing more
	const late = await r.sendMsg({ to: "bk", topic, kind: "ask", text: "vēl" });
	assert.match(text(late), /jau ir slēgts \(nodots tālāk\)/);
	assert.equal(r.store.notes("question").length, 1);
});

test("12.3 a refusal past the chain depth on a new topic opens it only to pass it up; one that does not pass up writes nothing", async () => {
	const r = rig({ agent: "lead", depth: 6 });
	const out = await r.sendMsg({ to: "ar", title: "Pārāk dziļi", kind: "ask", text: "jautājums" });
	assert.ok(out.isError);
	const [q] = r.store.notes("question");
	assert.deepEqual([q.to, q.title.includes("Pārāk dziļi")], ["user", true], "the lead's pass-up goes to the user");
	assert.deepEqual(r.mailbox.topics().map((t) => [t.title, t.state]), [["Pārāk dziļi", "passed-up"]]);
	assert.equal(r.changed(), 1);

	const self = await r.sendMsg({ to: "lead", title: "Pats sev", kind: "ask", text: "x" });
	assert.ok(self.isError);
	assert.equal(r.store.notes("question").length, 1, "a refusal without passUp writes no note");
	assert.equal(r.mailbox.topics().length, 1, "and opens no topic");
});

test("12.3 without a project the exchange-limit refusal stays a plain refusal (nothing can be written)", async () => {
	const r = rig({ agent: "ar", withProject: false });
	const topic = await r.open("bk");
	for (const n of ["divi", "trīs"]) await r.sendMsg({ to: "bk", topic, kind: "ask", text: n });
	const out = await r.sendMsg({ to: "bk", topic, kind: "ask", text: "četri" });
	assert.ok(out.isError);
	assert.match(text(out), /temats nodots tālāk\./);
	assert.equal(r.mailbox.topics()[0].state, "open", "the topic stays open: there is nowhere to record the pass-up");
});

// ---- Gaida tevi --------------------------------------------------------------------------------------------------------------

const q = (o: Partial<Note>): Note => ({ id: "n1", type: "question", title: "Jautājums", body: "?", refs: [], by: "agent", at: "2026-11-16T10:00:00.000Z", agent: "ar", to: "user", status: "open", ...o });

test("12.3 waitingQuestions: the open questions to the user, across projects; not closed ones, not ones to the lead, not decisions", () => {
	const dir = tmp();
	const a = ProjectStore.open(dir, { id: "BD1", name: "BD1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const b = ProjectStore.open(dir, { id: "BD2", name: "BD2", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	a.writeNote(q({ id: "n1", title: "Par logu" }));
	a.writeNote(q({ id: "n2", status: "closed" }));
	a.writeNote(q({ id: "n3", to: "lead" }));
	a.writeNote(q({ id: "n4", type: "decision", reviewed: false }));
	b.writeNote(q({ id: "n5", agent: "bk", title: "Par kolonnu", at: "2026-11-16T11:00:00.000Z" }));
	const items = waitingQuestions(dir);
	assert.deepEqual(items.map((i) => [i.noteId, i.projectId, i.from, i.title]).sort(), [["n1", "BD1", "ar", "Par logu"], ["n5", "BD2", "bk", "Par kolonnu"]]);
	assert.deepEqual(waitingQuestions(join(dir, "nav")), [], "no projects folder");
	// the pure list puts them in "Gaida tevi" with the rest
	const list = waitingItems({ confirms: [], gates: [], questions: items, paused: [], restore: null });
	assert.deepEqual(list.map((i) => i.kind), ["question", "question"]);
});

test("12.3 the user closes a question, reviews a decision, cancels a decision (a new note names it; nothing is deleted)", () => {
	const dir = tmp();
	const s = ProjectStore.open(dir, { id: "BD1", name: "BD1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	s.writeNote(q({ id: "n1" }));
	s.writeNote(q({ id: "n2", type: "decision", title: "Siena 300", topic: "tp_1", reviewed: false }));
	assert.equal(setNoteStatus(s, "n1", "closed").status, "closed");
	assert.equal(s.notes().find((n) => n.id === "n1")!.status, "closed");
	assert.deepEqual(waitingQuestions(dir), []);
	assert.throws(() => setNoteStatus(s, "nav", "closed"), /nav atrasta/);

	assert.throws(() => reviewDecision(s, "n1"), /tikai lēmumu/);
	assert.equal(reviewDecision(s, "n2").reviewed, true);
	assert.equal(s.notes().find((n) => n.id === "n2")!.reviewed, true);

	assert.throws(() => cancelDecision(s, "n2", "  "), /iemeslu/);
	const c = cancelDecision(s, "n2", "Norādīts nepareizs biezums.");
	assert.deepEqual([c.type, c.title, c.refs, c.topic, c.by], ["decision", "Atcelts: Siena 300", ["n2"], "tp_1", "user"]);
	assert.equal(s.notes().length, 3, "the cancelled decision is still there");
	assert.ok(s.notes().some((n) => n.id === "n2"));
});

// ---- read_notes --------------------------------------------------------------------------------------------------------------

test("12.3 read_notes takes topic, agent and status filters", async () => {
	const projectsDir = tmp();
	const appDir = tmp();
	const s = ProjectStore.open(projectsDir, { id: "BD1", name: "BD1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	s.writeNote(q({ id: "n1", topic: "tp_1", agent: "ar", at: "2026-11-16T10:00:00.000Z" }));
	s.writeNote(q({ id: "n2", type: "decision", status: undefined, topic: "tp_1", agent: "ar", reviewed: false, at: "2026-11-16T10:01:00.000Z" }));
	s.writeNote(q({ id: "n3", topic: "tp_2", agent: "bk", status: "closed", at: "2026-11-16T10:02:00.000Z" }));
	s.writeNote({ id: "n4", type: "learning", title: "Vecs", body: "b", refs: [], by: "user", at: "2026-11-16T09:00:00.000Z" });
	const ctx: ToolCtx = { projectsDir, projectId: "BD1", dataDir: tmp(), appDir, runDir: null, agent: null, thread: null };
	const run = (a: Record<string, unknown>) => allTools().find((t) => t.name === "read_notes")!.run(ctx, a as never);
	const read = async (a: Record<string, unknown>) => ((await run(a)) as { id: string }[]).map((n) => n.id).sort();
	assert.deepEqual(await read({ topic: "tp_1" }), ["n1", "n2"]);
	assert.deepEqual(await read({ agent: "bk" }), ["n3"]);
	assert.deepEqual(await read({ status: "open" }), ["n1"]);
	assert.deepEqual(await read({ topic: "tp_1", type: "decision" }), ["n2"]);
	assert.deepEqual(await read({}), ["n1", "n2", "n3", "n4"]);
	assert.match(String(await run({ topic: "tp_nav" })), /^no data/, "no match is the usual no-data line");
});

// ---- through the session -----------------------------------------------------------------------------------------------------

test("12.3 through a session: a close with an impact flag puts a question in Gaida tevi, closing it takes it out; the window is told both times", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa projekts", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const told: WaitingItem[][] = [];
	let leadRuns = 0;
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec("ar")],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onWaiting: (items) => told.push(items),
		runAgent: async (o) => {
			const mine = (n: string) => o.extraTools!.find((t) => t.name === n)!;
			if (/AGENT ar\./.test(o.systemPrompt ?? "")) {
				// the specialist answers nothing: the lead closes the topic below
			} else if (++leadRuns === 1) {
				await mine("send_message").execute("t", { to: "ar", title: "Loga izmērs", kind: "ask", text: "cik plats?" } as never, o.signal);
				const topic = new Mailbox(mailDir(dir, dir, "BD999")).topics()[0].id;
				const r = await mine("close_topic").execute("t", { topic, outcome: "agreed", decision: "Logs 1200 mm.", impact: { cost: true, time: false, norms: false, pu: false } } as never, o.signal);
				assert.ok(!r.isError, text(r));
			}
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	await s.send("BD999", "sāc", []);
	for (let i = 0; i < 100 && (s.queueView().running.length || !s.waiting().length); i++) await new Promise((r) => setTimeout(r, 5));
	const [item] = s.waiting();
	assert.equal(item.kind, "question");
	const n = store.notes("question")[0];
	assert.deepEqual(item, { kind: "question", noteId: n.id, projectId: "BD999", from: "lead", title: n.title });
	assert.ok(told.some((l) => l.some((x) => x.kind === "question")), "waiting.changed was sent when the question was written");

	// the user closes it (what the IPC handler does), then tells the session
	setNoteStatus(store, n.id, "closed");
	const before = told.length;
	s.notesChanged();
	assert.deepEqual(s.waiting().filter((x) => x.kind === "question"), []);
	assert.equal(told.length, before + 1);
	assert.deepEqual(told.at(-1)!.filter((x) => x.kind === "question"), []);
});
