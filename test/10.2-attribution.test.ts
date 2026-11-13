// 10.2 attribution: every write an agent's tool makes says which agent and which thread did it.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ctxEnv, ctxFromEnv, type ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { inToolScope } from "../src/core/scope.ts";
import { ProjectStore } from "../src/core/store.ts";
import { parseNote, serializeNote } from "../src/core/notes.ts";
import type { Note } from "../src/core/model.ts";
import { tmp } from "./helpers.ts";

function setup() {
	const projectsDir = tmp();
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const store = ProjectStore.open(projectsDir, { id: "BD999", name: "BD999", root, createdAt: "2026-11-13T00:00:00Z" });
	const ctx: ToolCtx = { projectsDir, projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir: null, agent: null, thread: null };
	return { store, ctx };
}

test("a store write inside a scope logs the agent and the thread", () => {
	const { store } = setup();
	const e = inToolScope({ run: "r1", tool: "set_fact", agent: "ar", thread: "t1" }, () => store.log({ kind: "x", by: "agent" }));
	assert.equal(e.data?.agent, "ar");
	assert.equal(e.data?.thread, "t1");
	assert.equal(e.data?.run, "r1");
});

test("without agent or thread neither key exists", () => {
	const { store } = setup();
	const out = store.log({ kind: "x", by: "user" });
	assert.ok(!out.data || !("agent" in out.data) && !("thread" in out.data));
	const inScope = inToolScope({ run: "r1", tool: "t", agent: null, thread: null }, () => store.log({ kind: "x", by: "agent" }));
	assert.ok(!("agent" in inScope.data!) && !("thread" in inScope.data!));
});

test("ctxEnv to ctxFromEnv keeps agent and thread, empty is null", () => {
	const { ctx } = setup();
	const back = ctxFromEnv(ctxEnv({ ...ctx, agent: "bk", thread: "t9" }) as NodeJS.ProcessEnv);
	assert.equal(back.agent, "bk");
	assert.equal(back.thread, "t9");
	const none = ctxFromEnv(ctxEnv(ctx) as NodeJS.ProcessEnv);
	assert.equal(none.agent, null);
	assert.equal(none.thread, null);
});

test("write_note stamps the agent on a project note", async () => {
	const { store, ctx } = setup();
	const t = allTools().find((x) => x.name === "write_note")!;
	await t.run({ ...ctx, agent: "bk" }, { type: "decision", title: "Lēmums", body: "x" } as never);
	await t.run(ctx, { type: "decision", title: "Bez aģenta", body: "y" } as never);
	const notes = store.notes();
	assert.equal(notes.find((n) => n.title === "Lēmums")?.agent, "bk");
	assert.ok(!("agent" in notes.find((n) => n.title === "Bez aģenta")!));
});

test("serializeNote and parseNote keep the new fields; old notes parse unchanged", () => {
	const base: Note = { id: "n1", type: "question", title: "T", body: "b", refs: [], by: "agent", at: "2026-11-13T00:00:00Z" };
	const full: Note = { ...base, agent: "ar", to: "bk", topic: "tp1", stage: "PP", status: "open", reviewed: false };
	assert.deepEqual(parseNote(serializeNote(full)), full);
	assert.deepEqual(parseNote(serializeNote(base)), base);
});
