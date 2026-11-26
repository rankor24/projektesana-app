// 26.0 How long an agent may work (Iestatījumi → Aģenti → Soļu limits). Seen 2026-11-26: a modelling run ended with "Type 'go' and I'll continue, one element per call" after the
// hard-coded 80 steps (a helper's 40). Now: the limits are settings (default 1000 for the main agent, 500 for a helper), every run is given them, and the agents' rules say
// to work to the end and stop only for a real blocker. Antigravity's own loop is covered in 22.0.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime, DEFAULT_MAX_TURNS } from "../src/agent/pi/index.ts";
import { SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import { RULES, runLanes, type Job, type LaneDeps } from "../src/agent/subagents.ts";
import { REVIT_RULES } from "../src/agent/tools/revit.ts";
import { ThreadRunner } from "../src/agent/thread-runner.ts";
import { WORK_RULE } from "../src/agent/work-rule.ts";
import { makeLevelOf } from "../src/agent/tools/levels.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { AppSettings } from "../src/main/settings.ts";
import { buildRegistry } from "../src/main/app-settings/registry.ts";
import { DEFAULT_MAX_TURNS as SETTING_DEFAULT, DEFAULT_MAX_TURNS_SUB, DEFAULT_SETTINGS, MAX_TURNS_LIMIT, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };

test("the defaults are high (1000 main, 500 helpers), a settings file from before has them too, and a value is kept inside 1 – 10000", () => {
	assert.equal(SETTING_DEFAULT, 1000);
	assert.equal(DEFAULT_MAX_TURNS_SUB, 500);
	assert.equal(DEFAULT_MAX_TURNS, SETTING_DEFAULT, "an engine given no limit uses the setting's default, not the old 80");
	const dir = tmp("turns-");
	const s = new AppSettings(dir, plainCrypto);
	assert.deepEqual([s.get().maxTurns, s.get().maxTurnsSub], [1000, 500]);
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ provider: "openai-codex", maxParallelAgents: 2 }));
	assert.deepEqual([s.get().maxTurns, s.get().maxTurnsSub], [1000, 500], "a file with no limits");
	assert.equal(s.set({ maxTurns: 2500 }).maxTurns, 2500);
	assert.equal(s.set({ maxTurns: 0 }).maxTurns, 1000, "0 is no number of steps: the default");
	assert.equal(s.set({ maxTurns: 99999 }).maxTurns, MAX_TURNS_LIMIT);
	assert.equal(s.set({ maxTurnsSub: 12.4 }).maxTurnsSub, 12);
	assert.equal(s.set({ maxTurnsSub: "abc" as never }).maxTurnsSub, 500);
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ maxTurns: -5, maxTurnsSub: "x" }));
	assert.deepEqual([s.get().maxTurns, s.get().maxTurnsSub], [1000, 500], "a file edited by hand");
});

test("an agent can read and change both limits through the settings tool; Undo gives the old value back", async () => {
	const dir = tmp("turns-reg-");
	const settings = new AppSettings(dir, plainCrypto);
	const entries = await buildRegistry({ settings, providers: async () => [], holds: async () => [] });
	for (const [id, key] of [["agents.maxTurns", "maxTurns"], ["agents.maxTurnsSub", "maxTurnsSub"]] as const) {
		const e = entries.find((x) => x.id === id);
		assert.ok(e && e.tier === "safe", id);
		if (!e || e.tier !== "safe") continue;
		assert.match(e.where, /Iestatījumi/);
		assert.equal(e.value.safeParse(0).success, false);
		assert.equal(e.value.safeParse(MAX_TURNS_LIMIT + 1).success, false);
		const snap = e.snap();
		assert.equal(await e.write(3000), null);
		assert.equal(settings.get()[key], 3000);
		e.restore(snap);
		assert.equal(settings.get()[key], key === "maxTurns" ? 1000 : 500);
	}
});

test("a run of the main agent is given the setting's limit, and a helper's lane the helper limit (not the old 80 and 40)", async () => {
	const dir = tmp("turns-run-");
	const store = new ThreadStore(join(dir, "th"));
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const seen: (number | undefined)[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxTurns: 1234, maxTurnsSub: 77 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [{ id: "lead", name: "Lead", description: "", prompt: "", tools: [] }],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		threads: () => store,
		locks: new LockRegistry(),
		runAgent: async (o) => {
			seen.push(o.maxTurns);
			o.onEvent({ type: "done", text: "gatavs" });
		},
	} as never);
	const thread = store.create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	const events: RunEvent[] = [];
	await runner.run({ runId: "r1", thread, spec: null, text: "dari", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async () => true });
	assert.deepEqual(seen, [1234]);
});

test("a lane's run gets the helper limit from the deps, else 500", async () => {
	const limits: (number | undefined)[] = [];
	const deps = (maxTurns?: number): LaneDeps => ({
		run: async (o) => {
			limits.push(o.maxTurns);
			o.onEvent({ type: "done", text: "gatavs" });
		},
		base: { runtime: {} as never },
		mcpFor: () => ({}),
		levelOf: makeLevelOf({}),
		listed: [],
		revitTools: new Set(),
		locks: new LockRegistry().forProject(null),
		emit: () => undefined,
		maxParallel: () => 1,
		specs: () => [],
		...(maxTurns === undefined ? {} : { maxTurns }),
	});
	const job: Job = { id: "j1", label: "darbs", task: "dari", system: "s", allowed: [] };
	await runLanes(deps(), [job], new AbortController().signal);
	await runLanes(deps(77), [job], new AbortController().signal);
	assert.deepEqual(limits, [500, 77]);
});

test("the agents' rules say: work to the end, never ask for \"go\", stop only for a real blocker", () => {
	assert.match(WORK_RULE, /neapstājies, lai prasītu «go»/);
	assert.match(WORK_RULE, /īsta šķēršļa/);
	assert.ok(SYSTEM_PROMPT.includes(WORK_RULE), "the lead");
	assert.ok(RULES.includes(WORK_RULE), "every specialist and lane");
	assert.match(REVIT_RULES, /negaidi lietotāja «go»/, "one call per action is a size, not a pause");
	assert.match(SYSTEM_PROMPT, /izsauc tos cits pēc cita/);
});
