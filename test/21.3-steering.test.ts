// Steering: a message written while a chat's agent answers is held, shown, editable and cancellable; the agent reads it after its current step
// (when the engine has a way in), else it starts a new run when this one ends. A stopped or failed run keeps it for the user.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { LockRegistry } from "../src/agent/locks.ts";
import { ThreadRunner, type RunSteer } from "../src/agent/thread-runner.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { Holds } from "../src/core/holds.ts";
import { IncidentStore } from "../src/core/incidents.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { runLines, placeSteered, apply, type Line } from "../src/renderer/shell/chat-lines.ts";
import { DEFAULT_DEPARTMENTS } from "../src/shared/departments.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

interface Started {
	threadId: string;
	text: string;
	signal: AbortSignal;
	emit: (e: RunEvent) => void;
	onSteer?: (h: RunSteer | null) => void;
	end: (ok: boolean) => void;
}

/** A coordinator over a runner that is a promise per run. `steer` = the engine offers a handle (the fake keeps what was pushed). */
function rig(o: { steer?: boolean } = {}) {
	const dir = tmp("steer-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `threads-${p ?? "_"}`))), stores.get(p)!);
	const started: Started[] = [];
	const events: { runId: string; e: RunEvent }[] = [];
	const titles: { text: string; runId: string }[] = [];
	const untitled: string[] = [];
	// what the fake agent has been handed and what it has read
	const pushed: { text: string; taken: () => void }[] = [];
	let reading = false;
	const handle: RunSteer = {
		push: (m, taken) => void pushed.push({ text: m.text, taken }),
		withdraw: () => {
			if (reading || !pushed.length) return false;
			pushed.pop();
			return true;
		},
	};
	const runner = {
		run: (i: { runId: string; thread: { id: string }; text: string; signal: AbortSignal; emit: (e: RunEvent) => void; onSteer?: (h: RunSteer | null) => void }) =>
			new Promise<{ ok: boolean; answer: string; confirmedBatches: number }>((resolve) => {
				const s: Started = {
					threadId: i.thread.id,
					text: i.text,
					signal: i.signal,
					emit: i.emit,
					onSteer: i.onSteer,
					end: (ok) => {
						if (o.steer) i.onSteer?.(null);
						resolve({ ok, answer: ok ? "gatavs" : "", confirmedBatches: 0 });
					},
				};
				started.push(s);
				if (o.steer) i.onSteer?.(handle);
				i.signal.addEventListener("abort", () => s.end(false));
			}),
	};
	const c = new Coordinator({
		runner: runner as never,
		threads,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 3 }),
		emit: (runId, e) => void events.push({ runId, e }),
		queueFile: join(dir, "queue.json"),
		specs: () => [],
		holds: new Holds(),
		incidents: new IncidentStore(),
		departments: () => DEFAULT_DEPARTMENTS,
		titleRun: (_p, text, runId) => {
			titles.push({ text, runId });
			return () => void untitled.push(runId);
		},
	});
	const open = (title = "A") => threads("P1").create({ projectId: "P1", agent: "lead", title, startedBy: "user" });
	const send = (id: string, text = "darbs") => c.start({ threadId: id, projectId: "P1", text, focus: [], cause: { by: "user" } });
	const hold = (id: string, text: string) => c.hold({ threadId: id, projectId: "P1", text, focus: [] });
	const settle = () => new Promise((r) => setTimeout(r, 20));
	return { c, open, send, hold, started, events, titles, untitled, pushed, settle, reading: (v: boolean) => (reading = v) };
}

test("hold: a message written while the agent answers is held and listed; a thread that is idle refuses it", async () => {
	const r = rig();
	const a = r.open();
	assert.throws(() => r.hold(a.id, "x"), /nestrādā/, "nothing runs: the message is sent the normal way");
	await r.send(a.id);
	const v = r.hold(a.id, "vēl viens");
	assert.equal(v.text, "vēl viens");
	assert.equal(v.kept, undefined);
	assert.deepEqual(r.c.view().steering.map((s) => s.text), ["vēl viens"]);
	r.started[0].end(true);
	await r.settle();
});

test("hold: without a way into the engine the run's good end starts a new run with the held message, whose first event is `steered`", async () => {
	const r = rig();
	const a = r.open();
	await r.send(a.id, "pirmais");
	r.hold(a.id, "otrais");
	r.started[0].end(true);
	await r.settle();
	assert.equal(r.started.length, 2, "a second run started");
	assert.equal(r.started[1].text.includes("otrais"), true);
	assert.deepEqual(r.c.view().steering, [], "the held message left the list");
	const second = r.events.find((x) => x.e.type === "steered");
	assert.ok(second, "the run announces the message");
	assert.equal((second!.e as { starts?: true }).starts, true);
	assert.equal(r.titles.length, 1);
	assert.equal(r.titles[0].text, "otrais", "the activity log titles the new run with the message");
	r.started[1].end(true);
});

test("hold: two messages in a row are one held message (nothing is lost)", async () => {
	const r = rig();
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "viens");
	const v = r.hold(a.id, "divi");
	assert.equal(v.text, "viens\n\ndivi");
	assert.equal(r.c.view().steering.length, 1);
	r.started[0].end(true);
	await r.settle();
	r.started[1]?.end(true);
});

test("hold with a way in: the agent is handed the message; it is a chat line (no longer held) once the agent has read it", async () => {
	const r = rig({ steer: true });
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "pievieno sienu");
	assert.equal(r.pushed.length, 1);
	assert.equal(r.pushed[0].text, "pievieno sienu");
	assert.equal(r.c.view().steering.length, 1, "still shown as held until the agent reads it");
	r.pushed[0].taken();
	assert.deepEqual(r.c.view().steering, [], "read: the held card goes");
	r.started[0].end(true);
	await r.settle();
	assert.equal(r.started.length, 1, "no second run: the agent already had it");
});

test("hold with a way in: a message the agent did not read before the run ended starts a new run", async () => {
	const r = rig({ steer: true });
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "kavēts");
	r.started[0].end(true);
	await r.settle();
	assert.equal(r.started.length, 2);
	assert.equal(r.started[1].text.includes("kavēts"), true);
	r.started[1].end(true);
});

test("unhold: cancelling takes the message back out of the agent's queue; too late once the agent is reading it", async () => {
	const r = rig({ steer: true });
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "atcelšu");
	const back = r.c.unhold(a.id);
	assert.equal(back?.text, "atcelšu");
	assert.equal(r.pushed.length, 0, "withdrawn from the agent");
	assert.deepEqual(r.c.view().steering, []);
	assert.equal(r.c.unhold(a.id), null, "nothing held");
	r.hold(a.id, "par vēlu");
	r.reading(true);
	assert.equal(r.c.unhold(a.id), null, "the agent is reading it: it stays");
	assert.equal(r.c.view().steering.length, 1);
	r.started[0].end(true);
	await r.settle();
	r.started[1]?.end(true);
});

test("edit: the held text changes (the agent's copy is replaced); too late once the agent is reading it", async () => {
	const r = rig({ steer: true });
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "vecais");
	const v = r.c.edit(a.id, "jaunais");
	assert.equal(v?.text, "jaunais");
	assert.deepEqual(r.pushed.map((p) => p.text), ["jaunais"], "only the new text is with the agent");
	assert.throws(() => r.c.edit(a.id, "  "), /Tukšs/);
	r.reading(true);
	assert.equal(r.c.edit(a.id, "vēlreiz"), null);
	assert.equal(r.c.view().steering[0].text, "jaunais");
	r.started[0].end(true);
	await r.settle();
	r.started[1]?.end(true);
});

test("a stopped run keeps the held message for the user; Sūtīt tagad sends it as a run of its own", async () => {
	const r = rig();
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "pēc apturēšanas");
	r.c.stopThread(a.id);
	await r.settle();
	assert.equal(r.started.length, 1, "a stopped run does not send it by itself");
	const [kept] = r.c.view().steering;
	assert.equal(kept.kept, "stopped");
	assert.equal(kept.text, "pēc apturēšanas");
	const sent = r.c.release(a.id);
	assert.equal(sent.queued, false);
	assert.equal(r.started.length, 2);
	assert.equal(r.started[1].text.includes("pēc apturēšanas"), true);
	assert.deepEqual(r.c.view().steering, []);
	r.started[1].end(true);
});

test("a run that ended in an error keeps the held message for the user; release refuses a message that is still waiting for its run", async () => {
	const r = rig();
	const a = r.open();
	await r.send(a.id);
	r.hold(a.id, "pēc kļūdas");
	assert.throws(() => r.c.release(a.id), /gaida/i, "not kept: the run decides it");
	r.started[0].end(false);
	await r.settle();
	const [kept] = r.c.view().steering;
	assert.ok(kept?.kept === "failed" || kept?.kept === "stopped", "kept for the user");
	assert.equal(r.started.length, 1);
});

test("a held message waits for the queued run of its thread and goes with the run's end", async () => {
	const r = rig();
	const a = r.open();
	await r.send(a.id);
	// the user also stops the chat's run through the thread: the message that was held for it is kept
	r.hold(a.id, "rindā");
	assert.equal(r.c.hasHold(a.id), true);
	r.started[0].end(true);
	await r.settle();
	assert.equal(r.c.hasHold(a.id), false, "sent as a run");
	r.started[1].end(true);
});

test("chat lines: a steered event is a user line; a run started for it puts the message above its card", () => {
	const e: RunEvent = { type: "steered", text: "ziņa", starts: true };
	assert.deepEqual(apply([], e), [{ kind: "user", text: "ziņa" }]);
	const picked = runLines("r1", apply([], e));
	assert.deepEqual(picked.map((l: Line) => l.kind), ["user", "run"], "message first, then the run card");
	const withText = runLines("r1", [...apply([], e), { kind: "assistant", text: "atbilde" }]);
	assert.deepEqual(withText.map((l: Line) => l.kind), ["user", "run", "assistant"]);
	const placed = placeSteered([{ kind: "run", runId: "r1" }], "r1", e as Extract<RunEvent, { type: "steered" }>);
	assert.deepEqual(placed.map((l: Line) => l.kind), ["user", "run"]);
	// a message the agent read mid-run goes where the run has got to
	const mid = apply([{ kind: "run", runId: "r1" }, { kind: "assistant", text: "daļa" }], { type: "steered", text: "vēl" });
	assert.deepEqual(mid.map((l: Line) => l.kind), ["run", "assistant", "user"]);
});

test("thread runner: the engine's handle becomes the run's steering handle; a message the engine takes is saved in the thread and announced as `steered`", async () => {
	const dir = tmp("steer-run-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `th-${p ?? "_"}`))), stores.get(p)!);
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec: AgentSpec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	const pushedToEngine: string[] = [];
	let engineTaken: (() => void) | undefined;
	let steer: RunSteer | null = null;
	const engine = async (o: PiRunOptions) => {
		o.onSteer?.({
			push: (m, taken) => {
				pushedToEngine.push(m.text);
				engineTaken = taken;
			},
			withdraw: () => false,
		});
		// the agent reads the message between two steps
		engineTaken?.();
		o.onEvent({ type: "done", text: "gatavs" });
		o.onSteer?.(null);
	};
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: (async (o: PiRunOptions) => {
			// the handle exists while the engine runs: the test pushes through the run's handle from inside it
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			await engine({ ...o, onSteer: (h) => {
				o.onSteer?.(h);
				if (h) {
					steer?.push({ text: "pievieno vēl", focus: [], files: { images: [], text: "", refs: [] } }, () => undefined);
				}
			} });
		}) as never,
		threads,
		locks: new LockRegistry(),
	});
	const thread = threads(null).create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	const events: RunEvent[] = [];
	await runner.run({
		runId: "r1",
		thread,
		spec,
		text: "sāk",
		focus: [],
		files: { images: [], text: "", refs: [] },
		wave: "w",
		signal: new AbortController().signal,
		emit: (e) => void events.push(e),
		ask: async () => false,
		onSteer: (h) => {
			steer = h;
		},
	});
	assert.equal(pushedToEngine.length, 1, "the engine was handed the message");
	assert.ok(pushedToEngine[0].includes("pievieno vēl"));
	assert.ok(events.some((e) => e.type === "steered" && e.text === "pievieno vēl" && e.starts === undefined), "announced to the chat");
	assert.ok(threads(null).transcript(thread.id).some((m) => m.role === "user" && m.text === "pievieno vēl"), "saved in the conversation");
});
