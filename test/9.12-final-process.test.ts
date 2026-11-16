// Final review, process side: bpv cannot move the process past a gate alone (R46), eks's pass-up in process mode goes to the user (I3),
// and a meta file is never missing while it is replaced (m3). Invented project and agents; nothing leaves the machine.
import assert from "node:assert/strict";
import fs, { existsSync, readFileSync, readdirSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { passUp } from "../src/agent/mail.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { canSend, DEFAULT_LIMITS, Mailbox } from "../src/core/messages.ts";
import { type GateArgs, changeProfile, decideGate, initial, readProcess, requestGate, skipStage, step, switchMode } from "../src/core/process.ts";
import { ProjectStore } from "../src/core/store.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { tmp } from "./helpers.ts";

const AGENTS = ["bpv", "eks", "ar"];
const ARGS: GateArgs = { result: ["x"], files: [], deviations: "nav", questions: [], risks: "", decisions: [], next: "S2" };
const rig = () => {
	const dir = tmp();
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	switchMode(store, "process", AGENTS, "user");
	const ctx = (agent: string | null): ToolCtx => ({ projectsDir: dir, projectId: "BD999", dataDir: dir, appDir: dir, runDir: null, agent, thread: null });
	return { dir, store, ctx };
};

// ---- I2 / R46 ---------------------------------------------------------------------------------------------------------------------

test("R46: an agent cannot skip S4 or S5; the user can; other agent skips stay allowed", () => {
	const { store } = rig();
	const trail: string[] = [];
	// S1 → S2 → S3 pass by an agent's skip
	for (const _ of [1, 2, 3]) trail.push(skipStage(store, "vienkāršs projekts", "agent").stage);
	assert.deepEqual(trail, ["S2", "S3", "S4"]);
	// now in S4: refused, state unchanged
	assert.throws(() => skipStage(store, "vienkāršs projekts", "agent"), /S4 izlaist drīkst tikai lietotājs\./);
	assert.equal(readProcess(store)!.stage, "S4");
	// the user may
	assert.equal(skipStage(store, "lietotājs izlaiž", "user").stage, "S5");
	assert.throws(() => skipStage(store, "vienkāršs projekts", "agent"), /S5 izlaist drīkst tikai lietotājs\./);
	assert.equal(readProcess(store)!.stage, "S5");
});

test("R46: step stage.skip by an agent is refused at S4 and S5 whatever the profile says", () => {
	for (const stage of ["S4", "S5"] as const) {
		const r = step({ ...initial("buvprojekts", AGENTS), stage }, { type: "stage.skip", why: "x", at: "2026-11-16T00:00:00Z", by: "agent" });
		assert.ok(!r.ok && r.error === `${stage} izlaist drīkst tikai lietotājs.`, JSON.stringify(r));
	}
});

test("R46: an agent's profile change is refused while any gate waits; the user's passes; after the decision the agent may again", () => {
	const { store } = rig();
	requestGate(store, "P", "bpv", ARGS);
	const patch = { why: "ātrāk", depth: { S2: "izlaiž", S3: "izlaiž", S4: "izlaiž", S5: "izlaiž" } } as never;
	assert.throws(() => changeProfile(store, patch, AGENTS, "agent"), /Gate H1 gaida lietotāja lēmumu; profilu tagad nemaina\./);
	assert.equal(readProcess(store)!.profile.depth.S4 !== "izlaiž", true, "nothing was written");
	// the user may change the profile even while a gate waits
	changeProfile(store, { why: "lietotāja izvēle", depth: { S2: "vienkāršota" } }, AGENTS, "user");
	decideGate(store, { approve: true });
	assert.doesNotThrow(() => changeProfile(store, { why: "pēc gate", depth: { S3: "vienkāršota" } }, AGENTS, "agent"));
});

test("R46: through the tool, process_set_profile and process_skip_stage give the refusals", async () => {
	const { store, ctx } = rig();
	const tool = (n: string) => allTools().find((t) => t.name === n)!;
	requestGate(store, "P", "bpv", ARGS);
	await assert.rejects(async () => tool("process_set_profile").run(ctx("bpv"), { why: "x", depth: { S2: "izlaiž" } } as never), /Gate H1 gaida/);
	decideGate(store, { approve: true });
	skipStage(store, "x", "agent");
	skipStage(store, "x", "agent");
	assert.equal(readProcess(store)!.stage, "S4");
	await assert.rejects(async () => tool("process_skip_stage").run(ctx("bpv"), { why: "x" } as never), /S4 izlaist drīkst tikai lietotājs\./);
});

// ---- I3 ---------------------------------------------------------------------------------------------------------------------------

test("I3: in process mode eks's pass-up goes to the user, writes no notice, and bpv cannot answer eks on it", () => {
	const dir = tmp();
	const mailbox = new Mailbox(join(dir, "mail"));
	const threads = new ThreadStore(join(dir, "threads"));
	const p = { ...initial("buvprojekts", ["bpv", "eks", "ar"]), stage: "S5" as const };
	const notes: { to?: string; id: string }[] = [];
	const eksThread = threads.create({ projectId: "p", agent: "eks", title: "S5", startedBy: "user" });
	const topic = mailbox.openTopic({ title: "Sienas U vērtība", parties: ["eks", "ar"], parent: null });
	const spec = (id: string) => ({ id, name: id, description: id, prompt: "x".repeat(12), tools: [] });
	let enqueued = 0;
	const d = {
		mailbox, threads, agents: () => [spec("bpv"), spec("eks"), spec("ar")], limits: () => DEFAULT_LIMITS,
		self: { agent: "eks", threadId: eksThread.id, projectId: "p", wave: "w1", depth: 0 }, enqueue: () => void enqueued++, note: () => undefined,
		notes: () => ({ writeNote: (n: never) => void notes.push(n), notes: () => notes as never }), process: () => p,
	};
	const q = passUp(d as never, topic, "Autors neatbild.");
	assert.equal(q.to, "user");
	assert.deepEqual(mailbox.messages(), [], "no notice and no mail");
	assert.equal(mailbox.topics().filter((t) => t.notice).length, 0);
	assert.equal(enqueued, 0);
	// the same call by an author goes to bpv with a notice (unchanged behaviour)
	const topic2 = mailbox.openTopic({ title: "Cits temats", parties: ["ar", "eks"], parent: null });
	const authorThread = threads.create({ projectId: "p", agent: "ar", title: "S5", startedBy: "user" });
	const q2 = passUp({ ...d, self: { ...d.self, agent: "ar", threadId: authorThread.id } } as never, topic2, "Eks neatbild.");
	assert.equal(q2.to, "bpv");
	const notice = mailbox.topics().find((t) => t.notice)!;
	assert.ok(notice);
	// and the wall holds for eks: bpv cannot reach it on a topic of its own either
	const r = canSend({ from: "bpv", to: "eks", kind: "ask", topic: null, depth: 1 }, { agents: d.agents(), limits: DEFAULT_LIMITS, messages: mailbox.messages(), process: p });
	assert.equal(r.ok, false);
});

// ---- m3 ---------------------------------------------------------------------------------------------------------------------------

test("m3: writeMeta never leaves the file missing; the replaced text is kept in versions", () => {
	const { store } = rig();
	const f = join(store.dir, "process.json");
	const seen: boolean[] = [];
	const real = { rename: fs.renameSync, copy: fs.copyFileSync };
	// every file operation the write makes: the live file must exist at each one
	fs.renameSync = ((a: string, b: string) => (seen.push(existsSync(f)), real.rename(a, b))) as never;
	fs.copyFileSync = ((a: string, b: string) => (seen.push(existsSync(f)), real.copy(a, b))) as never;
	syncBuiltinESMExports();
	try {
		const before = readFileSync(f, "utf8");
		store.writeMeta("process", { ...readProcess(store)!, stage: "S2" }, { kind: "process.test", by: "user" });
		assert.ok(seen.length > 0, "the write touched the file system");
		assert.ok(seen.every(Boolean), "the live file existed at every step");
		const kept = readdirSync(join(store.dir, "versions")).filter((n) => n.startsWith("process."));
		assert.ok(kept.some((n) => readFileSync(join(store.dir, "versions", n), "utf8") === before), "the old text is in versions");
		assert.equal(readProcess(store)!.stage, "S2");
		assert.ok(!readdirSync(store.dir).some((n) => n.endsWith(".tmp")));
	} finally {
		fs.renameSync = real.rename;
		fs.copyFileSync = real.copy;
		syncBuiltinESMExports();
	}
});
