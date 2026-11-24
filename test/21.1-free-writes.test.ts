// 21.1 free writes: a text note the agent writes inside the open project's folder runs without a click; every other write keeps it.
// Invented project in a temp folder; nothing leaves the machine.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { Gate, makeLevelOf, type ConfirmRequest } from "../src/agent/tools/levels.ts";
import { freeWrite } from "../src/agent/tools/project-write.ts";
import { tmp } from "./helpers.ts";

function rig() {
	const appDir = tmp();
	const root = tmp("pj-root-");
	const projectsDir = join(appDir, "projects");
	mkdirSync(join(projectsDir, "BD999"), { recursive: true });
	writeFileSync(join(projectsDir, "BD999", "project.json"), JSON.stringify({ id: "BD999", name: "BD999 Testa iela 1", root }), "utf8");
	const ctx: ToolCtx = { projectsDir, projectId: "BD999", dataDir: appDir, appDir, runDir: null, agent: null, thread: null };
	const run = async (name: string, args: Record<string, unknown>) => allTools().find((t) => t.name === name)!.run(ctx, args as never);
	const free = (tool: string, args: Record<string, unknown>) => freeWrite(ctx, tool, args);
	return { appDir, root, ctx, run, free };
}

test("21.1 a new text note inside the project folder is free, by a relative or a full path, in a folder that is not there yet", () => {
	const r = rig();
	assert.equal(r.free("write_file", { path: "analize.md", content: "x" }), true);
	assert.equal(r.free("write_file", { path: join(r.root, "01_Projektesana", "piezimes", "a.txt"), content: "x" }), true);
	assert.equal(r.free("write_file", { path: "saraksts.CSV", content: "x" }), true, "the extension is compared in lower case");
});

test("21.1 what stays with a click: outside the folder, `..`, hidden folders, other file types, no path, the folder itself, other tools", () => {
	const r = rig();
	const other = tmp("pj-other-");
	for (const path of [join(other, "a.md"), "../a.md", "sub/../../a.md", ".git/config.json", "x/.hidden/a.md", "a.docx", "a.pdf", "a.ps1", "a.bat", "noext", "a.md ", "a.md.", "con.md", "a.md:stream", "", "  ", ""]) {
		assert.equal(r.free("write_file", { path, content: "x" }), false, `asks for ${JSON.stringify(path)}`);
	}
	assert.equal(r.free("write_file", { content: "x" }), false);
	assert.equal(r.free("write_file", { path: 5 }), false);
	assert.equal(r.free("write_file", { path: r.root }), false, "the folder itself");
	for (const tool of ["run_command", "move_file", "delete_element", "made_up"]) assert.equal(r.free(tool, { path: "a.md", from: "a.md", to: "b.md", command: "x" }), false, tool);
	assert.equal(freeWrite({ ...r.ctx, projectId: null }, "write_file", { path: join(r.root, "a.md") }), false, "no open project, no free writes");
});

test("21.1 a file the agent did not make asks; a file it made itself is rewritten without asking; the old text is kept in the backups", async () => {
	const r = rig();
	writeFileSync(join(r.root, "klienta_pieprasijums.md"), "the office's own text", "utf8");
	assert.equal(r.free("write_file", { path: "klienta_pieprasijums.md" }), false, "an existing file that is not the agent's");
	assert.equal(r.free("edit_file", { path: "klienta_pieprasijums.md", old: "a", new: "b" }), false);
	assert.equal(r.free("edit_file", { path: "not-there.md", old: "a", new: "b" }), false, "an edit is of a file the agent made, never a new one");

	await r.run("write_file", { path: "analize.md", content: "v1" });
	assert.equal(readFileSync(join(r.root, "analize.md"), "utf8"), "v1");
	assert.equal(r.free("write_file", { path: "analize.md" }), true, "made by the agent");
	assert.equal(r.free("edit_file", { path: "analize.md", old: "v1", new: "v2" }), true);
	const res = (await r.run("write_file", { path: "analize.md", content: "v2" })) as { previousKeptAt?: string };
	assert.ok(res.previousKeptAt && readFileSync(res.previousKeptAt, "utf8") === "v1", "v1 was kept first");
	assert.equal(r.free("write_file", { path: "analize.md" }), true, "still the agent's after a rewrite");
	assert.equal(r.free("write_file", { path: "klienta_pieprasijums.md" }), false, "and the office's file is still not");
});

test("21.1 a file the agent overwrote after the user's click does not become free; one it created does, also when the click was needed", async () => {
	const r = rig();
	writeFileSync(join(r.root, "sveshs.txt"), "office", "utf8");
	await r.run("write_file", { path: "sveshs.txt", content: "agent" }); // as if the user had clicked
	assert.equal(r.free("write_file", { path: "sveshs.txt" }), false, "overwriting a file does not make it the agent's");
	await r.run("write_file", { path: "jauns.docx", content: "x" }); // a click was needed for this type; created by the agent
	assert.equal(r.free("write_file", { path: "jauns.docx" }), false, "not a text type, so never free");
});

test("21.1 edit_file replaces text exactly once, refuses an absent or repeated text, and `all` changes every place", async () => {
	const r = rig();
	await r.run("write_file", { path: "n.md", content: "a b a" });
	await assert.rejects(r.run("edit_file", { path: "n.md", old: "zzz", new: "y" }), /nav atrasts/);
	await assert.rejects(r.run("edit_file", { path: "n.md", old: "a", new: "y" }), /2 vietās/);
	assert.equal(readFileSync(join(r.root, "n.md"), "utf8"), "a b a", "a refused edit changes nothing");
	await r.run("edit_file", { path: "n.md", old: "b", new: "$&" });
	assert.equal(readFileSync(join(r.root, "n.md"), "utf8"), "a $& a", "the new text is taken literally");
	await r.run("edit_file", { path: "n.md", old: "a", new: "c", all: true });
	assert.equal(readFileSync(join(r.root, "n.md"), "utf8"), "c $& c");
	await assert.rejects(r.run("edit_file", { path: "gone.md", old: "a", new: "b" }), /nav fails/);
});

test("21.1 a link inside the project folder that leads out of it is not free", (t) => {
	const r = rig();
	const out = tmp("pj-out-");
	try {
		symlinkSync(out, join(r.root, "saite"), "junction");
	} catch {
		t.skip("no symlink right on this machine");
		return;
	}
	assert.equal(r.free("write_file", { path: "saite/a.md" }), false, "a folder link that leads out");
	writeFileSync(join(out, "real.md"), "x", "utf8");
	try {
		symlinkSync(join(out, "real.md"), join(r.root, "faila-saite.md"), "file");
		assert.equal(r.free("write_file", { path: "faila-saite.md" }), false, "a file link that leads out");
	} catch {
		// file links need a right Windows may not give; the folder link above is the same check
	}
	mkdirSync(join(r.root, "ok"), { recursive: true });
	assert.equal(r.free("write_file", { path: "ok/a.md" }), true);
});

test("21.1 the gate: a free write passes without a question; the same message's other confirm calls still ask once, and not about the free one", async () => {
	const r = rig();
	const asked: ConfirmRequest[] = [];
	const levelOf = makeLevelOf({ write_file: "confirm", run_command: "confirm", get_focus: "read" });
	const g = new Gate(levelOf, async (q) => (asked.push(q), true), (tool, args) => r.free(tool, args as Record<string, unknown>));
	const content = [
		{ type: "toolCall", id: "1", name: "write_file", arguments: { path: "analize.md", content: "x" } },
		{ type: "toolCall", id: "2", name: "write_file", arguments: { path: join(tmp("pj-other-"), "a.md"), content: "x" } },
		{ type: "toolCall", id: "3", name: "run_command", arguments: { command: "dir" } },
	];
	const msg = { role: "assistant", content } as never;
	const call = (i: number) => ({ assistantMessage: msg, toolCall: content[i], args: content[i].arguments, context: {} }) as never;
	assert.equal(await g.before(call(0)), undefined);
	assert.equal(asked.length, 0, "the note in the project folder asked nothing");
	assert.equal(await g.before(call(1)), undefined);
	assert.equal(await g.before(call(2)), undefined);
	assert.equal(asked.length, 1);
	assert.deepEqual(asked[0].batch.map((b) => b.tool), ["write_file", "run_command"], "the card lists the outside write and the command, not the note");
	assert.equal((asked[0].batch[0].args as { path: string }).path.includes("analize.md"), false);
	// a message of only free notes never asks, and a refusing user does not stop them
	const only = { role: "assistant", content: [content[0]] } as never;
	const never = new Gate(levelOf, async () => false, (tool, args) => r.free(tool, args as Record<string, unknown>));
	assert.equal(await never.before({ assistantMessage: only, toolCall: content[0], args: content[0].arguments, context: {} } as never), undefined);
	assert.equal(existsSync(dirname(r.root)), true);
});

test("21.1 without the lift a gate asks as before (the default)", async () => {
	const r = rig();
	let n = 0;
	const g = new Gate(makeLevelOf({ write_file: "confirm" }), async () => (++n, false));
	const c = { type: "toolCall", id: "1", name: "write_file", arguments: { path: "analize.md", content: "x" } };
	const res = await g.before({ assistantMessage: { role: "assistant", content: [c] }, toolCall: c, args: c.arguments, context: {} } as never);
	assert.equal(res?.block, true);
	assert.equal(n, 1);
	assert.equal(r.free("write_file", { path: "analize.md" }), true);
});
