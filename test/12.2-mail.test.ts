// 12.2 send_message, delivery and waking: agents ask each other, a message starts the recipient's run, replies wake the sender once.
// Every agent loop is scripted (SessionDeps.runAgent); nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SUMMARY_HEADER } from "../src/agent/compact.ts";
import type { Coordinator } from "../src/agent/coordinator.ts";
import { MAIL_TOOL_LEVELS, mailTools } from "../src/agent/mail.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { AgentSession } from "../src/agent/session.ts";
import { MAIN_TOOLS, laneTools, validateSpec } from "../src/agent/subagents.ts";
import { DEFAULT_LIMITS, Mailbox, deliveryText, mailDir, type Message } from "../src/core/messages.ts";
import { ThreadStore, threadsDir } from "../src/core/threads.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import type { Thread } from "../src/shared/thread-types.ts";
import { tmp } from "./helpers.ts";

const spec = (id: string): AgentSpec => ({ id, name: `Aģents ${id}`, description: id, prompt: `You are AGENT ${id}.`, tools: [] });
const TOOL = "send_message";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const gate = () => {
	let open!: () => void;
	const p = new Promise<void>((r) => (open = r));
	return { p, open };
};

type Ctx = { agent: string; o: PiRunOptions; n: number; /** the run's final answer; default `<agent> #<n>` */ answer?: string };
type Script = (c: Ctx) => Promise<void> | void;

/** A session whose runs are scripted per agent. `calls` records every run (agent, prompt, system prompt, tools). */
function setup(over: { agents?: AgentSpec[]; cap?: number; scripts?: Record<string, Script>; complete?: (user: string) => string } = {}) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	let agents = over.agents ?? [spec("ekspertize"), spec("parbaude")];
	const calls: Ctx[] = [];
	const seen: Record<string, number> = {};
	const s = new AgentSession({
		runtime: async () => rt,
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: over.cap ?? 6 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => agents,
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		complete: async (_m, _s, user) => ({ role: "assistant", content: [{ type: "text", text: over.complete?.(user) ?? "## Mērķis\nsaspiests" }], stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 1 }) as never,
		runAgent: async (o) => {
			const m = /AGENT (\S+?)\./.exec(o.systemPrompt ?? "");
			const agent = m ? m[1] : "lead";
			const c: Ctx = { agent, o, n: (seen[agent] = (seen[agent] ?? 0) + 1) };
			calls.push(c);
			await over.scripts?.[agent]?.(c);
			o.onEvent({ type: "done", text: c.answer ?? `${agent} #${c.n}` });
		},
	});
	const coordinator = (s as unknown as { coordinator: Coordinator }).coordinator;
	const mail = new Mailbox(mailDir(dir, dir, null));
	const threads = new ThreadStore(threadsDir(dir, dir, null));
	/** nothing running, nothing queued, twice in a row (a run that ends may start another a moment later) */
	const settle = async () => {
		for (let quiet = 0, i = 0; quiet < 2 && i < 400; i++) {
			await tick();
			const v = s.queueView();
			quiet = v.running.length === 0 && !v.queued.some((q) => q.state === "queued") ? quiet + 1 : 0;
		}
	};
	const send = (c: Ctx, p: Record<string, unknown>) => c.o.extraTools!.find((t) => t.name === TOOL)!.execute("t", p as never, c.o.signal);
	const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((x) => x.text ?? "").join("");
	const callsOf = (agent: string) => calls.filter((c) => c.agent === agent);
	const stateOf = (agent: string) => threads.list({ agent })[0]?.state;
	return { dir, s, coordinator, mail, threads, calls, callsOf, settle, send, text, stateOf, setAgents: (a: AgentSpec[]) => (agents = a) };
}

const topicIn = (prompt: string) => /tp_\w+/.exec(prompt)![0];

// ---- the whole exchange ------------------------------------------------------------------------------------------------------

test("12.2 an ask starts the recipient's thread and run; the reply wakes the sender once, and the states follow", async () => {
	const hold = gate();
	let leadThread = "";
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				const r = await t.send(c, { to: "ekspertize", title: "Daļu saraksts", kind: "ask", text: "Kuras daļas ir atzinumā?" });
				assert.match(t.text(r), /^Ziņa nosūtīta \(m_\w+\)\. Atbilde pienāks vēlāk; tagad pabeidz savu gājienu\.$/);
				assert.ok(!r.isError);
			},
			ekspertize: async (c) => {
				// the sender's run has ended by now: it waits for the answer
				await hold.p;
				await t.send(c, { to: "lead", topic: topicIn(c.o.prompt), kind: "reply", text: "AR, BK un AVK." });
			},
		},
	});
	const first = await t.s.send(null, "jautā ekspertīzei", []);
	assert.ok(first.runId);
	await tick(30);
	leadThread = t.threads.list({ agent: "lead" })[0].id;
	assert.equal(t.stateOf("lead"), "waiting-reply", "the sender's run ended with its ask unanswered");
	const b = t.threads.list({ agent: "ekspertize" });
	assert.equal(b.length, 1, "the recipient's thread was made");
	assert.equal(b[0].startedBy, "lead");
	assert.equal(b[0].title, "Daļu saraksts");
	assert.ok(b[0].topic?.startsWith("tp_"));
	assert.equal(b[0].state, "running");
	const ask = t.mail.messages()[0];
	assert.equal(ask.state, "delivered", "delivered when the recipient's run started");
	assert.equal(ask.depth, 1);
	assert.equal(ask.toThread, b[0].id);
	assert.equal(ask.fromThread, leadThread);
	assert.match(t.callsOf("ekspertize")[0].o.prompt, /\[no lead · Daļu saraksts · ask\]\nKuras daļas ir atzinumā\?/);
	assert.match(t.callsOf("ekspertize")[0].o.prompt, new RegExp(`Atvērti temati šajā sarunā: ${b[0].topic} «Daļu saraksts»`));

	hold.open();
	await t.settle();
	assert.equal(t.callsOf("lead").length, 2, "the sender was woken once");
	const woken = t.callsOf("lead")[1].o.prompt;
	assert.match(woken, /\[no ekspertize · Daļu saraksts · reply\]\nAR, BK un AVK\./);
	assert.equal((woken.match(/\[no /g) ?? []).length, 1);
	const all = t.mail.messages();
	assert.equal(all.length, 2);
	assert.ok(all.every((m) => m.state === "delivered"));
	assert.equal(all[1].toThread, leadThread, "the reply reaches the thread that asked, not a new one");
	assert.equal(all[1].depth, 2);
	assert.equal(t.threads.list({ agent: "lead" }).length, 1);
	assert.equal(t.stateOf("lead"), "idle");
	assert.equal(t.stateOf("ekspertize"), "idle");
});

test("12.2 a task carries its envelope: the recipient's text has the UZDEVUMS block", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				await t.send(c, { to: "parbaude", title: "Pārbaude", kind: "task", text: "Lūdzu izpildi.", task: { goal: "Pārbaudīt AR sienas", expects: "atradumu saraksts", context: ["avots s1"] } });
			},
		},
	});
	await t.s.send(null, "uzdod", []);
	await t.settle();
	const p = t.callsOf("parbaude")[0].o.prompt;
	assert.match(p, /\[no lead · Pārbaude · task\]\nUZDEVUMS: u_\w+ \| Stadija: nav \| Aģents: parbaude\nMērķis: Pārbaudīt AR sienas\nKonteksta pakete: avots s1\nGaidāmā izeja: atradumu saraksts\nTermiņš \/ iterācija: 1 no 3\nIerobežojumi: nav\nLūdzu izpildi\./);
});

test("12.2 five asks to five agents: the sender is woken once, after the fifth reply, with five messages", async () => {
	const ids = ["a1", "a2", "a3", "a4", "a5"];
	const gates = Object.fromEntries(ids.map((i) => [i, gate()]));
	const scripts: Record<string, Script> = {
		lead: async (c) => {
			if (c.n > 1) return;
			for (const id of ids) await t.send(c, { to: id, title: `Temats ${id}`, kind: "ask", text: `jautājums ${id}` });
		},
	};
	for (const id of ids) {
		scripts[id] = async (c) => {
			await gates[id].p;
			await t.send(c, { to: "lead", topic: topicIn(c.o.prompt), kind: "reply", text: `atbilde ${id}` });
		};
	}
	const t = setup({ agents: ids.map(spec), scripts });
	await t.s.send(null, "jautā visiem", []);
	await tick(30);
	assert.equal(t.callsOf("lead").length, 1);
	assert.equal(t.stateOf("lead"), "waiting-reply");
	for (const id of ids.slice(0, 4)) {
		gates[id].open();
		await tick(30);
		assert.equal(t.callsOf("lead").length, 1, `no wake after ${id}'s reply: four are not five`);
		assert.equal(t.stateOf("lead"), "waiting-reply");
	}
	gates.a5.open();
	await t.settle();
	assert.equal(t.callsOf("lead").length, 2, "woken once");
	const woken = t.callsOf("lead")[1].o.prompt;
	assert.equal((woken.match(/\[no a\d · Temats a\d · reply\]/g) ?? []).length, 5);
	for (const id of ids) assert.match(woken, new RegExp(`atbilde ${id}`));
	assert.ok(woken.indexOf("atbilde a1") < woken.indexOf("atbilde a5"), "in the order they came");
	assert.equal(t.stateOf("lead"), "idle");
});

// ---- Review Focus 2 ----------------------------------------------------------------------------------------------------------

test("12.2 a reply that comes while the sender's run is going waits and is delivered when that run ends: one run, nothing lost", async () => {
	const hold = gate();
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await hold.p; // the run goes on while the answer arrives
			},
			ekspertize: async (c) => {
				await t.send(c, { to: "lead", topic: topicIn(c.o.prompt), kind: "reply", text: "jā, ir." });
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(40);
	assert.equal(t.stateOf("lead"), "running");
	assert.equal(t.callsOf("ekspertize").length, 1);
	const reply = t.mail.messages()[1];
	assert.equal(reply.kind, "reply");
	assert.equal(reply.state, "queued", "kept, not dropped");
	assert.equal(t.callsOf("lead").length, 1, "and not started as a second run of the same thread");
	assert.equal(t.s.queueView().running.filter((r) => r.agent === "lead").length, 1);
	hold.open();
	await t.settle();
	assert.equal(t.callsOf("lead").length, 2, "exactly one more run");
	assert.match(t.callsOf("lead")[1].o.prompt, /\[no ekspertize · Jautājums · reply\]\njā, ir\./);
	assert.equal(t.mail.messages()[1].state, "delivered");
	assert.equal(t.stateOf("lead"), "idle");
});

// ---- Review Focus 3 ----------------------------------------------------------------------------------------------------------

test("12.2 the recipient's run ends in an error: the sender gets a 'bloķēts' reply that names the error", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
			},
			ekspertize: (c) => c.o.onEvent({ type: "error", engine: "pi", message: "429 Too Many Requests" }),
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	assert.equal(t.callsOf("lead").length, 2, "the sender was woken, it does not wait for ever");
	const p = t.callsOf("lead")[1].o.prompt;
	assert.match(p, /\[no ekspertize · Jautājums · reply\]/);
	assert.match(p, /Statuss: bloķēts/);
	assert.match(p, /429 Too Many Requests/);
	const reply = t.mail.messages().find((m) => m.kind === "reply")!;
	assert.equal(reply.reply?.status, "bloķēts");
	assert.equal(reply.from, "ekspertize");
	assert.equal(reply.to, "lead");
	assert.equal(t.stateOf("lead"), "idle");
});

test("12.2 the recipient is removed from the settings before its run could start: the sender gets a 'bloķēts' reply", async () => {
	const hold = gate();
	const t = setup({
		cap: 1, // the recipient waits in the queue behind the sender's run
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await hold.p;
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	assert.equal(t.stateOf("ekspertize"), "queued");
	t.setAgents([spec("parbaude")]); // removed in Iestatījumi
	hold.open();
	await t.settle();
	assert.equal(t.callsOf("ekspertize").length, 0, "it never ran");
	assert.equal(t.callsOf("lead").length, 2);
	const p = t.callsOf("lead")[1].o.prompt;
	assert.match(p, /Statuss: bloķēts/);
	assert.match(p, /Nav speciālista: ekspertize/);
	assert.equal(t.mail.messages()[0].state, "failed");
	assert.equal(t.stateOf("lead"), "idle");
});

test("12.2 the recipient's run is stopped on its own: the sender is told and woken", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
			},
			ekspertize: (c) => new Promise<void>((r) => c.o.signal.addEventListener("abort", () => r())),
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	const th = t.threads.list({ agent: "ekspertize" })[0];
	t.s.stopThread(th.id);
	await t.settle();
	assert.equal(t.callsOf("lead").length, 2);
	assert.match(t.callsOf("lead")[1].o.prompt, /darbs tika apturēts/);
	assert.match(t.callsOf("lead")[1].o.prompt, /Statuss: bloķēts/);
});

// ---- Stop --------------------------------------------------------------------------------------------------------------------

test("12.2 stopAll(wave) stops the wave's queued messages and wakes nobody", async () => {
	const t = setup({
		cap: 1,
		scripts: {
			lead: async (c) => {
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await new Promise<void>((r) => c.o.signal.addEventListener("abort", () => r()));
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	const wave = t.s.queueView().running[0].wave;
	assert.equal(t.mail.messages()[0].state, "queued", "behind the sender's run");
	t.coordinator.stopAll(wave);
	await t.settle();
	assert.equal(t.mail.messages()[0].state, "stopped");
	assert.equal(t.mail.messages().length, 1, "no reply was written for it");
	assert.equal(t.callsOf("ekspertize").length, 0, "nobody was woken");
	assert.equal(t.callsOf("lead").length, 1);
	assert.equal(t.stateOf("lead"), "idle", "it no longer waits for an answer that will not come");
	assert.equal(t.stateOf("ekspertize"), "idle");
});

test("12.2 Stop while the recipient runs: its sender is not woken by the stopped run", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) {
					await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
					await new Promise<void>((r) => c.o.signal.addEventListener("abort", () => r()));
				}
			},
			ekspertize: (c) => new Promise<void>((r) => c.o.signal.addEventListener("abort", () => r())),
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	t.s.stop();
	await t.settle();
	assert.equal(t.callsOf("lead").length, 1, "nobody woken");
	assert.ok(t.mail.messages().every((m) => m.state !== "queued"), "nothing is left to wake anyone later");
});

// ---- the user in a waiting thread --------------------------------------------------------------------------------------------

test("12.2 the user writes into a waiting-reply thread: it runs at once on his message; the later reply gets a run of its own", async () => {
	const hold = gate();
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
			},
			ekspertize: async (c) => {
				await hold.p;
				await t.send(c, { to: "lead", topic: topicIn(c.o.prompt), kind: "reply", text: "jā." });
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	assert.equal(t.stateOf("lead"), "waiting-reply");
	const r = await t.s.send(null, "kā iet?", []);
	assert.ok(r.runId && !r.queued, "at once");
	await tick(30);
	assert.equal(t.callsOf("lead").length, 2);
	assert.equal(t.callsOf("lead")[1].o.prompt.includes("[no "), false, "his message only, no mail");
	assert.equal(t.stateOf("lead"), "waiting-reply", "still waiting for the answer");
	hold.open();
	await t.settle();
	assert.equal(t.callsOf("lead").length, 3, "the reply is delivered in a run of its own");
	assert.match(t.callsOf("lead")[2].o.prompt, /\[no ekspertize · Jautājums · reply\]\njā\./);
	assert.equal(t.stateOf("lead"), "idle");
});

// ---- the rules ---------------------------------------------------------------------------------------------------------------

test("12.2 a 4th message on a topic is refused with the Latvian reason, and nothing is added", async () => {
	const results: { err: boolean; text: string }[] = [];
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				const first = await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "viens" });
				results.push({ err: !!first.isError, text: t.text(first) });
				const topic = t.mail.topics()[0].id;
				for (const n of ["divi", "trīs", "četri"]) {
					const r = await t.send(c, { to: "ekspertize", topic, kind: "ask", text: n });
					results.push({ err: !!r.isError, text: t.text(r) });
				}
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	assert.deepEqual(results.map((r) => r.err), [false, false, false, true]);
	assert.match(results[3].text, /Par tematu «Jautājums» jau ir 3 ziņas no lead; temats nodots tālāk\./);
	assert.equal(t.mail.messages().filter((m) => m.from === "lead").length, 3);
});

test("12.2 send_message input is checked: topic xor title, a known topic, the topic's own parties, an unknown or own id", async () => {
	const out: string[] = [];
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				for (const p of [
					{ to: "ekspertize", kind: "ask", text: "x" },
					{ to: "ekspertize", topic: "tp_x", title: "T", kind: "ask", text: "x" },
					{ to: "ekspertize", topic: "tp_nav", kind: "ask", text: "x" },
					{ to: "nav-tada", title: "T", kind: "ask", text: "x" },
					{ to: "lead", title: "T", kind: "ask", text: "x" },
				]) {
					const r = await t.send(c, p);
					assert.equal(r.isError, true);
					out.push(t.text(r));
				}
				await t.send(c, { to: "ekspertize", title: "Īstais", kind: "ask", text: "x" });
				const r = await t.send(c, { to: "parbaude", topic: t.mail.topics()[0].id, kind: "ask", text: "x" });
				assert.equal(r.isError, true);
				out.push(t.text(r));
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	assert.match(out[0], /vai nu|tieši vienu/);
	assert.match(out[1], /tieši vienu/);
	assert.match(out[2], /Temats tp_nav nav atrasts/);
	assert.match(out[3], /Nezināms aģents «nav-tada»/);
	assert.match(out[4], /nevar sūtīt ziņu pats sev/);
	assert.match(out[5], /ir starp lead un ekspertize/);
	assert.equal(t.mail.messages().filter((m) => m.from === "lead").length, 1, "only the one good message");
});

test("12.2 the depth of a message grows one a hop, from the run that sends it", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "T", kind: "ask", text: "a" });
			},
			ekspertize: async (c) => {
				if (c.n === 1) await t.send(c, { to: "parbaude", title: "T2", kind: "ask", text: "b" });
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	assert.deepEqual(t.mail.messages().filter((m) => m.kind === "ask").map((m) => [m.from, m.depth]), [["lead", 1], ["ekspertize", 2]]);
});

test("12.2 close_topic is declared but says it comes with 12.3", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				const r = await c.o.extraTools!.find((x) => x.name === "close_topic")!.execute("t", { topic: "tp_x", outcome: "agreed", decision: "d" } as never, c.o.signal);
				assert.equal(r.isError, true);
				assert.equal(t.text(r), "close_topic nāk ar 12.3.");
			},
		},
	});
	await t.s.send(null, "x", []);
	await t.settle();
	assert.equal(t.callsOf("lead").length, 1);
});

// ---- the tools, their levels, the standing text ------------------------------------------------------------------------------

test("12.2 the lead's and a specialist's runs are offered the mail tools; a lane is not; the gate lets a specialist send", async () => {
	const t = setup();
	const th = t.s.openThread(null, "ekspertize");
	await t.s.sendToThread(th.id, null, "x", []);
	await t.s.send(null, "y", []);
	await t.settle();
	const lead = t.callsOf("lead")[0].o;
	const spec_ = t.callsOf("ekspertize")[0].o;
	assert.deepEqual(lead.extraTools!.map((x) => x.name), ["run_subagent", "delegate", "send_message", "close_topic"]);
	assert.deepEqual(spec_.extraTools!.map((x) => x.name), ["send_message", "close_topic"], "no helpers for a specialist, mail yes");
	const ctx = (name: string) => ({ toolCall: { id: "g", name, arguments: {}, type: "toolCall" }, args: {}, assistantMessage: { content: [] }, context: {} }) as never;
	assert.equal(await spec_.beforeToolCall!(ctx("send_message")), undefined, "a specialist may send");
	assert.equal(await lead.beforeToolCall!(ctx("send_message")), undefined);
	assert.ok((await spec_.beforeToolCall!(ctx("delegate")))?.block, "a specialist still has no delegate");
	assert.deepEqual(MAIL_TOOL_LEVELS, { send_message: "run", close_topic: "run" });
	assert.ok(MAIN_TOOLS.has("send_message") && MAIN_TOOLS.has("close_topic"));
	assert.deepEqual(laneTools(["send_message", "close_topic", "read_notes"], (n) => (n === "read_notes" ? "read" : "run"), "run"), ["read_notes"], "never offered to a lane");
});

test("12.2 every agent's standing text has the mail lines, and the lead's fixed context stays under 10 000", async () => {
	const t = setup();
	const th = t.s.openThread(null, "ekspertize");
	await t.s.sendToThread(th.id, null, "x", []);
	await t.s.send(null, "y", []);
	await t.settle();
	for (const agent of ["lead", "ekspertize"]) {
		const sys = t.callsOf(agent)[0].o.systemPrompt ?? "";
		assert.match(sys, /send_message: darbam, kas pārsniedz tavu gājienu/);
		assert.match(sys, /delegate \(ja tas tev ir\): atskaitei, kas vajadzīga šajā pašā gājienā\./);
		assert.match(sys, /Nekad nesūti ziņu sev\./);
	}
	const c = await t.s.context(null, { text: "x", focus: [] });
	assert.ok(c.fixedEstimate < 10_000, `fixed ${c.fixedEstimate}`);
});

// ---- Review Focus 5 ----------------------------------------------------------------------------------------------------------

test("12.2 a thread compacted while a topic is open still gets the topic id in its next prompt", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Atvērtais temats", kind: "ask", text: "vai ir?" });
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	const topic = t.mail.topics()[0];
	assert.equal(topic.state, "open");
	// a long conversation in memory, then the user's own "saspiest"
	const msg = (role: string, text: string, ts: number) => (role === "user" ? { role, content: [{ type: "text", text }], timestamp: ts } : { role, content: [{ type: "text", text }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: ts });
	const turns = Array.from({ length: 6 }, (_, i) => [msg("user", `jautājums ${i} ${"v".repeat(40_000)}`, 10 + i * 10), msg("assistant", `atbilde ${i}`, 11 + i * 10)]).flat();
	t.s.conversations.set("_", { key: `${DEFAULT_SETTINGS.provider}/${DEFAULT_SETTINGS.model}`, messages: [{ role: "system", content: "p", timestamp: 0 } as never, ...(turns as never[])], lastAdded: null });
	await t.s.compactNow(null);
	assert.ok(JSON.stringify(t.s.conversations.get("_")!.messages).includes(SUMMARY_HEADER), "the old turns are now a summary");
	await t.s.send(null, "kā ar to?", []);
	await t.settle();
	const p = t.callsOf("lead").at(-1)!.o.prompt;
	assert.ok(p.includes(`${topic.id} «Atvērtais temats»`), "the open topic is named by code, not remembered from the history");
	assert.ok(!JSON.stringify(t.callsOf("lead").at(-1)!.o.history).includes(topic.id), "the compacted history does not carry it");
});

// ---- the mailbox: damaged topics.json ----------------------------------------------------------------------------------------

test("12.2 a topics.json that cannot be read is copied to topics.json.bad before it is rewritten; nothing is deleted", () => {
	const dir = tmp();
	const mb = new Mailbox(join(dir, "mail"));
	mkdirSync(join(dir, "mail"), { recursive: true });
	writeFileSync(join(dir, "mail", "topics.json"), '[{"id":"tp_1","title":"T","par');
	assert.deepEqual(mb.topics(), []);
	assert.ok(!existsSync(join(dir, "mail", "topics.json.bad")), "reading alone changes nothing");
	const t = mb.openTopic({ title: "Jaunais", parties: ["lead", "ar"], parent: null });
	assert.equal(readFileSync(join(dir, "mail", "topics.json.bad"), "utf8"), '[{"id":"tp_1","title":"T","par', "the damaged file is kept");
	assert.deepEqual(mb.topics().map((x) => x.id), [t.id], "the new file is whole");
	// a second damage never overwrites the first copy
	writeFileSync(join(dir, "mail", "topics.json"), "nonsense");
	mb.openTopic({ title: "Vēl viens", parties: ["lead", "ar"], parent: null });
	assert.equal(readFileSync(join(dir, "mail", "topics.json.bad"), "utf8"), '[{"id":"tp_1","title":"T","par');
	assert.equal(readFileSync(join(dir, "mail", "topics.json.bad2"), "utf8"), "nonsense");
	// a healthy file and a missing one make no copy
	const fresh = new Mailbox(join(dir, "other"));
	fresh.openTopic({ title: "T", parties: ["lead", "ar"], parent: null });
	fresh.openTopic({ title: "T2", parties: ["lead", "ar"], parent: null });
	assert.ok(!existsSync(join(dir, "other", "topics.json.bad")));
});

test("12.2 mailDir: a project's folder, or the app's own for no project", () => {
	assert.equal(mailDir("A", "P", "p1"), join("P", "p1", "mail"));
	assert.equal(mailDir("A", "P", null), join("A", "mail", "_"));
});

// kept for the record: mailTools takes plain deps, so a tool can be driven without a session
test("12.2 mailTools alone: a send adds the message, opens the topic and the recipient's thread, and calls enqueue once", async () => {
	const dir = tmp();
	const mailbox = new Mailbox(join(dir, "mail"));
	const threads = new ThreadStore(join(dir, "threads"));
	const mine: Thread = threads.create({ projectId: null, agent: "lead", title: "Saruna", startedBy: "user" });
	let enqueued = 0;
	const notes: string[] = [];
	const [send] = mailTools({ mailbox, threads, agents: () => [spec("ar")], limits: () => DEFAULT_LIMITS, self: { agent: "lead", threadId: mine.id, projectId: null, wave: "w1", depth: 0 }, enqueue: () => enqueued++, note: (l) => notes.push(l) });
	const r = await send.execute("t", { to: "ar", title: "Siena", kind: "ask", text: "cik bieza?", refs: ["s1"] } as never, new AbortController().signal);
	assert.ok(!r.isError);
	assert.equal(enqueued, 1);
	assert.match(notes[0], /Ziņa → ar: Siena/);
	const [m] = mailbox.messages() as Message[];
	assert.deepEqual([m.from, m.to, m.kind, m.state, m.depth, m.wave, m.refs], ["lead", "ar", "ask", "queued", 1, "w1", ["s1"]]);
	const th = threads.get(m.toThread)!;
	assert.deepEqual([th.agent, th.title, th.topic, th.startedBy], ["ar", "Siena", m.topic, "lead"]);
	// a second message on the topic goes to the same thread
	await send.execute("t", { to: "ar", topic: m.topic, kind: "ask", text: "un augstums?" } as never, new AbortController().signal);
	assert.equal(threads.list({ agent: "ar" }).length, 1);
	assert.equal(mailbox.messages()[1].toThread, th.id);
});

test("12.2 deliveryText: a plain message is its text; an envelope is rendered and its text is added only when the envelope lacks it", () => {
	const base = { id: "m1", at: "", wave: "w", topic: "tp_1", from: "lead", to: "ar", refs: [], fromThread: "a", toThread: "b", depth: 1, state: "queued" as const };
	const topics = [{ id: "tp_1", title: "Siena", parties: ["lead", "ar"] as [string, string], parent: null, state: "open" as const, openedAt: "" }];
	assert.equal(deliveryText([{ ...base, kind: "ask", text: " cik bieza? " }], topics), "[no lead · Siena · ask]\ncik bieza?");
	const reply = { ...base, from: "ar", to: "lead", kind: "reply" as const, text: "Aģents nevar", reply: { id: "a1", status: "bloķēts" as const, results: [], questions: [], decisions: [], risks: "Aģents nevar" } };
	const out = deliveryText([reply], topics);
	assert.equal((out.match(/Aģents nevar/g) ?? []).length, 1, "said once");
	assert.match(out, /^\[no ar · Siena · reply\]\nATBILDE: a1 \| Statuss: bloķēts/);
	assert.match(deliveryText([{ ...reply, text: "Skat. arī pielikumu." }], topics), /Riski: Aģents nevar\nSkat\. arī pielikumu\.$/);
	assert.match(deliveryText([{ ...base, topic: "tp_x", kind: "ask", text: "a" }], topics), /^\[no lead · tp_x · ask\]/, "an unknown topic shows its id");
});

// ---- fix round 1 -------------------------------------------------------------------------------------------------------------

test("12.2 fix: stopThread on a recipient that is still queued tells the sender, who wakes", async () => {
	const hold = gate();
	const t = setup({
		cap: 1, // the recipient waits in the queue behind the sender's run
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await hold.p;
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	const th = t.threads.list({ agent: "ekspertize" })[0];
	assert.equal(th.state, "queued");
	t.s.stopThread(th.id);
	assert.equal(t.mail.messages()[0].state, "failed", "the ask will not be delivered");
	hold.open();
	await t.settle();
	assert.equal(t.callsOf("ekspertize").length, 0);
	assert.equal(t.callsOf("lead").length, 2, "the sender was woken, it does not wait for ever");
	assert.match(t.callsOf("lead")[1].o.prompt, /Statuss: bloķēts/);
	assert.match(t.callsOf("lead")[1].o.prompt, /darbs tika apturēts/);
	assert.equal(t.stateOf("lead"), "idle");
});

test("12.2 fix: stopAll(wave) with a queued recipient leaves its sender idle and unwoken (silent)", async () => {
	const t = setup({
		cap: 1,
		scripts: {
			lead: async (c) => {
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await new Promise<void>((r) => c.o.signal.addEventListener("abort", () => r()));
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await tick(30);
	t.coordinator.stopAll(t.s.queueView().running[0].wave);
	await t.settle();
	assert.equal(t.callsOf("lead").length, 1);
	assert.equal(t.mail.messages()[0].state, "stopped");
	assert.equal(t.stateOf("lead"), "idle");
});

test("12.2 fix: a recipient that really replied and then errored does not also send a 'bloķēts' reply", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
			},
			ekspertize: async (c) => {
				await t.send(c, { to: "lead", topic: topicIn(c.o.prompt), kind: "reply", text: "jā, ir." });
				c.o.onEvent({ type: "error", engine: "pi", message: "pēc atbildes kļūda" });
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	assert.equal(t.mail.messages().filter((m) => m.reply?.status === "bloķēts").length, 0);
	assert.equal(t.mail.messages().filter((m) => m.kind === "reply").length, 1);
	assert.equal(t.callsOf("lead").length, 2);
	assert.match(t.callsOf("lead")[1].o.prompt, /jā, ir\./);
	assert.doesNotMatch(t.callsOf("lead")[1].o.prompt, /bloķēts/);
});

test("12.2 fix: two threads that asked each other on different topics do not deadlock: an ask wakes at once", async () => {
	const t = setup();
	const a = t.threads.create({ projectId: null, agent: "lead", title: "Saruna", startedBy: "user" });
	const b = t.threads.create({ projectId: null, agent: "ekspertize", title: "Saruna B", startedBy: "user" });
	const t1 = t.mail.openTopic({ title: "Pirmais", parties: ["lead", "ekspertize"], parent: null });
	const t2 = t.mail.openTopic({ title: "Otrais", parties: ["ekspertize", "lead"], parent: null });
	const base = { wave: "w1", refs: [], depth: 1 };
	// A asked B about topic 1 and waits; B asked A about topic 2 and waits
	const m1 = t.mail.add({ ...base, topic: t1.id, from: "lead", to: "ekspertize", kind: "ask", text: "viens?", fromThread: a.id, toThread: b.id });
	t.mail.setState(m1.id, "delivered");
	const m2 = t.mail.add({ ...base, topic: t2.id, from: "ekspertize", to: "lead", kind: "ask", text: "divi?", fromThread: b.id, toThread: a.id });
	t.threads.patch(a.id, { state: "waiting-reply" });
	t.coordinator.wake(null);
	await t.settle();
	assert.equal(t.callsOf("lead").length, 1, "A is woken by B's ask although its own ask is unanswered");
	assert.match(t.callsOf("lead")[0].o.prompt, /\[no ekspertize · Otrais · ask\]\ndivi\?/);
	assert.equal(t.mail.messages().find((m) => m.id === m2.id)!.state, "delivered");
	// it still waits for its own answer once the run ends
	assert.equal(t.threads.get(a.id)!.state, "waiting-reply");
});

test("12.2 fix: a run a message started that ends well without sending anything back answers by itself, 'daļēji', with its final answer", async () => {
	const t = setup({
		scripts: {
			lead: async (c) => {
				if (c.n === 1) await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
			},
			ekspertize: (c) => {
				c.answer = "Atbilde bez ziņas: " + "x".repeat(3000);
			},
		},
	});
	await t.s.send(null, "jautā", []);
	await t.settle();
	const auto = t.mail.messages().find((m) => m.kind === "reply")!;
	assert.equal(auto.reply?.status, "daļēji");
	assert.equal(auto.from, "ekspertize");
	assert.equal(auto.text.length, 2000, "cut at 2000");
	assert.ok(auto.text.startsWith("Atbilde bez ziņas: "));
	assert.equal(auto.depth, 2);
	assert.equal(t.callsOf("lead").length, 2, "the sender wakes");
	assert.match(t.callsOf("lead")[1].o.prompt, /Statuss: daļēji/);
	assert.equal(t.stateOf("lead"), "idle");
	assert.equal(t.callsOf("ekspertize").length, 1, "the automatic reply is not an ask: no run follows for the recipient");
});

test("12.2 fix: a message whose recipient thread was closed before delivery is answered 'bloķēts' (saruna ir slēgta)", async () => {
	const t = setup();
	const a = t.threads.create({ projectId: null, agent: "lead", title: "Saruna", startedBy: "user" });
	const b = t.threads.create({ projectId: null, agent: "ekspertize", title: "Atzinums", startedBy: "user" });
	const tp = t.mail.openTopic({ title: "Jautājums", parties: ["lead", "ekspertize"], parent: null });
	t.threads.patch(b.id, { state: "closed" });
	const m = t.mail.add({ wave: "w1", refs: [], depth: 1, topic: tp.id, from: "lead", to: "ekspertize", kind: "ask", text: "vai ir?", fromThread: a.id, toThread: b.id });
	t.threads.patch(a.id, { state: "waiting-reply" });
	t.coordinator.wake(null);
	await t.settle();
	assert.equal(t.callsOf("ekspertize").length, 0);
	assert.equal(t.mail.messages().find((x) => x.id === m.id)!.state, "failed");
	assert.equal(t.callsOf("lead").length, 1);
	assert.match(t.callsOf("lead")[0].o.prompt, /Statuss: bloķēts/);
	assert.match(t.callsOf("lead")[0].o.prompt, /saruna «Atzinums» ir slēgta/);
});

test("12.2 fix: a specialist that lists send_message or close_topic is told they come automatically", () => {
	const levelOf = (n: string) => (n === "read_notes" ? ("read" as const) : ("never" as const));
	for (const tool of ["send_message", "close_topic"]) {
		const r = validateSpec({ id: "ar", name: "Arhitektūra", description: "", prompt: "You read the AR part.", tools: [tool] }, levelOf, ["read_notes"]);
		assert.deepEqual(r, { ok: false, error: `${tool} ir dots katram aģentam automātiski; to nevajag norādīt.` });
	}
	const d = validateSpec({ id: "ar", name: "Arhitektūra", description: "", prompt: "You read the AR part.", tools: ["delegate"] }, levelOf, ["read_notes"]);
	assert.ok(!d.ok && /nevar palaist citus aģentus/.test(d.error), "the old text for the helpers' tools");
});

// ---- fix round 2 -------------------------------------------------------------------------------------------------------------

/** Counts the passes `wake` makes over a project. After `cap` of them the pass is skipped, so a loop shows as a failed count instead of starving the event loop. */
function countWakes(coordinator: Coordinator, cap = 50) {
	const c = coordinator as unknown as { wakeProject: (p: string | null) => void };
	const real = c.wakeProject.bind(coordinator);
	const seen = { n: 0 };
	c.wakeProject = (p) => {
		if (++seen.n <= cap) real(p);
	};
	return seen;
}

test("12.2 fix 2: a queued second ask on a closed thread that the recipient already answered still leaves the inbox: no wake loop", async () => {
	const t = setup();
	const wakes = countWakes(t.coordinator);
	const a = t.threads.create({ projectId: null, agent: "lead", title: "Saruna", startedBy: "user" });
	const b = t.threads.create({ projectId: null, agent: "ekspertize", title: "Atzinums", startedBy: "user" });
	const tp = t.mail.openTopic({ title: "Jautājums", parties: ["lead", "ekspertize"], parent: null });
	const base = { wave: "w1", refs: [], topic: tp.id, fromThread: a.id, toThread: b.id };
	const first = t.mail.add({ ...base, depth: 1, from: "lead", to: "ekspertize", kind: "ask", text: "viens?" });
	t.mail.setState(first.id, "delivered");
	const second = t.mail.add({ ...base, depth: 1, from: "lead", to: "ekspertize", kind: "ask", text: "un otrs?" });
	// the recipient answered the first ask after the second was sent: `answered` counts it for the second too
	const reply = t.mail.add({ wave: "w1", refs: [], topic: tp.id, depth: 2, from: "ekspertize", to: "lead", kind: "reply", text: "jā.", fromThread: b.id, toThread: a.id });
	t.mail.setState(reply.id, "delivered");
	t.threads.patch(b.id, { state: "closed" });
	t.coordinator.wake(null);
	await t.settle();
	assert.ok(wakes.n < 5, `wake passes stay bounded (${wakes.n})`);
	assert.equal(t.mail.messages().find((m) => m.id === second.id)!.state, "failed", "the answered ask still leaves the inbox");
	assert.equal(t.mail.messages().filter((m) => m.reply?.status === "bloķēts").length, 0, "no 'bloķēts' on top of the real reply");
	assert.equal(t.callsOf("ekspertize").length, 0);
	assert.equal(t.callsOf("lead").length, 0, "the reply was already delivered: nobody is woken");
});

test("12.2 fix 2: stopThread on a queued recipient whose ask was already answered does not submit the thread again", async () => {
	const hold = gate();
	const t = setup({
		cap: 1,
		scripts: {
			lead: async (c) => {
				if (c.n > 1) return;
				await t.send(c, { to: "ekspertize", title: "Jautājums", kind: "ask", text: "vai ir?" });
				await hold.p;
			},
		},
	});
	const wakes = countWakes(t.coordinator);
	await t.s.send(null, "jautā", []);
	await tick(30);
	const th = t.threads.list({ agent: "ekspertize" })[0];
	assert.equal(th.state, "queued");
	const ask = t.mail.messages()[0];
	// an answer exists for the ask that is still waiting to be delivered
	const reply = t.mail.add({ wave: ask.wave, refs: [], topic: ask.topic, depth: 2, from: "ekspertize", to: "lead", kind: "reply", text: "jau atbildēju.", fromThread: th.id, toThread: ask.fromThread });
	t.mail.setState(reply.id, "delivered");
	t.s.stopThread(th.id);
	assert.equal(t.mail.messages().find((m) => m.id === ask.id)!.state, "failed", "the stopped ask is closed even though it was answered");
	hold.open();
	await t.settle();
	assert.ok(wakes.n < 10, `wake passes stay bounded (${wakes.n})`);
	assert.equal(t.callsOf("ekspertize").length, 0, "the thread the user stopped is not run again");
	assert.equal(t.mail.messages().filter((m) => m.reply?.status === "bloķēts").length, 0);
});

test("12.2 fix 2: a Mailbox that throws on add and setState does not make the closed-thread branch repeat on every microtask", async () => {
	const t = setup();
	const wakes = countWakes(t.coordinator);
	const a = t.threads.create({ projectId: null, agent: "lead", title: "Saruna", startedBy: "user" });
	const b = t.threads.create({ projectId: null, agent: "ekspertize", title: "Atzinums", startedBy: "user" });
	const tp = t.mail.openTopic({ title: "Jautājums", parties: ["lead", "ekspertize"], parent: null });
	const m = t.mail.add({ wave: "w1", refs: [], depth: 1, topic: tp.id, from: "lead", to: "ekspertize", kind: "ask", text: "vai ir?", fromThread: a.id, toThread: b.id });
	t.threads.patch(b.id, { state: "closed" });
	// the session's own Mailbox for the project: its file is "locked"
	const box = (t.s as unknown as { mailbox: (p: string | null) => Mailbox }).mailbox(null);
	box.add = () => {
		throw new Error("EBUSY");
	};
	box.setState = () => {
		throw new Error("EBUSY");
	};
	t.coordinator.wake(null);
	await t.settle();
	assert.ok(wakes.n <= 2, `after a failed write nothing wakes the project again (${wakes.n})`);
	assert.equal(t.mail.messages().find((x) => x.id === m.id)!.state, "queued", "nothing was written");
	assert.equal(t.callsOf("ekspertize").length, 0);
});
