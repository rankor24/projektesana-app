// 24.0 A Revit change refused by the app is not "the user refused", and it does not end the run in the window.
// Seen 2026-11-25: the open Revit document was not the project's working copy, so the gate refused create_level and revit_set_parameter before any click. The agent was told
// "Lietotājs šo partiju noraidīja" (so it asked the user instead of making the working copy), and the refusal was an `error` event, which closes the run card and the chat's
// live line: the reply that followed only showed after switching conversations. Also: a saved attachment's path reaches the agent, so a new session can still open it.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";
import { createPiRuntime } from "../src/agent/pi/index.ts";
import { prepareAttachments } from "../src/agent/attachments.ts";
import { seedFromTranscript } from "../src/agent/session-compact.ts";
import { ThreadRunner, workCopyRefusal } from "../src/agent/thread-runner.ts";
import { Gate, makeLevelOf } from "../src/agent/tools/levels.ts";
import { ThreadStore } from "../src/core/threads.ts";
import { apply, type Line } from "../src/renderer/shell/chat-lines.ts";
import type { ChatEntry } from "../src/shared/api.ts";
import { DEFAULT_SETTINGS, type RunEvent } from "../src/shared/types.ts";
import { tmp } from "./helpers.ts";

const toolCtx = (name: string, calls: string[] = [name]) => ({ toolCall: { name, id: "t", arguments: {} }, args: {}, assistantMessage: { content: calls.map((n, i) => ({ type: "toolCall", id: `t${i}`, name: n, arguments: {} })) } }) as never;

test("Gate: a string from `ask` blocks the call with that reason; false is still the user's refusal", async () => {
	const levelOf = makeLevelOf({ create_level: "confirm" });
	const app = await new Gate(levelOf, async () => "Revit izmaiņa NAV izpildīta: darba kopija.").before(toolCtx("create_level"));
	assert.deepEqual(app, { block: true, reason: "Revit izmaiņa NAV izpildīta: darba kopija." });
	const user = (await new Gate(levelOf, async () => false).before(toolCtx("create_level"))) as { reason: string };
	assert.match(user.reason, /^Lietotājs šo partiju noraidīja/);
	assert.equal(await new Gate(levelOf, async () => true).before(toolCtx("create_level")), undefined);
});

test("the working-copy refusal tells the agent it was not the user, and what to do", () => {
	const t = workCopyRefusal("XY_AR");
	assert.match(t, /NENORAIDĪJA/);
	assert.match(t, /XY_AR/);
	assert.match(t, /revit_save_copy/);
	assert.doesNotMatch(t, /^Lietotājs šo partiju noraidīja/);
});

/** A whole run whose model asks for one Revit write; `work` = whether the open document is the project's working copy, `allow` = the user's click. */
async function writeRun(work: boolean, allow: boolean, calls: string[] = ["create_level"]) {
	const dir = tmp("refusal-");
	const store = new ThreadStore(join(dir, "th"));
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const spec = { id: "lead", name: "Lead", description: "", prompt: "", tools: [] };
	let result: { block?: boolean; reason?: string } | undefined;
	const asked: unknown[] = [];
	const runner = new ThreadRunner({
		runtime: async () => rt,
		settings: () => DEFAULT_SETTINGS,
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => ({ command: "node", args: [], env: {}, tools: ["create_level"], levels: { create_level: "confirm" } }),
		revitWork: async () => ({ ok: work, title: "XY_AR" }),
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => [spec],
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		threads: () => store,
		locks: new LockRegistry(),
		runAgent: async (o) => {
			result = (await o.beforeToolCall?.(toolCtx(calls[0]!, calls), new AbortController().signal)) as typeof result;
			o.onEvent({ type: "text", text: "Atbilde pēc atteikuma." });
			o.onEvent({ type: "done", text: "Atbilde pēc atteikuma." });
		},
	});
	const thread = store.create({ projectId: null, agent: "lead", title: "t", startedBy: "user" });
	const events: RunEvent[] = [];
	await runner.run({ runId: "r1", thread, spec: null, text: "izveido līmeņus", focus: [], files: { images: [], text: "", refs: [] }, wave: "w", signal: new AbortController().signal, emit: (e) => void events.push(e), ask: async (q) => (asked.push(q), allow) });
	return { result, events, asked };
}

test("a Revit write on a document that is not the working copy: the agent is told the app refused (not the user), no click was asked, and no `error` event ends the run", async () => {
	const r = await writeRun(false, true);
	assert.equal(r.result?.block, true);
	assert.match(r.result?.reason ?? "", /NENORAIDĪJA/);
	assert.doesNotMatch(r.result?.reason ?? "", /^Lietotājs šo partiju noraidīja/);
	assert.equal(r.asked.length, 0, "no approval card for a batch that cannot run");
	assert.equal(r.events.some((e) => e.type === "error"), false, "an `error` event closes the run card and the chat's live line in the window");
	assert.ok(r.events.some((e) => e.type === "text" && /\[lietotne\].*darba kopija/.test(e.text)), "the user is told in the chat");
	// the chat keeps following: text after the refusal reaches the lines, nothing was closed
	let lines: Line[] = [];
	for (const e of r.events) if (e.type !== "done") lines = apply(lines, e);
	assert.match(JSON.stringify(lines), /Atbilde pēc atteikuma/);
});

test("2.15.0 a Revit write on the working copy runs with no click; on any other document it is still refused by the app, and the click is no way round that", async () => {
	const yes = await writeRun(true, false);
	assert.equal(yes.result, undefined, "runs although the user would have said no: nobody is asked");
	assert.equal(yes.asked.length, 0, "no approval card");
	const other = await writeRun(false, true);
	assert.equal(other.result?.block, true);
	assert.equal(other.asked.length, 0);
});

test("2.15.0 a batch with a call that is not a Revit change (a shell command) still asks the user, and a refusal there is the user's", async () => {
	const no = await writeRun(true, false, ["create_level", "run_command"]);
	assert.equal(no.asked.length, 1, "one card for the whole batch");
	assert.match(no.result?.reason ?? "", /^Lietotājs šo partiju noraidīja/);
	const yes = await writeRun(true, true, ["create_level", "run_command"]);
	assert.equal(yes.result, undefined);
});

test("an attached file's saved path goes into the prompt, the stored line and the seed of a new session", async () => {
	const saveDir = mkdtempSync(join(tmpdir(), "att-"));
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==", "base64").toString("base64");
	const p = await prepareAttachments([{ name: "ekrans-1.png", mimeType: "image/png", data: png }], { seesImages: true, model: "m", saveDir });
	const saved = p.refs[0].path!;
	assert.ok(saved.startsWith(saveDir) && saved.endsWith("01-ekrans-1.png"));
	assert.ok(p.text.includes(saved), "the prompt names the saved copy");
	const entries: ChatEntry[] = [
		{ role: "user", text: "paskaties", at: "2026-11-25T10:00:00.000Z", attachments: p.refs },
		{ role: "assistant", text: "labi", at: "2026-11-25T10:01:00.000Z" },
		{ role: "user", text: "vēlreiz", at: "2026-11-25T10:02:00.000Z" },
	];
	assert.ok(seedFromTranscript(entries).earlier.some((l) => l.text.includes(saved)), "a rebuilt session still knows where the picture is");
});
