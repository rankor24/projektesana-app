// 7.1 a delivery being made: "Nodot projektu" starts a draft with its staging folder in the data folder; a rescan of
// 1.4_Nodevumi keeps it; once copied, the real folder's delivery takes the draft's id, checks and record.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { mergeDeliveries, readDeliveries } from "../src/sources/deliveries.ts";
import { draftId, refreshDraft, safeName, stageFile, startDraft, unstageFile, yymmdd } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

function project() {
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.4_Nodevumi", "1.4.2_MBP"), { recursive: true });
	mkdirSync(join(root, "01_Projektesana", "1.4_Nodevumi", "1.4.1_SKICE", "260515"), { recursive: true });
	writeFileSync(join(root, "01_Projektesana", "1.4_Nodevumi", "1.4.1_SKICE", "260515", "AR-1_skice.pdf"), "x");
	mkdirSync(join(root, "01_Projektesana", "1.1_Izejas dati"), { recursive: true });
	writeFileSync(join(root, "01_Projektesana", "1.1_Izejas dati", "TN izdomātais tīkls.pdf"), "tn");
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root, createdAt: "2026-11-10T00:00:00Z" });
	return { root, store };
}

test("7.1 start: a draft row with its staging folder <data>\\nodevumi\\MBP\\YYMMDD; twice the same is refused; bad kind/date refused", () => {
	const { store } = project();
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	assert.equal(d.id, draftId("MBP", "2026-12-01"));
	assert.equal(yymmdd("2026-12-01"), "261201");
	assert.equal(d.draft!.stagingDir, join(store.dir, "nodevumi", "MBP", "261201"));
	assert.ok(existsSync(d.draft!.stagingDir));
	assert.equal(d.stage, "Skice");
	assert.equal(d.folder, d.draft!.stagingDir);
	assert.throws(() => startDraft(store, "MBP", "2026-12-01", "user"), /jau ir sākts/);
	assert.throws(() => startDraft(store, "PR", "2026-12-01", "user"), /Nodevuma veids/);
	assert.throws(() => startDraft(store, "MBP", "2026-02-30", "user"), /GGGG-MM-DD/);
});

test("7.1 a planned-only row of the kind is replaced by the draft; the BIP's planned MBP does not come back on rescan", async () => {
	const { root, store } = project();
	store.write("deliveries", mergeDeliveries([], await readDeliveries(root), [{ kind: "MBP", date: "2026-12-05" }]), { kind: "t", by: "app" });
	assert.ok(store.read("deliveries").some((d) => d.id.startsWith("plan_MBP")));
	startDraft(store, "MBP", "2026-12-01", "user");
	assert.ok(!store.read("deliveries").some((d) => d.id.startsWith("plan_MBP")));
	const again = mergeDeliveries(store.read("deliveries"), await readDeliveries(root), [{ kind: "MBP", date: "2026-12-05" }]);
	assert.deepEqual(again.filter((d) => d.kind === "MBP").map((d) => d.id), ["draft_MBP_261201"]);
});

test("7.1 staging: a source file copied in under a safe name, refreshed into items; never overwritten; removed by name", () => {
	const { root, store } = project();
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	const src = join(root, "01_Projektesana", "1.1_Izejas dati", "TN izdomātais tīkls.pdf");
	const { file } = stageFile(store, d.id, src, "TN-1_Izdomātais tīkls.pdf", "user");
	assert.equal(file, join(d.draft!.stagingDir, "TN-1_Izdomatais tikls.pdf"));
	const items = store.read("deliveries").find((x) => x.id === d.id)!.items;
	assert.deepEqual(items.map((i) => [i.sheetNo, i.title]), [["TN-1", "Izdomatais tikls"]]);
	assert.throws(() => stageFile(store, d.id, src, "TN-1_Izdomātais tīkls.pdf", "user"), /jau ir/);
	assert.throws(() => stageFile(store, d.id, join(tmp(), "nekas.pdf"), undefined, "user"), /Ārpus projekta mapes/);
	unstageFile(store, d.id, "TN-1_Izdomatais tikls.pdf", "user");
	assert.equal(refreshDraft(store, d.id, "user").items.length, 0);
});

test("7.1 safe names: diacritics folded, separators and reserved characters out, traversal refused", () => {
	assert.equal(safeName("AR-3_Fasādes ziemeļu/dienvidu.pdf"), "AR-3_Fasades ziemelu_dienvidu.pdf");
	assert.equal(safeName('A:B*C?"<>|.pdf'), "A_B_C_.pdf");
	assert.throws(() => safeName(".."), /Nederīgs/);
	assert.throws(() => safeName("   "), /Nederīgs/);
});

test("7.1 rescan keeps an open draft; a copied draft joins its real folder: same id, checks, record; the draft row goes", async () => {
	const { root, store } = project();
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	const kept = mergeDeliveries(store.read("deliveries"), await readDeliveries(root), []);
	assert.ok(kept.some((x) => x.id === d.id && x.draft));
	// as the copy (7.6) leaves it: the real folder exists, the draft records where it went, one check run on record
	const real = join(root, "01_Projektesana", "1.4_Nodevumi", "1.4.2_MBP", "261201");
	mkdirSync(real);
	writeFileSync(join(real, "AR-1_Generalplans.pdf"), "x");
	const copied = kept.map((x) => (x.id === d.id ? { ...x, checksRun: [{ at: "2026-11-30T10:00:00Z", open: 0 }], draft: { ...x.draft!, copiedTo: "01_Projektesana\\1.4_Nodevumi\\1.4.2_MBP\\261201" } } : x));
	const after = mergeDeliveries(copied, await readDeliveries(root), []);
	const mbp = after.filter((x) => x.kind === "MBP");
	assert.equal(mbp.length, 1, "one MBP row, not draft + real");
	assert.equal(mbp[0].id, d.id);
	assert.equal(mbp[0].submittedDate, "2026-12-01");
	assert.equal(mbp[0].checksRun.length, 1);
	assert.match(mbp[0].items[0].file, /^01_Projektesana/);
	// and again: stable
	const twice = mergeDeliveries(after, await readDeliveries(root), []);
	assert.deepEqual(twice.filter((x) => x.kind === "MBP").map((x) => x.id), [d.id]);
});
