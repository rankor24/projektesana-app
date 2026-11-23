// Who may write to whom by default (shared/departments.ts mayReach): own department + BPV; EKS reports to the human; UD reaches every department;
// the lists the user sets still decide (a list that leaves the other out closes it, one that names it opens it); the lead is open; an unknown department fails closed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canSend } from "../src/core/messages.ts";
import { DEFAULT_LIMITS } from "../src/shared/thread-types.ts";
import { mayReach, bpvManages, type ReachSpec } from "../src/shared/departments.ts";

const s = (id: string, extra: Partial<ReachSpec> = {}): ReachSpec => ({ id, ...extra });
const team: ReachSpec[] = ["bpv", "ar", "bk", "uk", "avk", "ud", "eks", "dokumenti", "parbaude"].map((id) => s(id));
const ok = (from: string, to: string, specs: readonly ReachSpec[] = team) => mayReach(from, to, specs).ok;

test("reach by department: own department and BPV, EKS apart, UD to all, lists decide, unknown department fails closed", () => {
	// the default: the same department, BPV both ways, UD to everybody, nobody opens a topic with EKS, EKS writes to authors but not to BPV
	assert.equal(ok("uk", "avk"), true);
	assert.equal(ok("ar", "bk"), false, "another department: not by default");
	assert.equal(ok("ar", "bpv"), true);
	assert.equal(ok("bpv", "bk"), true);
	assert.equal(ok("ud", "bk"), true);
	assert.equal(ok("bk", "ud"), false, "UD reaches every department; the others do not reach it unasked");
	assert.equal(ok("bpv", "eks"), false);
	assert.equal(ok("ar", "eks"), false);
	assert.equal(ok("eks", "ar"), true);
	assert.equal(ok("eks", "bpv"), false, "EKS reports to the human, not under BPV");
	// agents in no department are one group (a team that never set departments works as before), apart from the filed ones
	assert.equal(ok("dokumenti", "parbaude"), true);
	assert.equal(ok("dokumenti", "ar"), false);
	// the lead is the user's own agent: open both ways
	assert.equal(ok("lead", "bk"), true);
	assert.equal(ok("bk", "lead"), true);
	// a list the user set: naming the other opens it across departments, leaving it out closes it (exclusion wins over a grant on the other side)
	assert.equal(ok("ar", "bk", [s("ar", { mayMessage: ["bk"] }), s("bk")]), true);
	assert.equal(ok("ar", "bk", [s("ar"), s("bk", { acceptsFrom: ["ar"] })]), true);
	assert.equal(ok("uk", "avk", [s("uk", { mayMessage: ["bpv"] }), s("avk")]), false);
	assert.equal(ok("ar", "bk", [s("ar", { mayMessage: ["bk"] }), s("bk", { acceptsFrom: ["bpv"] })]), false);
	// a department an agent was filed in by hand: its own, so only its own members, BPV and UD reach it
	const filed = [s("ar", { department: "x-missing" }), s("bk", { department: "x-missing" }), s("uk")];
	assert.equal(ok("ar", "bk", filed), true);
	assert.equal(ok("ar", "uk", filed), false);
	// ... and "" takes an agent out of the department its id would default to
	assert.equal(ok("avk", "uk", [s("avk", { department: "" }), s("uk")]), false);
	// BPV's authority: every department but Kvalitāte
	assert.equal(bpvManages(s("ar")), true);
	assert.equal(bpvManages(s("eks")), false);
	assert.equal(bpvManages(s("ar", { department: "kvalitate" })), false);

	// the send rule uses it, and says why
	const c = { agents: team as never, limits: DEFAULT_LIMITS, messages: [] };
	const no = canSend({ from: "ar", to: "bk", kind: "ask", topic: null, depth: 1 }, c);
	assert.equal(no.ok, false);
	assert.equal(!no.ok && no.code, "acl");
	assert.match(!no.ok ? no.reason : "", /Arhitektūra/);
	assert.equal(canSend({ from: "ar", to: "bpv", kind: "ask", topic: null, depth: 1 }, c).ok, true);
});
