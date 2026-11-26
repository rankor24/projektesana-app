// 25.1 Two Revit sessions open. Against the REAL Revit MCP server the app ships (resources/revit-mcp), with an invented session registry in a temp folder: two live processes stand in
// for two Revits, on ports where nothing listens, so the server's own "connect to revit client failed: pid N …" says which session a call was sent to. No Revit is touched.
// The cause this covers (seen 2026-11-26): the server keeps one selection per server process, every message starts new processes, and a selection made earlier was not there.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { connectMcpServers } from "../src/agent/pi/mcp.ts";
import { toolsSessionRules } from "../src/agent/tools/revit-commands.ts";
import { ProjectStore } from "../src/core/store.ts";
import { RevitClient, launchSpec } from "../src/revit/client.ts";
import { projectSession, workDir } from "../src/revit/revision.ts";
import { choiceFile, pickSession, SessionRefused } from "../src/revit/target.ts";
import { tmp } from "./helpers.ts";

const serverJs = join(import.meta.dirname, "..", "resources", "revit-mcp", "node-server", "build", "index.js");
// the server is part of a build, not of the repository
const skip = existsSync(serverJs) ? false : "resources/revit-mcp is not there (npm run dist copies it)";

const launch = { serverJs, node: null };
const dir = tmp("two-sessions-");
const registry = join(dir, "registry");
const projectsDir = join(dir, "projects");
const appDir = join(dir, "app");
mkdirSync(join(projectsDir, "BD999"), { recursive: true });
writeFileSync(join(projectsDir, "BD999", "project.json"), JSON.stringify({ id: "BD999", name: "BD999 Testa iela 1", root: join(dir, "office") }), "utf8");
const work = () => join(workDir(ProjectStore.load(projectsDir, "BD999")), "XY_AR_WORK.rvt");
const OTHER = join(dir, "office", "ZZ_AR.rvt");

interface Session {
	pid: number;
	port: number;
}
const children: ChildProcess[] = [];
let a: Session;
let b: Session;

const freePort = () =>
	new Promise<number>((resolve) => {
		const s = createServer().listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => resolve(port));
		});
	});
async function session(): Promise<Session> {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	children.push(child);
	return { pid: child.pid!, port: await freePort() };
}
/** What each Revit's add-in writes about itself; `docs` says which file is active in which session. */
function open(...docs: [Session, string][]) {
	mkdirSync(registry, { recursive: true });
	for (const s of [a, b]) {
		const mine = docs.find(([x]) => x === s);
		const file = join(registry, `${s.pid}.json`);
		if (!mine) {
			writeFileSync(file, "closed", "utf8"); // unreadable: the server skips it, as if that Revit were not open
			continue;
		}
		const doc = { title: mine[1].replace(/^.*[\\/]|\.rvt$/gi, ""), path: mine[1] };
		writeFileSync(file, JSON.stringify({ schema: 1, pid: s.pid, host: "127.0.0.1", port: s.port, revitVersion: "2026", activeDocument: doc, activeView: "1", documents: [{ ...doc, isFamily: false }], updatedAt: new Date().toISOString() }), "utf8");
	}
}
const to = (s: Session) => new RegExp(`connect to revit client failed: pid ${s.pid}\\b`);
const send = { code: "return 1;", parameters: [], transactionMode: "none" };

before(async () => {
	process.env.REVIT_MCP_REGISTRY_DIR = registry;
	a = await session();
	b = await session();
});
after(() => {
	for (const c of children) c.kill();
	delete process.env.REVIT_MCP_REGISTRY_DIR;
});

async function withClient(fn: (c: RevitClient) => Promise<void>) {
	const c = new RevitClient(() => launch, process.execPath);
	try {
		await fn(c);
	} finally {
		await c.close();
	}
}
const rules = (thread: string, project = "BD999") => () => toolsSessionRules({ PROJEKTESANA_APP: appDir, PROJEKTESANA_THREAD: thread, PROJEKTESANA_PROJECTS: projectsDir, PROJEKTESANA_PROJECT: project });
const choose = (thread: string, choice: Record<string, unknown>) => {
	mkdirSync(join(appDir, "revit-choice"), { recursive: true });
	writeFileSync(choiceFile(appDir, thread), JSON.stringify(choice), "utf8");
};

test("25.1 the real server: two sessions and no selection refuse the call (what the user saw)", { skip }, async () => {
	open([a, OTHER], [b, work()]);
	await withClient(async (c) => assert.match(await c.call("send_code_to_revit", send), /2 Revit sessions are running\. Call select_revit_instance first/));
});

test("25.1 a revit_* tool with no choice goes to the session whose active document is the project's working copy, and follows it when Revit restarts or the model moves", { skip }, async () => {
	await withClient(async (c) => {
		c.pick = pickSession(rules("new"));
		open([a, OTHER], [b, work()]);
		assert.match(await c.call("send_code_to_revit", send), to(b));
		open([a, work()], [b, OTHER]);
		assert.match(await c.call("send_code_to_revit", send), to(a), "chosen again for every call");
	});
});

test("25.1 the agent's choice of an earlier message holds while that session runs; a pid that is gone is dropped for the working copy", { skip }, async () => {
	open([a, OTHER], [b, work()]);
	choose("t1", { pid: a.pid });
	await withClient(async (c) => {
		c.pick = pickSession(rules("t1"));
		assert.match(await c.call("send_code_to_revit", send), to(a), "the choice, not the working copy");
		choose("t1", { pid: 999_999 });
		assert.match(await c.call("send_code_to_revit", send), to(b), "stale: the working copy");
		choose("t1", { match: "ZZ_AR" });
		assert.match(await c.call("send_code_to_revit", send), to(a), "a choice by name is the server's to resolve");
		choose("t1", { match: "no such model" });
		assert.match(await c.call("send_code_to_revit", send), to(b));
	});
});

test("25.1 no working copy active, or two of them: refused with the sessions named, and nothing is sent", { skip }, async () => {
	await withClient(async (c) => {
		for (const docs of [[OTHER, OTHER], [work(), work()]]) {
			open([a, docs[0]!], [b, docs[1]!]);
			await assert.rejects(c.session((r) => r.call("send_code_to_revit", send), projectSession(ProjectStore.load(projectsDir, "BD999"))), (e: Error) => e instanceof SessionRefused && e.message.includes(`pid ${a.pid}`) && e.message.includes(`pid ${b.pid}`));
		}
		// another project's working copy is not this project's
		open([a, OTHER], [b, join(dir, "projects", "BD998", "work", "QQ_WORK.rvt")]);
		await assert.rejects(c.session((r) => r.call("send_code_to_revit", send), pickSession(rules("new"))), SessionRefused);
	});
});

test("25.1 one session open is the one, whatever the choice says; calls running together each keep their own session", { skip }, async () => {
	await withClient(async (c) => {
		open([a, OTHER]);
		c.pick = pickSession(() => ({ choice: { pid: b.pid }, isWork: () => false }));
		assert.match(await c.call("send_code_to_revit", send), to(a));
		open([a, OTHER], [b, work()]);
		const [x, y] = await Promise.all([a, b].map((s) => c.session((r) => r.call("send_code_to_revit", send), pickSession(() => ({ choice: { pid: s.pid }, isWork: () => false })))));
		assert.match(x!, to(a));
		assert.match(y!, to(b));
	});
});

test("25.1 the agent's own Revit server, new in every message, is put on the same session before its tools; its select tool is left to it", { skip }, async () => {
	open([a, OTHER], [b, work()]);
	let choice: Record<string, unknown> | null = null;
	const spec = launchSpec(launch, process.execPath);
	const mcp = await connectMcpServers({ revit: { ...spec, env: { ...(process.env as Record<string, string>), ...spec.env }, allow: ["send_code_to_revit", "select_revit_instance"], pick: pickSession(() => ({ choice, isWork: (p) => p === work() })) } });
	const call = async (name: string, args: Record<string, unknown>) => (await mcp.tools.find((t) => t.name === name)!.execute("1", args)).content.map((c) => (c.type === "text" ? c.text : "")).join("");
	try {
		assert.match(await call("send_code_to_revit", send), to(b));
		assert.match(await call("select_revit_instance", { pid: a.pid }), /^Selected:/);
		choice = { pid: a.pid };
		assert.match(await call("send_code_to_revit", send), to(a));
	} finally {
		await mcp.close();
	}
});
