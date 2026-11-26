// 25.1 Two Revit sessions open: every Revit call of the tools server (revit_set_parameter, revit_read_parameters, views, schedules, sheets, the working copy, exports) follows the
// session the agent chose with select_revit_instance. Seen 2026-11-26: reading and placing worked, the revit_* tools failed with "2 Revit sessions are running" because the tools
// server's own Revit connection never made the agent's choice. A fake Revit MCP server that behaves like the real one with two sessions; no Revit.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { RevitClient } from "../src/revit/client.ts";
import { REVIT_CHOICE_FILE, readRevitChoice } from "../src/agent/tools/revit-commands.ts";
import { tmp } from "./helpers.ts";

/** The server side: with two sessions and no choice every call but list/select answers with the error; a choice for a pid that is not open is answered with plain text, as the real server does. */
function fakeServer(open: number[] = [17376, 14488]) {
	const calls: string[] = [];
	let selected: number | null = null;
	const text = (t: string, isError = false) => ({ content: [{ type: "text", text: t }], isError });
	const client = {
		async callTool({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) {
			calls.push(name === "select_revit_instance" ? `select:${String(args.pid)}` : name);
			if (name === "select_revit_instance") {
				if (open.includes(Number(args.pid))) {
					selected = Number(args.pid);
					return text(`Selected: pid ${selected}`);
				}
				return text("No Revit instance with that pid.");
			}
			if (name === "list_revit_instances") return text("{}");
			if (selected === null && open.length > 1) return text(`Code execution failed: ${open.length} Revit sessions are running. Call select_revit_instance first`, true);
			return text(`ok in ${selected}`);
		},
	};
	return { client, calls, selected: () => selected };
}

function rig(open?: number[]) {
	const runDir = tmp("two-sessions-");
	mkdirSync(runDir, { recursive: true });
	const srv = fakeServer(open);
	const rc = new RevitClient(() => ({ serverJs: "x", node: null }), "node");
	(rc as unknown as { connect: () => Promise<unknown> }).connect = async () => srv.client;
	rc.choice = () => readRevitChoice(runDir);
	const choose = (c: Record<string, unknown>) => writeFileSync(join(runDir, REVIT_CHOICE_FILE), JSON.stringify(c), "utf8");
	return { rc, srv, choose, runDir };
}

test("25.1 without the agent's choice two sessions refuse every call (the old behaviour this fixes)", async () => {
	const r = rig();
	await assert.rejects(r.rc.call("set_parameter", {}), /2 Revit sessions are running/);
});

test("25.1 the client makes the agent's choice before its first call, once, and calls then run in that session", async () => {
	const r = rig();
	r.choose({ pid: 14488 });
	assert.equal(await r.rc.call("send_code_to_revit", {}), "ok in 14488");
	assert.equal(await r.rc.call("send_code_to_revit", {}), "ok in 14488");
	assert.deepEqual(r.srv.calls, ["select:14488", "send_code_to_revit", "send_code_to_revit"], "selected once, not before every call");
});

test("25.1 a new choice of the agent is followed by the next call", async () => {
	const r = rig();
	r.choose({ pid: 14488 });
	await r.rc.call("a", {});
	r.choose({ pid: 17376 });
	assert.equal(await r.rc.call("b", {}), "ok in 17376");
	assert.deepEqual(r.srv.calls, ["select:14488", "a", "select:17376", "b"]);
});

test("25.1 a choice the server does not accept stops the call: nothing is done in another session", async () => {
	const r = rig();
	r.choose({ pid: 99999 });
	await assert.rejects(r.rc.call("set_parameter", {}), /nevarēja izvēlēties to pašu Revit sesiju/);
	assert.deepEqual(r.srv.calls, ["select:99999"], "the call itself never went out");
	r.choose({ pid: 14488 });
	assert.equal(await r.rc.call("set_parameter", {}), "ok in 14488", "a good choice afterwards works");
});

test("25.1 the agent's own select_revit_instance call through this client is not wrapped in another choice; with one session open nothing changes", async () => {
	const r = rig([14488]);
	assert.equal(await r.rc.call("anything", {}), "ok in null", "no choice file: the call goes as before");
	r.choose({ pid: 14488 });
	assert.match(await r.rc.call("select_revit_instance", { pid: 14488 }), /^Selected:/);
	assert.deepEqual(r.srv.calls, ["anything", "select:14488"]);
});

test("25.1 readRevitChoice: no run folder, no file or a file that is not an object is no choice", () => {
	assert.equal(readRevitChoice(null), null);
	assert.equal(readRevitChoice(tmp("none-")), null);
	const dir = tmp("bad-");
	writeFileSync(join(dir, REVIT_CHOICE_FILE), "[1,2]", "utf8");
	assert.equal(readRevitChoice(dir), null);
	writeFileSync(join(dir, REVIT_CHOICE_FILE), "{broken", "utf8");
	assert.equal(readRevitChoice(dir), null);
});
