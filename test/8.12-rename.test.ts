// 8.12 renamer: the plan rules (pure), renaming inside a draft's staging folder, taking a batch back, the 8.7 undo list, and the
// `filenames` check on a draft before and after. Invented project and file names only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { prepareDelivery } from "../src/checks/gate.ts";
import { registerAppChecks } from "../src/checks/index.ts";
import { runChecks } from "../src/checks/run.ts";
import { listCheckpoints, trackCreated } from "../src/core/checkpoints.ts";
import { inToolScope } from "../src/core/scope.ts";
import { ProjectStore } from "../src/core/store.ts";
import { applyUndo, undoRows } from "../src/core/undo.ts";
import { copyDelivery } from "../src/sources/deliver-copy.ts";
import { refreshDraft, startDraft } from "../src/sources/staging.ts";
import { renamePlan, renameStaged, undoRenameBatch } from "../src/sources/staging-rename.ts";
import { extractMarka, extractNumurs, foldName, guessLapas, parseBis, parseSheet, planRenames, validName } from "../src/shared/rename.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const RUN = "run_r1";

function setup(files: Record<string, string>) {
	registerAppChecks();
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.4_Nodevumi", "1.4.2_MBP"), { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root, createdAt: "2026-11-13T00:00:00Z" });
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	const dir = d.draft!.stagingDir;
	for (const [name, body] of Object.entries(files)) {
		mkdirSync(join(dir, name, ".."), { recursive: true });
		writeFileSync(join(dir, name), body);
	}
	refreshDraft(store, d.id, "user");
	return { store, id: d.id, dir, root };
}

const row = (rows: ReturnType<typeof planRenames>, file: string) => rows.find((r) => r.file === file)!;

// ---- the rules -------------------------------------------------------------------------------------------------------------

test("8.12 office plan: a correct name is left, diacritics are folded, a loose name becomes number_title", () => {
	const rows = planRenames(["AR-1_Generalplans.pdf", "AR-2_Fasādes.pdf", "AR 3 Fasādes.pdf", "ar-4_griezumi.pdf"]);
	assert.equal(row(rows, "AR-1_Generalplans.pdf").status, "same");
	assert.deepEqual([row(rows, "AR-2_Fasādes.pdf").status, row(rows, "AR-2_Fasādes.pdf").to], ["rename", "AR-2_Fasades.pdf"]);
	assert.deepEqual([row(rows, "AR 3 Fasādes.pdf").status, row(rows, "AR 3 Fasādes.pdf").to], ["rename", "AR-3_Fasades.pdf"]);
	assert.equal(row(rows, "ar-4_griezumi.pdf").status, "same", "the office pattern is case-insensitive");
});

test("8.12 office plan: no number or no title cannot be decided, so the user is asked", () => {
	const rows = planRenames(["Fasades.pdf", "AR-5.pdf"]);
	assert.equal(row(rows, "Fasades.pdf").status, "input");
	assert.equal(row(rows, "Fasades.pdf").to, null);
	assert.match(row(rows, "AR-5.pdf").why, /nav nosaukuma/);
	assert.equal(row(rows, "AR-5.pdf").status, "input");
});

test("8.12 office plan: two files to one name → the second is a conflict; a name a staying file already has is a conflict", () => {
	const two = planRenames(["AR 3 Fasādes.pdf", "AR-3 Fasades.pdf"]);
	assert.deepEqual(two.map((r) => r.status), ["rename", "conflict"]);
	const taken = planRenames(["AR-3_Fasades.pdf", "AR 3 Fasādes.pdf"]);
	assert.deepEqual(taken.map((r) => r.status), ["same", "conflict"]);
	// the same name in another folder is not a collision
	const apart = planRenames(["a/AR 3 Fasādes.pdf", "b/AR-3 Fasades.pdf"]);
	assert.deepEqual(apart.map((r) => r.status), ["rename", "rename"]);
});

test("8.12 BIS parsing: marka from the known list, numurs as written, sheet name from the field with words, default revision 01", () => {
	assert.equal(extractMarka("001_AVK-A_Plans"), "AVK-A", "a compound mark keeps its hyphen");
	assert.equal(extractMarka("xyz"), "");
	assert.equal(extractNumurs("AR_001_Plans"), "001");
	assert.equal(extractNumurs("AR_Plans"), "");
	assert.equal(guessLapas("AR_001_1. stāva plāns"), "1. stāva plāns");
	assert.deepEqual(parseBis("001_AR_02_1. stāva plāns"), { numurs: "001", marka: "AR", revizija: "02", lapas: "1. stāva plāns", orig: "" });
	const rows = planRenames(["AR_001_1. stāva plāns.pdf"], "bis");
	assert.equal(rows[0].status, "rename");
	assert.match(rows[0].to!, /^001_AR_01_/, "revision defaults to 01");
	assert.doesNotMatch(rows[0].to!, /[^\x00-\x7F]/, "diacritics are folded: the office rule applies to BIS names too");
	assert.match(planRenames(["AR_001_plans.pdf"], "bis", { revision: "03" })[0].to!, /^001_AR_03_/);
});

test("8.12 helpers: foldName, parseSheet, validName", () => {
	assert.equal(foldName("Fasādes: 1/2 Ēka"), "Fasades 1 2 Eka", "Latvian letters folded, characters Windows refuses become spaces");
	assert.deepEqual(parseSheet("AR 3 Fasades"), { number: "AR-3", title: "Fasades" });
	assert.deepEqual(parseSheet("ar-3.1 - Griezumi 1-1"), { number: "AR-3.1", title: "- Griezumi 1-1".replace(/^- /, "") });
	assert.equal(parseSheet("Fasades"), null);
	assert.equal(validName("AR-3_Fasades.pdf"), null);
	for (const bad of ["", "  ", "a/b.pdf", "a\\b.pdf", "a:b.pdf", ".pdf.", "x ", "q".repeat(200)]) assert.notEqual(validName(bad), null, JSON.stringify(bad));
});

// ---- staging --------------------------------------------------------------------------------------------------------------

test("8.12 renameStaged: renames in staging (also in a subfolder), refuses an existing target, a path out of staging, a bad name", () => {
	const { store, id, dir } = setup({ "AR 3 Fasādes.pdf": "fasades", "01_AR/AR 4 Griezumi.pdf": "griezumi", "AR-9_Cits.pdf": "cits", "AR 9 Cits.pdf": "cits2" });
	const plan = renamePlan(store, id);
	assert.deepEqual(plan.map((r) => r.file).sort(), ["01_AR/AR 4 Griezumi.pdf", "AR 3 Fasādes.pdf", "AR 9 Cits.pdf", "AR-9_Cits.pdf"].sort());
	const r = renameStaged(
		store,
		id,
		[
			{ file: "AR 3 Fasādes.pdf", to: "AR-3_Fasades.pdf" },
			{ file: "01_AR/AR 4 Griezumi.pdf", to: "AR-4_Griezumi.pdf" },
			{ file: "AR 9 Cits.pdf", to: "AR-9_Cits.pdf" }, // taken
			{ file: "../x.pdf", to: "x.pdf" }, // out
			{ file: "AR-9_Cits.pdf", to: "a/b.pdf" }, // bad name
		],
		"user",
	);
	assert.equal(r.applied, 2);
	assert.equal(r.errors.length, 3, JSON.stringify(r.errors));
	assert.match(r.errors.join("|"), /jau ir/);
	assert.ok(r.batch);
	assert.equal(readFileSync(join(dir, "AR-3_Fasades.pdf"), "utf8"), "fasades");
	assert.equal(readFileSync(join(dir, "01_AR", "AR-4_Griezumi.pdf"), "utf8"), "griezumi");
	assert.equal(readFileSync(join(dir, "AR-9_Cits.pdf"), "utf8"), "cits", "the file that was there is untouched");
	assert.equal(existsSync(join(dir, "AR 3 Fasādes.pdf")), false);
	assert.deepEqual(store.read("deliveries").find((d) => d.id === id)!.items.map((i) => i.file.split(/[\\/]/).pop()).sort(), ["AR 9 Cits.pdf", "AR-3_Fasades.pdf", "AR-4_Griezumi.pdf", "AR-9_Cits.pdf"]);
});

test("8.12 renameStaged: a change of letter case only is allowed", () => {
	const { store, id, dir } = setup({ "ar-1_plans.pdf": "x" });
	const r = renameStaged(store, id, [{ file: "ar-1_plans.pdf", to: "AR-1_plans.pdf" }], "user");
	assert.equal(r.applied, 1, JSON.stringify(r.errors));
	assert.ok(readdirSync(dir).includes("AR-1_plans.pdf"));
});

test("8.12 renameStaged: an unknown file is said, not thrown; nothing renamed → no batch", () => {
	const { store, id } = setup({ "AR-1_plans.pdf": "x" });
	const r = renameStaged(store, id, [{ file: "nav.pdf", to: "AR-2_nav.pdf" }], "user");
	assert.deepEqual([r.applied, r.batch], [0, null]);
	assert.match(r.errors[0], /faila nav/);
});

test("8.12 renameStaged: refused once the delivery was copied to 1.4", async () => {
	const { store, id } = setup({ "AR-1_Generalplans.pdf": "x" });
	const p = await prepareDelivery(store, id, { dataDir: DATA, today: "2026-11-13" });
	assert.equal(p.open, 0, JSON.stringify(store.read("findings").filter((f) => f.state === "open").map((f) => f.message)));
	await copyDelivery(store, id, "user");
	assert.throws(() => renameStaged(store, id, [{ file: "AR-1_Generalplans.pdf", to: "AR-2_Cits.pdf" }], "user"), /nokopēts/);
});

test("8.12 undo of a batch: names return; a name that is gone is said; what took the old name goes aside, nothing is deleted", () => {
	const { store, id, dir } = setup({ "AR 3 Fasādes.pdf": "a", "AR 4 Griezumi.pdf": "b", "AR 5 Skati.pdf": "c" });
	const r = renameStaged(store, id, [{ file: "AR 3 Fasādes.pdf", to: "AR-3_Fasades.pdf" }, { file: "AR 4 Griezumi.pdf", to: "AR-4_Griezumi.pdf" }, { file: "AR 5 Skati.pdf", to: "AR-5_Skati.pdf" }], "user");
	assert.equal(r.applied, 3);
	// the user moved on: one new name is gone, and something new sits at another old name
	const gone = join(dir, "AR-5_Skati.pdf");
	renameStaged(store, id, [{ file: "AR-5_Skati.pdf", to: "AR-5_Skati-v2.pdf" }], "user");
	assert.equal(existsSync(gone), false);
	writeFileSync(join(dir, "AR 3 Fasādes.pdf"), "jauns");
	const u = undoRenameBatch(store, id, r.batch!);
	assert.equal(u.reverted, 2, JSON.stringify(u));
	assert.equal(u.errors.length, 1, "AR-5_Skati.pdf is not there any more");
	assert.equal(readFileSync(join(dir, "AR 3 Fasādes.pdf"), "utf8"), "a", "the old name is back with its bytes");
	assert.equal(readFileSync(join(dir, "AR 4 Griezumi.pdf"), "utf8"), "b");
	const aside = readdirSync(join(store.dir, "checkpoints", "aside"));
	assert.equal(aside.length, 1);
	assert.equal(readFileSync(join(store.dir, "checkpoints", "aside", aside[0]), "utf8"), "jauns", "what was in the way is kept, aside");
	// the two that were taken back are not taken back twice; the one that failed stays pending and says so again
	const again = undoRenameBatch(store, id, r.batch!);
	assert.deepEqual([again.reverted, again.errors.length], [0, 1]);
});

// ---- the agent tool and 8.7 ---------------------------------------------------------------------------------------------------

function asAgent(store: ProjectStore, ctx: ToolCtx, args: Record<string, unknown>) {
	const t = allTools().find((x) => x.name === "rename_staged")!;
	return inToolScope({ run: RUN, tool: "rename_staged" }, () => trackCreated(store, () => t.run(ctx, args as never)));
}

test("8.12 rename_staged: the plan without apply; with apply the run's undo list shows the rename, no 'created' row, and undo renames back", async () => {
	const { store, id, dir } = setup({ "AR 3 Fasādes.pdf": "a", "Skati.pdf": "b" });
	const runDir = join(tmp(), RUN);
	mkdirSync(runDir, { recursive: true });
	const ctx: ToolCtx = { projectsDir: store.dir.replace(/[\\/][^\\/]+$/, ""), projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir };
	void ctx;
	// the store was opened in its own temp folder: build the ctx the way test 8.7 does, from the same projects dir
	const projectsDir = join(store.dir, "..");
	const c: ToolCtx = { projectsDir, projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir };
	const plan = (await asAgent(store, c, { deliveryId: id })) as { toRename: number; needsYou: number };
	assert.deepEqual([plan.toRename, plan.needsYou], [1, 1]);
	assert.ok(existsSync(join(dir, "AR 3 Fasādes.pdf")), "no apply, nothing renamed");
	await asAgent(store, c, { deliveryId: id, apply: true });
	assert.ok(existsSync(join(dir, "AR-3_Fasades.pdf")));
	assert.ok(existsSync(join(dir, "Skati.pdf")), "what the plan cannot decide is left");
	const rows = undoRows(store, RUN);
	assert.ok(rows.some((r) => /Pārdēvēts: AR 3 Fasādes\.pdf → AR-3_Fasades\.pdf/.test(r.label)), JSON.stringify(rows.map((r) => r.label)));
	assert.equal(rows.filter((r) => /Izveidots/.test(r.label)).length, 0, "the new name is not listed as a created file");
	const rn = rows.find((r) => /Pārdēvēts/.test(r.label))!;
	assert.equal(rn.undoable, true);
	applyUndo(store, rn.key);
	assert.ok(existsSync(join(dir, "AR 3 Fasādes.pdf")));
	assert.equal(existsSync(join(dir, "AR-3_Fasades.pdf")), false);
	assert.ok(listCheckpoints(store, RUN).length >= 1);
});

test("8.12 rename_staged is level run, and no agent tool copies to 1.4 or marks a delivery sent", () => {
	const tools = allTools();
	assert.equal(tools.find((t) => t.name === "rename_staged")!.level, "run");
	assert.deepEqual(tools.map((t) => t.name).filter((n) => /copy_to|copy_delivery|mark_sent|send_delivery/.test(n)), []);
});

// ---- the filenames check on a draft ---------------------------------------------------------------------------------------------

test("8.12 the filenames check reads a draft's staged files: findings appear, then close after the rename", async () => {
	const { store, id } = setup({ "AR 3 Fasādes.pdf": "a", "AR-1_Generalplans.pdf": "b" });
	const open = () => store.read("findings").filter((f) => f.state === "open" && /filenames|nosaukum|garumzīm|rasējuma numurs/i.test(`${f.checkId ?? ""} ${f.message}`));
	await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-13", only: ["filenames"], deliveryId: id });
	assert.ok(open().length >= 1, JSON.stringify(store.read("findings").map((f) => f.message)));
	assert.ok(open().some((f) => /garumzīm/.test(f.message)));
	assert.ok(!open().some((f) => /mapes nosaukumā/.test(f.message)), "a draft has no folder: folder-name checks are skipped");
	renameStaged(store, id, [{ file: "AR 3 Fasādes.pdf", to: "AR-3_Fasades.pdf" }], "user");
	await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-13", only: ["filenames"], deliveryId: id });
	assert.equal(open().length, 0, JSON.stringify(open().map((f) => f.message)));
});
