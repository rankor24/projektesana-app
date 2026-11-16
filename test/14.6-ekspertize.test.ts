// 14.6 ekspertīze in process mode: the wall round eks (nobody asks or tasks it; it asks authors; replies on its own topics pass), its questions
// as notes, the S5 block on authors' write tools, remark classes, the 10% rule as a tool, the stage stamp on notes, read_notes for eks, and the fix
// ids of H5 checked against real remarks. Invented project and agents; the agent loop is scripted, nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mailTools, type MailDeps } from "../src/agent/mail.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { addRemark, fixList, readRemarks } from "../src/core/expertise.ts";
import { DEFAULT_LIMITS, Mailbox, canSend, mailDir, type Topic } from "../src/core/messages.ts";
import { type ProcessState, decideGate, initial, readProcess, requestGate, statusText, switchMode, writeProcess } from "../src/core/process.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { AppSettings } from "../src/main/settings.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: id, prompt: `You are AGENT ${id}.`, tools: [], ...extra });
const IDS = ["bpv", "eks", "ar", "bk"];
const PROFILE = ["bpv", "eks", "ar", "bk"];
const signal = new AbortController().signal;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((x) => x.text ?? "").join("");
const proc = (o: Partial<ProcessState> = {}): ProcessState => ({ ...initial("buvprojekts", PROFILE), ...o });

type M = { from: string; to: string; kind: "task" | "ask" | "reply"; topic: Topic | null; depth: number };
const msg = (o: Partial<M> = {}): M => ({ from: "ar", to: "eks", kind: "ask", topic: null, depth: 1, ...o });
const specs = (eks: Partial<AgentSpec> = {}) => [...IDS.map((id) => spec(id, id === "eks" ? eks : {})), spec("ek")];
const ctx = (process: ProcessState | null, eks: Partial<AgentSpec> = {}, messages: never[] = []) => ({ agents: specs(eks), limits: DEFAULT_LIMITS, messages, process });
const topicOf = (parties: string[], state: Topic["state"] = "open"): Topic => ({ id: "tp_1", title: "Siena", parties, parent: null, state, openedAt: "2026-11-16T10:00:00Z" });
const refusal = (m: M, p: ProcessState | null, eks: Partial<AgentSpec> = {}) => {
	const r = canSend(m, ctx(p, eks));
	assert.equal(r.ok, false, `refused: ${JSON.stringify(m)}`);
	return r as Extract<ReturnType<typeof canSend>, { ok: false }>;
};

// ---- the wall ---------------------------------------------------------------------------------------------------------------

test("14.6 nobody asks or tasks eks: bpv, an author, any stage; with or without a spec that lists acceptsFrom", () => {
	for (const eks of [{}, { acceptsFrom: [] }]) {
		for (const stage of ["S1", "S4", "S5", "S6"] as const) {
			for (const [from, kind] of [["bpv", "task"], ["bpv", "ask"], ["ar", "ask"], ["ar", "task"], ["bk", "ask"]] as const) {
				const r = refusal(msg({ from, kind }), proc({ stage }), eks);
				assert.equal(r.code, "acl", `${from} ${kind} ${stage}`);
			}
		}
	}
	// the process rule's own text, when the spec does not close the door itself
	assert.equal(refusal(msg({ from: "bpv", kind: "task" }), proc()).reason, "Ekspertīzes aģentam raksta tikai atbildes uz tā jautājumiem.");
});

test("14.6 cowork and no state: the wall is the process's, it does not apply", () => {
	for (const p of [proc({ mode: "cowork" }), null]) assert.equal(canSend(msg({ from: "bpv", kind: "task" }), ctx(p)).ok, true, String(p?.mode));
});

test("14.6 eks asks any author of the profile; an agent outside the profile it cannot reach", () => {
	assert.equal(canSend(msg({ from: "eks", to: "ar", kind: "ask" }), ctx(proc({ stage: "S5" }))).ok, true);
	assert.equal(canSend(msg({ from: "eks", to: "ar", kind: "ask" }), ctx(proc({ stage: "S4" }))).ok, true, "an ask is not a task: any stage");
	assert.equal(refusal(msg({ from: "eks", to: "ek", kind: "ask" }), proc()).reason, "Aģents ek nav procesa profilā.");
});

test("14.6 a reply on a topic eks opened passes, from the author and from eks; any other reply to eks is refused", () => {
	const t = topicOf(["eks", "ar"]);
	for (const eks of [{}, { acceptsFrom: [] }]) {
		assert.equal(canSend(msg({ from: "ar", to: "eks", kind: "reply", topic: t }), ctx(proc({ stage: "S5" }), eks)).ok, true);
		assert.equal(canSend(msg({ from: "eks", to: "ar", kind: "reply", topic: t }), ctx(proc({ stage: "S5" }), eks)).ok, true);
	}
	assert.equal(refusal(msg({ from: "ar", to: "eks", kind: "reply", topic: null }), proc()).code, "acl", "no topic");
	assert.equal(refusal(msg({ from: "bk", to: "eks", kind: "reply", topic: t }), proc()).code, "acl", "not a party");
	assert.equal(refusal(msg({ from: "ar", to: "eks", kind: "reply", topic: topicOf(["eks", "ar"], "agreed") }), proc()).code, "acl", "a closed topic");
	// eks answers nothing it was not asked: a reply from eks on a topic of two others' is refused
	assert.equal(refusal(msg({ from: "eks", to: "ar", kind: "reply", topic: null }), proc()).code, "acl");
});

test("14.6 eks gives tasks as the leader of S5 only, and only to the profile", () => {
	assert.equal(canSend(msg({ from: "eks", to: "ar", kind: "task" }), ctx(proc({ stage: "S5" }))).ok, true);
	assert.equal(refusal(msg({ from: "eks", to: "ar", kind: "task" }), proc({ stage: "S4" })).reason, "Procesa režīmā uzdevumus dod tikai stadijas vadītājs (bpv).");
	assert.equal(refusal(msg({ from: "eks", to: "ek", kind: "task" }), proc({ stage: "S5" })).reason, "Aģents ek nav procesa profilā.");
});

// ---- eks's questions as notes ---------------------------------------------------------------------------------------------

function rig(o: { agent: string; process?: ProcessState | null }) {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa projekts", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const mailbox = new Mailbox(mailDir(dir, dir, "BD999"));
	const threads = new ThreadStore(threadsDir(dir, dir, "BD999"));
	const mine = threads.create({ projectId: "BD999", agent: o.agent, title: "Saruna", startedBy: "user" });
	let current = o.process ?? null;
	const d: MailDeps = {
		mailbox, threads, agents: () => specs(), limits: () => DEFAULT_LIMITS,
		self: { agent: o.agent, threadId: mine.id, projectId: "BD999", wave: "w1", depth: 0 },
		enqueue: () => undefined, note: () => undefined, notes: () => store, notesChanged: () => undefined, process: () => current,
	};
	const [send, close] = mailTools(d);
	return { store, mailbox, threads, mine, d, set: (p: ProcessState | null) => (current = p), sendMsg: (p: Record<string, unknown>) => send.execute("t", p as never, signal), closeTopic: (p: Record<string, unknown>) => close.execute("t", p as never, signal) };
}

test("14.6 S5: eks asks ar, the question is a note of eks, ar's reply arrives at eks and is a note too; a message to eks from bpv is refused", async () => {
	const eks = rig({ agent: "eks", process: proc({ stage: "S5" }) });
	const out = await eks.sendMsg({ to: "ar", title: "Evakuācija", kind: "ask", text: "Kur ir otrais evakuācijas ceļš?" });
	assert.ok(!out.isError, text(out));
	const topic = eks.mailbox.topics()[0];
	const q = eks.store.notes("question");
	assert.equal(q.length, 1);
	assert.deepEqual([q[0].agent, q[0].to, q[0].status, q[0].stage, q[0].topic, q[0].by], ["eks", "ar", "open", "S5", topic.id, "agent"]);
	assert.match(q[0].body, /otrais evakuācijas ceļš/);
	assert.equal(eks.mailbox.topics()[0].state, "open", "the topic stays open: the author has to answer on it");

	// ar answers on the same topic: the mailbox is shared, so the same rig hears it
	const ar = { ...eks.d, self: { ...eks.d.self, agent: "ar", threadId: eks.threads.create({ projectId: "BD999", agent: "ar", title: "x", startedBy: "eks" }).id } };
	const [arSend] = mailTools(ar);
	const reply = await arSend.execute("t", { to: "eks", topic: topic.id, kind: "reply", text: "Otrais ceļš ir pa rietumu kāpnēm." } as never, signal);
	assert.ok(!reply.isError, text(reply));
	const last = eks.mailbox.messages().at(-1)!;
	assert.deepEqual([last.from, last.to, last.kind], ["ar", "eks", "reply"]);
	const notes = eks.store.notes("question");
	assert.equal(notes.length, 2);
	const answer = notes.find((n) => n.id !== q[0].id)!;
	assert.deepEqual([answer.agent, answer.status, answer.stage], ["eks", "closed", "S5"]);
	assert.match(answer.body, /rietumu kāpnēm/);

	// bpv writes to eks: refused, nothing sent, nothing written
	const bpv = mailTools({ ...eks.d, self: { ...eks.d.self, agent: "bpv" } })[0];
	const no = await bpv.execute("t", { to: "eks", title: "Lūdzu", kind: "ask", text: "palīdzi" } as never, signal);
	assert.equal(no.isError, true);
	assert.equal(eks.mailbox.messages().length, 2);
	assert.equal(eks.store.notes("question").length, 2);
});

test("14.6 outside S5, and in cowork, eks's ask writes no note; an ask of an author to a colleague never does", async () => {
	const r = rig({ agent: "eks", process: proc({ stage: "S6" }) });
	assert.ok(!(await r.sendMsg({ to: "ar", title: "Pārbaude", kind: "ask", text: "kā ar plānu?" })).isError);
	r.set(proc({ stage: "S5", mode: "cowork" }));
	assert.ok(!(await r.sendMsg({ to: "ar", title: "Pārbaude 2", kind: "ask", text: "kā ar griezumu?" })).isError);
	assert.deepEqual(r.store.notes("question"), []);
	const a = rig({ agent: "ar", process: proc({ stage: "S5" }) });
	assert.ok(!(await a.sendMsg({ to: "bk", title: "Siena", kind: "ask", text: "cik bieza?" })).isError);
	assert.deepEqual(a.store.notes("question"), []);
});

// ---- the stage stamp (R39) ------------------------------------------------------------------------------------------------

test("14.6 notes written by close_topic (agreed and passed-up) carry the stage in process mode, and none in cowork", async () => {
	const r = rig({ agent: "ar", process: proc({ stage: "S4" }) });
	const flags = { cost: false, time: false, norms: false, pu: false };
	// a pass-up opens a notice topic of its own: topics are found by title
	const close = async (title: string, outcome: "agreed" | "passed-up", impact = flags) => {
		await r.sendMsg({ to: "bk", title, kind: "ask", text: "cik bieza?" });
		return r.closeTopic({ topic: r.mailbox.topics().find((t) => t.title === title)!.id, outcome, decision: "Lēmums.", impact });
	};
	await close("Siena", "agreed");
	await close("Siena 2", "passed-up");
	await close("Siena 3", "agreed", { ...flags, cost: true });
	const stages = r.store.notes().map((n) => [n.type, n.stage]);
	assert.deepEqual(stages.sort(), [["decision", "S4"], ["question", "S4"], ["question", "S4"]].sort());
	r.set(proc({ mode: "cowork", stage: "S4" }));
	await close("Siena 4", "agreed");
	assert.equal(r.store.notes().find((n) => n.title === "Siena 4")!.stage, undefined);
});

function toolRig(o: { process?: "process" | "cowork" | null; stage?: ProcessState["stage"] } = {}) {
	const dir = tmp();
	const root = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root, createdAt: "2026-11-16T00:00:00Z" });
	if (o.process) {
		switchMode(store, "process", IDS, "user");
		if (o.stage) writeProcess(store, { ...readProcess(store)!, stage: o.stage }, "user");
		if (o.process === "cowork") switchMode(store, "cowork", IDS, "user");
	}
	const ctx = (agent: string | null): ToolCtx => ({ projectsDir: dir, projectId: "BD999", dataDir: dir, appDir: dir, runDir: null, agent, thread: null });
	const call = async (agent: string | null, name: string, args: Record<string, unknown> = {}) => allTools().find((t) => t.name === name)!.run(ctx(agent), args as never);
	return { dir, store, ctx, call };
}

test("14.6 write_note stamps the stage in process mode; in cowork, no stage", async () => {
	const p = toolRig({ process: "process", stage: "S3" });
	await p.call("ar", "write_note", { type: "learning", title: "Mācība par sienām", body: "Mērīt pirms zīmēt." });
	assert.equal(p.store.notes("learning")[0].stage, "S3");
	const c = toolRig({ process: "cowork" });
	await c.call("ar", "write_note", { type: "learning", title: "Mācība par sienām", body: "Mērīt pirms zīmēt." });
	assert.equal(c.store.notes("learning")[0].stage, undefined);
	const none = toolRig();
	await none.call("ar", "write_note", { type: "learning", title: "Mācība par sienām", body: "Mērīt pirms zīmēt." });
	assert.equal(none.store.notes("learning")[0].stage, undefined);
});

test("14.6 read_notes: eks in process mode reads no decision, question or answer that is not its own; others read everything", async () => {
	const p = toolRig({ process: "process", stage: "S5" });
	const mk = (type: "decision" | "question" | "learning" | "answer", agent: string | undefined, title: string) =>
		p.store.writeNote({ id: `n_${title}`, type, title, body: "teksts", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", ...(agent ? { agent } : {}) });
	mk("decision", "ar", "Vienošanās ar bk");
	mk("question", "ar", "Jautājums ar bk");
	mk("question", "eks", "Eks jautā");
	mk("learning", "ar", "Mācība");
	mk("answer", undefined, "Lietotāja atbilde");
	const titles = async (agent: string, a: Record<string, unknown> = {}) => {
		const r = (await p.call(agent, "read_notes", a)) as string | { title: string }[];
		return typeof r === "string" ? [] : r.map((n) => n.title).sort();
	};
	// the user's answer note is hidden too since 14.7 (R42)
	assert.deepEqual(await titles("eks"), ["Eks jautā", "Mācība"]);
	assert.deepEqual(await titles("eks", { type: "decision" }), [], "asking for the type directly changes nothing");
	assert.deepEqual(await titles("ar"), ["Eks jautā", "Jautājums ar bk", "Lietotāja atbilde", "Mācība", "Vienošanās ar bk"]);
	// not in process mode: eks reads like anyone
	const c = toolRig({ process: "cowork" });
	c.store.writeNote({ id: "n1", type: "decision", title: "Vienošanās", body: "x", refs: [], by: "agent", at: "2026-11-16T10:00:00Z", agent: "ar" });
	assert.equal(((await c.call("eks", "read_notes", {})) as unknown[]).length, 1);
});

// ---- classes ------------------------------------------------------------------------------------------------------------------

function withSource(store: ProjectStore) {
	const pages = [
		"Atzinums\n- [ ] A1 Nav norādīts evakuācijas ceļu platums 2. stāva plānā.\n- [ ] A2 Jāprecizē durvju ugunsdrošības klase pie kāpņu telpas.\n- [ ] A3 Fasādes apraksts nav pilnīgs un jāpapildina.\n- [ ] A4 Eksplikācijā jāpārbauda telpu numuri.",
	];
	store.writeText("sha_exp", { pages, state: "ok" });
	store.write("sources", [{ id: "s_exp", kind: "document", folderKey: "1.1.9", paths: ["Atzinums.pdf"], title: "Atzinums.pdf", role: "Cits", roleFrom: "unconfirmed", versions: [{ sha256: "sha_exp", size: 1, mtime: "2026-11-01T00:00:00Z", seenAt: "2026-11-13T00:00:00Z", textState: "ok", pages: 1 }], signers: [] } as never], { kind: "t", by: "app" });
}

test("14.6 expert_add stores the class; a bad class is refused; the fix list groups by class inside the daļa (K, B, I, then none)", async () => {
	const t = toolRig();
	withSource(t.store);
	const add = (quote: string, cls?: string) => t.call("ar", "expert_add", { sourceId: "s_exp", page: 1, quote, daļa: "AR", ...(cls ? { class: cls } : {}) });
	await add("Nav norādīts evakuācijas ceļu platums 2. stāva plānā.", "I");
	await add("Jāprecizē durvju ugunsdrošības klase pie kāpņu telpas.", "K");
	await add("Fasādes apraksts nav pilnīgs un jāpapildina.");
	await add("Eksplikācijā jāpārbauda telpu numuri.", "B");
	const all = readRemarks(t.store);
	assert.deepEqual(all.map((r) => r.class), ["I", "K", undefined, "B"]);
	await assert.rejects(async () => add("Eksplikācijā jāpārbauda telpu numuri. ", "X"), /Piezīmes klase/);
	const md = fixList(all, "AR");
	const order = ["Klase K", "Klase B", "Klase I", "Bez klases"].map((h) => md.indexOf(h));
	assert.ok(order.every((x) => x >= 0), md);
	assert.deepEqual([...order].sort((a, b) => a - b), order, "K, B, I, then unclassed");
	assert.ok(md.indexOf("durvju") > order[0] && md.indexOf("durvju") < order[1], "K's remark under K");
	assert.ok(md.indexOf("Eksplikācijā") > order[1] && md.indexOf("Eksplikācijā") < order[2]);
	assert.ok(md.indexOf("Fasādes") > order[3]);
	// no class on any remark: the list is the one it always was, no class heading
	assert.ok(!/Klase|Bez klases/.test(fixList(all.map(({ class: _c, ...r }) => r), "AR")));
	// the tool's listing carries the class
	const rows = (await t.call("ar", "expert_remarks", {})) as { remarks: { class?: string }[] };
	assert.deepEqual(rows.remarks.map((r) => r.class).sort(), ["B", "I", "K", undefined].sort());
});

test("14.6 addRemark keeps the class given; the same remark added again is one", () => {
	const t = toolRig();
	withSource(t.store);
	const q = "Eksplikācijā jāpārbauda telpu numuri.";
	const r = addRemark(t.store, { sourceId: "s_exp", page: 1, quote: q, class: "B" }, "agent");
	assert.equal(r.class, "B");
	assert.equal(addRemark(t.store, { sourceId: "s_exp", page: 1, quote: q }, "agent").id, r.id);
	assert.equal(readRemarks(t.store).length, 1);
});

// ---- the 10% rule ---------------------------------------------------------------------------------------------------------

function withDraft(store: ProjectStore, n: number) {
	const items = Array.from({ length: n }, (_, i) => ({ sheetNo: `L${i + 1}`, title: `Lapa ${i + 1}`, file: `C:\\data\\nodevumi\\BP\\261120\\Lapa_${i + 1}.pdf`, sha: null }));
	store.write("deliveries", [{ id: "BP_261120", stage: "Koncept", kind: "BP", label: "BP 261120", plannedDate: "2026-11-20", submittedDate: null, folder: null, items, checksRun: [], draft: { stagingDir: "C:\\data\\nodevumi\\BP\\261120", startedAt: "2026-11-16T10:00:00Z", date: "2026-11-20", copiedTo: null } } as never], { kind: "t", by: "app" });
	return items.map((i) => i.file);
}

test("14.6 process_review_scope: 1 of 10 changed is partial, 2 of 10 full; the delivery draft's files are the whole", async () => {
	const t = toolRig({ process: "process", stage: "S6" });
	const files = withDraft(t.store, 10);
	const one = (await t.call("eks", "process_review_scope", { changed: [files[0]] })) as { mode: string; share: number; changed: number; of: number };
	assert.deepEqual([one.mode, one.share, one.changed, one.of], ["partial", 0.1, 1, 10]);
	const two = (await t.call("eks", "process_review_scope", { changed: [files[0], files[3]] })) as { mode: string; share: number };
	assert.deepEqual([two.mode, two.share], ["full", 0.2]);
	// by file name, as the agent will have them from the checklist; the same file twice is one
	const byName = (await t.call("eks", "process_review_scope", { changed: ["Lapa_1.pdf", "lapa_1.pdf", files[0]] })) as { mode: string; changed: number; unmatched: string[] };
	assert.deepEqual([byName.mode, byName.changed, byName.unmatched], ["partial", 1, []]);
	// a name the draft does not have is said, and still counts as a changed document
	const odd = (await t.call("eks", "process_review_scope", { changed: ["Lapa_1.pdf", "Cits.pdf"] })) as { mode: string; unmatched: string[] };
	assert.deepEqual([odd.mode, odd.unmatched], ["full", ["Cits.pdf"]]);
});

test("14.6 process_review_scope: no draft says so; co-work refuses; only eks is offered it", async () => {
	const t = toolRig({ process: "process", stage: "S6" });
	assert.equal(await t.call("eks", "process_review_scope", { changed: ["a.pdf"] }), "nav aktīva nodevuma");
	const c = toolRig({ process: "cowork" });
	await assert.rejects(async () => c.call("eks", "process_review_scope", { changed: ["a.pdf"] }), /Procesa režīms nav ieslēgts/);
	const tool = allTools().find((x) => x.name === "process_review_scope")!;
	assert.equal(tool.level, "read");
	const { PROCESS_TOOLS_OF, PROCESS_OWN_TOOLS } = await import("../src/core/process-def.ts");
	assert.deepEqual([PROCESS_TOOLS_OF.eks.includes("process_review_scope"), PROCESS_TOOLS_OF.bpv.includes("process_review_scope"), PROCESS_OWN_TOOLS.has("process_review_scope")], [true, false, true]);
});

// ---- H5's fix ids ---------------------------------------------------------------------------------------------------------

test("14.6 process.gate (H5) refuses a fix id that is no remark: 'Nezināma piezīme: <id>'; known ids pass and S6 gets them", () => {
	const t = toolRig({ process: "process", stage: "S5" });
	withSource(t.store);
	const r = addRemark(t.store, { sourceId: "s_exp", page: 1, quote: "Eksplikācijā jāpārbauda telpu numuri.", class: "K" }, "agent");
	requestGate(t.store, "BD999", "eks", { result: ["Atzinums"], files: [], deviations: "", questions: [], risks: "", decisions: [], next: "S6" });
	assert.throws(() => decideGate(t.store, { approve: true, fix: [r.id, "s_exp:1:nav"] }), /Nezināma piezīme: s_exp:1:nav/);
	assert.equal(readProcess(t.store)!.stage, "S5", "nothing moved");
	const after = decideGate(t.store, { approve: true, fix: [r.id] });
	assert.equal(after.stage, "S6");
	assert.deepEqual(after.gates.find((g) => g.stage === "S5")!.fix, [r.id]);
});

// ---- the S5 block ---------------------------------------------------------------------------------------------------------

const S5 = "S5 laikā sadaļas autors nelabo projektu.";

function sessionRig(script?: (who: string, o: PiRunOptions) => Promise<void>) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	new AppSettings(dir, plainCrypto).saveAgentSpecs(IDS.map((id) => spec(id, { tools: ["set_fact", "write_note", "expert_add", "expert_import"] })));
	switchMode(store, "process", IDS, "user");
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const prompts = new Map<string, string>();
	const seen = new Map<string, { before: (name: string) => Promise<{ block?: boolean; reason?: string } | undefined>; after: () => Promise<unknown> }>();
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: { who: "x" } }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => IDS.map((id) => spec(id, { tools: ["set_fact", "write_note", "expert_add", "expert_import"] })),
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (o) => {
			const who = /AGENT (\w+)\./.exec(o.systemPrompt ?? "")?.[1] ?? "lead";
			prompts.set(who, o.systemPrompt ?? "");
			seen.set(who, {
				before: async (name) => (await o.beforeToolCall?.({ toolCall: { name, id: "t", arguments: {} }, args: {} } as never, new AbortController().signal)) as never,
				// the call that was let through holds the project's write lock until its end: free it, as the real loop does
				after: async () => o.afterToolCall?.({ toolCall: { id: "t" } } as never),
			});
			await script?.(who, o);
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const start = async (who: string) => {
		await s.sendToThread(s.openThread("BD999", who).id, "BD999", "sāc", []);
		for (let i = 0; i < 100 && (s.queueView().running.length || !seen.has(who)); i++) await new Promise((r) => setTimeout(r, 5));
	};
	const stage = (st: ProcessState["stage"]) => writeProcess(store, { ...readProcess(store)!, stage: st }, "user");
	const call = async (who: string, name: string) => {
		const r = await seen.get(who)!.before(name);
		await seen.get(who)!.after();
		return r;
	};
	const settle = async (until: () => boolean = () => true) => {
		for (let i = 0; i < 200 && (s.queueView().running.length || s.queueView().queued.length || !until()); i++) await new Promise((r) => setTimeout(r, 5));
	};
	return { start, stage, call, store, dir, s, prompts, settle };
}

test("14.6 S5: an author's, the lead's and bpv's write tools are refused at the gate with the one text; in S4 they pass; read tools always pass", async () => {
	const r = sessionRig();
	for (const who of ["lead", "bpv", "ar", "eks"]) await r.start(who);
	r.stage("S4");
	for (const who of ["bpv", "ar"]) assert.equal((await r.call(who, "set_fact"))?.reason, undefined, `${who} in S4`);
	assert.equal((await r.call("ar", "write_note"))?.block, undefined);
	r.stage("S5");
	for (const who of ["bpv", "ar"]) {
		for (const n of ["set_fact", "write_note"]) {
			const out = await r.call(who, n);
			assert.deepEqual([out?.block, out?.reason], [true, S5], `${who} ${n}`);
		}
		assert.equal((await r.call(who, "read_notes"))?.block, undefined, `${who} reads`);
		assert.equal((await r.call(who, "expert_add"))?.reason === S5, false, `${who}: expert_* is not the project`);
		assert.equal((await r.call(who, "send_message"))?.reason === S5, false, `${who}: mail passes`);
		assert.equal((await r.call(who, "close_topic"))?.reason === S5, false);
	}
	// the lead's gate: set_fact is one of its tools, and the same text
	assert.equal((await r.call("lead", "set_fact"))?.reason, S5);
	assert.equal((await r.call("lead", "delegate"))?.reason, S5, "a helper started by the lead would write the project");
	// eks works in S5: its own writes are not the authors' block
	assert.equal((await r.call("eks", "set_fact"))?.reason === S5, false);
	assert.equal((await r.call("eks", "write_note"))?.reason === S5, false);
	// S6: the block is over
	r.stage("S6");
	assert.equal((await r.call("ar", "set_fact"))?.reason === S5, false);
});

test("14.6 S5 block: read at call time (a gate that moves the stage mid-run opens it), and only in process mode", async () => {
	const r = sessionRig();
	await r.start("ar");
	r.stage("S5");
	assert.equal((await r.call("ar", "set_fact"))?.reason, S5);
	r.stage("S6");
	assert.equal((await r.call("ar", "set_fact"))?.reason === S5, false);
	r.stage("S5");
	switchMode(r.store, "cowork", IDS, "user");
	assert.equal((await r.call("ar", "set_fact"))?.reason === S5, false, "co-work: the stage is not a rule");
});

test("14.6 process_review_scope is eks's own: the lead's and bpv's gates refuse it, eks's lets it through", async () => {
	const r = sessionRig();
	for (const who of ["lead", "bpv", "eks"]) await r.start(who);
	for (const who of ["lead", "bpv"]) assert.equal((await r.call(who, "process_review_scope"))?.block, true, who);
	assert.equal((await r.call("eks", "process_review_scope"))?.block, undefined);
});

// ---- round 1: what eks's status shows, the S6 fix section, lanes, automatic replies --------------------------------------------

const note = (o: Partial<import("../src/core/model.ts").Note> & { id: string }) => ({ type: "question" as const, title: "T", body: "b", refs: [], by: "agent" as const, at: "2026-11-16T10:00:00Z", status: "open" as const, ...o });
const task = (id: string, from: string, to: string, goal: string, at: string) =>
	({ id, wave: "w", topic: "tp", from, to, kind: "task", text: goal, refs: [], fromThread: "a", toThread: "b", depth: 1, state: "queued", at, task: { id: `u${id}`, stage: "S5", goal, context: [], expects: "x", iteration: 1 } }) as never;

test("14.6 statusText for eks: only its own questions and the tasks it is a party of; the numbers stay the register's; others see everything", () => {
	const s = proc({ stage: "S5" });
	const notes = [
		note({ id: "n1", title: "Ar jautā par sienu", agent: "ar", to: "bk", at: "2026-11-16T10:00:00Z" }),
		note({ id: "n2", title: "Eks jautā par kāpnēm", agent: "eks", to: "ar", at: "2026-11-16T10:01:00Z" }),
	];
	const open = [task("m1", "bpv", "ar", "Sagatavot sienu sarakstu", "2026-11-16T10:00:00Z"), task("m2", "eks", "ar", "Pārbaudīt kāpnes", "2026-11-16T10:02:00Z")];
	const eks = statusText(s, { notes, open, now: "x", viewer: "eks" });
	assert.ok(eks.includes("Eks jautā par kāpnēm") && eks.includes("Pārbaudīt kāpnes"), eks);
	assert.ok(eks.includes("J-2 ar:"), "numbered over all the questions, as the register does");
	assert.ok(!eks.includes("Ar jautā par sienu") && !eks.includes("Sagatavot sienu sarakstu"), eks);
	const ar = statusText(s, { notes, open, now: "x", viewer: "ar" });
	for (const t of ["Ar jautā par sienu", "Eks jautā par kāpnēm", "Sagatavot sienu sarakstu", "Pārbaudīt kāpnes"]) assert.ok(ar.includes(t), t);
	assert.equal(statusText(s, { notes, open, now: "x" }), ar, "no viewer: the user's page");
});

test("14.6 eks's standing text in S5 holds no other agent's question title or task goal; an author's does", async () => {
	const r = sessionRig();
	r.stage("S5");
	r.store.writeNote(note({ id: "n1", title: "Ar jautā par sienu", agent: "ar", to: "bk" }));
	r.store.writeNote(note({ id: "n2", title: "Eks jautā par kāpnēm", agent: "eks", to: "ar", at: "2026-11-16T10:01:00Z" }));
	const mb = new Mailbox(mailDir(r.dir, r.dir, "BD999"));
	const m = (o: { from: string; to: string; goal: string }) => mb.add({ wave: "w", topic: "tp", from: o.from, to: o.to, kind: "task", text: o.goal, refs: [], fromThread: "a", toThread: "b", depth: 1, task: { id: "u", stage: "S5", goal: o.goal, context: [], expects: "x", iteration: 1 } });
	m({ from: "bpv", to: "ar", goal: "Sagatavot sienu sarakstu" });
	m({ from: "eks", to: "bk", goal: "Pārbaudīt kāpnes" });
	await r.start("eks");
	await r.start("ar");
	const eks = r.prompts.get("eks")!;
	assert.ok(eks.includes("Eks jautā par kāpnēm") && eks.includes("Pārbaudīt kāpnes"), "its own are there");
	assert.ok(!eks.includes("Ar jautā par sienu") && !eks.includes("Sagatavot sienu sarakstu"), "the others' are not");
	assert.ok(r.prompts.get("ar")!.includes("Ar jautā par sienu") && r.prompts.get("ar")!.includes("Sagatavot sienu sarakstu"));
});

test("14.6 S6 status: 'Labojamās piezīmes:' lists each H5 fix id as '- id [class] daļa: first 100 characters'; an unknown id and a remark with no class or daļa are said", () => {
	const long = "Nav norādīts evakuācijas ceļu platums 2. stāva plānā un nav parādīts, kā tas atbilst ugunsdrošības prasībām kāpņu telpā pie ieejas.";
	const remarks = [{ id: "r1", class: "K", daļa: "AR", quote: "Nav norādīts evakuācijas ceļu platums 2. stāva plānā." }, { id: "r2", daļa: null, quote: `${long}\n  otrā rinda` }];
	const gate = (fix: string[]) => ({ id: "H5" as const, stage: "S5" as const, iteration: 1, state: "approved" as const, noteId: "n", at: "2026-11-16T10:00:00Z", fix });
	const s6 = proc({ stage: "S6", gates: [gate(["r1", "r2", "r9"])] });
	const lines = statusText(s6, { notes: [], open: [], now: "x", remarks }).split("\n");
	const at = lines.indexOf("Labojamās piezīmes:");
	assert.ok(at > 0);
	assert.deepEqual(lines.slice(at + 1), ["- r1 [K] AR: Nav norādīts evakuācijas ceļu platums 2. stāva plānā.", `- r2 [-] -: ${long.slice(0, 100)}`, "- r9 [-] -: (piezīme nav atrasta)"]);
	// only S6 carries it, and only when H5 sent something
	for (const p of [proc({ stage: "S5", gates: [gate(["r1"])] }), proc({ stage: "S7", gates: [gate(["r1"])] }), proc({ stage: "S6", gates: [gate([])] })]) assert.ok(!statusText(p, { notes: [], open: [], now: "x", remarks }).includes("Labojamās"), p.stage);
	// the cut keeps the text under its limit and the heading
	const many = Array.from({ length: 80 }, (_, i) => `r${i}`);
	const cut = statusText(proc({ stage: "S6", gates: [gate(many)] }), { notes: [], open: [], now: "x", remarks }, 400);
	assert.ok(cut.length <= 400 && cut.includes("Labojamās piezīmes:"));
});

test("14.6 S6: every profile agent's standing text carries the fix remarks from the real remark list", async () => {
	const r = sessionRig();
	withSource(r.store);
	const rem = addRemark(r.store, { sourceId: "s_exp", page: 1, quote: "Eksplikācijā jāpārbauda telpu numuri.", class: "B", daļa: "AR" }, "agent");
	r.stage("S5");
	requestGate(r.store, "BD999", "eks", { result: ["Atzinums"], files: [], deviations: "", questions: [], risks: "", decisions: [], next: "S6" });
	decideGate(r.store, { approve: true, fix: [rem.id] });
	assert.equal(readProcess(r.store)!.stage, "S6");
	for (const who of ["bpv", "ar"]) {
		await r.start(who);
		const p = r.prompts.get(who)!;
		assert.ok(p.includes("Labojamās piezīmes:") && p.includes(`- ${rem.id} [B] AR: Eksplikācijā jāpārbauda telpu numuri.`), who);
	}
});

test("14.6 a lane started in S4 and still running in S5 is stopped by the same block", async () => {
	let ran = false;
	const r = sessionRig(async (who, o) => {
		if (who !== "lead" || ran) return;
		ran = true;
		const delegate = o.extraTools!.find((t) => t.name === "delegate")!;
		await delegate.execute("d", { jobs: [{ agent: "ar", task: "dari" }] } as never, new AbortController().signal);
	});
	await r.start("lead");
	await r.settle(() => ran);
	// the lane's run (its prompt names AGENT ar) left its gate in `seen`
	assert.equal((await r.call("ar", "set_fact"))?.reason, undefined, "S4: the lane writes");
	r.stage("S5");
	assert.deepEqual(await r.call("ar", "set_fact"), { block: true, reason: S5 });
	assert.equal((await r.call("ar", "read_notes"))?.block, undefined, "reading stays");
});

test("14.6 the coordinator's automatic reply to eks's S5 ask closes eks's question note", async () => {
	let asked = false;
	const r = sessionRig(async (who, o) => {
		if (who !== "eks" || asked) return;
		asked = true;
		const send = o.extraTools!.find((t) => t.name === "send_message")!;
		const out = await send.execute("s", { to: "ar", title: "Evakuācija", kind: "ask", text: "Kur ir otrais ceļš?" } as never, new AbortController().signal);
		assert.ok(!(out as { isError?: boolean }).isError, text(out as never));
	});
	r.stage("S5");
	await r.start("eks");
	// ar is woken, finishes without answering; the coordinator answers "daļēji" for it
	await r.settle(() => r.store.notes("question").some((n) => n.agent === "eks" && n.status === "closed"));
	const qs = r.store.notes("question").filter((n) => n.agent === "eks");
	assert.equal(qs.length, 1);
	assert.deepEqual([qs[0].status, qs[0].stage, qs[0].to], ["closed", "S5", "ar"]);
	const last = new Mailbox(mailDir(r.dir, r.dir, "BD999")).messages().at(-1)!;
	assert.deepEqual([last.from, last.to, last.reply?.status], ["ar", "eks", "daļēji"]);
});
