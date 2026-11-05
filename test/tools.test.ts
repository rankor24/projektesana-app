import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { registerFile } from "../src/kernel/files.ts";
import { addPin, loadPins, setReviewState, initReview, loadReview, revisionComplete, pinToModel, closePin, type ViewGeometry } from "../src/kernel/pins.ts";
import { readLog } from "../src/kernel/log.ts";
import * as t from "../src/mcp/tools.ts";
import { appendChat } from "../src/main/chat/brief.ts";
import { MODEL_TOOLS, SETUP_TOOLS } from "../src/main/engines/types.ts";

const dataDir = join(import.meta.dirname, "..", "data");

function proj() {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	writeFileSync(join(root, "PU.txt"), "Objekts: Duntes iela 8");
	registerFile(root, "PU.txt", "PU");
	return { root, ctx: { root, engine: "claude", dataDir, revision: "r1" } satisfies t.ToolCtx };
}

test("no agent tool can approve or write a source", () => {
	for (const n of [...MODEL_TOOLS, ...SETUP_TOOLS]) assert.ok(!/approve|delete|write|overwrite/i.test(n), n);
});

test("read_doc reads a registered project file and refuses paths outside it", async () => {
	const { ctx } = proj();
	assert.match(await t.readDoc(ctx, "PU.txt"), /Duntes/);
	await assert.rejects(t.readDoc(ctx, "..\\..\\Windows\\win.ini"), /Ārpus projekta/);
});

test("every tool call is logged, failures too", async () => {
	const { root, ctx } = proj();
	await t.listFiles(ctx);
	await assert.rejects(t.readDoc(ctx, "..\\x.txt"));
	const calls = readLog(root).entries.filter((e) => e.kind === "agent.tool");
	assert.equal(calls.length, 2);
	assert.equal((calls[1].data as { ok: boolean }).ok, false);
});

test("rules_for_stage refuses before the brief has work and use, then cites articles", async () => {
	const { root, ctx } = proj();
	await assert.rejects(t.rulesForStage(ctx, "mbp"), /Brief nav pabeigts/);
	appendChat(root, "boris", "jauna publiska ēka 3 stāvi 2500 m2");
	const at = new Date().toISOString();
	for (const [id, v, q] of [["engine.work", "new_build", "jauna publiska ēka"], ["engine.use", "public", "jauna publiska ēka"], ["engine.floorsAbove", "3", "3 stāvi"], ["engine.totalAreaM2", "2500", "2500 m2"]] as const)
		await t.setFactTool(ctx, id, v, { kind: "boris", quote: q, at });
	const r = (await t.rulesForStage(ctx, "mbp")) as { group: { value: number; rules: { quote: string }[] }; procedure: { value: string }; content: { items: unknown[] } };
	assert.equal(r.group.value, 3);
	assert.equal(r.procedure.value, "mbp_buvatlauja");
	assert.ok(r.group.rules[0].quote.length > 0);
	assert.ok(r.content.items.length >= 5);
});

test("agent can address a pin but not close it; finish_revision hands over without approving", async () => {
	const { root, ctx } = proj();
	const pin = addPin(root, "r1", { kind: "pdf", sheet: "A-101.pdf", page: 1, x: 0.4, y: 0.5, viewId: 11 }, "pārbīdi kāpnes 2 m uz austrumiem");
	assert.equal((await t.listOpenPins(ctx)).length, 1);
	const p = await t.resolvePin(ctx, pin.id, "pārbīdīju par 2000 mm");
	assert.equal(p.state, "addressed");
	assert.equal((await t.listOpenPins(ctx)).length, 0);
	assert.equal(loadPins(root)[0].state, "addressed");
	closePin(root, pin.id);
	await assert.rejects(t.resolvePin(ctx, pin.id, "vēlreiz"), /aizvērts/);
	await t.finishRevision(ctx, "pirmā skice");
	assert.ok(existsSync(join(root, ".bv", "revisions", "r1", "agent-done.json")));
});

test("pins outside the page are refused", () => {
	const { root } = proj();
	assert.throws(() => addPin(root, "r1", { kind: "pdf", sheet: "a.pdf", page: 1, x: 1.2, y: 0.5, viewId: null }, "x"), /ārpus lapas/);
	assert.throws(() => addPin(root, "r1", { kind: "ifc", guid: "g" }, "  "), /tukša/);
});

test("approval is per item; the revision is complete only when all are approved", () => {
	const { root } = proj();
	initReview(root, "r1", [{ item: "A-101.pdf", kind: "page" }, { item: "model.ifc", kind: "model" }]);
	setReviewState(root, "r1", "A-101.pdf", "approved");
	assert.equal(revisionComplete(loadReview(root, "r1")), false);
	setReviewState(root, "r1", "model.ifc", "approved");
	assert.equal(revisionComplete(loadReview(root, "r1")), true);
	assert.equal(readLog(root).entries.filter((e) => e.kind === "page.approved").length, 2);
	assert.throws(() => setReviewState(root, "r1", "nope.pdf", "approved"));
});

test("pin → model coordinates through crop box, page rectangle and view transform", () => {
	const g: ViewGeometry = {
		viewId: 11, viewName: "1. stāvs", levelName: "L1", elevationMm: 0, scale: 100,
		cropMin: [0, 0], cropMax: [10000, 5000],
		origin: [1000, 2000, 0], right: [1, 0, 0], up: [0, 1, 0],
		pageRect: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
	};
	const pin = addPin(proj().root, "r1", { kind: "pdf", sheet: "a.pdf", page: 1, x: 0.5, y: 0.5, viewId: 11 }, "centrs");
	assert.deepEqual(pinToModel(pin, g), { x: 6000, y: 4500, z: 0, levelName: "L1" });
	const topLeft = { ...pin, target: { ...pin.target, x: 0.1, y: 0.1 } } as typeof pin;
	assert.deepEqual(pinToModel(topLeft, g), { x: 1000, y: 7000, z: 0, levelName: "L1" });
	const outside = { ...pin, target: { ...pin.target, x: 0.02, y: 0.5 } } as typeof pin;
	assert.throws(() => pinToModel(outside, g), /ārpus skata/);
});
