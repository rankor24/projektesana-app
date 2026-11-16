// 13.3 an agent that may confirm, and its own model: the Revit seat (one connection per Revit), confirm-level specialists whose gate asks the
// user, and spec.model / spec.effort per agent. The agent loop is scripted (SessionDeps.runAgent); nothing leaves the machine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { BeforeToolCallContext } from "@earendil-works/pi-agent-core";
import { writeRole } from "../src/agent/agents.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { ThreadRunner, type RunInput } from "../src/agent/thread-runner.ts";
import { RULES } from "../src/agent/subagents.ts";
import { ThreadStore } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { LEAD_ID, type Thread } from "../src/shared/thread-types.ts";
import type { RunEvent } from "../src/shared/types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

type Run = (o: PiRunOptions) => Promise<void>;

const SEAT_LINE = (who: string) => `Revit šobrīd lieto ${who}; Revit darbu atstāj vai jautā lietotājam.`;
const REVIT = { tools: ["revit_edit", "create_level"], levels: { revit_edit: "run", create_level: "confirm" } as Record<string, "run" | "confirm"> };

const mk = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: `Aģents ${id}`, description: `apraksts ${id}`, prompt: `Tu esi ${id}, ar savu darbu.`, tools: ["revit_edit", "create_level"], ...extra });

function setup(runAgent: Run, o: { specs?: AgentSpec[]; afterBatch?: (p: string, s: string) => Promise<string>; revitWork?: () => Promise<{ ok: boolean; title: string }>; locks?: LockRegistry; model?: string } = {}) {
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
		afterBatch: o.afterBatch,
		revitWork: o.revitWork,
		agents: () => o.specs ?? [],
		threads: () => store,
		locks,
	});
	let n = 0;
	const run = (thread: Thread, text: string, extra: Partial<RunInput> = {}) =>
		runner.run({ runId: `r${++n}`, thread, spec: null, text, focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => true, ...extra });
	const lead = () => store.create({ projectId: "p1", agent: LEAD_ID, title: "A", startedBy: "user" });
	const of = (spec: AgentSpec) => store.create({ projectId: "p1", agent: spec.id, title: spec.name, startedBy: "user" });
	return { dir, rt, store, runner, locks, run, lead, of };
}

const ctxFor = (name: string, id: string) =>
	({ toolCall: { id, name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [{ type: "toolCall", id, name, arguments: {} }] }, context: {} }) as unknown as BeforeToolCallContext;

const tick = () => new Promise((r) => setTimeout(r, 15));

// ---- the Revit seat -----------------------------------------------------------------------------------------------------------

test("13.3 LockRegistry seat: one holder, the same owner may take it again, only the holder releases", () => {
	const l = new LockRegistry();
	assert.equal(l.seatHeldBy(), null);
	assert.equal(l.takeSeat("run:a", "galvenais aģents"), true);
	assert.equal(l.seatHeldBy(), "run:a");
	assert.equal(l.takeSeat("run:a", "galvenais aģents"), true);
	assert.equal(l.takeSeat("run:b", "Cits"), false);
	assert.equal(l.seatHeldBy(), "run:a");
	l.releaseSeat("run:b");
	assert.equal(l.seatHeldBy(), "run:a", "a run that never had the seat frees nothing");
	l.releaseSeat("run:a");
	assert.equal(l.seatHeldBy(), null);
	assert.equal(l.takeSeat("run:b", "Cits"), true);
});

test("13.3 while the lead's run holds the seat a specialist's run has no revit server and one prompt line; after it the next run takes the seat", async () => {
	const rv = mk("rv");
	const seen: Record<string, { mcp: string[]; prompt: string; system: string }> = {};
	let t!: ReturnType<typeof setup>;
	t = setup(
		async (o) => {
			const who = o.prompt.includes("specialists") ? "spec" : o.prompt.includes("vēlāk") ? "later" : "lead";
			seen[who] = { mcp: Object.keys(o.mcp ?? {}), prompt: o.prompt, system: o.systemPrompt ?? "" };
			if (who === "lead") {
				assert.equal(t.locks.seatHeldBy(), "run:r1");
				await t.run(t.of(rv), "specialists", { spec: rv });
			}
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [rv] },
	);
	await t.run(t.lead(), "vadītājs");
	assert.ok(seen.lead.mcp.includes("revit"));
	assert.ok(!seen.spec.mcp.includes("revit"), "no Revit server for the second run");
	assert.ok(seen.spec.prompt.includes(SEAT_LINE("galvenais aģents")), seen.spec.prompt);
	assert.ok(!seen.lead.prompt.includes("Revit šobrīd lieto"));
	assert.ok(!seen.spec.system.includes("Revit noteikumi"), "a specialist without Revit tools is not told the Revit rules");
	assert.equal(t.locks.seatHeldBy(), null, "released at the end of the run");
	await t.run(t.of(rv), "vēlāk", { spec: rv });
	assert.ok(seen.later.mcp.includes("revit"), "the next run takes the seat");
	assert.ok(!seen.later.prompt.includes("Revit šobrīd lieto"));
	assert.equal(t.locks.seatHeldBy(), null);
});

test("13.3 two runs side by side never both have the Revit server; a run that has none says who has it", async () => {
	const a = mk("aa");
	const b = mk("bb");
	const log: { who: string; revit: boolean; line: boolean }[] = [];
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const t = setup(
		async (o) => {
			log.push({ who: o.prompt, revit: !!o.mcp?.revit, line: o.prompt.includes("Revit šobrīd lieto") });
			await gate;
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [a, b] },
	);
	const ra = t.run(t.of(a), "A darbs", { spec: a });
	const rb = t.run(t.of(b), "B darbs", { spec: b });
	await tick();
	release();
	await Promise.all([ra, rb]);
	assert.equal(log.filter((x) => x.revit).length, 1, JSON.stringify(log));
	assert.equal(log.filter((x) => !x.revit).length, 1);
	assert.ok(log.filter((x) => !x.revit).every((x) => x.line));
	assert.equal(t.locks.seatHeldBy(), null);
});

test("13.3 a run that fails still frees the seat; a run that would get no Revit tool never takes it", async () => {
	const t = setup(async () => {
		throw new Error("modelis nokrita");
	});
	const r = await t.run(t.lead(), "x");
	assert.equal(r.ok, false);
	assert.equal(t.locks.seatHeldBy(), null);
	// a specialist with no Revit tool of its own: no seat taken, so the lead can still have it
	const plain = mk("plain", { tools: [] });
	let during: string | null = "?";
	const t2 = setup(async (o) => (during = t2.locks.seatHeldBy(), o.onEvent({ type: "done", text: "ok" })), { specs: [plain] });
	await t2.run(t2.of(plain), "x", { spec: plain });
	assert.equal(during, null);
});

test("13.3 the seat is freed after afterBatch, not before", async () => {
	const rv = mk("rv", { maxLevel: "confirm" });
	let heldAtAfter: string | null = "?";
	const t = setup(
		async (o) => {
			assert.equal(await o.beforeToolCall!(ctxFor("create_level", "c1")), undefined);
			o.onEvent({ type: "done", text: "gatavs" });
		},
		{ specs: [rv], afterBatch: async () => ((heldAtAfter = t.locks.seatHeldBy()), "revīzija") },
	);
	await t.run(t.of(rv), "izveido līmeni", { spec: rv });
	assert.equal(heldAtAfter, "run:r1");
	assert.equal(t.locks.seatHeldBy(), null);
});

// ---- a specialist that may confirm ---------------------------------------------------------------------------------------------

test("13.3 a run-level specialist is not offered create_level; a confirm-level one is, and a lane of it is not", async () => {
	const allow: Record<string, readonly string[] | undefined> = {};
	const tag = (prompt: string) => (prompt.includes("confirm") ? "confirm" : "run");
	const run = mk("lim");
	const conf = mk("conf", { maxLevel: "confirm" });
	const t = setup(async (o) => (allow[tag(o.prompt)] = o.mcp?.revit?.allow, o.onEvent({ type: "done", text: "ok" })), { specs: [run, conf] });
	await t.run(t.of(run), "run", { spec: run });
	await t.run(t.of(conf), "confirm", { spec: conf });
	assert.deepEqual(allow.run, ["revit_edit"]);
	assert.deepEqual(allow.confirm, ["revit_edit", "create_level"]);
	// delegate gives a lane the run cap whatever the spec says: nobody looks at a lane's confirmation
	const lane: Record<string, readonly string[] | undefined> = {};
	const t2 = setup(
		async (o) => {
			if (o.extraTools) {
				const r = await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "conf", task: "lane" }] }, o.signal);
				assert.ok(!r.isError);
			} else lane.revit = o.mcp?.revit?.allow;
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [conf] },
	);
	await t2.run(t2.lead(), "deleģē");
	assert.deepEqual(lane.revit, ["revit_edit"]);
});

test("13.3 a confirm-level call waits for the user; yes lets it through, no blocks it with today's text", async () => {
	const conf = mk("conf", { maxLevel: "confirm" });
	const asked: { batch: { tool: string }[] }[] = [];
	let answer!: (ok: boolean) => void;
	let outcome: unknown = "pending";
	const t = setup(
		async (o) => {
			const p = o.beforeToolCall!(ctxFor("create_level", "c1"));
			p.then((r) => (outcome = r));
			await tick();
			assert.equal(outcome, "pending", "the call waits for the user");
			assert.equal(asked.length, 1);
			answer(false);
			await p;
			assert.equal((outcome as { block: boolean }).block, true);
			assert.equal((outcome as { reason: string }).reason, "Lietotājs šo partiju noraidīja. Neatkārto to; jautā, ko darīt citādi.");
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [conf] },
	);
	const r = await t.run(t.of(conf), "izveido", { spec: conf, ask: (req) => (asked.push(req), new Promise<boolean>((res) => (answer = res))) });
	assert.equal(r.confirmedBatches, 0, "a refused batch is not counted");
	assert.deepEqual(asked[0].batch.map((b) => b.tool), ["create_level"]);
	assert.equal(t.locks.revitHeldBy(), null);
	// a tool it was not given stays out of reach, a main-process or never tool above all
	const t2 = setup(
		async (o) => {
			const b = await o.beforeToolCall!(ctxFor("send_code_to_revit", "c2"));
			assert.equal(b?.block, true);
			const d = await o.beforeToolCall!(ctxFor("delegate", "c3"));
			assert.equal(d?.block, true);
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [conf] },
	);
	await t2.run(t2.of(conf), "x", { spec: conf, ask: async () => assert.fail("never asked") as never });
});

test("13.3 the working-copy check applies to a confirm-level specialist as to the lead: not the project's copy = no batch, no question", async () => {
	const conf = mk("conf", { maxLevel: "confirm" });
	const errors: string[] = [];
	let asked = 0;
	const t = setup(
		async (o) => {
			const b = await o.beforeToolCall!(ctxFor("create_level", "c1"));
			assert.equal(b?.block, true);
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [conf], revitWork: async () => ({ ok: false, title: "Birojs.rvt" }) },
	);
	const r = await t.run(t.of(conf), "x", { spec: conf, ask: async () => (asked++, true), emit: (e: RunEvent) => e.type === "error" && errors.push(e.message) });
	assert.equal(asked, 0);
	assert.match(errors[0], /Partija noraidīta: aktīvais Revit dokuments nav šī projekta darba kopija/);
	assert.equal(r.confirmedBatches, 0);
});

test("13.3 a confirmed batch of a specialist holds Revit against other agents, afterBatch runs once, then the batch is released", async () => {
	const conf = mk("conf", { maxLevel: "confirm" });
	const probe: Record<string, unknown> = {};
	let after = 0;
	let heldAtAfter: string | null = null;
	const t = setup(
		async (o) => {
			assert.equal(await o.beforeToolCall!(ctxFor("create_level", "c1")), undefined);
			await o.afterToolCall!({ toolCall: { id: "c1" } } as never);
			probe.during = t.locks.revitHeldBy();
			probe.other = (await t.locks.acquire("p1", "revit", "run:other", "x1", undefined, "cits")).ok;
			o.onEvent({ type: "done", text: "gatavs" });
		},
		{ specs: [conf], afterBatch: async () => (after++, (heldAtAfter = t.locks.revitHeldBy()), "revīzija") },
	);
	const r = await t.run(t.of(conf), "izveido", { spec: conf });
	assert.equal(r.confirmedBatches, 1);
	assert.equal(probe.during, "run:r1");
	assert.equal(probe.other, false, "another agent's Revit call waits for the batch");
	assert.equal(after, 1);
	assert.equal(heldAtAfter, "run:r1", "afterBatch runs inside the batch");
	assert.equal(t.locks.revitHeldBy(), null);
	assert.equal((await t.locks.acquire("p1", "revit", "run:next", "n1")).ok, true);
});

// ---- the agent's own model -----------------------------------------------------------------------------------------------------

test("13.3 spec.model and spec.effort replace the settings' for that agent's runs; usage is logged under the model used", async () => {
	const seen: Record<string, { provider: string; modelId?: string; effort?: string }> = {};
	const tag = (prompt: string) => ["own", "plain", "lead"].find((w) => prompt.includes(w))!;
	const usage = { type: "usage", input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: null } as const;
	let modelId = "";
	const t = setup(async (o) => {
		seen[tag(o.prompt)] = { provider: o.provider, modelId: o.modelId, effort: o.effort };
		o.onEvent(usage);
		o.onEvent({ type: "done", text: "ok" });
	});
	const rt = t.rt;
	modelId = rt.models.getModels(DEFAULT_SETTINGS.provider as never)[0].id;
	const own = mk("own", { model: modelId, effort: "low", tools: [] });
	const plain = mk("plain", { tools: [] });
	await t.run(t.of(own), "own", { spec: own });
	await t.run(t.of(plain), "plain", { spec: plain });
	await t.run(t.lead(), "lead");
	assert.deepEqual(seen.own, { provider: DEFAULT_SETTINGS.provider, modelId, effort: "low" });
	assert.equal(seen.plain.modelId, DEFAULT_SETTINGS.model, "no model on the spec: the settings'");
	assert.equal(seen.lead.modelId, DEFAULT_SETTINGS.model);
	const rows = readFileSync(join(t.dir, "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { run: string; model: string });
	assert.equal(rows.find((r) => r.run === "r1")!.model, `${DEFAULT_SETTINGS.provider}/${modelId}`);
	assert.equal(rows.find((r) => r.run === "r2")!.model, `${DEFAULT_SETTINGS.provider}/${DEFAULT_SETTINGS.model}`);
});

test("13.3 an unknown model on the spec ends the run with the provider's own error", async () => {
	const bad = mk("bad", { model: "x", tools: [] });
	let started = false;
	const t = setup(async () => void (started = true));
	const errors: string[] = [];
	const r = await t.run(t.of(bad), "x", { spec: bad, emit: (e: RunEvent) => e.type === "error" && errors.push(e.message) });
	assert.equal(r.ok, false);
	assert.equal(started, false);
	assert.match(errors[0], /Unknown model "x"/);
});

test("13.3 a lane of a specialist gets its model, effort and usage name; its system text is standingFor + RULES, so a role file works through delegate", async () => {
	const sp = mk("rf", { roleFile: true, prompt: "", tools: ["revit_edit"], effort: "high" });
	const lanes: { modelId?: string; effort?: string; system: string; revit: boolean }[] = [];
	let ownModel = "";
	const t = setup(
		async (o) => {
			if (o.extraTools) {
				await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "rf", task: "lane" }] }, o.signal);
			} else {
				lanes.push({ modelId: o.modelId, effort: o.effort, system: o.systemPrompt ?? "", revit: !!o.mcp?.revit });
				o.onEvent({ type: "usage", input: 3, output: 2, cacheRead: 0, cacheWrite: 0, cost: null });
			}
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [sp] },
	);
	ownModel = t.rt.models.getModels(DEFAULT_SETTINGS.provider as never)[0].id;
	sp.model = ownModel;
	writeRole(t.dir, "rf", "ROLE-TEKSTS-IZ-FAILA");
	await t.run(t.lead(), "deleģē");
	assert.equal(lanes.length, 1);
	assert.equal(lanes[0].modelId, ownModel);
	assert.equal(lanes[0].effort, "high");
	assert.match(lanes[0].system, /ROLE-TEKSTS-IZ-FAILA/);
	assert.ok(lanes[0].system.endsWith(RULES), "the lane's RULES suffix is kept");
	assert.ok(lanes[0].revit, "the lead holds the seat: its lane has Revit");
	const rows = readFileSync(join(t.dir, "usage.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { model: string });
	assert.equal(rows[0].model, `${DEFAULT_SETTINGS.provider}/${ownModel}`, "the lane's turn is logged under the lane's model");
});

test("13.3 a lane uses its parent's seat: without it the lane has no Revit tools", async () => {
	const sp = mk("rv");
	const seen: { revit: boolean }[] = [];
	const locks = new LockRegistry({ waitMs: 60 });
	locks.takeSeat("run:other", "Cits aģents");
	const t = setup(
		async (o) => {
			if (o.extraTools) await o.extraTools.find((x) => x.name === "delegate")!.execute("d1", { jobs: [{ agent: "rv", task: "lane" }] }, o.signal);
			else seen.push({ revit: !!o.mcp?.revit });
			o.onEvent({ type: "done", text: "ok" });
		},
		{ specs: [sp], locks },
	);
	await t.run(t.lead(), "deleģē");
	assert.deepEqual(seen, [{ revit: false }]);
	assert.equal(locks.seatHeldBy(), "run:other", "the other run's seat is not touched");
});
