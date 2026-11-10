// 0.7 chat sessions: "jauna saruna" starts a real new chat, the earlier ones stay selectable, each keeps its own transcript
// and context, and the one-file transcript from before sessions comes in as one session. The agent loop is scripted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime, type PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

/** `dir` given = the same app data folder again, as after a restart: nothing in memory, the transcripts on disk. */
function setup(dir = tmp()) {
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	let finish: () => void = () => {};
	/** what each run got: its first-run system prompt (the seed) and the history it carried */
	const got: { system: string; history: number }[] = [];
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: (_id, e) => {
			if (e.type === "done" || e.type === "error") finish();
		},
		runAgent: async (o: PiRunOptions) => {
			got.push({ system: o.systemPrompt ?? "", history: o.history?.length ?? 0 });
			const answer = `atbilde uz: ${o.prompt.slice(-20)}`;
			o.onMessages?.([...(o.history ?? []), { role: "user", content: [{ type: "text", text: o.prompt }], timestamp: Date.now() } as never]);
			o.onEvent({ type: "done", engine: "pi", text: answer } as never);
		},
	});
	const ask = async (projectId: string | null, text: string) => {
		const done = new Promise<void>((r) => (finish = r));
		await s.send(projectId, text, []);
		await done;
		// the transcript's last line is written after the run's events
		await (s as unknown as { runDone: Promise<unknown> }).runDone;
	};
	return { s, dir, ask, got };
}

test("sessions: a new chat starts empty, the earlier one stays in the list and opens again with its own lines", async () => {
	const { s, ask, dir } = setup();
	await ask("p1", "Pirmā saruna par telpām");
	const first = s.activeSession("p1");
	assert.equal(s.history("p1").length, 2);

	const { sessionId: second } = s.newSession("p1");
	assert.notEqual(second, first);
	assert.deepEqual(s.history("p1"), [], "the new chat shows nothing of the old one");
	// listed before its first message, so the selector can show it as open
	assert.equal(s.sessions("p1").active, second);
	assert.equal(s.sessions("p1").list[0].title, "(jauna saruna)");

	await ask("p1", "Otrā saruna par jumtu");
	const list = s.sessions("p1").list;
	assert.deepEqual(list.map((r) => r.title).sort(), ["Otrā saruna par jumtu", "Pirmā saruna par telpām"]);
	assert.ok(list.every((r) => r.messages === 2));
	assert.equal(readdirSync(join(dir, "chat", "p1")).length, 2, "one file per chat");

	s.openSession("p1", first);
	assert.equal(s.history("p1")[0].text, "Pirmā saruna par telpām");
});

test("sessions: each chat keeps its own context; a new chat is not seeded from the old transcript", async () => {
	const { s, ask, got } = setup();
	await ask("p1", "Pirmā saruna");
	await ask("p1", "turpinājums");
	assert.ok(got[1].history > 0, "the second message of a chat carries the chat");

	s.newSession("p1");
	await ask("p1", "jauna tēma");
	assert.equal(got[2].history, 0, "a new chat starts with no history");
	assert.doesNotMatch(got[2].system, /Pirmā saruna|turpinājums/, "nothing of the old chat in the seed");
});

test("sessions: after a restart the newest chat opens, and an earlier one, reopened, brings its own lines to the model", async () => {
	const a = setup();
	await a.ask("p1", "Saruna par kāpnēm");
	const stairs = a.s.activeSession("p1");
	a.s.newSession("p1");
	await a.ask("p1", "Saruna par logiem");

	const b = setup(a.dir);
	assert.equal(b.s.history("p1")[0].text, "Saruna par logiem", "the newest chat is the one open after a restart");
	b.s.openSession("p1", stairs);
	await b.ask("p1", "un platums?");
	// nothing in memory: the model gets the earlier lines of this chat, and none of the other chat
	assert.equal(b.got[0].history, 0);
	assert.match(b.got[0].system, /Saruna par kāpnēm/);
	assert.doesNotMatch(b.got[0].system, /Saruna par logiem/);
	assert.equal(b.s.history("p1").length, 4, "the new lines went to the reopened chat");
});

test("sessions: the one-file transcript from before sessions is moved in as one chat, nothing lost", () => {
	const { s, dir } = setup();
	const lines = [
		{ role: "user", text: "Vecā saruna", at: "2026-11-09T10:00:00.000Z" },
		{ role: "assistant", text: "atbilde", at: "2026-11-09T10:01:00.000Z" },
	];
	writeFileSync(join(dir, "chat", "BD427.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
	const r = s.sessions("BD427");
	assert.equal(r.list.length, 1);
	assert.equal(r.list[0].title, "Vecā saruna");
	assert.equal(r.active, r.list[0].id);
	assert.equal(existsSync(join(dir, "chat", "BD427.jsonl")), false, "moved, not copied");
	assert.deepEqual(s.history("BD427").map((e) => e.text), ["Vecā saruna", "atbilde"]);
});

test("sessions: switching is refused while a run goes; an unknown or path-like id is refused", async () => {
	const { s } = setup();
	assert.throws(() => s.openSession("p1", "../../etc"), /nav atrasta/);
	assert.throws(() => s.openSession("p1", "snotthere"), /nav atrasta/);
	(s as unknown as { running: unknown }).running = { id: "x", abort: new AbortController() };
	assert.throws(() => s.newSession("p1"), /strādā/);
});
