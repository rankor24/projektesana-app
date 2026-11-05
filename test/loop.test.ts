import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { readLog } from "../src/kernel/log.ts";
import { addPin, loadReview, setReviewState } from "../src/kernel/pins.ts";
import { runAgentBatch, publishApproved, captureRevision, nextRevisionId, type BatchDeps } from "../src/main/loop/revision.ts";
import { buildPrompt, PROMPT_MAX } from "../src/main/loop/prompt.ts";
import * as tools from "../src/mcp/tools.ts";
import { fakeRevit, G2 } from "./helpers.ts";
import type { Engine } from "../src/main/engines/types.ts";
import type { McpLaunch } from "../src/main/engines/types.ts";

const dataDir = join(import.meta.dirname, "..", "data");
const launch: McpLaunch = { command: "x", args: [], env: {}, tools: [] };

function setup() {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	const workPath = join(root, "A_WORK.rvt");
	writeFileSync(workPath, "rvt-bytes");
	const state = { exports: 0 };
	return { root, workPath, state, revit: fakeRevit({ workPath, state }) };
}

/** An engine that behaves like an agent: calls our tool server's functions in-process. */
function fakeEngine(root: string, finish: boolean): Engine {
	return {
		id: "claude",
		async status() {
			return { id: "claude", ready: true, reason: "", canLogin: false };
		},
		async run(o) {
			o.onEvent({ type: "tool", name: "mcp__revit__create_level", detail: "{}" });
			if (finish) await tools.finishRevision({ root, engine: "claude", dataDir, revision: nextId(root) }, "sketch done");
			o.onEvent({ type: "done", text: "ok" });
		},
	};
}
// the revision id the batch is using = the highest existing r<N> directory
function nextId(root: string) {
	const d = join(root, ".bv", "revisions");
	return readdirSync(d).filter((x) => /^r\d+$/.test(x)).sort().pop()!;
}

const deps = (s: ReturnType<typeof setup>, finish = true): BatchDeps => ({ root: s.root, engine: fakeEngine(s.root, finish), revit: s.revit, workPath: s.workPath, mcp: { revit: launch, tools: () => launch }, instruction: "sketch", signal: new AbortController().signal, onEvent: () => {} });

test("a batch becomes a revision: PDFs for plan and elevation (not 3D), IFC, summary, review items all `new`", async () => {
	const s = setup();
	const r = await runAgentBatch(deps(s));
	assert.equal(r.ok, true);
	if (!r.ok) return;
	assert.deepEqual(r.manifest.pages.map((p) => p.file), ["1. stāvs.pdf", "Fasāde A.pdf"]);
	const dir = join(s.root, ".bv", "revisions", "r1");
	for (const f of ["1. stāvs.pdf", "Fasāde A.pdf", "model.ifc", "summary.json", "geometry.json", "manifest.json", "transcript.jsonl"]) assert.ok(existsSync(join(dir, f)), f);
	assert.deepEqual(loadReview(s.root, "r1").map((x) => x.state), ["new", "new", "new"]);
	const geo = JSON.parse(readFileSync(join(dir, "geometry.json"), "utf8"));
	assert.ok(Math.abs(geo["1. stāvs.pdf"].pageRect.x0 - 100 / 600) < 1e-3);
	assert.ok(existsSync(join(s.root, "snapshots", "A_WORK_before_r1.rvt")));
	assert.equal(readFileSync(s.workPath, "utf8"), "rvt-bytes");
	const kinds = readLog(s.root).entries.map((e) => e.kind);
	for (const k of ["agent.run", "agent.revit", "agent.tool", "revision.created", "snapshot.created"]) assert.ok(kinds.includes(k), k);
});

test("an agent that never calls finish_revision produces no revision", async () => {
	const s = setup();
	const r = await runAgentBatch(deps(s, false));
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.reason, /finish_revision/);
	assert.ok(!existsSync(join(s.root, ".bv", "revisions", "r1", "manifest.json")));
});

test("wrong active Revit document stops the batch before the agent runs", async () => {
	const s = setup();
	const d = deps(s);
	let ran = false;
	d.engine = { ...d.engine, run: async () => void (ran = true) };
	d.workPath = join(s.root, "Other_WORK.rvt");
	writeFileSync(d.workPath, "x");
	const r = await runAgentBatch(d);
	assert.equal(r.ok, false);
	assert.equal(ran, false);
});

test("revision 2 shows the difference against revision 1 (added door, moved wall, room area)", async () => {
	const s = setup();
	await runAgentBatch(deps(s));
	const r2 = await runAgentBatch(deps(s));
	assert.equal(r2.ok, true);
	const diff = JSON.parse(readFileSync(join(s.root, ".bv", "revisions", "r2", "diff.json"), "utf8"));
	assert.equal(diff.against, "r1");
	assert.deepEqual(diff.ifc.added.map((x: { guid: string }) => x.guid), [G2]);
	assert.equal(diff.ifc.moved.length, 1);
	assert.equal(diff.rooms.areaChanged[0].to, 22);
	assert.equal(nextRevisionId(s.root), "r3");
});

test("open pins go into the prompt before the long rules text, and the prompt is capped", () => {
	const s = setup();
	const pin = addPin(s.root, "r1", { kind: "pdf", sheet: "a.pdf", page: 1, x: 0.5, y: 0.5, viewId: 11 }, "pārbīdi kāpnes");
	const p = buildPrompt({ instruction: "labo", brief: { facts: {}, engine: {} }, pins: [pin], rulesJson: "R".repeat(PROMPT_MAX * 2) });
	assert.ok(p.indexOf("pārbīdi kāpnes") < p.indexOf("RRRR"));
	assert.ok(p.indexOf("Noteikumi") < p.indexOf("pārbīdi kāpnes"));
	assert.equal(p.length, PROMPT_MAX);
});

test("publishApproved refuses until everything is approved, then copies without overwriting", async () => {
	const s = setup();
	await runAgentBatch(deps(s));
	await assert.rejects(publishApproved(s.root, "r1"), /nav pilnībā apstiprināta/);
	for (const it of loadReview(s.root, "r1")) setReviewState(s.root, "r1", it.item, "approved");
	const out = await publishApproved(s.root, "r1", { revit: s.revit, workPath: s.workPath });
	assert.deepEqual(readdirSync(out).sort(), ["1. stāvs.pdf", "A_r1.rvt", "Fasāde A.pdf", "model.ifc"]);
	await assert.rejects(publishApproved(s.root, "r1"), /EEXIST/);
});

test("capture fails loudly when Revit wrote no file", async () => {
	const s = setup();
	const revit = { call: async (t: string, a: Record<string, unknown>) => (String(a.code ?? "").includes("PDFExportOptions") ? `Result: ${JSON.stringify({ Success: true, Result: "true" })}` : s.revit.call(t, a)) };
	await assert.rejects(captureRevision({ root: s.root, revit, id: "r1", workPath: s.workPath }), /neizveidoja/);
});
