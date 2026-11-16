// 12.5 room feed: one line per message, agreement, pass-up and pause. `roomLines` is pure; the mailbox tells the session about each new line,
// the session sends it as `room.line`, and `room.lines` reads it all again. Every agent loop is scripted; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { Mailbox, mailDir, type Message, type Topic } from "../src/core/messages.ts";
import { threadHandlers } from "../src/main/handlers/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { EVENT_NAMES } from "../src/shared/api.ts";
import { roomLines } from "../src/shared/room.ts";
import type { RoomLine, Thread, Wave } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const at = (n: number) => new Date(Date.UTC(2026, 10, 16, 9, n)).toISOString();

const topic = (id: string, over: Partial<Topic> = {}): Topic => ({ id, title: "Pārseguma biezums", parties: ["ar", "bk"], parent: null, state: "open", openedAt: at(0), ...over });
const msg = (id: string, over: Partial<Message> = {}): Message => ({ id, at: at(1), wave: "w1", topic: "tp1", from: "ar", to: "bk", kind: "ask", text: "Cik biezs?", refs: [], fromThread: "th_ar", toThread: "th_bk", depth: 1, state: "delivered", ...over });
const thread = (id: string, over: Partial<Thread> = {}): Thread => ({ id, projectId: "BD999", agent: "ar", title: "Saruna", topic: null, state: "idle", startedBy: "user", wave: null, createdAt: at(0), lastAt: at(0), runs: 0, ...over });

// ---- roomLines ---------------------------------------------------------------------------------------------------------------

test("12.5 lines come oldest first, whatever order the files list them in", () => {
	const lines = roomLines({
		messages: [msg("m2", { at: at(5), from: "bk", to: "ar", kind: "reply", text: "300 mm.", fromThread: "th_bk", toThread: "th_ar" }), msg("m1", { at: at(2) })],
		topics: [topic("tp1", { state: "agreed", noteId: "n1", closedAt: at(7) })],
		threads: [],
	});
	assert.deepEqual(lines.map((l) => [l.kind, l.at]), [["message", at(2)], ["message", at(5)], ["agreed", at(7)]]);
});

test("12.5 a message line reads 'from → to · topic: text', names replace ids, and it points at the receiving thread", () => {
	const [l] = roomLines({ messages: [msg("m1")], topics: [topic("tp1")], threads: [], names: { ar: "AR", bk: "BK" } });
	assert.equal(l.text, "AR → BK · Pārseguma biezums: Cik biezs?");
	assert.deepEqual([l.kind, l.from, l.to, l.topic, l.threadId, l.noteId], ["message", "ar", "bk", "Pārseguma biezums", "th_bk", undefined]);
	// no name known: the id; a topic that is gone: its id
	const [bare] = roomLines({ messages: [msg("m1", { topic: "tp9" })], topics: [], threads: [] });
	assert.equal(bare.text, "ar → bk · tp9: Cik biezs?");
});

test("12.5 a message's text is cut at 120 characters and its line breaks are one space", () => {
	const [long] = roomLines({ messages: [msg("m1", { text: "a".repeat(300) })], topics: [topic("tp1")], threads: [] });
	assert.equal(long.text, `ar → bk · Pārseguma biezums: ${"a".repeat(120)}`);
	const [multi] = roomLines({ messages: [msg("m1", { text: "pirmā rinda\n\n  otrā\trinda" })], topics: [topic("tp1")], threads: [] });
	assert.equal(multi.text, "ar → bk · Pārseguma biezums: pirmā rinda otrā rinda");
});

test("12.5 an envelope message shows its goal or its status, not its text", () => {
	const task = msg("m1", { kind: "task", text: "UZDEVUMS …", task: { id: "t1", goal: "Pārbaudīt plātnes biezumu", context: [], expects: "ATBILDE", iteration: 1 } });
	const reply = msg("m2", { at: at(3), kind: "reply", text: "ATBILDE …", reply: { id: "t1", status: "daļēji", results: ["x"], questions: [], decisions: [] } });
	const [a, b] = roomLines({ messages: [task, reply], topics: [topic("tp1")], threads: [] });
	assert.equal(a.text, "ar → bk · Pārseguma biezums: Pārbaudīt plātnes biezumu");
	assert.equal(b.text, "ar → bk · Pārseguma biezums: daļēji");
});

test("12.5 an agreed topic gives one agreed line with its note; an open topic gives none", () => {
	const lines = roomLines({
		messages: [msg("m1")],
		topics: [topic("tp1", { state: "agreed", noteId: "n42", closedAt: at(4) }), topic("tp2", { title: "Durvju platums" })],
		threads: [],
		names: { ar: "AR", bk: "BK" },
	});
	const agreed = lines.filter((l) => l.kind === "agreed");
	assert.equal(agreed.length, 1);
	assert.deepEqual([agreed[0].text, agreed[0].noteId, agreed[0].at, agreed[0].from, agreed[0].to], ["AR ↔ BK vienojās: Pārseguma biezums", "n42", at(4), "ar", "bk"]);
	assert.equal(lines.length, 2, "the message and the agreement");
	// the line opens the thread the topic's messages went to (or the thread that carries the topic)
	assert.equal(agreed[0].threadId, "th_bk");
	const carried = roomLines({ messages: [], topics: [topic("tp1", { state: "agreed", noteId: "n1", closedAt: at(4) })], threads: [thread("th_x", { topic: "tp1" })] });
	assert.equal(carried[0].threadId, "th_x");
});

test("12.5 a passed-up topic gives one passed-up line with its note", () => {
	const [l] = roomLines({ messages: [], topics: [topic("tp1", { state: "passed-up", noteId: "n7", closedAt: at(6) })], threads: [] });
	assert.deepEqual([l.kind, l.text, l.noteId, l.at, l.topic], ["passed-up", "Pārseguma biezums nodots tālāk", "n7", at(6), "Pārseguma biezums"]);
});

test("12.5 a paused wave gives a paused line after its last message; a running wave gives none", () => {
	const w = (id: string, paused: Wave["paused"]): Wave => ({ id, projectId: "BD999", startedAt: at(0), runs: 20, cost: 0, paused });
	const lines = roomLines({ messages: [msg("m1", { wave: "w1", at: at(3) })], topics: [topic("tp1")], threads: [], waves: [w("w1", "runs"), w("w2", null), w("w3", "cost")] });
	// a wave with no messages sits at its start; a tie goes to the message, so the pause reads as what followed it
	assert.deepEqual(lines.map((l) => [l.kind, l.text, l.at]), [["paused", "Vilnis apturēts: cost", at(0)], ["message", "ar → bk · Pārseguma biezums: Cik biezs?", at(3)], ["paused", "Vilnis apturēts: runs", at(3)]]);
});

test("12.5 max keeps the newest lines, still oldest first; the default is 300", () => {
	const messages = Array.from({ length: 350 }, (_, i) => msg(`m${i}`, { at: new Date(Date.UTC(2026, 10, 16, 9, 0, i)).toISOString(), text: `ziņa ${i}` }));
	const all = roomLines({ messages, topics: [topic("tp1")], threads: [] });
	assert.equal(all.length, 300);
	assert.match(all[0].text, /ziņa 50$/);
	assert.match(all[299].text, /ziņa 349$/);
	const few = roomLines({ messages, topics: [topic("tp1")], threads: [] }, 2);
	assert.deepEqual(few.map((l) => l.text.slice(-8)), ["ziņa 348", "ziņa 349"]);
	assert.deepEqual(roomLines({ messages, topics: [], threads: [] }, 0), []);
});

// ---- the mailbox tells about each new line -----------------------------------------------------------------------------------

test("12.5 the mailbox reports each added message and each closed topic, and a failing listener breaks nothing", () => {
	const seen: string[] = [];
	const mb = new Mailbox(join(tmp(), "mail"), {
		added: (m) => seen.push(`m:${m.id}`),
		closed: (t) => {
			seen.push(`t:${t.state}`);
			throw new Error("a window already gone");
		},
	});
	const t = mb.openTopic({ title: "Siena", parties: ["ar", "bk"], parent: null });
	const m = mb.add({ wave: "w1", topic: t.id, from: "ar", to: "bk", kind: "ask", text: "x", refs: [], fromThread: "a", toThread: "b", depth: 1 });
	mb.setState(m.id, "delivered");
	const closed = mb.closeTopic(t.id, "agreed", "n1");
	assert.deepEqual(seen, [`m:${m.id}`, "t:agreed"], "a state change is no new line; the topic opening is none either");
	assert.equal(closed.state, "agreed", "the close itself went through");
	assert.equal(mb.topics()[0].state, "agreed");
});

// ---- the session: events and the read ----------------------------------------------------------------------------------------

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function setup() {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const room: { projectId: string | null; line: RoomLine }[] = [];
	const topicOf = (o: PiRunOptions) => /tp_\w+/.exec(o.prompt)![0];
	const send = (o: PiRunOptions, p: Record<string, unknown>) => o.extraTools!.find((t) => t.name === "send_message")!.execute("t", p as never, o.signal);
	const close = (o: PiRunOptions, p: Record<string, unknown>) => o.extraTools!.find((t) => t.name === "close_topic")!.execute("t", p as never, o.signal);
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 6 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec("ar"), spec("bk")],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onRoom: (projectId, line) => room.push({ projectId, line }),
		runAgent: async (o) => {
			const agent = /AGENT (\S+?)\./.exec(o.systemPrompt ?? "")?.[1] ?? "lead";
			if (agent === "lead" && !o.prompt.includes("[no ")) await send(o, { to: "ar", title: "Pārseguma biezums", kind: "ask", text: "Cik biezs ir pārsegums?" });
			if (agent === "ar") await send(o, { to: "lead", topic: topicOf(o), kind: "reply", text: "250 mm." });
			o.onEvent({ type: "done", text: `${agent} gatavs` });
		},
	});
	const settle = async () => {
		for (let quiet = 0, i = 0; quiet < 2 && i < 400; i++) {
			await tick();
			const v = s.queueView();
			quiet = v.running.length === 0 && !v.queued.some((q) => q.state === "queued") ? quiet + 1 : 0;
		}
	};
	return { dir, s, room, settle, send, close };
}

test("12.5 an exchange between agents arrives as room.line events and as room.lines, with names", async () => {
	const t = setup();
	await t.s.send(null, "jautā AR", []);
	await t.settle();
	const texts = t.room.map((e) => e.line.text);
	assert.deepEqual(texts, ["Vadošais aģents → Aģents ar · Pārseguma biezums: Cik biezs ir pārsegums?", "Aģents ar → Vadošais aģents · Pārseguma biezums: 250 mm."]);
	assert.ok(t.room.every((e) => e.projectId === null && e.line.kind === "message"));
	assert.deepEqual(t.s.roomLines(null).map((l) => l.text), texts, "the read gives the same lines the events gave");
	assert.deepEqual(t.s.roomLines("BD999"), [], "another project's mail is its own");
});

test("12.5 closing a topic is one more event, and the read has it with its note id", async () => {
	const t = setup();
	await t.s.send(null, "jautā AR", []);
	await t.settle();
	const mb = new Mailbox(mailDir(t.dir, t.dir, null));
	const topicId = mb.topics()[0].id;
	// close it the way the tool does (through the session's own handle), so the listener fires
	const session = t.s as unknown as { mailbox: (p: string | null) => Mailbox };
	session.mailbox(null).closeTopic(topicId, "passed-up", "n_q1");
	const last = t.room.at(-1)!.line;
	assert.deepEqual([last.kind, last.text, last.noteId], ["passed-up", "Pārseguma biezums nodots tālāk", "n_q1"]);
	assert.equal(t.s.roomLines(null).at(-1)!.noteId, "n_q1");
});

test("12.5 the room.lines handler reads the session, and room.line is a known event", () => {
	const lines: RoomLine[] = [{ at: at(1), kind: "message", text: "x" }];
	const h = threadHandlers({ session: { roomLines: (p: string | null) => (p === "BD999" ? lines : []) } as never });
	assert.deepEqual(h["room.lines"]("BD999"), lines);
	assert.deepEqual(h["room.lines"](null), []);
	assert.ok((EVENT_NAMES as readonly string[]).includes("room.line"));
});
