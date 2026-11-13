// 8.7 undo and usage. Undo: what an agent run changed (collection writes tagged with the run and the tool, files created,
// replaced or removed), taken back one at a time without ever deleting anything; usage: each model turn's tokens and, only when
// the provider gave a price, its cost. Invented projects; the tools are run the way the tools server runs them.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { newPiState, piEvents } from "../src/agent/pi/events.ts";
import { parseUsage, summarizeUsage, type UsageEntry } from "../src/agent/usage.ts";
import { checkpointBeforeWrite, listCheckpoints, trackCreated } from "../src/core/checkpoints.ts";
import { inToolScope } from "../src/core/scope.ts";
import { ProjectStore } from "../src/core/store.ts";
import { applyUndo, undoRows } from "../src/core/undo.ts";
import { ActivityLog } from "../src/main/activity.ts";
import { usageText } from "../src/shared/tokens.ts";
import { tmp } from "./helpers.ts";

const RUN = "run_a1";

function setup() {
	const projectsDir = tmp();
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.1_Izejas dati"), { recursive: true });
	writeFileSync(join(root, "01_Projektesana", "1.1_Izejas dati", "TN.pdf"), "tn");
	const store = ProjectStore.open(projectsDir, { id: "BD999", name: "BD999", root, createdAt: "2026-11-13T00:00:00Z" });
	const runDir = join(tmp(), RUN);
	mkdirSync(runDir, { recursive: true });
	const ctx: ToolCtx = { projectsDir, projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir };
	return { store, ctx };
}

/** One agent tool call, as server.ts runs it. */
function asAgent(store: ProjectStore, tool: string, ctx: ToolCtx, args: Record<string, unknown>, run = RUN) {
	const t = allTools().find((x) => x.name === tool)!;
	return inToolScope({ run, tool }, () => trackCreated(store, () => t.run(ctx, args as never)));
}

test("an agent write names the run and the tool in the log; a user's write does not", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "create_task", ctx, { title: "Sagatavot MBP" });
	store.update("tasks", (all) => all, { kind: "task.touched", by: "user" });
	const w = store.events().filter((e) => e.data?.collection === "tasks");
	assert.deepEqual([w[0].by, w[0].data?.run, w[0].data?.tool], ["agent", RUN, "create_task"]);
	assert.deepEqual([w[1].by, w[1].data?.run, w[1].data?.tool], ["user", undefined, undefined]);
});

test("a collection write is listed with its run and can be undone while it is the newest; then it is marked undone", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "create_task", ctx, { title: "Pirmais" });
	const rows = undoRows(store, RUN);
	assert.equal(rows.length, 1);
	assert.deepEqual([rows[0].kind, rows[0].undoable, rows[0].undone, rows[0].tool], ["collection", true, false, "create_task"]);
	assert.match(rows[0].label, /^Uzdevumi: task\.added \(tagad 1\)$/);
	assert.deepEqual(undoRows(store, "cita_palaisana"), [], "another run's changes are not listed");
	assert.match(applyUndo(store, rows[0].key), /Uzdevumi atgrieztas/);
	assert.deepEqual(store.read("tasks"), []);
	const after = undoRows(store, RUN);
	assert.deepEqual([after[0].undone, after[0].undoable], [true, false]);
	assert.throws(() => applyUndo(store, rows[0].key), /jau ir atsaukta/);
	assert.ok(store.events().some((e) => e.kind === "undo" && e.by === "user" && e.data?.of === Number(rows[0].key.slice(4))), "the undo is itself in the log");
});

test("a write that is not the newest cannot be undone: undoing it would throw the later one away", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "create_task", ctx, { title: "Pirmais" });
	await asAgent(store, "create_task", ctx, { title: "Otrais" });
	const [a, b] = undoRows(store, RUN);
	assert.equal(a.undoable, false);
	assert.match(a.why!, /Uzdevumi vēlāk mainītas/);
	assert.equal(b.undoable, true);
	assert.throws(() => applyUndo(store, a.key), /vispirms atsauc vēlākās izmaiņas/);
	applyUndo(store, b.key);
	assert.deepEqual(store.read("tasks").map((t) => t.title), ["Pirmais"]);
	// now the first is the newest write again
	assert.equal(undoRows(store, RUN).find((r) => r.key === a.key)!.undoable, true);
	applyUndo(store, a.key);
	assert.deepEqual(store.read("tasks"), []);
});

test("something the user changed after the agent is not lost by undoing the agent's earlier write", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "create_task", ctx, { title: "Aģenta" });
	store.update("tasks", (all) => [...all, { id: "t_u", title: "Lietotāja", due: null, state: "open", refs: {}, by: "user", at: "2026-11-13T10:00:00Z" }], { kind: "task.added", by: "user" });
	const [row] = undoRows(store, RUN);
	assert.equal(row.undoable, false);
	assert.throws(() => applyUndo(store, row.key), /vispirms atsauc/);
	assert.equal(store.read("tasks").length, 2);
});

test("a note the agent wrote is a file it created: recorded, and undo moves it aside, deleting nothing", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "write_note", ctx, { type: "decision", title: "Lēmums par fasādi", body: "Apmetums." });
	const cps = listCheckpoints(store, RUN);
	assert.equal(cps.length, 1);
	assert.deepEqual([cps[0].created, cps[0].backup, cps[0].tool], [true, null, "write_note"]);
	assert.match(cps[0].path, /^notes[\\/].+\.md$/);
	const file = join(store.dir, cps[0].path);
	assert.ok(existsSync(file));
	const row = undoRows(store, RUN).find((r) => r.kind === "file")!;
	assert.match(row.label, /^Izveidots fails notes\/.+\.md$/);
	assert.match(applyUndo(store, row.key), /pārvietots malā/);
	assert.equal(existsSync(file), false);
	const aside = readdirSync(join(store.dir, "checkpoints", "aside"));
	assert.equal(aside.length, 1);
	assert.equal(readFileSync(join(store.dir, "checkpoints", "aside", aside[0]), "utf8").includes("Apmetums."), true, "the note is still there, aside");
	assert.deepEqual(undoRows(store, RUN).find((r) => r.kind === "file")!.undone, true);
});

test("removing a staged file takes a copy first; undo puts it back, and what is in the way goes aside", async () => {
	const { store, ctx } = setup();
	await asAgent(store, "start_delivery", ctx, { kind: "MBP", date: "2026-12-01" });
	store.write("sources", [{ id: "s1", kind: "document", paths: ["01_Projektesana\\1.1_Izejas dati\\TN.pdf"] } as never], { kind: "t", by: "app" });
	await asAgent(store, "stage_source_file", ctx, { sourceId: "s1", name: "TN-1_tikls.pdf" });
	const staged = join(store.dir, "nodevumi", "MBP", "261201", "TN-1_tikls.pdf");
	assert.equal(readFileSync(staged, "utf8"), "tn");
	await asAgent(store, "unstage_file", ctx, { name: "TN-1_tikls.pdf" }, "run_b2");
	assert.equal(existsSync(staged), false);
	const [cp] = listCheckpoints(store, "run_b2");
	assert.deepEqual([cp.created, cp.tool], [false, "unstage_file"]);
	assert.equal(readFileSync(join(store.dir, cp.backup!), "utf8"), "tn", "the copy was taken before the file was removed");
	// the run that staged it recorded it as created
	assert.deepEqual(listCheckpoints(store, RUN).filter((c) => c.created).map((c) => c.path.replace(/\\/g, "/")), ["nodevumi/MBP/261201/TN-1_tikls.pdf"]);
	// something new sits at the old name when the user undoes: it goes aside, not over the copy
	writeFileSync(staged, "jauns");
	applyUndo(store, `cp:${cp.id}`);
	assert.equal(readFileSync(staged, "utf8"), "tn");
	const aside = readdirSync(join(store.dir, "checkpoints", "aside"));
	assert.equal(aside.length, 1);
	assert.equal(readFileSync(join(store.dir, "checkpoints", "aside", aside[0]), "utf8"), "jauns");
});

test("outside an agent tool call nothing is checkpointed, and nothing outside the data folder ever is", async () => {
	const { store } = setup();
	const f = join(store.dir, "nodevumi", "x.pdf");
	mkdirSync(join(store.dir, "nodevumi"), { recursive: true });
	writeFileSync(f, "x");
	assert.equal(checkpointBeforeWrite(store, f), null, "a user's own click is not an agent write");
	const office = join(store.project.root, "01_Projektesana", "1.1_Izejas dati", "TN.pdf");
	assert.equal(await inToolScope({ run: RUN, tool: "t" }, () => checkpointBeforeWrite(store, office)), null, "the office folder is never touched");
	assert.deepEqual(listCheckpoints(store), []);
});

test("an undo that cannot be done says why", () => {
	const { store } = setup();
	assert.throws(() => applyUndo(store, "cp:nav"), /nav atrasts/);
	assert.throws(() => applyUndo(store, "log:99"), /nav aģenta ieraksts/);
	assert.throws(() => applyUndo(store, "x"), /Nezināma/);
});

// ---- usage -------------------------------------------------------------------------------------------------------

const msg = (usage: Partial<AssistantMessage["usage"]> | undefined, text = "Atbilde"): AssistantMessage =>
	({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: usage && { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, ...usage } }) as unknown as AssistantMessage;

test("each assistant turn reports its tokens; a price of 0 is no price, not free", () => {
	const ev = (m: AssistantMessage) => piEvents({ type: "message_end", message: m } as never, newPiState()).filter((e) => e.type === "usage");
	assert.deepEqual(ev(msg({ input: 1200, output: 340, cacheRead: 5000, cacheWrite: 80, cost: { input: 0.003, output: 0.005, cacheRead: 0.001, cacheWrite: 0.0003, total: 0.0093 } })), [{ type: "usage", input: 1200, output: 340, cacheRead: 5000, cacheWrite: 80, cost: 0.0093 }]);
	assert.deepEqual(ev(msg({ input: 900, output: 100 })), [{ type: "usage", input: 900, output: 100, cacheRead: 0, cacheWrite: 0, cost: null }], "a subscription: tokens known, price not");
	assert.deepEqual(ev(msg({ input: 0, output: 0 })), [], "nothing to report");
	assert.deepEqual(ev(msg(undefined)), [], "a provider with no usage block");
});

test("the log: lines are read, a damaged one is skipped; totals per project add only the known prices and say how many", () => {
	const e = (o: Partial<UsageEntry>): UsageEntry => ({ at: "2026-11-13T10:00:00.000Z", run: "r1", project: "BD1", model: "m", input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: null, ...o });
	const text = [e({}), e({ run: "r1", input: 200, cost: 0.01 }), e({ run: "r2", at: "2026-11-14T10:00:00.000Z", cost: 0.02 }), e({ project: null, run: "r3", input: 10, output: 5 })].map((x) => JSON.stringify(x)).join("\n") + '\n{"run":"r4","at":"x","input":1\n{broken\n';
	const entries = parseUsage(text);
	assert.equal(entries.length, 4, "the two damaged lines are skipped");
	const rows = summarizeUsage(entries);
	assert.deepEqual(rows.map((r) => r.project), ["BD1", null], "the busiest first");
	const bd1 = rows[0];
	assert.deepEqual([bd1.runs, bd1.turns, bd1.input, bd1.output, bd1.priced, bd1.lastAt], [2, 3, 400, 150, 2, "2026-11-14T10:00:00.000Z"]);
	assert.ok(Math.abs(bd1.cost! - 0.03) < 1e-9);
	assert.equal(rows[1].cost, null, "no price anywhere: unknown, not zero");
});

test("usage on one line: tokens in and out, the price when known, a partial price marked", () => {
	assert.equal(usageText({ input: 1200, output: 340, cacheRead: 5000, cost: null }), "6.2K ievade · 340 izvade · cena nav zināma");
	assert.equal(usageText({ input: 100, output: 50, cacheRead: 0, cost: 0.0421 }), "100 ievade · 50 izvade · $0.042");
	assert.equal(usageText({ input: 2_000_000, output: 90_000, cacheRead: 0, cost: 12.5 }), "2.00M ievade · 90K izvade · $12.50");
	assert.match(usageText({ input: 1, output: 1, cacheRead: 0, cost: 0.5, turns: 4, priced: 2 }), /\(no 2 no 4 piegājieniem\)$/);
});

test("the run card's summary carries the run's usage, added up turn by turn", () => {
	const sent: { summary?: { usage?: { turns: number; input: number; output: number; cost: number | null } } }[] = [];
	let t = Date.parse("2026-11-13T10:00:00Z");
	const log = new ActivityLog({ send: (a) => sent.push(a), sources: () => [], levelOf: () => "read", templates: [], now: () => (t += 10) });
	log.begin("BD999", "Jautājums");
	log.event("r9", { type: "tool", name: "list_sources", id: "c1", detail: "{}" });
	log.bind("r9");
	log.event("r9", { type: "usage", input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, cost: null });
	log.event("r9", { type: "usage", input: 500, output: 50, cacheRead: 200, cacheWrite: 0, cost: 0.01 });
	log.event("r9", { type: "usage", input: 500, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.02 });
	const last = [...sent].reverse().find((a) => a.summary)!;
	assert.deepEqual(last.summary!.usage, { turns: 3, input: 2000, output: 200, cacheRead: 200, cacheWrite: 0, cost: 0.03 });
});
