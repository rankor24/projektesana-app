// Final review, restart side: what a crash or a quit leaves in the mailbox is reconciled by the user's answer to the restart question.
//   C1: Atmest also stops the queued messages (not only the queue items), so no discarded run starts later.
//   I1: a recipient cut by quit or crash must not leave its sender waiting for ever: Turpināt writes the "bloķēts" reply that wakes it, Atmest writes it stopped.
// Scripted agent loop (SessionDeps.runAgent); invented agents; nothing leaves the machine.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { Mailbox, mailDir } from "../src/core/messages.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string) => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
type Ctx = { agent: string; o: any; n: number };

function session(dir: string, cap: number, scripts: Record<string, (c: Ctx) => Promise<void> | void>) {
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const calls: Ctx[] = [];
	const seen: Record<string, number> = {};
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: cap }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec("ekspertize"), spec("parbaude")],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		runAgent: async (o: any) => {
			const m = /AGENT (\S+?)\./.exec(o.systemPrompt ?? "");
			const agent = m ? m[1] : "lead";
			const c: Ctx = { agent, o, n: (seen[agent] = (seen[agent] ?? 0) + 1) };
			calls.push(c);
			await scripts[agent]?.(c);
			o.onEvent({ type: "done", text: `${agent} #${c.n}` });
		},
	} as any);
	const settle = async () => {
		for (let quiet = 0, i = 0; quiet < 2 && i < 400; i++) {
			await tick();
			const v = s.queueView();
			quiet = v.running.length === 0 && !v.queued.some((q) => q.state === "queued") ? quiet + 1 : 0;
		}
	};
	const send = (c: Ctx, p: any) => c.o.extraTools.find((t: any) => t.name === "send_message").execute("t", p, c.o.signal);
	return { s, calls, settle, send, mail: new Mailbox(mailDir(dir, dir, null)), threads: new ThreadStore(threadsDir(dir, dir, null)) };
}
const untilAbort = (o: any) => new Promise<void>((r) => (o.signal.aborted ? r() : o.signal.addEventListener("abort", () => r())));
const states = (r: ReturnType<typeof session>) => Object.fromEntries(r.threads.list().map((t) => [t.agent, t.state]));

/** The lead asks `ekspertize`, which works until the app is closed. Returns session `a` after a clean quit (or, with `crash`, left as it was). */
async function cutRecipient(dir: string, crash: boolean) {
	const a: ReturnType<typeof session> = session(dir, 6, {
		lead: async (c) => {
			if (c.n === 1) await a.send(c, { to: "ekspertize", title: "T", kind: "ask", text: "?" });
		},
		ekspertize: async (c) => {
			await untilAbort(c.o);
		},
	});
	await a.s.send(null, "jautā", []);
	await tick(60);
	assert.equal(states(a).ekspertize, "running", "the recipient is mid-run");
	if (!crash) await a.s.shutdown();
	return a;
}

// ---- C1 ---------------------------------------------------------------------------------------------------------------------------

test("C1: crash with a queued message-run, restore, Atmest, an unrelated user message: no discarded run starts", async () => {
	const dir = tmp();
	// cap 1: the lead's run holds the only slot while its ask waits in the queue
	const a: ReturnType<typeof session> = session(dir, 1, {
		lead: async (c) => {
			await a.send(c, { to: "ekspertize", title: "T", kind: "ask", text: "?" });
			await new Promise(() => undefined); // the app dies here
		},
	});
	void a.s.send(null, "jautā", []);
	await tick(60);
	assert.deepEqual(a.mail.messages().map((m) => m.state), ["queued"], "the ask waits behind the cap");

	const b = session(dir, 1, {});
	b.s.restore();
	const found = b.s.queueRestored()!;
	assert.ok(found.queued >= 1, `the restart notice counts the queued work: ${JSON.stringify(found)}`);
	b.s.discardInterrupted();
	await b.settle();
	assert.deepEqual(b.mail.messages().map((m) => m.state), ["stopped"], "the message went with its queue item");
	assert.equal(b.calls.length, 0);

	await b.s.send(null, "cits jautājums", []);
	await b.settle();
	assert.deepEqual(b.calls.map((c) => c.agent), ["lead"], "only the new message ran, the discarded ask did not");
	assert.equal(states(b).ekspertize === "running" || states(b).ekspertize === "queued", false);
});

test("C1: a queued message with no queue item counts in the restart notice and Atmest stops it", async () => {
	const dir = tmp();
	const a: ReturnType<typeof session> = session(dir, 6, {
		lead: async (c) => {
			await a.send(c, { to: "ekspertize", title: "T", kind: "ask", text: "?" });
			// a second message to the same thread while it runs: it waits for the run to end, and no queue item holds it
			await a.send(c, { to: "ekspertize", topic: a.mail.topics()[0].id, kind: "ask", text: "vēl" });
		},
		ekspertize: async (c) => {
			await untilAbort(c.o);
		},
	});
	await a.s.send(null, "jautā", []);
	await tick(60);
	assert.deepEqual(a.mail.messages().map((m) => m.state), ["delivered", "queued"]);
	assert.equal(a.s.queueView().queued.length, 0, "no queue item holds the second message");
	// crash: session a is left as it is
	const b = session(dir, 6, {});
	b.s.restore();
	assert.ok(b.s.queueRestored()!.queued >= 1, "the notice counts the message");
	b.s.discardInterrupted();
	await b.settle();
	assert.deepEqual(b.mail.messages().filter((m) => m.kind !== "reply").map((m) => m.state), ["delivered", "stopped"]);
	assert.equal(b.calls.length, 0);
});

// ---- I1 ---------------------------------------------------------------------------------------------------------------------------

test("I1: a clean quit leaves the running thread interrupted, not idle", async () => {
	const a = await cutRecipient(tmp(), false);
	assert.equal(states(a).ekspertize, "interrupted");
});

for (const crash of [false, true]) {
	test(`I1: ${crash ? "crash" : "quit"} mid recipient run, Turpināt: the sender gets a "bloķēts" reply and wakes`, async () => {
		const dir = tmp();
		await cutRecipient(dir, crash);
		const b = session(dir, 6, {});
		b.s.restore();
		assert.ok(b.s.queueRestored()!.interrupted >= 1);
		b.s.resumeInterrupted();
		await b.settle();
		const reply = b.mail.messages().find((m) => m.kind === "reply");
		assert.ok(reply, "a reply was written");
		assert.equal(reply!.from, "ekspertize");
		assert.equal(reply!.reply?.status, "bloķēts");
		assert.match(reply!.text, /darbs tika pārtraukts \(lietotne aizvērta\)/);
		assert.deepEqual(b.calls.map((c) => c.agent), ["lead"], "the sender's thread woke; the cut recipient did not run again");
		const delivered = b.mail.messages().find((m) => m.kind === "ask")!;
		assert.notEqual(delivered.state, "queued");
		assert.equal(states(b).ekspertize, "idle");
		assert.notEqual(states(b).lead, "waiting-reply");
	});

	test(`I1: ${crash ? "crash" : "quit"} mid recipient run, Atmest: the reply is written stopped and wakes nobody`, async () => {
		const dir = tmp();
		await cutRecipient(dir, crash);
		const b = session(dir, 6, {});
		b.s.restore();
		b.s.discardInterrupted();
		await b.settle();
		const reply = b.mail.messages().find((m) => m.kind === "reply");
		assert.ok(reply, "a reply was written");
		assert.equal(reply!.state, "stopped");
		assert.equal(reply!.reply?.status, "bloķēts");
		assert.equal(b.calls.length, 0, "nobody ran");
		assert.equal(states(b).lead, "idle", "the sender no longer waits");
		assert.equal(states(b).ekspertize, "idle");
	});
}
