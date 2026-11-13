// 9.2 the plan above the chat input and the view-context toggle: the update_plan tool replaces the whole list (one doing, level
// read), a user edit wins and reaches the next turn, the plan per project survives a restart, the view-context item from
// viewer states, Auto / Manual defaults by tab, and the fixed context stays under the guard. Invented projects.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { buildPrompt, SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { agentSetPlan, getPlan, peekPendingPlanText, takePendingPlanText, userSetPlan } from "../src/core/plan.ts";
import { ProjectStore } from "../src/core/store.ts";
import { addStep, checkSteps, editText, moveStep, planProgress, planText, removeStep, setState, tick } from "../src/shared/plan.ts";
import { defaultMode, effectiveMode, focusForSend, viewContextItem, type ViewState } from "../src/shared/view-context.ts";
import { toolLine } from "../src/shared/activity.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const mk = () => ProjectStore.open(tmp(), { id: "BD930", name: "BD930", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
const ctxOf = (s: ProjectStore): ToolCtx => ({ projectsDir: s.projectsDir, projectId: s.project.id, dataDir: tmp(), appDir: tmp(), runDir: null });
const tool = (name: string) => allTools().find((t) => t.name === name)!;
const ids = () => {
	let n = 0;
	return () => `i${++n}`;
};
const S = (text: string, state = "todo") => ({ text, state });

test("update_plan is a read-level tool; the whole list replaces the last one and keeps the ids of steps with the same text", async () => {
	assert.equal(appLevels().update_plan, "read");
	const s = mk();
	const c = ctxOf(s);
	const r1 = (await tool("update_plan").run(c, { steps: [S("Nolasīt PU", "doing"), S("Salīdzināt platības"), S("Sagatavot atzinumu")] } as never)) as { ok: boolean; progress: string };
	assert.deepEqual([r1.ok, r1.progress], [true, "Plāns · 0/3"]);
	const first = getPlan(s).steps;
	assert.deepEqual(first.map((x) => x.state), ["doing", "todo", "todo"]);
	await tool("update_plan").run(c, { steps: [S("Nolasīt PU", "done"), S("Salīdzināt platības", "doing"), S("Sagatavot atzinumu"), S("Nosūtīt")] } as never);
	const now = getPlan(s);
	assert.deepEqual(now.steps.map((x) => x.state), ["done", "doing", "todo", "todo"]);
	assert.equal(now.steps[0].id, first[0].id, "same text, same id");
	assert.equal(now.steps[1].id, first[1].id);
	assert.deepEqual([now.by, now.pending], ["agent", false]);
	assert.equal(s.read("plan").length, 1, "one document, replaced whole");
	await tool("update_plan").run(c, { steps: [] } as never);
	assert.deepEqual(getPlan(s).steps, []);
});

test("one step doing at most, text and state checked, at most 30 steps; nothing is written on a refusal", async () => {
	const s = mk();
	const c = ctxOf(s);
	await assert.rejects(async () => tool("update_plan").run(c, { steps: [S("A1", "doing"), S("B2", "doing")] } as never), /tikai viens solis/);
	await assert.rejects(async () => tool("update_plan").run(c, { steps: [S("x")] } as never), /vajag tekstu/);
	await assert.rejects(async () => tool("update_plan").run(c, { steps: [S("Solis", "izdarīts")] } as never), /nav zināms/);
	assert.throws(() => checkSteps(Array.from({ length: 31 }, (_, i) => S(`solis ${i}`)), ids()), /ne vairāk kā 30/);
	assert.equal(checkSteps(Array.from({ length: 30 }, (_, i) => S(`solis ${i}`)), ids()).length, 30);
	assert.throws(() => checkSteps([S("a".repeat(201))], ids()), /garāks par 200/);
	assert.deepEqual(s.read("plan"), []);
	// a missing state means todo; a duplicated id is made unique
	const two = checkSteps([{ text: "viens", id: "k" }, { text: "divi", id: "k" }], ids());
	assert.deepEqual(two.map((x) => x.state), ["todo", "todo"]);
	assert.notEqual(two[0].id, two[1].id);
});

test("the user's edit wins: it is carried by the next prompt, once; an agent update that arrives first is refused with his list", async () => {
	const s = mk();
	agentSetPlan(s, [S("Nolasīt PU", "doing"), S("Salīdzināt platības"), S("Nosūtīt")]);
	assert.equal(takePendingPlanText(s), "", "nothing pending: the prompt carries no plan");
	// the user ticks the first step, drops the last and adds one of his own
	const mine = getPlan(s).steps;
	let next = tick(mine, mine[0].id);
	next = removeStep(next, mine[2].id);
	next = addStep(next, "Pārbaudīt TN termiņu", "u1");
	const doc = userSetPlan(s, next);
	assert.deepEqual([doc.by, doc.pending], ["user", true]);
	assert.match(peekPendingPlanText(s), /Pārbaudīt TN termiņu/);
	assert.equal(getPlan(s).pending, true, "peeking takes nothing");
	// the agent's update lands before any prompt carried the edit: refused, and the refusal tells it the list
	await assert.rejects(async () => tool("update_plan").run(ctxOf(s), { steps: [S("Nolasīt PU"), S("Nosūtīt", "doing")] } as never), (e: Error) => /viņa saraksts ir spēkā/.test(e.message) && /\[x\] Nolasīt PU/.test(e.message) && /Pārbaudīt TN termiņu/.test(e.message) && !/Nosūtīt/.test(e.message));
	assert.deepEqual(getPlan(s).steps.map((x) => x.text), ["Nolasīt PU", "Salīdzināt platības", "Pārbaudīt TN termiņu"], "his list stays");
	assert.equal(getPlan(s).pending, false, "the agent has now seen it");
	// the next prompt: an edit made again is carried exactly once
	userSetPlan(s, setState(getPlan(s).steps, getPlan(s).steps[1].id, "doing"));
	const lines = takePendingPlanText(s);
	assert.match(lines, /^Lietotājs ir mainījis plānu/);
	assert.match(lines, /2\. \[→\] Salīdzināt platības/);
	assert.equal(takePendingPlanText(s), "", "carried once");
	const p = buildPrompt([], [], "turpini", lines);
	assert.ok(p.indexOf("Lietotājs ir mainījis plānu") < p.indexOf("Fokuss"), "the plan comes before the Fokuss, the message last");
	assert.ok(p.endsWith("turpini"));
	// after the prompt carried it, the agent may write its own list again
	agentSetPlan(s, [S("Salīdzināt platības", "doing"), S("Pārbaudīt TN termiņu")]);
	assert.deepEqual(getPlan(s).steps.map((x) => x.text), ["Salīdzināt platības", "Pārbaudīt TN termiņu"]);
});

test("a plan the user clears reaches the agent too; the plan of a project survives a restart and is not another project's", () => {
	const dir = tmp();
	const open = (id: string) => ProjectStore.open(dir, { id, name: id, root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
	const a = open("BD930");
	agentSetPlan(a, [S("Viens", "doing"), S("Divi")]);
	userSetPlan(a, []);
	assert.match(takePendingPlanText(a), /\(tukšs\)/);
	agentSetPlan(a, [S("Viens", "done"), S("Divi", "doing")]);
	assert.deepEqual(getPlan(ProjectStore.load(dir, "BD930")).steps.map((x) => x.state), ["done", "doing"], "read back by a new process");
	assert.deepEqual(getPlan(open("BD931")).steps, [], "another project has none");
	assert.deepEqual(getPlan(open("BD931")).by, "app");
});

test("the plan's pure edits: tick, set state (one doing), edit, add, move, remove, progress and the folded line", () => {
	const mint = ids();
	let st = checkSteps([S("A1", "doing"), S("B2"), S("C3", "blocked"), S("D4", "done")], mint);
	assert.equal(planProgress(st).line, "Plāns · 1/4");
	assert.equal(planProgress(st).doing?.text, "A1");
	assert.equal(planProgress([]).line, "Plāns");
	st = setState(st, st[1].id, "doing");
	assert.deepEqual(st.map((x) => x.state), ["todo", "doing", "blocked", "done"], "the one that was doing goes back to todo");
	st = tick(st, st[2].id);
	assert.equal(st[2].state, "done");
	st = tick(st, st[2].id);
	assert.equal(st[2].state, "todo", "ticking a done step unticks it");
	st = editText(st, st[0].id, "  Jauns   teksts ");
	assert.equal(st[0].text, "Jauns teksts");
	assert.equal(editText(st, st[0].id, "x")[0].text, "Jauns teksts", "too short: kept");
	st = moveStep(st, st[3].id, 0);
	assert.equal(st[0].text, "D4");
	assert.deepEqual(st.map((x) => x.text), ["D4", "Jauns teksts", "B2", "C3"]);
	st = addStep(st, "E5", "e", 1);
	assert.equal(st[1].text, "E5");
	assert.equal(addStep(st, "e", "z").length, st.length, "too short: not added");
	assert.equal(addStep(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, text: `solis ${i}`, state: "todo" as const })), "vēl viens", "y").length, 30);
	assert.equal(removeStep(st, "e").length, st.length - 1);
	assert.doesNotThrow(() => checkSteps(st, mint), "every edit leaves a valid list");
	assert.equal(planText(st, "Plāns:").split("\n").length, st.length + 1);
	assert.equal(moveStep(st, "nav", 0), st);
});

const MODEL: ViewState = { kind: "ifc", label: "BD930_AR.ifc", path: "src:s1", selection: [{ guid: "1abc", cls: "IfcWall", name: "Siena 200" }, { guid: "2def", cls: "IfcDoor", name: null }], camera: { position: [10.123, 5, 3], target: [0, 0, 1.5], fov: 60 } };

test("the view-context item: a 3D view with selection and camera, a PDF page, nothing open", () => {
	const m = viewContextItem(MODEL)!;
	assert.deepEqual([m.kind, m.id], ["view", "view"]);
	assert.equal(m.label, "skats: BD930_AR.ifc, 2 elementi, kamera");
	const d = m.data as { tab: string; selected: { guid: string }[]; selectedCount: number; camera: { position: number[] } };
	assert.deepEqual([d.tab, d.selected.map((x) => x.guid), d.selectedCount], ["ifc", ["1abc", "2def"], 2]);
	assert.deepEqual(d.camera.position, [10.12, 5, 3], "rounded: the numbers are not the question");
	const pdf = viewContextItem({ kind: "source", label: "Būvvaldes PU", sourceId: "s7", page: 4, selection: [] })!;
	assert.equal(pdf.label, "skats: Būvvaldes PU, lpp. 4");
	assert.deepEqual(pdf.data, { tab: "source", file: "Būvvaldes PU", sourceId: "s7", page: 4 });
	assert.equal(viewContextItem({ kind: null, selection: [] }), null);
	assert.equal(viewContextItem({ kind: "ifc", selection: [] }), null, "no file name: nothing to say");
	const many = viewContextItem({ ...MODEL, selection: Array.from({ length: 50 }, (_, i) => ({ guid: `g${i}`, cls: "IfcWall", name: null })) })!;
	assert.equal((many.data as { selected: unknown[] }).selected.length, 20);
	assert.equal((many.data as { selectedCount: number }).selectedCount, 50, "it says how many there really are");
});

test("Auto and Manual: the default follows the tab, the user's choice holds for that kind of tab only, the item is added once", () => {
	assert.deepEqual((["ifc", "compare", "source", "law", null] as const).map(defaultMode), ["auto", "auto", "manual", "manual", "manual"]);
	assert.equal(effectiveMode(null, "ifc"), "auto");
	assert.equal(effectiveMode({ kind: "ifc", mode: "manual" }, "ifc"), "manual");
	assert.equal(effectiveMode({ kind: "ifc", mode: "manual" }, "source"), "manual", "documents default to manual");
	assert.equal(effectiveMode({ kind: "source", mode: "auto" }, "ifc"), "auto", "his choice was for a document: 3D uses its own default");
	const own = [{ kind: "finding" as const, id: "f1", label: "atradums" }];
	const auto = focusForSend(own, "auto", MODEL);
	assert.deepEqual(auto.map((f) => f.kind), ["finding", "view"]);
	assert.deepEqual(focusForSend(auto, "auto", MODEL).map((f) => f.kind), ["finding", "view"], "an older view item is replaced, not stacked");
	assert.deepEqual(focusForSend(own, "manual", MODEL), own);
	assert.deepEqual(focusForSend(auto, "manual", MODEL).map((f) => f.kind), ["finding"], "Manual drops it");
	assert.deepEqual(focusForSend(own, "auto", { kind: null, selection: [] }), own, "nothing open: nothing to add");
});

test("the view item reaches the agent as one Fokuss line, and the run card names update_plan", async () => {
	const { focusText, isFocusItem } = await import("../src/agent/focus.ts");
	const line = focusText([viewContextItem(MODEL)!]);
	assert.match(line, /skats \(atvērtais fails/);
	assert.match(line, /\[view:view\] skats: BD930_AR\.ifc/);
	assert.ok(isFocusItem(viewContextItem(MODEL)));
	assert.deepEqual(toolLine("update_plan", undefined, () => null), { text: "Atjauno plānu", kind: "ui" });
	assert.match(SYSTEM_PROMPT, /update_plan/);
});

test("the fixed context stays under the 10K guard with the plan tool and the new rule, and a pending plan is counted in the draft", async () => {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const store = ProjectStore.open(dir, { id: "BD930", name: "BD930", root: tmp(), createdAt: "2026-11-01T00:00:00Z" });
	const s = new AgentSession({ runtime: async () => rt, settings: () => ({ ...DEFAULT_SETTINGS }), toolsServer: () => ({ command: "node", args: [], env: {} }), revit: () => null, ctx: { projectsDir: dir, dataDir: dir, appDir: dir }, runsDir: join(dir, "runs"), chatDir: join(dir, "chat"), emit: () => {} });
	const before = await s.context("BD930", { text: "sveiki", focus: [] });
	assert.ok(before.fixedEstimate < 10_000, `fixed ${before.fixedEstimate}`);
	assert.equal(before.draft?.plan, 0, "no plan, no cost");
	userSetPlan(store, [S("Nolasīt PU", "doing"), S("Salīdzināt platības")]);
	const after = await s.context("BD930", { text: "sveiki", focus: [] });
	assert.ok(after.draft!.plan > 10, `plan ${after.draft!.plan}`);
	assert.equal(getPlan(store).pending, true, "measuring does not take it");
});
