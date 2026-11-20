// Follow-up fix wave 2: an agent cannot skip S4 or S5 by any road (R46), the lead's cap is held at save (R49), a gate decision lands in the leader's open thread (R48),
// the "start eks" card goes once eks has run (R48), and Office servers left behind by a failed COM job are stopped. Invented projects and agents; no real Word is started.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LEAD_FIXED_MAX, fixedTokens, rosterFor, standingFor } from "../src/agent/agents.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { DEFAULT_AGENTS, LEAD_ROSTER_DESC_MAX, rosterText } from "../src/agent/subagents.ts";
import { Mailbox, mailDir } from "../src/core/messages.ts";
import { type ProcessState, changeProfile, initial, readProcess, skipStage, step, switchMode, writeProcess } from "../src/core/process.ts";
import { waitingEksStarts } from "../src/core/process-waiting.ts";
import { ProjectStore } from "../src/core/store.ts";
import { agentHandlers } from "../src/main/handlers/agents.ts";
import { processHandlers } from "../src/main/handlers/process.ts";
import { AppSettings } from "../src/main/settings.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import type { WaitingItem } from "../src/shared/thread-types.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { LOCK_FILE, type LockEnv, OfficeLockTimeout, realLockEnv, withOfficeLock } from "../src/sources/text/office-lock.ts";
import { SETTLE_MS, type OfficeProc, type OfficeProcIO, automationPids, pidsToStop, withOfficeCleanup } from "../src/sources/text/office-procs.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: `apraksts ${id}`, prompt: `You are AGENT ${id}.`, tools: ["write_note"], ...extra });
const IDS = ["bpv", "eks", "ar"];
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const gateRec = (id: string, stage: string, state: "waiting" | "approved" | "returned" = "waiting", extra: object = {}) => ({ id, stage, iteration: 1, state, noteId: "n_g", at: "2026-11-16T10:00:00.000Z", ...extra }) as never;

// ---- 1. an agent cannot walk past S4 and S5 ------------------------------------------------------------------------------------------

function processStore() {
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	switchMode(store, "process", IDS, "user");
	return store;
}

// ---- 2. the lead's cap ---------------------------------------------------------------------------------------------------------------

function handler() {
	const dir = tmp();
	const settings = new AppSettings(dir, plainCrypto);
	return { dir, settings, h: agentHandlers({ settings }) };
}
const many = (n: number, chars: number): AgentSpec[] => Array.from({ length: n }, (_, i) => spec(`ag${String(i).padStart(3, "0")}`, { description: "d".repeat(chars), tools: [] }));
const leadOf = (dir: string, specs: AgentSpec[]) => fixedTokens(null, { appDir: dir, userName: "", specs, skills: [], knowledge: "" }, declarationTokens(null));

// ---- 3 and 4. gate decisions and the start-eks card ----------------------------------------------------------------------------------

function rig(at: { stage?: ProcessState["stage"]; gates?: ProcessState["gates"] } = {}, waiting: (w: WaitingItem[]) => void = () => undefined) {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const store = ProjectStore.open(dir, { id: "BD999", name: "BD999 Testa iela 1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" });
	const settings = new AppSettings(dir, plainCrypto);
	settings.saveAgentSpecs(IDS.map((i) => spec(i)));
	switchMode(store, "process", IDS, "user");
	writeProcess(store, { ...readProcess(store)!, ...(at.stage ? { stage: at.stage } : {}), ...(at.gates ? { gates: at.gates } : {}) }, "user");
	const prompts: string[] = [];
	let inRun: (() => void) | null = null;
	const s = new AgentSession({
		runtime: async () => createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null }),
		settings: () => ({ ...DEFAULT_SETTINGS, maxParallelAgents: 4 }),
		toolsServer: () => ({ command: "node", args: [], env: {} }),
		revit: () => null,
		ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
		agents: () => IDS.map((i) => spec(i)),
		runsDir: join(dir, "runs"),
		chatDir: join(dir, "chat"),
		emit: () => undefined,
		onWaiting: waiting,
		runAgent: async (r: PiRunOptions) => {
			prompts.push(r.prompt);
			inRun?.();
			r.onEvent({ type: "done", text: "gatavs" });
		},
	});
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: () => undefined, session: s });
	const settle = async () => {
		for (let i = 0; i < 400 && (s.queueView().running.length || s.queueView().queued.length); i++) await tick();
		await tick(20);
	};
	return { dir, store, s, h, prompts, settle, onRun: (f: () => void) => void (inRun = f), mail: () => new Mailbox(mailDir(dir, dir, "BD999")), state: () => readProcess(store)! };
}

// ---- 6. Office servers left behind ---------------------------------------------------------------------------------------------------

const proc = (pid: number, cmd: string | null, window = false): OfficeProc => ({ pid, cmd, window });

function fakeIO(snapshots: (number[] | null)[]) {
	const stopped: number[][] = [];
	const waits: number[] = [];
	let i = 0;
	const io: OfficeProcIO = {
		list: async () => {
			const snap = snapshots[i++];
			return snap ? new Set(snap) : null;
		},
		stop: (p) => void stopped.push([...p]),
		wait: async (ms) => void waits.push(ms),
	};
	return { io, stopped, waits };
}

const lockOf = (dir = tmp()) => ({ dir, timeoutMs: 2_000 });

// ---- R50: the lock across processes -----------------------------------------------------------------------------------------------------

const DEAD = 2_147_000_000; // no process has this id
const fastEnv = (over: Partial<LockEnv> = {}): LockEnv => ({ ...realLockEnv, pollMs: 5, ...over });

test("R50: two acquirers of one lock folder run one after the other, and the lock file is gone afterwards", async () => {
	const dir = tmp();
	const order: string[] = [];
	const job = (name: string, ms: number) => withOfficeLock(dir, 2_000, async () => (order.push(`${name}+`), await tick(ms), order.push(`${name}-`), name), fastEnv());
	assert.deepEqual(await Promise.all([job("a", 40), job("b", 1), job("c", 1)]), ["a", "b", "c"]);
	// whoever came first runs first; none of the three overlaps another
	assert.deepEqual(
		order.filter((_, i) => i % 2 === 0).map((x) => x[0]).sort(),
		["a", "b", "c"],
	);
	for (let i = 0; i < order.length; i += 2) assert.equal(order[i][0], order[i + 1][0], `${order.join(" ")}: a job's start is followed by its own end`);
	assert.equal(existsSync(join(dir, LOCK_FILE)), false);
});

test("R50: a lock whose pid is dead is taken over; one whose pid lives is waited for, then OfficeLockTimeout; one older than its owner's limit + 60 s is taken over though its pid lives", async () => {
	const dir = tmp();
	const file = join(dir, LOCK_FILE);
	const body = (pid: number, start: number, staleMs = 60_000) => JSON.stringify({ pid, start, staleMs, token: "x" });
	// the owner is gone
	writeFileSync(file, body(DEAD, Date.now()), "utf8");
	assert.equal(await withOfficeLock(dir, 1_000, async () => "taken", fastEnv()), "taken");
	assert.equal(existsSync(file), false);
	// the owner lives and the lock is young: we wait the whole budget, the lock is left as it was
	writeFileSync(file, body(process.pid, Date.now()), "utf8");
	await assert.rejects(withOfficeLock(dir, 60, async () => "never", fastEnv()), OfficeLockTimeout);
	assert.equal(readFileSync(file, "utf8"), body(process.pid, Number(JSON.parse(readFileSync(file, "utf8")).start)), "a live owner's lock is not touched");
	// the owner lives but the lock is older than its own limit + 60 s: a pid can be reused, so age decides too
	writeFileSync(file, JSON.stringify({ pid: process.pid, start: 1_000, staleMs: 240_000, token: "old" }), "utf8");
	assert.equal(await withOfficeLock(dir, 1_000, async () => "aged", fastEnv({ now: () => 1_000 + 240_001 })), "aged");
	// an unreadable lock (owner died before writing it) is a leftover only after a long while
	writeFileSync(file, "", "utf8");
	await assert.rejects(withOfficeLock(dir, 40, async () => "never", fastEnv()), OfficeLockTimeout);
	assert.equal(await withOfficeLock(dir, 1_000, async () => "late", fastEnv({ now: () => Date.now() + 10 * 60_000 })), "late");
});

test("R50: the lock is released when the job throws, and a job never removes a lock that is no longer its own", async () => {
	const dir = tmp();
	const file = join(dir, LOCK_FILE);
	await assert.rejects(
		withOfficeLock(dir, 1_000, async () => {
			assert.equal(existsSync(file), true, "held while the job runs");
			throw new Error("boom");
		}, fastEnv()),
		{ message: "boom" },
	);
	assert.equal(existsSync(file), false, "released in finally");
	assert.equal(await withOfficeLock(dir, 1_000, async () => "again", fastEnv()), "again");
	// a very long job whose lock was taken over meanwhile: the new owner's lock stays
	await withOfficeLock(dir, 1_000, async () => writeFileSync(file, JSON.stringify({ pid: process.pid, start: Date.now(), staleMs: 60_000, token: "other" }), "utf8"), fastEnv());
	assert.equal(JSON.parse(readFileSync(file, "utf8")).token, "other");
});

test("R50: withOfficeCleanup takes the lock around the snapshots and the cleanup: a lock held by another process makes it wait, and a lock that never frees fails it without running the job", async () => {
	const dir = tmp();
	const file = join(dir, LOCK_FILE);
	const io = fakeIO([[], [], []]).io;
	let ran = false;
	writeFileSync(file, JSON.stringify({ pid: process.pid, start: Date.now(), staleMs: 60_000, token: "other-process" }), "utf8");
	await assert.rejects(
		withOfficeCleanup("WINWORD.EXE", async () => ((ran = true), { ok: true }), (r) => !r.ok, { dir, timeoutMs: 60, env: fastEnv() }, io),
		OfficeLockTimeout,
	);
	assert.equal(ran, false, "no job, and no snapshot, while another job holds the lock");
	// the other process finishes while we wait
	setTimeout(() => rmSync(file, { force: true }), 30);
	assert.deepEqual(await withOfficeCleanup("WINWORD.EXE", async () => ({ ok: true }), (r) => !r.ok, { dir, timeoutMs: 2_000, env: fastEnv() }, io), { ok: true });
	assert.equal(existsSync(file), false);
});
