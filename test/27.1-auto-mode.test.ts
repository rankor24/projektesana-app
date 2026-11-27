// 27.1 Auto mode (the button in the agent chat, Settings.autoApprove): approval cards are answered yes by the app, except what stays with the user.
// What no click lifts stays refused: the gate's `never` and office-folder `deny` come before any card. Invented data only.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Coordinator } from "../src/agent/coordinator.ts";
import { Gate, autoMayApprove, makeLevelOf } from "../src/agent/tools/levels.ts";
import { Holds } from "../src/core/holds.ts";
import { IncidentStore } from "../src/core/incidents.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { AppSettings } from "../src/main/settings.ts";
import { DEFAULT_DEPARTMENTS } from "../src/shared/departments.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const app = (call: string) => ({ tool: "app_confirm", args: { call, args: [] } });

test("27.1 autoMayApprove: run_command, files, Revit and an agent's own MCP tools are answered; agent changes and the delivery copy stay with the user", () => {
	assert.equal(autoMayApprove([{ tool: "run_command", args: { command: "dir" } }, { tool: "write_file", args: {} }, { tool: "create_level", args: {} }, { tool: "open_document", args: {} }]), true);
	assert.equal(autoMayApprove([app("facts.decide"), app("threads.close")]), true);
	assert.equal(autoMayApprove([{ tool: "agent_configure", args: {} }]), false);
	for (const c of ["agents.save", "agents.role.set", "skills.import", "deliveries.copy", "deliveries.markSent"]) assert.equal(autoMayApprove([{ tool: "run_command", args: {} }, app(c)]), false, `${c} asks even in a batch with others`);
	assert.equal(autoMayApprove([{ tool: "app_confirm", args: null }]), false, "an app_confirm that cannot be read is not judged by Auto mode");
});

test("27.1 the gate refuses before it asks: send_code_to_revit, Revit by shell and an office-folder write are blocked and never reach Auto mode", async () => {
	let asked = 0;
	const levelOf = makeLevelOf({ run_command: "confirm", write_file: "confirm", send_code_to_revit: "confirm" });
	const gate = new Gate(levelOf, async () => (asked++, true), () => false, (tool) => (tool === "write_file" ? "Projekta (biroja) mapē app neraksta nekad" : null));
	const ctx = (name: string, args: unknown) => ({ toolCall: { name, id: "t", arguments: args }, args, assistantMessage: { content: [{ type: "toolCall", id: "t", name, arguments: args }] } }) as never;
	assert.equal(((await gate.before(ctx("send_code_to_revit", {}))) as { block: boolean }).block, true);
	assert.equal(((await gate.before(ctx("run_command", { command: "Get-Process Revit | Stop-Process" }))) as { block: boolean }).block, true);
	assert.equal(((await gate.before(ctx("write_file", { path: "B:\\x.md" }))) as { block: boolean }).block, true);
	assert.equal(asked, 0, "no card was even asked");
});

type Batch = { tool: string; args: unknown }[];

function rig(settings: Partial<Settings>) {
	const batch: { now: Batch } = { now: [] };
	const dir = tmp("auto-");
	const stores = new Map<string | null, ThreadStore>();
	const threads = (p: string | null) => stores.get(p) ?? (stores.set(p, new ThreadStore(join(dir, `threads-${p ?? "_"}`))), stores.get(p)!);
	const events: { type: string }[] = [];
	const cfg = { ...DEFAULT_SETTINGS, ...settings };
	// a run that asks one batch and ends with what the answer was
	const runner = {
		run: async (i: { ask: (r: { id: string; batch: Batch }) => Promise<boolean> }) => {
			const answer = await i.ask({ id: "c1", batch: batch.now });
			return { ok: true, answer: String(answer), confirmedBatches: answer ? 1 : 0 };
		},
	};
	const c = new Coordinator({ runner: runner as never, threads, settings: () => cfg, emit: (_id: string, e: { type: string }) => void events.push(e), queueFile: join(dir, "queue.json"), holds: new Holds(), incidents: new IncidentStore(), departments: () => DEFAULT_DEPARTMENTS });
	const open = () => threads("P1").create({ projectId: "P1", agent: "lead", title: "Saruna", startedBy: "user" });
	const send = (id: string) => c.start({ threadId: id, projectId: "P1", text: "darbs", focus: [], cause: { by: "user" } });
	return { c, open, send, events, cfg, batch };
}
test("27.1 coordinator: with Auto mode on a confirm batch is answered at once with no card; a kept batch still waits; off, everything waits", async () => {
	const on = rig({ autoApprove: true });
	on.batch.now = [{ tool: "run_command", args: { command: "dir" } }];
	await on.send(on.open().id);
	assert.equal(on.events.some((e) => e.type === "confirm"), false, "no card shown");
	assert.deepEqual(on.c.waiting(), []);

	const off = rig({ autoApprove: false });
	off.batch.now = [{ tool: "run_command", args: { command: "dir" } }];
	await off.send(off.open().id);
	assert.equal(off.events.some((e) => e.type === "confirm"), true, "off: the card is shown");
	assert.equal(off.c.waiting().length, 1);

	const kept = rig({ autoApprove: true });
	kept.batch.now = [{ tool: "agent_configure", args: {} }];
	await kept.send(kept.open().id);
	assert.equal(kept.c.waiting().length, 1, "agent_configure still asks in Auto mode");
});

test("27.1 switching Auto mode on answers the cards that already wait, except the ones the user keeps", async () => {
	const r = rig({ autoApprove: false });
	r.batch.now = [{ tool: "run_command", args: { command: "dir" } }];
	await r.send(r.open().id);
	r.batch.now = [{ tool: "agent_configure", args: {} }];
	await r.send(r.open().id);
	assert.equal(r.c.waiting().length, 2);
	r.cfg.autoApprove = true;
	r.c.approveWaiting();
	const left = r.c.waiting();
	assert.equal(left.length, 1);
	assert.match((left[0] as { tool: string }).tool, /agent_configure/);
});

test("27.1 the setting is the user's: it is stored as true only for true, off by default, and the agent has no way to set it", () => {
	assert.equal(DEFAULT_SETTINGS.autoApprove, false);
	const s = new AppSettings(tmp("auto-set-"), { available: () => true, encrypt: (x: string) => Buffer.from(x), decrypt: (b: Buffer) => b.toString() });
	assert.notEqual(s.get().autoApprove, true);
	assert.equal(s.set({ autoApprove: "yes" as never }).autoApprove, false);
	assert.equal(s.set({ autoApprove: true }).autoApprove, true);
	assert.equal(s.set({ autoApprove: false }).autoApprove, false);
});

test("27.1 a guarded card says in plain words what it would do (the user: keep it guarded, with a clear command)", async () => {
	const { confirmNotes } = await import("../src/shared/confirm-text.ts");
	const notes = confirmNotes(JSON.stringify([{ tool: "agent_configure", args: { agent: "ar", reason: "vajag Revit rīku" } }, app("deliveries.copy"), app("agents.save"), { tool: "run_command", args: { command: "dir" } }]));
	assert.equal(notes.length, 3, "run_command has no note");
	assert.match(notes[0].text, /Maina aģenta/);
	assert.deepEqual(notes[0].vars, { agent: "ar", reason: "vajag Revit rīku" });
	assert.match(notes[1].text, /1\.4_Nodevumi/);
	assert.deepEqual(notes[2].vars, { call: "agents.save" });
	assert.deepEqual(confirmNotes("not json"), []);
});
