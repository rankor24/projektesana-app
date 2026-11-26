// 25.0 The original model is never touched (the user's ruling, 2026-11-25: agents work on a copy in the app's own project folder, nothing on B: is changed).
// Every role that changes a model can make its own working copy (revit_save_copy); opening a document stands alone in its batch, so a change in the same message can not land in
// the model that was just opened.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { OPEN_ALONE, SELECT_AFTER_CHANGE, ThreadRunner } from "../src/agent/thread-runner.ts";
import { selectSession } from "../src/revit/commands.ts";
import { choiceFile } from "../src/revit/target.ts";
import { REVIT_RULES } from "../src/agent/tools/revit.ts";
import { FLEET_ADDITIONS, FLEET_DEFAULTS, withFleetAddition } from "../src/shared/fleet-defaults.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { tmp } from "./helpers.ts";

const MODELS = ["ar", "bk", "uk", "avk", "ga", "el", "ess"];

test("every role that changes a model, and BPV, can make its own working copy", () => {
	for (const id of [...MODELS, "bpv", "ud", "tam"]) assert.ok(FLEET_DEFAULTS[id]!.tools.includes("revit_save_copy"), `${id} has revit_save_copy`);
	// the roles that only read have no write tool and need no copy
	for (const id of ["aa", "cd", "ea", "ak", "eks", "mel"]) assert.ok(!FLEET_DEFAULTS[id]!.tools.some((t) => ["operate_element", "revit_set_parameter", "color_elements", "revit_set_schedule_filter"].includes(t)), `${id} does not change a model`);
	// every agent that has a tool that changes a model also has the way to make its copy (BPV has it for sheets and exports too)
	for (const [id, d] of Object.entries(FLEET_DEFAULTS)) {
		const changes = d.tools.some((t) => ["operate_element", "color_elements", "revit_set_parameter", "revit_set_view_settings", "revit_set_schedule_filter", "create_line_based_element"].includes(t));
		if (changes) assert.ok(d.tools.includes("revit_save_copy"), `${id}: changes a model, so it can make the working copy`);
	}
});

test("the rules every Revit agent works by: never the original, make the copy with revit_save_copy, open an existing copy alone", () => {
	assert.match(REVIT_RULES, /Oriģinālo failu \(arī uz B: diska\) nekad nemaini/);
	assert.match(REVIT_RULES, /revit_save_copy/);
	assert.match(REVIT_RULES, /open_document \(atsevišķā ziņā/);
});

test("a fleet set up before gets revit_save_copy once: only an agent that already reads Revit, no confirm cap needed", () => {
	const add = FLEET_ADDITIONS[1]!;
	assert.equal(add.marker, ".fleet-setup-3");
	const have = { tools: new Set(["revit_save_copy", "get_current_view_info", "operate_element"]) };
	const s = (id: string, tools: string[]) => ({ id, tools, maxLevel: undefined as "run" | "confirm" | undefined });
	assert.deepEqual(withFleetAddition(s("ud", ["get_current_view_info", "operate_element"]), add.tools, have, add).tools, ["get_current_view_info", "operate_element", "revit_save_copy"]);
	assert.equal(withFleetAddition(s("ud", ["write_note"]), add.tools, have, add).tools.length, 1, "no Revit at all: nothing to copy");
	assert.equal(withFleetAddition(s("eks", ["get_current_view_info"]), add.tools, have, add).tools.length, 1, "the expert does not change a model");
	assert.equal(withFleetAddition(s("ar", ["get_current_view_info", "revit_save_copy"]), add.tools, have, add).tools.length, 2, "no repeats");
});

/** A run whose model asks for ONE assistant message with the given Revit calls; `allow` = the user's click. */
async function batchRun(calls: string[], allow: boolean, opts: { work?: boolean; args?: Record<string, unknown>; isWork?: (p: string) => boolean } = {}) {
	const dir = tmp("wc-");
	const store = new ThreadStore(join(dir, "th"));
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const levels = { open_document: "confirm", create_level: "confirm", save_document: "confirm" } as const;
	let result: { block?: boolean; reason?: string } | undefined;
	let checked = 0;
	const choices: (Record<string, unknown> | null)[] = [];
	const asked: unknown[] = [];
	const content = calls.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: opts.args ?? {} }));
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => DEFAULT_SETTINGS,
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, tools: Object.keys(levels), levels }),
		revitWork: async (_p, choice) => (checked++, choices.push(choice ?? null), { ok: !!opts.work, title: "XY_AR (cits modelis)" }),
		isWorkCopyPath: (_p, path) => opts.isWork?.(path) ?? false,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		threads: () => store,
		locks: new LockRegistry(),
		runAgent: async (o) => {
			const first = calls[0]!;
			result = (await o.beforeToolCall?.({ toolCall: { name: first, id: "t0", arguments: opts.args ?? {} }, args: opts.args ?? {}, assistantMessage: { content } } as never, new AbortController().signal)) as typeof result;
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const thread = store.create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	const events: RunEvent[] = [];
	await runner.run({ runId: "r1", thread, spec: null, text: "atver darba kopiju", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async (q) => (asked.push(q), allow) });
	return { result, events, asked, checked, choices };
}

test("open_document alone is allowed to run while another model is active (the user's click asks); mixed with a change in the same message it is refused without a click", async () => {
	const alone = await batchRun(["open_document"], true);
	assert.equal(alone.result, undefined, "an open on its own runs after the click");
	assert.equal(alone.asked.length, 1);
	assert.equal(alone.checked, 0, "no working-copy check for a batch that only opens");

	const mixed = await batchRun(["open_document", "create_level"], true);
	assert.equal(mixed.result?.block, true);
	assert.equal(mixed.result?.reason, OPEN_ALONE);
	assert.match(OPEN_ALONE, /NENORAIDĪJA/);
	assert.equal(mixed.asked.length, 0, "no approval card for a batch that cannot run");
	assert.equal(mixed.events.some((e) => e.type === "error"), false);
	assert.ok(mixed.events.some((e) => e.type === "text" && /open_document jāizsauc atsevišķi/.test(e.text)));

	const change = await batchRun(["create_level"], true);
	assert.equal(change.result?.block, true, "a change while another model is active is still refused");
	assert.equal(change.checked, 1);
});

test("2.15.0 open_document of the project's working copy needs no click; of any other file (or a call that names no file) it still asks", async () => {
	const isWork = (p: string) => /_WORK\.rvt$/i.test(p);
	const mine = await batchRun(["open_document"], false, { args: { filePath: "C:\\data\\projects\\BD1\\work\\XY_AR_WORK.rvt" }, isWork });
	assert.equal(mine.asked.length, 0, "the working copy opens on its own");
	assert.equal(mine.result, undefined);
	const office = await batchRun(["open_document"], true, { args: { filePath: "B:\\Projekti\\BD1\\XY_AR.rvt" }, isWork });
	assert.equal(office.asked.length, 1, "an office model: the user sees the file and clicks");
	const both = await batchRun(["open_document"], true, { args: { options: { files: ["C:\\x\\a_WORK.rvt", "B:\\o.rvt"] } }, isWork });
	assert.equal(both.asked.length, 1, "one file that is not the copy is enough to ask");
	const none = await batchRun(["open_document"], true, { isWork });
	assert.equal(none.asked.length, 1, "no file named: ask");
});

test("2.15.0 a Revit change (create, save, delete) on the working copy asks nobody; a build without the working-copy check lifts nothing", async () => {
	for (const call of ["create_level", "save_document"]) {
		const r = await batchRun([call], false, { work: true });
		assert.equal(r.asked.length, 0, call);
		assert.equal(r.checked, 1, `${call}: the working-copy check still ran`);
		assert.equal(r.result, undefined);
	}
});

test("2.15.1 the working-copy check follows the Revit session the agent chose with select_revit_instance (two sessions open), and asks nothing of another one", async () => {
	// a select_revit_instance call comes first in the run; the next Revit change is checked with the same arguments
	const dir = tmp("wc-sel-");
	const store = new ThreadStore(join(dir, "th"));
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const levels = { select_revit_instance: "read", create_level: "confirm" } as const;
	const seen: (Record<string, unknown> | null)[] = [];
	const afterBatchChoice: (Record<string, unknown> | null)[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => DEFAULT_SETTINGS,
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, tools: Object.keys(levels), levels }),
		revitWork: async (_p, choice) => (seen.push(choice ?? null), { ok: true, title: "XY_AR_WORK" }),
		afterBatch: async (_p, _s, choice) => (afterBatchChoice.push(choice ?? null), "revīzija r1"),
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		threads: () => store,
		locks: new LockRegistry(),
		runAgent: async (o) => {
			const sig = new AbortController().signal;
			const call = (name: string, args: Record<string, unknown>) => ({ toolCall: { name, id: name, arguments: args }, args, assistantMessage: { content: [{ type: "toolCall", id: name, name, arguments: args }] } }) as never;
			if (!seen.length) await o.beforeToolCall?.(call("select_revit_instance", { pid: 14488 }), sig);
			await o.beforeToolCall?.(call("create_level", {}), sig);
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const thread = store.create({ projectId: "BD999", agent: "lead", title: "t", startedBy: "user" });
	await runner.run({ runId: "r1", thread, spec: null, text: "izveido līmeņus", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => false });
	assert.deepEqual(seen, [{ pid: 14488 }], "the check was made on the chosen session, nobody was asked");
	assert.deepEqual(afterBatchChoice, [{ pid: 14488 }], "the revision is taken from the same session");
	// the revit_* tools run in the tools server (another process): the choice reaches it in the conversation's file
	assert.deepEqual(JSON.parse(readFileSync(choiceFile(dir, thread.id), "utf8")), { pid: 14488 });
	// the next message of the same conversation makes no select_revit_instance: the check and the revision still get the choice (2.16.3; it was lost with the run before)
	await runner.run({ runId: "r2", thread, spec: null, text: "vēl vienu līmeni", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => false });
	assert.deepEqual(seen[1], { pid: 14488 });
});

/** A run whose model asks, in ONE assistant message, for these Revit calls in order; each goes through the gate as the engine would send it. */
async function messageRun(calls: { name: string; args: Record<string, unknown> }[]) {
	const dir = tmp("wc-msg-");
	const store = new ThreadStore(join(dir, "th"));
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const levels = { select_revit_instance: "read", create_level: "confirm" } as const;
	const seen: (Record<string, unknown> | null)[] = [];
	const results: ({ block?: boolean; reason?: string } | undefined)[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => DEFAULT_SETTINGS,
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, tools: Object.keys(levels), levels }),
		revitWork: async (_p, choice) => (seen.push(choice ?? null), { ok: true, title: "XY_AR_WORK" }),
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		threads: () => store,
		locks: new LockRegistry(),
		runAgent: async (o) => {
			const content = calls.map((c, i) => ({ type: "toolCall", id: `t${i}`, name: c.name, arguments: c.args }));
			const assistantMessage = { content };
			for (const [i, c] of calls.entries()) {
				const ctx = { toolCall: content[i], args: c.args, assistantMessage } as never;
				results.push((await o.beforeToolCall?.(ctx, new AbortController().signal)) as never);
				await o.afterToolCall?.({ toolCall: { id: `t${i}` } } as never, new AbortController().signal);
			}
			o.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const thread = store.create({ projectId: "BD999", agent: "lead", title: "t", startedBy: "user" });
	await runner.run({ runId: "r1", thread, spec: null, text: "modele", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: () => undefined, ask: async () => false });
	return { seen, results };
}

test("2.15.1 a Revit session switch after a change in the same message is refused, so a later change cannot land in an unchecked session", async () => {
	const r = await messageRun([
		{ name: "select_revit_instance", args: { pid: 1 } },
		{ name: "create_level", args: {} },
		{ name: "select_revit_instance", args: { pid: 2 } },
		{ name: "create_level", args: {} },
	]);
	assert.equal(r.results[0], undefined, "a choice before the changes runs");
	assert.equal(r.results[1], undefined);
	assert.equal(r.results[2]?.block, true, "the switch after a change is refused");
	assert.equal(r.results[2]?.reason, SELECT_AFTER_CHANGE);
	assert.match(SELECT_AFTER_CHANGE, /NENORAIDĪJA/);
	assert.equal(r.results[3], undefined, "the next change stays on the checked session");
	assert.deepEqual(r.seen, [{ pid: 1 }]);
});

test("2.15.1 the app counts its own session choice only when the Revit server says it made it", async () => {
	const answer = (text: string) => ({ call: async () => text }) as never;
	assert.equal(await selectSession(answer("Selected: pid 1  Revit 2026  port 8081  XY_AR_WORK"), { pid: 1 }), true);
	for (const text of ["No running session matches. Running sessions:\n  pid 1", "More than one session matches; use pid:\n  pid 1", "Give pid or match. Running sessions:\n  pid 1", ""]) {
		assert.equal(await selectSession(answer(text), { match: "AR" }), false, text);
	}
});
