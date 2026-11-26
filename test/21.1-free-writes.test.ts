// 21.1 the agent's files and the office folders. A text note the agent writes in its own work folder (<app data>\agent-work\<project>) runs without a click;
// a write into an office project folder is refused whatever the click (2.14.1: .md files had appeared in an office folder). Invented project in temp folders.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { allTools } from "../src/agent/tools/defs.ts";
import { Gate, makeLevelOf, type ConfirmRequest } from "../src/agent/tools/levels.ts";
import { freeWrite, officeBlock, workFolder } from "../src/agent/tools/project-write.ts";
import { ANTIGRAVITY_OWN_TOOLS_OFF, antigravitySessionSetup } from "../src/agent/antigravity/acp.ts";
import { tmp } from "./helpers.ts";

function rig() {
	const appDir = tmp();
	const root = tmp("pj-root-");
	const root2 = tmp("pj-root2-");
	const projectsDir = join(appDir, "projects");
	for (const [id, r] of [["BD999", root], ["BD998", root2]] as const) {
		mkdirSync(join(projectsDir, id), { recursive: true });
		writeFileSync(join(projectsDir, id, "project.json"), JSON.stringify({ id, name: `${id} Testa iela 1`, root: r }), "utf8");
	}
	const ctx: ToolCtx = { projectsDir, projectId: "BD999", dataDir: appDir, appDir, runDir: null, agent: null, thread: null };
	const run = async (name: string, args: Record<string, unknown>) => allTools().find((t) => t.name === name)!.run(ctx, args as never);
	const free = (tool: string, args: Record<string, unknown>) => freeWrite(ctx, tool, args);
	const block = (tool: string, args: Record<string, unknown>) => officeBlock(ctx, tool, args);
	return { appDir, root, root2, ctx, run, free, block, work: workFolder(ctx) };
}

test("21.1 a relative path of a write tool means the agent's work folder, never the office folder", async () => {
	const r = rig();
	const res = (await r.run("write_file", { path: "analize.md", content: "x" })) as { file: string };
	assert.equal(res.file, join(r.work, "analize.md"));
	assert.equal(readFileSync(join(r.work, "analize.md"), "utf8"), "x");
	assert.equal(existsSync(join(r.root, "analize.md")), false, "nothing in the office folder");
	assert.equal(r.work.startsWith(r.appDir), true);
});

test("21.1 a text note in the work folder is free: relative or full path, a folder that is not there yet, the extension in any case", () => {
	const r = rig();
	assert.equal(r.free("write_file", { path: "analize.md", content: "x" }), true);
	assert.equal(r.free("write_file", { path: join(r.work, "piezimes", "a.txt"), content: "x" }), true);
	assert.equal(r.free("write_file", { path: "saraksts.CSV", content: "x" }), true);
	assert.equal(r.free("copy_file", { from: "a.md", to: "b.md" }), true);
});

test("21.1 what stays with a click: outside the work folder, `..`, hidden folders, other file types, no path, the folder itself, other tools", () => {
	const r = rig();
	const other = tmp("pj-other-");
	for (const path of [join(other, "a.md"), "../a.md", "sub/../../a.md", ".git/config.json", "x/.hidden/a.md", "a.docx", "a.pdf", "a.ps1", "a.bat", "noext", "a.md ", "a.md.", "con.md", "a.md:stream", "", "  "]) {
		assert.equal(r.free("write_file", { path, content: "x" }), false, `asks for ${JSON.stringify(path)}`);
	}
	assert.equal(r.free("write_file", { content: "x" }), false);
	assert.equal(r.free("write_file", { path: 5 }), false);
	assert.equal(r.free("write_file", { path: r.work }), false, "the folder itself");
	for (const tool of ["run_command", "move_file", "delete_element", "made_up"]) assert.equal(r.free(tool, { path: "a.md", from: "a.md", to: "b.md", command: "x" }), false, tool);
});

test("21.1 the office folder is read-only: write, edit, copy into it and move in or out are refused, by relative path, full path, `..`, and the other project's folder", async () => {
	const r = rig();
	writeFileSync(join(r.root, "klienta_pieprasijums.md"), "the office's own text", "utf8");
	const inRoot = join(r.root, "01_Projektesana", "analize.md");
	assert.match(r.block("write_file", { path: inRoot }) ?? "", /neraksta nekad/);
	assert.match(r.block("write_file", { path: join(r.root, "a.docx") }) ?? "", /neraksta nekad/, "any file type");
	assert.match(r.block("write_file", { path: relative(r.work, join(r.root, "klientam.md")) }) ?? "", /neraksta nekad/, "a relative path with `..` that leads out of the work folder into the office folder");
	assert.match(r.block("write_file", { path: join(r.root2, "a.md") }) ?? "", /neraksta nekad/, "another project's folder too");
	assert.match(r.block("edit_file", { path: join(r.root, "klienta_pieprasijums.md") }) ?? "", /neraksta nekad/);
	assert.match(r.block("copy_file", { to: join(r.root, "kopija.md") }) ?? "", /neraksta nekad/);
	assert.match(r.block("move_file", { from: join(r.root, "klienta_pieprasijums.md"), to: join(r.work, "x.md") }) ?? "", /neraksta nekad/, "moving out takes it from the office folder");
	assert.match(r.block("move_file", { from: "klienta_pieprasijums.md", to: "x.md" }) ?? "", /neraksta nekad/, "a relative `from` means the project");
	assert.equal(r.block("move_file", { from: join(r.work, "a.md"), to: join(r.work, "b.md") }), null);
	assert.equal(r.block("write_file", { path: "a.md" }), null);
	assert.equal(r.block("read_file", { path: inRoot }), null, "reading is not this rule");
	for (const [tool, args] of [["write_file", { path: inRoot, content: "x" }], ["edit_file", { path: join(r.root, "klienta_pieprasijums.md"), old: "o", new: "n" }], ["copy_file", { from: join(r.root, "klienta_pieprasijums.md"), to: join(r.root, "k2.md") }], ["move_file", { from: join(r.root, "klienta_pieprasijums.md"), to: "x.md" }]] as const) {
		await assert.rejects(r.run(tool, args as never), /neraksta nekad/, tool);
	}
	assert.equal(readFileSync(join(r.root, "klienta_pieprasijums.md"), "utf8"), "the office's own text");
	assert.equal(existsSync(inRoot), false);
	assert.equal(r.free("write_file", { path: inRoot }), false, "never free in the office folder");
});

test("21.1 a link in the work folder that leads into the office folder is refused", () => {
	const r = rig();
	mkdirSync(r.work, { recursive: true });
	try {
		symlinkSync(r.root, join(r.work, "saite"), "junction");
	} catch {
		return; // no right to make a link here; the plain-path cases above carry the rule
	}
	assert.match(r.block("write_file", { path: join(r.work, "saite", "a.md") }) ?? "", /neraksta nekad/);
	assert.equal(r.free("write_file", { path: join(r.work, "saite", "a.md") }), false);
});

test("21.1 a network path (\\\\server\\share) is never a place for an agent file", () => {
	const r = rig();
	assert.match(r.block("write_file", { path: "\\\\192.168.0.1\\Dokumenti\\a.md" }) ?? "", /tīkla ceļš/);
});

test("21.1 run_command: a command that writes into the office folder (named or by its folder) is refused; its default folder is the work folder; a read is not", async () => {
	const r = rig();
	const call = (command: string, cwd?: string) => r.block("run_command", { command, ...(cwd ? { cwd } : {}) });
	assert.match(call(`Set-Content -Path '${join(r.root, "a.md")}' -Value x`) ?? "", /neraksta nekad/);
	assert.match(call(`"x" > "${join(r.root, "a.md")}"`) ?? "", /neraksta nekad/);
	assert.match(call(`Copy-Item a.md b.md`, r.root) ?? "", /neraksta nekad/, "runs in the office folder and writes");
	assert.equal(call(`Get-ChildItem '${r.root}' -Recurse 2>$null`), null, "listing is reading");
	assert.equal(call(`Get-Content '${join(r.root, "a.md")}'`), null);
	assert.equal(call(`Get-Content "${join(r.root, "Copy of plans", "notes.md")}"`), null, "a folder or file name that holds a verb word is a read");
	assert.equal(call(`Set-Content a.md x`), null, "default folder = the work folder");
	const out = (await r.run("run_command", { command: "(Get-Location).Path" })) as { stdout: string };
	if (process.platform === "win32") assert.equal(out.stdout.trim().toLowerCase(), r.work.toLowerCase(), "the command ran in the work folder");
	await assert.rejects(r.run("run_command", { command: `Set-Content -Path '${join(r.root, "b.md")}' -Value x` }), /neraksta nekad/);
});

test("21.1 a note the agent wrote is found again by a relative path (read falls back to the work folder)", async () => {
	const r = rig();
	await r.run("write_file", { path: "n.md", content: "a b a" });
	const read = (await r.run("read_file", { path: "n.md" })) as string;
	assert.equal(read, "a b a");
	writeFileSync(join(r.root, "n.md"), "office", "utf8");
	assert.equal(await r.run("read_file", { path: "n.md" }), "office", "the project's file wins when both exist");
});

test("21.1 the old text is kept in the backups first; a file the agent overwrites in its work folder stays rewritable", async () => {
	const r = rig();
	await r.run("write_file", { path: "analize.md", content: "v1" });
	assert.equal(r.free("write_file", { path: "analize.md" }), true);
	assert.equal(r.free("edit_file", { path: "analize.md", old: "v1", new: "v2" }), true);
	const res = (await r.run("write_file", { path: "analize.md", content: "v2" })) as { previousKeptAt?: string };
	assert.ok(res.previousKeptAt && readFileSync(res.previousKeptAt, "utf8") === "v1", "v1 was kept first");
	assert.equal(r.free("edit_file", { path: "not-there.md", old: "a", new: "b" }), false, "an edit of a file that is not there asks nothing and fails by itself");
	await assert.rejects(r.run("edit_file", { path: "not-there.md", old: "a", new: "b" }), /nav fails/);
});

test("21.1 edit_file replaces text exactly once, refuses an absent or repeated text, and `all` changes every place", async () => {
	const r = rig();
	await r.run("write_file", { path: "n.md", content: "a b a" });
	await assert.rejects(r.run("edit_file", { path: "n.md", old: "zzz", new: "y" }), /nav atrasts/);
	await assert.rejects(r.run("edit_file", { path: "n.md", old: "a", new: "y" }), /2 vietās/);
	assert.equal(readFileSync(join(r.work, "n.md"), "utf8"), "a b a", "a refused edit changes nothing");
	await r.run("edit_file", { path: "n.md", old: "b", new: "$&" });
	assert.equal(readFileSync(join(r.work, "n.md"), "utf8"), "a $& a", "the new text is taken literally");
	await r.run("edit_file", { path: "n.md", old: "a", new: "c", all: true });
	assert.equal(readFileSync(join(r.work, "n.md"), "utf8"), "c $& c");
});

test("21.1 the gate: a note in the work folder passes without a question; an office write is blocked before any question; other confirm calls ask once", async () => {
	const r = rig();
	const asked: ConfirmRequest[] = [];
	const levelOf = makeLevelOf({ write_file: "confirm", run_command: "confirm", get_focus: "read" });
	const g = new Gate(levelOf, async (q) => (asked.push(q), true), (tool, args) => r.free(tool, args as Record<string, unknown>), (tool, args) => r.block(tool, args as Record<string, unknown>));
	const content = [
		{ type: "toolCall", id: "1", name: "write_file", arguments: { path: "analize.md", content: "x" } },
		{ type: "toolCall", id: "2", name: "write_file", arguments: { path: join(tmp("pj-other-"), "a.md"), content: "x" } },
		{ type: "toolCall", id: "3", name: "run_command", arguments: { command: "dir" } },
		{ type: "toolCall", id: "4", name: "write_file", arguments: { path: join(r.root, "BD_plans.md"), content: "x" } },
	];
	const msg = { role: "assistant", content } as never;
	const call = (i: number) => ({ assistantMessage: msg, toolCall: content[i], args: content[i].arguments, context: {} }) as never;
	const office = await g.before(call(3));
	assert.equal(office?.block, true, "blocked");
	assert.match(String(office?.reason), /neraksta nekad/);
	assert.equal(asked.length, 0, "no click was even offered for the office folder");
	assert.equal(await g.before(call(0)), undefined);
	assert.equal(asked.length, 0, "the note in the work folder asked nothing");
	assert.equal(await g.before(call(1)), undefined);
	assert.equal(await g.before(call(2)), undefined);
	assert.equal(asked.length, 1);
	assert.deepEqual(asked[0].batch.map((b) => b.tool), ["write_file", "run_command"], "the card lists the outside write and the command, not the note and not the refused office write");
	const only = { role: "assistant", content: [content[0]] } as never;
	const never = new Gate(levelOf, async () => false, (tool, args) => r.free(tool, args as Record<string, unknown>), (tool, args) => r.block(tool, args as Record<string, unknown>));
	assert.equal(await never.before({ assistantMessage: only, toolCall: content[0], args: content[0].arguments, context: {} } as never), undefined);
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

test("21.1 an Antigravity session is opened with the server's own writing, running and browsing tools off; reading stays", () => {
	const setup = antigravitySessionSetup({ agentInfo: { version: "1.4.3" } });
	const off = setup._meta?.antigravity.disabledTools ?? [];
	for (const t of ["write_to_file", "replace_file_content", "multi_replace_file_content", "run_command", "browser_subagent", "invoke_subagent", "run_workflow"]) assert.ok(off.includes(t), t);
	for (const t of ["view_file", "call_mcp_tool"]) assert.equal(off.includes(t), false, `${t} stays`);
	assert.deepEqual(off, [...ANTIGRAVITY_OWN_TOOLS_OFF]);
	assert.deepEqual(antigravitySessionSetup({ agentInfo: { version: "1.5.1" } }), setup, "every version");
	assert.deepEqual(antigravitySessionSetup({ agentInfo: { version: "1.4.3" } }, true), { _meta: { antigravity: { disabledTools: ["run_workflow"] } } }, "the minimal setup is the old one");
});

test("2.15.0 in the work folder a copy of any file type and a move from the work folder to the work folder need no click; a move in or out of anywhere else does", async () => {
	const r = rig();
	const other = tmp("pj-other-");
	writeFileSync(join(other, "avots.pdf"), "pdf", "utf8");
	assert.equal(r.free("copy_file", { from: join(other, "avots.pdf"), to: "kopija.pdf" }), true, "a PDF copied into the work folder");
	assert.equal(r.free("copy_file", { from: join(other, "avots.pdf"), to: join(other, "kopija.pdf") }), false, "a copy elsewhere still asks");
	assert.equal(r.free("copy_file", { from: join(other, "avots.pdf"), to: join(r.root, "kopija.pdf") }), false, "an office folder is never free");
	mkdirSync(r.work, { recursive: true });
	writeFileSync(join(r.work, "a.pdf"), "x", "utf8");
	writeFileSync(join(other, "b.pdf"), "x", "utf8");
	assert.equal(r.free("move_file", { from: "a.pdf", to: "arhivs/a.pdf" }), true, "work folder to work folder");
	assert.equal(r.free("move_file", { from: join(r.work, "a.pdf"), to: join(r.work, "b.pdf") }), true);
	assert.equal(r.free("move_file", { from: join(other, "b.pdf"), to: "b.pdf" }), false, "taking a file from elsewhere asks");
	assert.equal(r.free("move_file", { from: join(r.work, "a.pdf"), to: join(other, "a.pdf") }), false, "taking a file out of the work folder asks");
	assert.equal(r.free("move_file", { from: "nav_tada.pdf", to: "x.pdf" }), false, "a file that is not there");
	assert.equal(r.free("move_file", { to: "x.pdf" }), false, "no `from`");
	assert.equal(r.free("write_file", { path: "a.docx", content: "x" }), false, "write_file still writes text only");
});

test("2.15.0 the tools that only change the app's own project data need no click; the ones that reach further keep it", async () => {
	const { OWN_DATA_TOOLS } = await import("../src/agent/tools/levels.ts");
	assert.deepEqual([...OWN_DATA_TOOLS].sort(), ["delete_inventory_rooms", "start_delivery", "unstage_file"]);
	for (const keep of ["run_command", "memory_write_office", "agent_configure", "app_confirm", "write_file"]) assert.equal(OWN_DATA_TOOLS.has(keep), false, keep);
});
