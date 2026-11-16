// 14.1 the process as data and a pure state machine: stages S1–S7, gates H1–H7, the depth table, returns, the iteration limit, the H5 fork, the S6 re-check.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ProcessEvent, type ProcessState, initial, reviewScope, step } from "../src/core/process.ts";
import { DEFAULT_DEPTH, GATE_OF, LEADER, MAX_ITERATIONS, STAGES, STAGE_CARD, type Stage } from "../src/core/process-def.ts";

const T = (n: number) => `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`;
let clock = 0;
const at = () => T(clock++ % 60);

/** Applies the events in order; any refusal fails the test with its text. */
function run(s: ProcessState, ...events: ProcessEvent[]): ProcessState {
	for (const e of events) {
		const r = step(s, e);
		assert.ok(r.ok, r.ok ? "" : `${e.type}: ${r.error}`);
		s = r.state;
	}
	return s;
}
const refused = (s: ProcessState, e: ProcessEvent): string => {
	const r = step(s, e);
	assert.equal(r.ok, false, `${e.type} should be refused`);
	return r.ok ? "" : r.error;
};
const request = (n = "n1"): ProcessEvent => ({ type: "gate.request", noteId: n, at: at() });
const approve = (extra: { fix?: string[]; comment?: string } = {}): ProcessEvent => ({ type: "gate.approve", at: at(), ...extra });
const ret = (comment = "labot"): ProcessEvent => ({ type: "gate.return", at: at(), comment });

test("the definitions: gates, leaders and the depth table cell for cell", () => {
	assert.deepEqual([...STAGES], ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
	STAGES.forEach((st, i) => assert.equal(GATE_OF[st], `H${i + 1}`));
	assert.equal(LEADER.S5, "eks");
	for (const st of STAGES.filter((x) => x !== "S5")) assert.equal(LEADER[st], "bpv");
	assert.equal(MAX_ITERATIONS, 3);
	for (const st of STAGES) assert.equal(DEFAULT_DEPTH.buvprojekts[st], "pilna");
	assert.deepEqual(DEFAULT_DEPTH["paskaidrojuma-raksts"], { S1: "pilna", S2: "pēc vajadzības", S3: "vienkāršota", S4: "vienkāršota", S5: "vienkāršota", S6: "pilna", S7: "pilna" });
	assert.deepEqual(DEFAULT_DEPTH.pazinojums, { S1: "vienkāršota", S2: "izlaiž", S3: "izlaiž", S4: "vienkāršota", S5: "vienkāršota", S6: "pilna", S7: "pilna" });
});

test("initial: process mode at S1 with the profile copied from the table", () => {
	const s = initial("pazinojums", ["bpv", "ar"]);
	assert.equal(s.mode, "process");
	assert.equal(s.stage, "S1");
	assert.deepEqual(s.profile.agents, ["bpv", "ar"]);
	assert.deepEqual(s.profile.depth, DEFAULT_DEPTH.pazinojums);
	assert.notEqual(s.profile.depth, DEFAULT_DEPTH.pazinojums, "a copy, so a profile change cannot edit the table");
	assert.equal(s.gates.length, 0);
	assert.equal(s.escalated, null);
	assert.equal(s.reviewed, false);
});

test("happy path for a būvprojekts: S1 .. H7 .. mācības .. done, input never mutated", () => {
	let s = initial("buvprojekts", ["bpv"]);
	const first = s;
	const frozen = JSON.stringify(first);
	for (const [i, st] of STAGES.entries()) {
		assert.equal(s.stage, st);
		if (st === "S6") s = run(s, { type: "review.done", at: at() });
		s = run(s, request(`n${i}`));
		assert.equal(s.gates.at(-1)?.id, GATE_OF[st]);
		assert.equal(s.gates.at(-1)?.state, "waiting");
		s = run(s, st === "S5" ? approve({ fix: ["r1"] }) : approve());
		// S5 with fix goes to S6; S6 goes to S7: the seven stages are walked in order
	}
	assert.equal(s.stage, "mācības");
	s = run(s, { type: "learned", at: at() });
	assert.equal(s.stage, "done");
	assert.equal(JSON.stringify(first), frozen);
	assert.ok(s.gates.every((g) => g.state === "approved" && g.decidedAt));
	assert.equal(s.profile.changes.length, 0);
});

test("a gate waits once, and approve or return need a waiting gate", () => {
	let s = initial("buvprojekts", []);
	assert.match(refused(s, approve()), /nav gaidoša gate/);
	assert.match(refused(s, ret()), /nav gaidoša gate/);
	s = run(s, request());
	assert.equal(refused(s, request("n2")), "Gate jau gaida lēmumu.");
	assert.match(refused(s, ret("")), /komentār/);
});

test("pazinojums skips S2 and S3 and says why in the profile", () => {
	let s = initial("pazinojums", []);
	s = run(s, request(), approve());
	assert.equal(s.stage, "S4");
	assert.deepEqual(
		s.profile.changes.map((c) => [c.what, c.why]),
		[
			["S2 izlaista", "izlaists pēc profila"],
			["S3 izlaista", "izlaists pēc profila"],
		],
	);
	// the state moved on without a gate for the skipped ones
	assert.deepEqual(s.gates.map((g) => g.id), ["H1"]);
});

test("H5: no remarks to fix goes to S7, remarks to fix go to S6", () => {
	const toS5 = () => {
		let s = initial("buvprojekts", []);
		for (let i = 0; i < 4; i++) s = run(s, request(), approve());
		assert.equal(s.stage, "S5");
		return s;
	};
	const none = run(toS5(), request(), approve());
	assert.equal(none.stage, "S7");
	const empty = run(toS5(), request(), approve({ fix: [] }));
	assert.equal(empty.stage, "S7");
	const some = run(toS5(), request(), approve({ fix: ["r1", "r2"] }));
	assert.equal(some.stage, "S6");
	assert.deepEqual(some.gates.at(-1)?.fix, ["r1", "r2"]);
	assert.equal(some.reviewed, false);
});

test("S6: the gate needs the re-check; H6 goes to S7", () => {
	let s = initial("buvprojekts", []);
	for (let i = 0; i < 4; i++) s = run(s, request(), approve());
	s = run(s, request(), approve({ fix: ["r1"] }));
	assert.equal(s.stage, "S6");
	assert.match(refused(s, request()), /review\.done/);
	assert.match(refused(initial("buvprojekts", []), { type: "review.done", at: at() }), /S6/);
	s = run(s, { type: "review.done", at: at() });
	assert.equal(s.reviewed, true);
	s = run(s, request(), approve());
	assert.equal(s.stage, "S7");
	assert.equal(s.reviewed, false);
});

test("a returned gate keeps the stage, counts the iteration and clears the re-check; the fourth return escalates", () => {
	let s = initial("buvprojekts", []);
	for (let i = 0; i < 3; i++) s = run(s, request(), ret(`atgriezts ${i}`));
	assert.equal(s.stage, "S1");
	assert.equal(s.iteration.S1, 3);
	assert.equal(s.escalated, null);
	assert.deepEqual(s.gates.map((g) => g.state), ["returned", "returned", "returned"]);
	assert.deepEqual(s.gates.map((g) => g.iteration), [1, 2, 3]);
	assert.equal(s.gates[0].comment, "atgriezts 0");
	s = run(s, request(), ret("vēl"));
	assert.equal(s.escalated, "S1");
	assert.equal(refused(s, request()), "Stadija S1 eskalēta cilvēkam: pārsniegts iterāciju limits.");
});

test("an escalated stage is cleared when the user approves", () => {
	let s = initial("buvprojekts", []);
	for (let i = 0; i < 4; i++) s = run(s, request(), ret());
	assert.equal(s.escalated, "S1");
	s = run(s, approve({ comment: "lemju es" }));
	assert.equal(s.escalated, null);
	assert.equal(s.stage, "S2");
	assert.equal(s.gates.at(-1)?.state, "approved");
	// the new stage starts clean
	s = run(s, request());
	assert.equal(s.gates.at(-1)?.stage, "S2");
});

test("a return in S6 clears the re-check", () => {
	let s = initial("buvprojekts", []);
	for (let i = 0; i < 4; i++) s = run(s, request(), approve());
	s = run(s, request(), approve({ fix: ["r1"] }), { type: "review.done", at: at() }, request(), ret());
	assert.equal(s.stage, "S6");
	assert.equal(s.reviewed, false);
	assert.match(refused(s, request()), /review\.done/);
});

test("stage.skip: S6 and S7 refused, others move on and record the reason", () => {
	let s = initial("buvprojekts", []);
	s = run(s, { type: "stage.skip", why: "vienkāršs projekts", at: at() });
	assert.equal(s.stage, "S2");
	assert.deepEqual(s.profile.changes.map((c) => [c.what, c.why]), [["S1 izlaista", "vienkāršs projekts"]]);
	assert.match(refused(s, { type: "stage.skip", why: "", at: at() }), /pamatojum/);
	const atStage = (st: Stage): ProcessState => ({ ...s, stage: st });
	assert.equal(refused(atStage("S6"), { type: "stage.skip", why: "x", at: at() }), "S6 nedrīkst izlaist.");
	assert.equal(refused(atStage("S7"), { type: "stage.skip", why: "x", at: at() }), "S7 nedrīkst izlaist.");
	const waiting = run(s, request());
	assert.equal(refused(waiting, { type: "stage.skip", why: "x", at: at() }), "Gate jau gaida lēmumu.");
});

test("change: basic in S4 returns to S3, otherwise the stage stays", () => {
	let s = initial("buvprojekts", []);
	for (let i = 0; i < 3; i++) s = run(s, request(), approve());
	assert.equal(s.stage, "S4");
	assert.equal(run(s, { type: "change", basic: false, at: at() }).stage, "S4");
	const back = run(s, { type: "change", basic: true, at: at() });
	assert.equal(back.stage, "S3");
	// a gate waiting in S4 is not left dangling
	const waiting = run(s, request());
	const moved = run(waiting, { type: "change", basic: true, at: at() });
	assert.equal(moved.stage, "S3");
	assert.equal(moved.gates.at(-1)?.state, "returned");
	assert.equal(run(initial("buvprojekts", []), { type: "change", basic: true, at: at() }).stage, "S1");
});

test("learned only after H7; nothing moves a finished process; co-work refuses every event", () => {
	let s = initial("buvprojekts", []);
	assert.match(refused(s, { type: "learned", at: at() }), /Mācības/);
	for (let i = 0; i < 7; i++) {
		if (s.stage === "S6") s = run(s, { type: "review.done", at: at() });
		s = run(s, request(), approve(s.stage === "S5" ? { fix: ["r"] } : {}));
	}
	s = run(s, { type: "learned", at: at() });
	assert.equal(s.stage, "done");
	assert.ok(!step(s, request()).ok);
	const cowork: ProcessState = { ...initial("buvprojekts", []), mode: "cowork" };
	for (const e of [request(), approve(), ret(), { type: "stage.skip", why: "x", at: at() }, { type: "review.done", at: at() }, { type: "change", basic: true, at: at() }, { type: "learned", at: at() }] as ProcessEvent[]) {
		assert.equal(refused(cowork, e), "Procesa režīms nav ieslēgts.");
	}
});

test("reviewScope: the share of changed documents decides, above 10% is a full re-check", () => {
	const all = Array.from({ length: 10 }, (_, i) => `d${i}`);
	assert.deepEqual(reviewScope(["d0"], all), { mode: "partial", share: 0.1 });
	assert.deepEqual(reviewScope(["d0", "d1"], all), { mode: "full", share: 0.2 });
	assert.equal(reviewScope(["d0", "d0"], all).share, 0.1, "the same document twice counts once");
	assert.deepEqual(reviewScope([], all), { mode: "partial", share: 0 });
	assert.equal(reviewScope(["x"], []).mode, "full");
});

test("every stage card has a goal, an action, outputs and a gate text, and stays short", () => {
	for (const st of STAGES) {
		const c = STAGE_CARD[st];
		assert.ok(c.title.includes(st), `${st} title names the stage`);
		assert.ok(c.goal.length > 10 && c.involved.length > 5 && c.gate.length > 10);
		assert.ok(c.actions.length >= 3 && c.actions.length <= 6, `${st} actions`);
		assert.ok(c.output.length >= 1);
		const size = [c.title, c.goal, c.involved, c.gate, ...c.actions, ...c.output].join(" ").length;
		assert.ok(size < 800, `${st} card is ${size} characters`);
	}
});
