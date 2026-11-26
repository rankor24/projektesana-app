// 25.0 The original model is never touched (the user's ruling, 2026-11-25: agents work on a copy in the app's own project folder, nothing on B: is changed).
// Every role that changes a model can make its own working copy (revit_save_copy); opening a document stands alone in its batch, so a change in the same message can not land in
// the model that was just opened.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { OPEN_ALONE, ThreadRunner } from "../src/agent/thread-runner.ts";
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
	const asked: unknown[] = [];
	const content = calls.map((name, i) => ({ type: "toolCall", id: `t${i}`, name, arguments: opts.args ?? {} }));
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => DEFAULT_SETTINGS,
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, tools: Object.keys(levels), levels }),
		revitWork: async () => (checked++, { ok: !!opts.work, title: "XY_AR (cits modelis)" }),
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
	return { result, events, asked, checked };
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
