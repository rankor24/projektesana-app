import assert from "node:assert/strict";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import {
	DEFAULT_LIMITS, Mailbox, answered, canSend, inboxOf, pendingOf, renderReply, renderTask, shouldWake,
	type Message, type ReplyEnvelope, type TaskEnvelope, type Topic,
} from "../src/core/messages.ts";
import { tmp } from "./helpers.ts";

type Ext = AgentSpec & { mayMessage?: string[]; acceptsFrom?: string[] };
const spec = (id: string, extra: Partial<Ext> = {}): Ext => ({ id, name: id.toUpperCase(), description: "", prompt: "", tools: [], ...extra });
const agents = [spec("ar"), spec("bk"), spec("ve")];
const ctx = (messages: Message[] = [], as: readonly AgentSpec[] = agents) => ({ agents: as, limits: DEFAULT_LIMITS, messages });
const topic = (over: Partial<Topic> = {}): Topic => ({ id: "tp1", title: "Pārseguma biezums", parties: ["ar", "bk"], parent: null, state: "open", openedAt: "2026-01-01T00:00:00Z", ...over });
const msg = (id: string, over: Partial<Message> = {}): Message => ({
	id, at: "2026-01-01T00:00:00Z", wave: "w1", topic: "tp1", from: "ar", to: "bk", kind: "ask", text: "x", refs: [],
	fromThread: "tA", toThread: "tB", depth: 0, state: "queued", ...over,
});
const ask = { from: "ar", to: "bk", kind: "ask" as const, topic: topic(), depth: 0 };
const latvian = (s: string) => assert.ok(s.length > 10 && /[ĀāČčĒēĢģĪīĶķĻļŅņŠšŪūŽž]|Temat|Aģent/.test(s), `not Latvian: ${s}`);

test("canSend: a plain ask passes; with no topic yet it passes too", () => {
	assert.deepEqual(canSend(ask, ctx()), { ok: true });
	assert.deepEqual(canSend({ ...ask, topic: null }, ctx()), { ok: true });
});

test("canSend: self", () => {
	const r = canSend({ ...ask, to: "ar" }, ctx());
	assert.ok(!r.ok && r.code === "self" && r.passUp === false);
	latvian(r.reason);
});

test("canSend: unknown-agent for a stranger, for the user, and for an unknown sender; lead is always known", () => {
	for (const m of [{ ...ask, to: "zz" }, { ...ask, to: "user" }, { ...ask, from: "user" }, { ...ask, from: "zz" }]) {
		const r = canSend(m, ctx());
		assert.ok(!r.ok && r.code === "unknown-agent" && r.passUp === false, JSON.stringify(m));
		latvian(r.reason);
		assert.match(r.reason, new RegExp(m.to === "zz" || m.to === "user" ? m.to : m.from));
	}
	assert.deepEqual(canSend({ ...ask, from: "lead", topic: topic({ parties: ["lead", "bk"] }) }, ctx()), { ok: true });
	assert.deepEqual(canSend({ ...ask, to: "lead", topic: topic({ parties: ["ar", "lead"] }) }, ctx()), { ok: true });
});

test("canSend: self is checked before unknown-agent", () => {
	const r = canSend({ ...ask, from: "zz", to: "zz" }, ctx());
	assert.ok(!r.ok && r.code === "self");
});

test("canSend: acl by the sender's mayMessage", () => {
	const as = [spec("ar", { mayMessage: ["ve"] }), spec("bk"), spec("ve")];
	const r = canSend(ask, ctx([], as));
	assert.ok(!r.ok && r.code === "acl" && r.passUp === false);
	latvian(r.reason);
	assert.match(r.reason, /ar/);
	assert.match(r.reason, /bk/);
	assert.deepEqual(canSend({ ...ask, to: "ve", topic: null }, ctx([], as)), { ok: true });
});

test("canSend: acl by the recipient's acceptsFrom", () => {
	const as = [spec("ar"), spec("bk", { acceptsFrom: ["ve"] }), spec("ve")];
	const r = canSend(ask, ctx([], as));
	assert.ok(!r.ok && r.code === "acl");
	latvian(r.reason);
	assert.deepEqual(canSend({ ...ask, from: "ve", topic: topic({ parties: ["ve", "bk"] }) }, ctx([], as)), { ok: true });
	// empty list means "from nobody", not "no rule"
	const none = [spec("ar"), spec("bk", { acceptsFrom: [] }), spec("ve")];
	const e = canSend(ask, ctx([], none));
	assert.ok(!e.ok && e.code === "acl");
});

test("canSend: a reply between the two parties of an open topic always passes the acl rule", () => {
	const as = [spec("ar", { acceptsFrom: [] }), spec("bk", { mayMessage: [] })];
	const reply = { from: "bk", to: "ar", kind: "reply" as const, topic: topic(), depth: 0 };
	assert.deepEqual(canSend(reply, ctx([], as)), { ok: true });
	// an ask on the same topic is still held by the acl; so is a reply to someone who is not a party
	const a = canSend({ ...reply, kind: "ask" }, ctx([], as));
	assert.ok(!a.ok && a.code === "acl");
	const outsider = canSend({ ...reply, to: "ve", topic: topic({ parties: ["bk", "ar"] }) }, ctx([], [...as, spec("ve", { acceptsFrom: [] })]));
	assert.ok(!outsider.ok && outsider.code === "acl");
	// a reply on a closed topic gets no pass: the acl refuses first
	const c2 = canSend({ ...reply, topic: topic({ state: "agreed" }) }, ctx([], as));
	assert.ok(!c2.ok && c2.code === "acl");
});

test("canSend: closed", () => {
	for (const state of ["agreed", "passed-up"] as const) {
		const r = canSend({ ...ask, topic: topic({ state }) }, ctx());
		assert.ok(!r.ok && r.code === "closed" && r.passUp === false);
		latvian(r.reason);
		assert.match(r.reason, /Pārseguma biezums/);
	}
});

test("canSend: the opener's 1st, 2nd and 3rd message pass, the 4th is exchanges with passUp; so is the other party's 4th", () => {
	const sent: Message[] = [];
	for (let i = 1; i <= 3; i++) {
		assert.deepEqual(canSend(ask, ctx(sent)), { ok: true }, `message ${i}`);
		sent.push(msg(`a${i}`, { from: "ar", to: "bk" }));
	}
	const r = canSend(ask, ctx(sent));
	assert.ok(!r.ok && r.code === "exchanges" && r.passUp === true);
	assert.equal(r.reason, "Par tematu «Pārseguma biezums» jau ir 3 ziņas no ar; temats nodots tālāk.");
	// the other party has sent nothing yet, so the count is per sender
	const back = { from: "bk", to: "ar", kind: "reply" as const, topic: topic(), depth: 0 };
	for (let i = 1; i <= 3; i++) {
		assert.deepEqual(canSend(back, ctx(sent)), { ok: true }, `reply ${i}`);
		sent.push(msg(`b${i}`, { from: "bk", to: "ar", kind: "reply" }));
	}
	const r2 = canSend(back, ctx(sent));
	assert.ok(!r2.ok && r2.code === "exchanges" && r2.passUp === true);
	// messages on another topic do not count
	assert.deepEqual(canSend(ask, ctx(sent.map((m) => ({ ...m, topic: "other" })))), { ok: true });
});

test("canSend: depth 6 passes, 7 is refused with passUp", () => {
	assert.deepEqual(canSend({ ...ask, depth: 6 }, ctx()), { ok: true });
	const r = canSend({ ...ask, depth: 7 }, ctx());
	assert.ok(!r.ok && r.code === "depth" && r.passUp === true);
	latvian(r.reason);
	assert.match(r.reason, /7/);
	assert.match(r.reason, /6/);
});

test("canSend: a task past the iteration limit is refused with passUp; other kinds ignore iteration", () => {
	assert.deepEqual(canSend({ ...ask, kind: "task", iteration: 3 }, ctx()), { ok: true });
	const r = canSend({ ...ask, kind: "task", iteration: 4 }, ctx());
	assert.ok(!r.ok && r.code === "iterations" && r.passUp === true);
	latvian(r.reason);
	assert.deepEqual(canSend({ ...ask, kind: "ask", iteration: 9 }, ctx()), { ok: true });
});

test("canSend: rule order, closed before exchanges before depth", () => {
	const many = [1, 2, 3].map((i) => msg(`a${i}`));
	const r = canSend({ ...ask, depth: 9, topic: topic({ state: "agreed" }) }, ctx(many));
	assert.ok(!r.ok && r.code === "closed");
	const r2 = canSend({ ...ask, depth: 9 }, ctx(many));
	assert.ok(!r2.ok && r2.code === "exchanges");
});

test("inboxOf: queued messages to the thread, in order", () => {
	const ms = [msg("1", { toThread: "tB" }), msg("2", { toThread: "tC" }), msg("3", { toThread: "tB", state: "delivered" }), msg("4", { toThread: "tB" })];
	assert.deepEqual(inboxOf("tB", ms).map((m) => m.id), ["1", "4"]);
});

test("wake: a fresh task wakes its recipient", () => {
	const ms = [msg("1", { kind: "task", from: "ar", to: "bk", fromThread: "tA", toThread: "tB" })];
	assert.equal(shouldWake("tB", ms), true);
	// the sender has nothing in its inbox
	assert.equal(shouldWake("tA", ms), false);
	assert.deepEqual(pendingOf("tA", ms).map((m) => m.id), ["1"]);
	assert.deepEqual(pendingOf("tB", ms), []);
});

test("wake: one of two replies in does not wake, both in does", () => {
	const asks = [
		msg("a1", { topic: "t1", to: "bk", toThread: "tB" }),
		msg("a2", { topic: "t2", to: "ve", toThread: "tV" }),
	];
	// asks already delivered to B and V
	const delivered = asks.map((m) => ({ ...m, state: "delivered" as const }));
	assert.equal(shouldWake("tA", delivered), false);
	const one = [...delivered, msg("r1", { topic: "t1", from: "bk", to: "ar", kind: "reply", fromThread: "tB", toThread: "tA" })];
	assert.deepEqual(pendingOf("tA", one).map((m) => m.id), ["a2"]);
	assert.equal(shouldWake("tA", one), false);
	const both = [...one, msg("r2", { topic: "t2", from: "ve", to: "ar", kind: "reply", fromThread: "tV", toThread: "tA" })];
	assert.deepEqual(pendingOf("tA", both), []);
	assert.equal(shouldWake("tA", both), true);
	assert.deepEqual(inboxOf("tA", both).map((m) => m.id), ["r1", "r2"]);
});

test("wake: one reply in and the other ask failed wakes", () => {
	const ms = [
		msg("a1", { topic: "t1", state: "delivered" }),
		msg("a2", { topic: "t2", to: "ve", toThread: "tV", state: "failed" }),
		msg("r1", { topic: "t1", from: "bk", to: "ar", kind: "reply", fromThread: "tB", toThread: "tA" }),
	];
	assert.deepEqual(pendingOf("tA", ms), []);
	assert.equal(shouldWake("tA", ms), true);
	// a stopped ask does not hold the thread either
	const stopped = ms.map((m) => (m.id === "a2" ? { ...m, state: "stopped" as const } : m));
	assert.equal(shouldWake("tA", stopped), true);
});

test("pending: a reply that comes before the ask on the same topic does not answer it; replies and tasks", () => {
	const early = [msg("r0", { topic: "t1", from: "bk", to: "ar", kind: "reply", fromThread: "tB", toThread: "tA", state: "delivered" }), msg("a1", { topic: "t1", state: "delivered" })];
	assert.deepEqual(pendingOf("tA", early).map((m) => m.id), ["a1"]);
	// a reply is never pending
	assert.deepEqual(pendingOf("tB", [msg("r", { kind: "reply", fromThread: "tB", toThread: "tA" })]), []);
	// a task is pending like an ask
	assert.deepEqual(pendingOf("tA", [msg("t", { kind: "task", state: "delivered" })]).map((m) => m.id), ["t"]);
});

test("renderTask gives the office's UZDEVUMS block", () => {
	const t: TaskEnvelope = { id: "U-12", stage: "S4", goal: "Pārbaudīt pārseguma biezumu asīs 1-4.", context: ["04_modeli/ifc/AR.ifc", "L-7"], expects: "atbilde ar pamatojumu", iteration: 1, limits: "nemainīt modeli" };
	assert.equal(
		renderTask(t, "bk"),
		[
			"UZDEVUMS: U-12 | Stadija: S4 | Aģents: bk",
			"Mērķis: Pārbaudīt pārseguma biezumu asīs 1-4.",
			"Konteksta pakete: 04_modeli/ifc/AR.ifc; L-7",
			"Gaidāmā izeja: atbilde ar pamatojumu",
			"Termiņš / iterācija: 1 no 3",
			"Ierobežojumi: nemainīt modeli",
		].join("\n"),
	);
});

test("renderTask: missing stage, context and limits read 'nav'; the limit comes from the argument", () => {
	const out = renderTask({ id: "U-1", goal: "G", context: [], expects: "E", iteration: 2 }, "ar", 5).split("\n");
	assert.equal(out[0], "UZDEVUMS: U-1 | Stadija: nav | Aģents: ar");
	assert.equal(out[2], "Konteksta pakete: nav");
	assert.equal(out[4], "Termiņš / iterācija: 2 no 5");
	assert.equal(out[5], "Ierobežojumi: nav");
});

test("renderReply gives the office's ATBILDE block", () => {
	const r: ReplyEnvelope = { id: "U-12", status: "daļēji", results: ["03_dokumenti/atzinums.docx", "L-9"], questions: ["J-4"], decisions: ["L-7"], risks: "trūkst griezuma" };
	assert.equal(
		renderReply(r),
		["ATBILDE: U-12 | Statuss: daļēji", "Rezultāts: 03_dokumenti/atzinums.docx; L-9", "Jautājumi: J-4", "Vienošanās: L-7", "Riski: trūkst griezuma"].join("\n"),
	);
});

test("renderReply: empty lists and missing risks read 'nav'", () => {
	assert.equal(
		renderReply({ id: "U-3", status: "bloķēts", results: [], questions: [], decisions: [] }),
		["ATBILDE: U-3 | Statuss: bloķēts", "Rezultāts: nav", "Jautājumi: nav", "Vienošanās: nav", "Riski: nav"].join("\n"),
	);
});

const draft = (over: Partial<Omit<Message, "id" | "at" | "state">> = {}): Omit<Message, "id" | "at" | "state"> => ({
	wave: "w1", topic: "tp1", from: "ar", to: "bk", kind: "ask", text: "x", refs: [], fromThread: "tA", toThread: "tB", depth: 0, ...over,
});

test("Mailbox: topics round trip, atomic file, closing", () => {
	const dir = join(tmp(), "mail");
	const mb = new Mailbox(dir);
	assert.deepEqual(mb.topics(), []);
	assert.deepEqual(mb.messages(), []);
	const t = mb.openTopic({ title: "Pārseguma biezums", parties: ["ar", "bk"], parent: null });
	assert.match(t.id, /^tp_/);
	assert.equal(t.state, "open");
	assert.ok(t.openedAt);
	assert.deepEqual(new Mailbox(dir).topics(), [t]);
	assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
	const closed = mb.closeTopic(t.id, "agreed", "n1");
	assert.equal(closed.state, "agreed");
	assert.equal(closed.noteId, "n1");
	assert.ok(closed.closedAt);
	assert.deepEqual(new Mailbox(dir).topics(), [closed]);
	assert.throws(() => mb.closeTopic(t.id, "passed-up", "n2"), /slēgts/);
	assert.throws(() => mb.closeTopic("nope", "agreed", "n"), /nav atrasts/);
});

test("Mailbox: add gives id, time and state queued; setState appends a line and the last one wins", () => {
	const dir = join(tmp(), "mail");
	const mb = new Mailbox(dir);
	const a = mb.add(draft());
	const b = mb.add(draft({ text: "y" }));
	assert.match(a.id, /^m_/);
	assert.equal(a.state, "queued");
	assert.ok(a.at);
	mb.setState(a.id, "delivered");
	const read = new Mailbox(dir).messages();
	assert.deepEqual(read.map((m) => [m.id, m.state]), [[a.id, "delivered"], [b.id, "queued"]]);
	assert.equal(readFileSync(join(dir, "messages.jsonl"), "utf8").trim().split("\n").length, 3);
	assert.throws(() => mb.setState("nope", "failed"), /nav atrasta/);
});

test("Mailbox: a torn last line loses nothing before it, and the next add is not glued to it", () => {
	const dir = join(tmp(), "mail");
	const mb = new Mailbox(dir);
	const a = mb.add(draft());
	const b = mb.add(draft({ text: "y" }));
	appendFileSync(join(dir, "messages.jsonl"), '{"id":"m_torn","at":"2026-01-01T00:00:0');
	assert.deepEqual(mb.messages().map((m) => m.id), [a.id, b.id]);
	const c = mb.add(draft({ text: "z" }));
	assert.deepEqual(new Mailbox(dir).messages().map((m) => m.id), [a.id, b.id, c.id]);
});

test("Mailbox: a torn state line leaves the earlier state of that id", () => {
	const dir = join(tmp(), "mail");
	const mb = new Mailbox(dir);
	const a = mb.add(draft());
	mb.setState(a.id, "delivered");
	appendFileSync(join(dir, "messages.jsonl"), `{"id":"${a.id}","state":"fail`);
	assert.equal(mb.messages()[0].state, "delivered");
});

test("Mailbox: a damaged topics.json reads as empty and does not throw", () => {
	const dir = join(tmp(), "mail");
	const mb = new Mailbox(dir);
	mb.openTopic({ title: "T", parties: ["ar", "bk"], parent: null });
	writeFileSync(join(dir, "topics.json"), "{ not json");
	assert.deepEqual(mb.topics(), []);
	assert.ok(existsSync(join(dir, "topics.json")));
});

test("wake (R22): a task or an ask wakes a thread that still waits for an answer on another topic; replies alone are batched", () => {
	// A asked B on t1 and waits; B asked A on t2
	const ms = [
		msg("a1", { topic: "t1", state: "delivered" }),
		msg("a2", { topic: "t2", from: "bk", to: "ar", kind: "ask", fromThread: "tB", toThread: "tA" }),
	];
	assert.deepEqual(pendingOf("tA", ms).map((m) => m.id), ["a1"]);
	assert.equal(shouldWake("tA", ms), true, "an ask in the inbox wakes at once");
	assert.equal(shouldWake("tA", [ms[0], { ...ms[1], kind: "task" as const }]), true);
	// the same inbox holding only a reply to another ask still waits
	const onlyReply = [msg("a1", { topic: "t1", state: "delivered" }), msg("a3", { topic: "t3", to: "ve", toThread: "tV", state: "delivered" }), msg("r3", { topic: "t3", from: "ve", to: "ar", kind: "reply", fromThread: "tV", toThread: "tA" })];
	assert.equal(shouldWake("tA", onlyReply), false);
});

test("answered: a later message on the topic back to the sender's thread answers it", () => {
	const a = msg("a1", { topic: "t1", state: "delivered" });
	assert.equal(answered(a, [a]), false);
	const early = msg("r0", { topic: "t1", from: "bk", to: "ar", kind: "reply", fromThread: "tB", toThread: "tA" });
	assert.equal(answered(a, [early, a]), false, "a reply before the ask does not count");
	assert.equal(answered(a, [a, { ...early, id: "r1" }]), true);
	assert.equal(answered(a, [a, { ...early, id: "r2", topic: "t2" }]), false);
});
