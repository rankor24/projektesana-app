// Follow-up fix wave 2: an agent cannot skip S4 or S5 by any road (R46), the lead's cap is held at save (R49), a gate decision lands in the leader's open thread (R48),
// the "start eks" card goes once eks has run (R48), and Office servers left behind by a failed COM job are stopped. Invented projects and agents; no real Word is started.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LEAD_FIXED_MAX, fixedTokens, rosterFor, standingFor } from "../src/agent/agents.ts";
import { declarationTokens } from "../src/agent/declarations.ts";
import type { PiRunOptions } from "../src/agent/pi/index.ts";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { LEAD_ROSTER_DESC_MAX, rosterText } from "../src/agent/subagents.ts";
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
import { type OfficeProc, type OfficeProcIO, automationPids, pidsToStop, withOfficeCleanup } from "../src/sources/text/office-procs.ts";
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

test("R46: an agent's profile change that sets S4 or S5 to izlaiž is refused, nothing is written, and the skip road is closed too", () => {
	const store = processStore();
	const before = JSON.stringify(readProcess(store));
	for (const st of ["S4", "S5"] as const) {
		assert.throws(() => changeProfile(store, { why: "ātrāk", depth: { [st]: "izlaiž" } }, IDS, "agent"), { message: `${st} izlaist drīkst tikai lietotājs.` });
	}
	// the same patch with both and another stage in it: the whole change is refused
	assert.throws(() => changeProfile(store, { why: "ātrāk", depth: { S2: "vienkāršota", S4: "izlaiž", S5: "izlaiž" } }, IDS, "agent"), /S4 izlaist drīkst tikai lietotājs\./);
	assert.equal(JSON.stringify(readProcess(store)), before, "nothing was written");
	// the repro: with the profile untouched the agent walks S1 → S2 → S3 → S4 and is stopped at S4, as before
	assert.equal(skipStage(store, "vienkāršs", "agent").stage, "S2");
	assert.equal(skipStage(store, "vienkāršs", "agent").stage, "S3");
	assert.equal(skipStage(store, "vienkāršs", "agent").stage, "S4");
	assert.throws(() => skipStage(store, "vienkāršs", "agent"), /S4 izlaist drīkst tikai lietotājs\./);
	// the agent's other profile changes still go through
	assert.doesNotThrow(() => changeProfile(store, { why: "mazāk", depth: { S2: "vienkāršota" } }, IDS, "agent"));
});

test("R46: when the user has set S4 and S5 to izlaiž, an agent's skip of S3 (which would pass over both) is refused; the user's skip goes, as does the user's profile change", () => {
	const store = processStore();
	// the user may set them (the user's paths keep today's behaviour)
	changeProfile(store, { why: "lietotāja izvēle", depth: { S4: "izlaiž", S5: "izlaiž" } }, IDS, "user");
	assert.equal(readProcess(store)!.profile.depth.S4, "izlaiž");
	assert.equal(skipStage(store, "vienkāršs", "agent").stage, "S2");
	assert.equal(skipStage(store, "vienkāršs", "agent").stage, "S3");
	const at = readProcess(store)!;
	assert.throws(() => skipStage(store, "vienkāršs", "agent"), { message: "S4 izlaist drīkst tikai lietotājs." });
	assert.deepEqual(readProcess(store), at, "the state is unchanged");
	// the pure step says the same
	const r = step({ ...initial("buvprojekts", IDS), stage: "S3", profile: { ...initial("buvprojekts", IDS).profile, depth: { ...initial("buvprojekts", IDS).profile.depth, S4: "izlaiž" } } }, { type: "stage.skip", why: "x", at: "2026-11-16T00:00:00Z", by: "agent" });
	assert.ok(!r.ok && r.error === "S4 izlaist drīkst tikai lietotājs.", JSON.stringify(r));
	// the user skips S3 and lands in S6, the two passed stages recorded
	const after = skipStage(store, "lietotājs izlaiž", "user");
	assert.equal(after.stage, "S6");
	assert.deepEqual(after.profile.changes.filter((c) => /^S[45] izlaista$/.test(c.what)).map((c) => c.what).sort(), ["S4 izlaista", "S5 izlaista"]);
});

test("R46: the user can also set S4 to izlaiž through the handler, with a gate waiting, and skip S4 itself", () => {
	const store = processStore();
	const settings = new AppSettings(tmp(), plainCrypto);
	settings.saveAgentSpecs(IDS.map((i) => spec(i)));
	const h = processHandlers({ registry: { store: () => store } as never, settings, emit: () => undefined });
	assert.equal(h["process.setProfile"]("BD999", { why: "lietotājs", depth: { S4: "izlaiž" } }).profile.depth.S4, "izlaiž");
	writeProcess(store, { ...readProcess(store)!, stage: "S4" }, "user");
	assert.equal(skipStage(store, "lietotājs", "user").stage, "S5");
});

// ---- 2. the lead's cap ---------------------------------------------------------------------------------------------------------------

function handler() {
	const dir = tmp();
	const settings = new AppSettings(dir, plainCrypto);
	return { dir, settings, h: agentHandlers({ settings }) };
}
const many = (n: number, chars: number): AgentSpec[] => Array.from({ length: n }, (_, i) => spec(`ag${String(i).padStart(3, "0")}`, { description: "d".repeat(chars), tools: [] }));
const leadOf = (dir: string, specs: AgentSpec[]) => fixedTokens(null, { appDir: dir, userName: "", specs, skills: [], knowledge: "" }, declarationTokens(null));

test("R49: the lead's roster lists a description at most LEAD_ROSTER_DESC_MAX characters, cut with an ellipsis; a short one stays whole; a specialist's roster is not cut", () => {
	const long = spec("gar", { description: "g".repeat(200) });
	const short = spec("isa", { description: "īss apraksts" });
	const lines = rosterFor(null, [long, short]).split("\n").slice(1);
	assert.equal(lines[0], `- gar: ${"g".repeat(LEAD_ROSTER_DESC_MAX - 1)}…`);
	assert.equal(lines[0].slice(7).length, LEAD_ROSTER_DESC_MAX);
	assert.equal(lines[1], "- isa: īss apraksts");
	assert.equal(rosterText([long]).includes("g".repeat(200)), true, "rosterText without a limit keeps it whole (the delegate list of other callers)");
	// the number drops with the cut
	const withLong = leadOf(tmp(), many(8, 200));
	const cut = standingFor(null, { appDir: tmp(), userName: "", specs: many(8, 200), skills: [], knowledge: "" });
	assert.ok(!cut.includes("d".repeat(121)));
	assert.ok(withLong < fixedTokens(null, { appDir: tmp(), userName: "", specs: many(8, 120), skills: [], knowledge: "" }, declarationTokens(null)) + 1, "200 characters weigh no more than 120");
	// a specialist's own roster keeps its lines whole
	assert.ok(rosterFor(spec("zzz"), [spec("zzz"), long]).includes("g".repeat(200)));
});

test("R49: agents.save refuses a list that pushes the lead past 10 000 tokens, with the number and the advice; one fewer agent saves", () => {
	const { dir, h } = handler();
	// the number of agents at which the lead (measured without skills, as this settings folder has none) crosses the limit
	let k = 1;
	while (leadOf(dir, many(k, 120)) <= LEAD_FIXED_MAX) k++;
	assert.ok(k > 5 && k < 200, `the fixture reaches the limit: ${k}`);
	const n = leadOf(dir, many(k, 120));
	assert.throws(() => h["agents.save"](many(k, 120)), { message: `Galvenā aģenta pastāvīgais konteksts būtu ${n} tokeni (limits ${LEAD_FIXED_MAX}). Saīsini aģentu aprakstus vai noņem kādu aģentu.` });
	assert.equal(h["agents.list"]().shipped, true, "nothing was saved");
	assert.equal(h["agents.save"](many(k - 1, 120)).length, k - 1);
	// descriptions longer than the roster cap cost the lead no more
	assert.equal(leadOf(dir, many(k - 1, 200)), leadOf(dir, many(k - 1, 120)));
});

test("R49: the lead is measured with the synced skills the app really has (0.6 guard's measure): skills push the same limit sooner", () => {
	const dir = tmp();
	const skills = join(tmp(), "skills");
	for (let i = 0; i < 60; i++) {
		mkdirSync(join(skills, `prasme-${i}`), { recursive: true });
		writeFileSync(join(skills, `prasme-${i}`, "SKILL.md"), `---\nname: prasme-${i}\ndescription: ${"s".repeat(100)}\n---\nteksts`, "utf8");
	}
	const settings = new AppSettings(dir, plainCrypto);
	const h = agentHandlers({ settings, skillsDir: skills });
	assert.throws(() => h["agents.save"]([spec("ar", { tools: [] })]), /^Error: Galvenā aģenta pastāvīgais konteksts būtu \d+ tokeni \(limits 10000\)\. Saīsini/);
});

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

test("R48: gate decisions go to the leader's newest open thread, not a new thread each time; a thread is made only when there is none", async () => {
	const r = rig({ gates: [gateRec("H1", "S1")] });
	assert.equal(r.s.listThreads("BD999").filter((t) => t.agent === "bpv").length, 0);
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	const bpv = () => r.s.listThreads("BD999").filter((t) => t.agent === "bpv");
	assert.equal(bpv().length, 1, "one made, as there was none");
	// the next gate: S2 → S3, bpv leads S2 and S3
	writeProcess(r.store, { ...r.state(), gates: [...r.state().gates, gateRec("H2", "S2")] }, "user");
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	assert.equal(r.state().stage, "S3");
	assert.equal(bpv().length, 1, "the second decision came to the same thread");
	const toBpv = r.mail().messages().filter((m) => m.to === "bpv");
	assert.equal(toBpv.length, 2);
	assert.equal(toBpv[0].toThread, toBpv[1].toThread);
	assert.equal(toBpv[0].toThread, bpv()[0].id);
	// a thread the user opened later and newer takes the next one
	await tick(10);
	const mine = r.s.openThread("BD999", "bpv", "Mana saruna");
	writeProcess(r.store, { ...r.state(), gates: [...r.state().gates, gateRec("H3", "S3")] }, "user");
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	assert.equal(bpv().length, 2);
	assert.equal(r.mail().messages().filter((m) => m.to === "bpv").at(-1)!.toThread, mine.id);
});

test("R48: a closed thread of the leader is not reused: the decision makes a new one", async () => {
	const r = rig({ gates: [gateRec("H1", "S1")] });
	const old = r.s.openThread("BD999", "bpv", "Vecā");
	(r.s as unknown as { threads(p: string): { patch(id: string, p: object): unknown } }).threads("BD999").patch(old.id, { state: "closed" });
	r.h["process.gate"]("BD999", { approve: true });
	await r.settle();
	const last = r.mail().messages().filter((m) => m.to === "bpv").at(-1)!;
	assert.notEqual(last.toThread, old.id);
});

test("R48: waitingEksStarts keeps S5's start at the H4 approval: a later gate record or profile change inside S5 does not bring the card back after eks has worked", () => {
	const dir = tmp();
	const open = (p: ProcessState) => writeProcess(ProjectStore.open(dir, { id: "BD1", name: "BD1", root: tmp(), createdAt: "2026-11-16T00:00:00Z" }), p, "user");
	const base = { ...initial("buvprojekts", IDS), stage: "S5" as const, gates: [gateRec("H4", "S4", "approved", { decidedAt: "2026-11-16T10:00:00.000Z" })] };
	open(base);
	const last = "2026-11-16T11:00:00.000Z"; // eks ran after S5 began
	assert.equal(waitingEksStarts(dir, () => last).length, 0);
	// the user changes the profile at 12:00, inside S5
	open({ ...base, profile: { ...base.profile, changes: [{ at: "2026-11-16T12:00:00.000Z", what: "S6 dziļums: pilna → vienkāršota", why: "tests" }] } });
	assert.equal(waitingEksStarts(dir, () => last).length, 0, "a profile change inside S5 is not the start of S5");
	// a returned H5 at 12:30 followed by nothing else: still no card
	open({ ...base, gates: [...base.gates, gateRec("H5", "S5", "returned", { decidedAt: "2026-11-16T12:30:00.000Z" })] });
	assert.equal(waitingEksStarts(dir, () => last).length, 0);
	// S4 skipped by the user at 13:00 puts the start there: an eks thread from before is not "eks has started"
	open({ ...base, gates: [], profile: { ...base.profile, changes: [{ at: "2026-11-16T13:00:00.000Z", what: "S4 izlaista", why: "lietotājs" }] } });
	assert.equal(waitingEksStarts(dir, () => last).length, 1);
	assert.equal(waitingEksStarts(dir, () => "2026-11-16T13:30:00.000Z").length, 0);
});

test("R48: when a run of eks starts, Gaida tevi is sent again and no longer holds the start-eks card", async () => {
	const lists: WaitingItem[][] = [];
	const r = rig({ stage: "S5", gates: [gateRec("H4", "S4", "approved", { decidedAt: "2026-11-16T10:00:00.000Z" })] }, (w) => lists.push(w));
	// eks has a thread from before S5 began, so the card shows
	const t = r.s.openThread("BD999", "eks");
	(r.s as unknown as { threads(p: string): { patch(id: string, p: object): unknown } }).threads("BD999").patch(t.id, { lastAt: "2026-11-16T09:00:00.000Z" });
	assert.equal(r.s.waiting().filter((w) => w.kind === "start-eks").length, 1);
	// inside the run the window must already have been told (not at some later change)
	let told: WaitingItem[] | null = null;
	const n0 = lists.length;
	r.onRun(() => void (told = lists.length > n0 ? lists[lists.length - 1] : null));
	await r.s.sendToThread(t.id, "BD999", "sāc", [], undefined);
	await r.settle();
	assert.ok(told, "onWaiting fired before eks's run began its work");
	assert.equal((told as WaitingItem[]).filter((w) => w.kind === "start-eks").length, 0);
	assert.equal(r.s.waiting().filter((w) => w.kind === "start-eks").length, 0);
});

// ---- 6. Office servers left behind ---------------------------------------------------------------------------------------------------

const proc = (pid: number, cmd: string | null, window = false): OfficeProc => ({ pid, cmd, window });

test("office: only automation servers without a window count, and only the ones that appeared during the job are stopped", () => {
	const procs = [
		proc(100, '"C:\\Office\\WINWORD.EXE" /Automation -Embedding'),
		proc(200, '"C:\\Office\\WINWORD.EXE" /n "C:\\x\\a.docx"'), // a Word the user opened
		proc(300, '"C:\\Office\\WINWORD.EXE" /automation  -embedding'), // case and spacing
		proc(400, '"C:\\Office\\WINWORD.EXE" /Automation -Embedding', true), // has a window
		proc(500, null), // command line not readable
		proc(0, "/Automation -Embedding"),
	];
	assert.deepEqual([...automationPids(procs)].sort(), [100, 300]);
	assert.deepEqual(pidsToStop(new Set([100]), new Set([100, 300, 700])), [300, 700]);
	assert.deepEqual(pidsToStop(new Set([100, 300]), new Set([100, 300])), []);
	assert.deepEqual(pidsToStop(new Set(), new Set()), []);
	assert.deepEqual(pidsToStop(new Set([100, 300]), new Set([300])), [], "one that went by itself is not stopped");
});

function fakeIO(snapshots: (number[] | null)[]) {
	const stopped: number[][] = [];
	let i = 0;
	const io: OfficeProcIO = {
		list: async () => {
			const snap = snapshots[i++];
			return snap ? new Set(snap) : null;
		},
		stop: (p) => void stopped.push([...p]),
	};
	return { io, stopped };
}

test("office: a failed job stops the new servers, a good one stops nothing, one that threw is cleaned and rethrown, an unreadable list stops nothing", async () => {
	const failed = (r: { ok: boolean }) => !r.ok;
	let f = fakeIO([[10], [10, 11, 12]]);
	assert.deepEqual(await withOfficeCleanup("WINWORD.EXE", async () => ({ ok: false }), failed, f.io), { ok: false });
	assert.deepEqual(f.stopped, [[11, 12]], "the one from before (10) stays");
	f = fakeIO([[10], [10, 11]]);
	await withOfficeCleanup("WINWORD.EXE", async () => ({ ok: true }), failed, f.io);
	assert.deepEqual(f.stopped, [], "success: no second look");
	f = fakeIO([[], [20]]);
	await assert.rejects(withOfficeCleanup("EXCEL.EXE", async () => Promise.reject(new Error("boom")), failed, f.io), { message: "boom" });
	assert.deepEqual(f.stopped, [[20]]);
	f = fakeIO([null, [30]]);
	await withOfficeCleanup("WINWORD.EXE", async () => ({ ok: false }), failed, f.io);
	assert.deepEqual(f.stopped, [], "no list before the job: nobody can tell which are new");
	f = fakeIO([[1], null]);
	await withOfficeCleanup("WINWORD.EXE", async () => ({ ok: false }), failed, f.io);
	assert.deepEqual(f.stopped, []);
});

test("office: jobs run one at a time, so a failed job's cleanup cannot stop the server of one beside it", async () => {
	const order: string[] = [];
	const io: OfficeProcIO = { list: async () => new Set<number>(), stop: () => undefined };
	const job = (name: string, ms: number) => withOfficeCleanup("WINWORD.EXE", async () => (order.push(`${name}+`), await tick(ms), order.push(`${name}-`), { ok: true }), (r) => !r.ok, io);
	await Promise.all([job("a", 30), job("b", 1)]);
	assert.deepEqual(order, ["a+", "a-", "b+", "b-"]);
});
