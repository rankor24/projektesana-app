// 13.4 agent knowledge: an office note an agent proposed (and the user accepted) is what that agent reads about itself. knowledgeFor builds the text,
// write_note stamps the agent, a specialist's run carries it and the lead's does not. Carried from the 13.3 review: helper lanes never get Revit, the
// seat is freed first, a lane's system text has no mail lines and no doubled rules, a lane's model id is trimmed.
// The agent loop is scripted (SessionDeps.runAgent); nothing leaves the machine.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { knowledgeFor } from "../src/agent/agents.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import { MAIL_RULES } from "../src/agent/mail.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { RULES } from "../src/agent/subagents.ts";
import { ThreadRunner, type RunInput } from "../src/agent/thread-runner.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import type { Note } from "../src/core/model.ts";
import { writeNoteFile } from "../src/core/notes.ts";
import { OfficeMemory } from "../src/core/office-memory.ts";
import { ThreadStore } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { LEAD_ID, type Thread } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const memOf = () => new OfficeMemory(join(tmp(), "memory"));
/** an accepted note of `agent` (the user accepts what the agent proposed) */
function accepted(m: OfficeMemory, agent: string | undefined, title: string, body: string, type: Note["type"] = "learning"): Note {
	const n = m.write({ type, title, body, ...(agent ? { agent } : {}) }, "agent");
	m.decide(n.id, true);
	return n;
}

// ---- the memory ---------------------------------------------------------------------------------------------------------------

test("13.4 a proposal is not knowledge; after the user accepts it, it is; another agent's note and an unstamped one are not", () => {
	const m = memOf();
	const p = m.write({ type: "learning", title: "Priekšlikums", body: "Gaida.", agent: "ar" }, "agent");
	assert.equal(p.state, "proposed");
	assert.equal(p.agent, "ar");
	assert.equal(knowledgeFor(m, "ar"), "", "a proposal waits");
	m.decide(p.id, true);
	assert.equal(knowledgeFor(m, "ar"), "### Priekšlikums\nGaida.");
	assert.equal(m.list().find((n) => n.id === p.id)!.agent, "ar", "accepting keeps the stamp");

	accepted(m, "bk", "Cita aģenta mācība", "Tikai BK.");
	// a note written before 13.4 (the user's, or an agent's without a stamp) belongs to no agent but stays in the shared memory
	m.write({ type: "learning", title: "Vecā piezīme", body: "Bez aģenta." }, "user");
	accepted(m, undefined, "Vecā aģenta piezīme", "Bez zīmoga.");
	assert.equal(knowledgeFor(m, "ar"), "### Priekšlikums\nGaida.");
	assert.equal(knowledgeFor(m, "bk"), "### Cita aģenta mācība\nTikai BK.");
	assert.equal(knowledgeFor(m, "nav-tāda"), "");
	const shared = m.list({ standing: true });
	assert.ok(shared.some((n) => n.title === "Vecā piezīme") && shared.some((n) => n.title === "Vecā aģenta piezīme"), "still in the office memory");
});

test("13.4 only learning notes count, newest first, each as '### title' and the body", () => {
	const m = memOf();
	// explicit times: two writes in one millisecond must not decide the order
	const put = (id: string, at: string, title: string, body: string, type: Note["type"] = "learning") => writeNoteFile(m.dir, { id, type, title, body, refs: [], by: "user", at, agent: "ar" }, join(m.dir, "versions"));
	put("o1", "2026-11-10T10:00:00.000Z", "Vecākā", "Pirmā.");
	put("o2", "2026-11-11T10:00:00.000Z", "Lēmums", "Nav mācība.", "decision");
	put("o3", "2026-11-12T10:00:00.000Z", "Jaunākā", "Otrā.");
	assert.equal(knowledgeFor(m, "ar"), ["### Jaunākā", "Otrā.", "", "### Vecākā", "Pirmā."].join(String.fromCharCode(10)));
});

test("13.4 the text stops at a whole note under the limit", () => {
	const m = memOf();
	const body = "x".repeat(900);
	for (let i = 0; i < 6; i++) accepted(m, "ar", `Mācība ${i}`, body);
	const k = knowledgeFor(m, "ar");
	assert.ok(k.length <= 4000, `${k.length}`);
	const blocks = k.split("\n\n");
	assert.equal(blocks.length, 4, "four whole notes of ~910 characters fit; the fifth would pass 4000");
	for (const b of blocks) assert.match(b, /^### Mācība \d\nx{900}$/, "no note is cut in the middle");
	assert.equal(knowledgeFor(m, "ar", 1000).split("\n\n").length, 1);
	assert.equal(knowledgeFor(m, "ar", 10), "", "a limit below the first note: nothing, never a torn note");
});

test("13.4 list can ask for one agent's notes", () => {
	const m = memOf();
	accepted(m, "ar", "AR viens", "a");
	m.write({ type: "learning", title: "AR gaida", body: "b", agent: "ar" }, "agent");
	accepted(m, "bk", "BK viens", "c");
	assert.deepEqual(m.list({ agent: "ar" }).map((n) => n.title).sort(), ["AR gaida", "AR viens"], "proposals too: the user sees them");
	assert.deepEqual(m.list({ agent: "ar", standing: true }).map((n) => n.title), ["AR viens"]);
	assert.equal(m.list({ agent: "nav" }).length, 0);
	assert.equal(m.list().length, 3);
});

test("13.4 write_note in the office scope stamps the agent and still waits as a proposal; without an agent no stamp", async () => {
	const appDir = tmp();
	const ctx: ToolCtx = { projectsDir: tmp(), projectId: null, dataDir: tmp(), appDir, runDir: null, agent: "bk", thread: "t1" };
	const t = allTools().find((x) => x.name === "write_note")!;
	const a = (await t.run(ctx, { type: "learning", title: "Biroja mācība", body: "Der visiem.", scope: "birojs" } as never)) as { ok: boolean; state: string };
	assert.equal(a.state, "proposed");
	await t.run({ ...ctx, agent: null }, { type: "learning", title: "Bez aģenta", body: "x", scope: "birojs" } as never);
	const mem = new OfficeMemory(join(appDir, "memory"));
	assert.equal(mem.list().find((n) => n.title === "Biroja mācība")!.agent, "bk");
	assert.ok(!("agent" in mem.list().find((n) => n.title === "Bez aģenta")!));
	assert.equal(knowledgeFor(mem, "bk"), "", "no tool of the agent accepts it");
});

// ---- the run ------------------------------------------------------------------------------------------------------------------

type Run = (o: PiRunOptions) => Promise<void>;
const REVIT = { tools: ["revit_edit", "create_level"], levels: { revit_edit: "run", create_level: "confirm" } as Record<string, "run" | "confirm"> };
const mk = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: `Aģents ${id}`, description: `apraksts ${id}`, prompt: `Tu esi ${id}, ar savu darbu.`, tools: [], ...extra });

function setup(runAgent: Run, o: { specs?: AgentSpec[]; locks?: LockRegistry } = {}) {
	const dir = tmp();
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const store = new ThreadStore(join(dir, "threads"));
	const locks = o.locks ?? new LockRegistry({ waitMs: 60 });
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, ...REVIT }),
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		complete: async () => ({}) as never,
		runAgent,
		agents: () => o.specs ?? [],
		threads: () => store,
		locks,
	});
	let n = 0;
	const run = (thread: Thread, text: string, extra: Partial<RunInput> = {}) =>
		runner.run({ runId: `r${++n}`, thread, spec: null, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => true, ...extra });
	const lead = () => store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" });
	const of = (spec: AgentSpec) => store.create({ projectId: "p1", agent: spec.id, title: spec.name, startedBy: "user" });
	return { dir, rt, store, runner, locks, run, lead, of, memory: new OfficeMemory(join(dir, "memory")) };
}

test("13.4 a specialist's run carries its own accepted lessons; the lead's text does not change", async () => {
	const ar = mk("ar");
	const sys: Record<string, string> = {};
	const t = setup(async (o) => (sys[o.prompt.includes("LEAD-RUN") ? "lead" : "ar"] = o.systemPrompt ?? "", o.onEvent({ type: "done", text: "ok" })), { specs: [ar] });
	accepted(t.memory, "ar", "Mana mācība", "Pārbaudi mērogu.");
	accepted(t.memory, "bk", "Svešā mācība", "Cita aģenta.");
	accepted(t.memory, LEAD_ID, "Galvenā mācība", "Galvenā aģenta.");
	t.memory.write({ type: "learning", title: "Gaidošā mācība", body: "Vēl nav pieņemta.", agent: "ar" }, "agent");
	await t.run(t.of(ar), "SPEC-RUN", { spec: ar });
	await t.run(t.lead(), "LEAD-RUN");
	assert.match(sys.ar, /### Mana mācība\nPārbaudi mērogu\./);
	assert.doesNotMatch(sys.ar, /Svešā mācība|Galvenā mācība|Gaidošā mācība/);
	assert.doesNotMatch(sys.lead, /Mana mācība|Galvenā mācība|### /, "the lead reads office memory through read_notes, not its standing text");
});

test("13.4 the meter counts the lessons a specialist carries", async () => {
	const ar = mk("ar");
	const t = setup(async () => undefined, { specs: [ar] });
	const before = (await t.runner.context(t.of(ar))).fixedEstimate;
	accepted(t.memory, "ar", "Mana mācība", "x".repeat(2000));
	const after = (await t.runner.context(t.of(ar))).fixedEstimate;
	assert.ok(after > before + 400, `${before} -> ${after}`);
});

// ---- carried from the 13.3 review ----------------------------------------------------------------------------------------------

test("13.4 R29: a lane of delegate has no revit server, even when the parent holds the seat", async () => {
	const sp = mk("rv", { tools: ["revit_edit"] });
	const seen: { revit: boolean; allow: string[]; parentHolds: boolean }[] = [];
	let parent: Record<string, unknown> | null = null;
	const t = setup(
		async (o) => {
			if (o.extraTools) {
				parent = { ...o.mcp };
				await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "rv", task: "lane" }] }, o.signal);
				await o.extraTools.find((x) => x.name === "run_subagent")!.execute("d2", { tasks: [{ task: "lasi" }] }, o.signal);
			} else seen.push({ revit: !!o.mcp?.revit, allow: Object.values(o.mcp).flatMap((m) => m.allow), parentHolds: t.locks.seatHeldBy() === "run:r1" });
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [sp] },
	);
	await t.run(t.lead(), "deleģē");
	assert.ok(parent && "revit" in parent, "the lead itself has Revit");
	assert.equal(seen.length, 2);
	for (const s of seen) {
		assert.ok(s.parentHolds, "the parent holds the seat while its lanes run");
		assert.equal(s.revit, false, "a second connection to the one Revit is not opened");
		assert.ok(!s.allow.some((n) => REVIT.tools.includes(n)), s.allow.join(","));
	}
	assert.equal(t.locks.seatHeldBy(), null);
});

test("13.4 the seat is freed even when the batch cannot be ended", async () => {
	class Broken extends LockRegistry {
		override endBatch(): void {
			throw new Error("endBatch failed");
		}
	}
	const conf = mk("conf", { maxLevel: "confirm", tools: ["revit_edit", "create_level"] });
	const locks = new Broken({ waitMs: 60 });
	const ctxFor = (name: string, id: string) => ({ toolCall: { id, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [{ type: "toolCall", id, name, arguments: {} }] }, context: {} }) as unknown as BeforeToolCallContext;
	const t = setup(
		async (o) => {
			assert.equal(await o.beforeToolCall!(ctxFor("create_level", "c1")), undefined, "the batch is confirmed and open");
			assert.equal(locks.seatHeldBy(), "run:r1");
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [conf], locks },
	);
	await assert.rejects(t.run(t.of(conf), "izveido", { spec: conf }), /endBatch failed/);
	assert.equal(locks.seatHeldBy(), null, "the next run can take Revit");
	assert.equal(locks.takeSeat("run:next", "nākamais"), true);
});

test("13.4 a lane's system text: its role once, the common rules once, no mail lines, no roster; a lane's model id is trimmed", async () => {
	const other = mk("bk");
	const sp = mk("rv", { prompt: "LANE-LOMA", mayMessage: ["bk"] });
	const seen: { system: string; modelId?: string }[] = [];
	let id = "";
	const t = setup(
		async (o) => {
			if (o.extraTools) {
				sp.model = `  ${id}  `;
				await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "rv", task: "lane" }] }, o.signal);
			} else seen.push({ system: o.systemPrompt ?? "", modelId: o.modelId });
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [sp, other] },
	);
	id = t.rt.models.getModels(DEFAULT_SETTINGS.provider as never)[0].id;
	accepted(t.memory, "rv", "Lanes mācība", "Zina arī lane.");
	await t.run(t.lead(), "deleģē");
	assert.equal(seen.length, 1);
	const s = seen[0];
	assert.equal(s.modelId, id, "trimmed, as modelFor does");
	assert.equal(s.system.split("LANE-LOMA").length, 2);
	assert.equal(s.system.split(RULES.trim()).length, 2, "the common rules are there once");
	assert.ok(s.system.endsWith(RULES), "and sit at the end");
	assert.ok(!s.system.includes(MAIL_RULES.trim()), "a lane has no mail tools");
	assert.ok(!s.system.includes("send_message"));
	assert.doesNotMatch(s.system, /^- bk: /m, "no roster");
	assert.match(s.system, /### Lanes mācība/, "what its agent has learned goes with it");
});

test("13.4 a thread of a specialist keeps the rules, mail lines and roster a lane leaves out", async () => {
	const sp = mk("rv", { mayMessage: ["bk"] });
	const other = mk("bk");
	let sys = "";
	const t = setup(async (o) => (sys = o.systemPrompt ?? "", o.onEvent({ type: "done", text: "ok" })), { specs: [sp, other] });
	await t.run(t.of(sp), "x", { spec: sp });
	assert.ok(sys.includes(RULES.trim()) && sys.includes(MAIL_RULES.trim()));
	assert.match(sys, /^- bk: /m);
});
