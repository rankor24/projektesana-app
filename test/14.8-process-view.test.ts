// 14.8 Process UI: the pure helpers the strip and the profile editor use. The components themselves are typechecked and built only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type ProcessState, initial, step } from "../src/core/process.ts";
import { DEFAULT_DEPTH } from "../src/core/process-def.ts";
import { depthChoices, depthOfDocType, gateStage, profilePatch, stripModel } from "../src/shared/process-view.ts";

const AT = "2026-01-01T10:00:00.000Z";
const ok = (s: ProcessState, e: Parameters<typeof step>[1]): ProcessState => {
	const r = step(s, e);
	assert.ok(r.ok, r.ok ? "" : r.error);
	return r.state;
};
const states = (s: ProcessState) => stripModel(s).stages.map((x) => x.state);

test("14.8 strip: a fresh process has S1 on and six to come", () => {
	const m = stripModel(initial("buvprojekts", ["bpv", "ar"]));
	assert.equal(m.current, "S1");
	assert.deepEqual(states(initial("buvprojekts", ["bpv"])), ["current", "todo", "todo", "todo", "todo", "todo", "todo"]);
	assert.equal(m.stages.length, 7);
	assert.equal(m.gate, null);
	assert.deepEqual(m.iteration, { n: 1, of: 3 }, "the first pass");
	assert.equal(m.escalated, null);
});

test("14.8 strip: a waiting gate is named, an approved one ticks its stage, a skipped stage is dimmed", () => {
	let s = initial("pazinojums", ["bpv"]); // S2 and S3 default to izlaiž
	s = ok(s, { type: "gate.request", noteId: "n1", at: AT });
	assert.equal(stripModel(s).gate, "H1");
	s = ok(s, { type: "gate.approve", at: AT });
	const m = stripModel(s);
	assert.equal(m.current, "S4", "S2 and S3 are passed over by the profile");
	assert.deepEqual(m.stages.map((x) => x.state), ["done", "skipped", "skipped", "current", "todo", "todo", "todo"]);
	assert.equal(m.gate, null, "the approved gate no longer waits");
});

test("14.8 strip: the iteration counts returns and escalation shows", () => {
	let s = initial("buvprojekts", ["bpv"]);
	for (let i = 0; i < 4; i++) {
		s = ok(s, { type: "gate.request", noteId: `n${i}`, at: AT });
		s = ok(s, { type: "gate.return", at: AT, comment: "vēlreiz" });
		const m = stripModel(s);
		assert.deepEqual(m.iteration, { n: i + 2, of: 3 }, "passes: returns so far + 1");
	}
	assert.equal(stripModel(s).escalated, "S1", "the fourth return goes to the human");
});

test("14.8 strip: a finished process has no current stage", () => {
	let s = initial("buvprojekts", ["bpv"]);
	for (let i = 0; s.stage !== "mācības"; i++) {
		s = ok(s, { type: "gate.request", noteId: `n${i}`, at: AT });
		s = ok(s, { type: "gate.approve", at: AT });
	}
	assert.equal(stripModel(s).current, null);
	// H5 with nothing to fix goes straight to S7: S6 had no gate, so it shows as passed over
	assert.deepEqual(states(s), ["done", "done", "done", "done", "done", "skipped", "done"]);
});

test("14.8 strip: a basic client change sends S4 back to S3, which is on again", () => {
	let s = initial("buvprojekts", ["bpv"]);
	for (let i = 0; i < 3; i++) {
		s = ok(s, { type: "gate.request", noteId: `n${i}`, at: AT });
		s = ok(s, { type: "gate.approve", at: AT });
	}
	assert.equal(s.stage, "S4");
	s = ok(s, { type: "change", basic: true, at: AT });
	assert.deepEqual(states(s), ["done", "done", "current", "todo", "todo", "todo", "todo"]);
});

test("14.8 gateStage and depthChoices", () => {
	assert.equal(gateStage("H5"), "S5");
	assert.equal(gateStage("g1"), null);
	assert.ok(depthChoices("S2").includes("izlaiž"));
	assert.ok(!depthChoices("S6").includes("izlaiž"));
	assert.ok(!depthChoices("S7").includes("izlaiž"));
});

test("14.8 profilePatch: only differences, bpv kept, null when nothing moved", () => {
	const s = initial("buvprojekts", ["bpv", "ar", "bk"]);
	const same = { docType: s.docType, depth: { ...s.profile.depth }, agents: [...s.profile.agents], why: "x" };
	assert.equal(profilePatch(s, same), null);
	assert.deepEqual(profilePatch(s, { ...same, depth: { ...same.depth, S2: "izlaiž" }, why: " vienkāršs " }), { why: "vienkāršs", depth: { S2: "izlaiž" } });
	assert.deepEqual(profilePatch(s, { ...same, agents: ["ar"] })?.agents, ["bpv", "ar"], "bpv cannot be unticked");
	// a cell put back to its old value after a type change must be sent: the new type's default would otherwise win in main
	const back = profilePatch(s, { docType: "pazinojums", depth: { ...depthOfDocType("pazinojums"), S2: "pilna" }, agents: [...s.profile.agents], why: "x" });
	assert.equal(back?.depth?.S2, "pilna");
	assert.equal(Object.keys(back?.depth ?? {}).length, 1, "only the cell that differs from the new type's row");
	const p = profilePatch(s, { docType: "pazinojums", depth: depthOfDocType("pazinojums"), agents: [...s.profile.agents], why: "mazs darbs" });
	assert.equal(p?.docType, "pazinojums");
	assert.equal(p?.depth, undefined, "the new type's own row is main's to apply, nothing extra is sent");
	assert.equal(DEFAULT_DEPTH.pazinojums.S2, "izlaiž");
});
