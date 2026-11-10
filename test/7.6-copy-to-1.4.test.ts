// 7.6 "Kopēt uz 1.4_Nodevumi": the one write into the office folder. Invented project tree in a temp folder.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { markSent, prepareDelivery } from "../src/checks/gate.ts";
import { registerAppChecks } from "../src/checks/index.ts";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { checkDeliveryWrite } from "../src/core/guard.ts";
import { ProjectStore } from "../src/core/store.ts";
import { copyDelivery, copyPlan, kindFolderOf } from "../src/sources/deliver-copy.ts";
import { refreshDeliveries } from "../src/sources/pipeline.ts";
import { refreshDraft, startDraft } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");

async function ready(kind = "MBP") {
	registerAppChecks();
	const root = join(tmp(), "BD999 Testa iela 1");
	const dd = join(root, "01_Projektesana", "1.4_Nodevumi");
	mkdirSync(join(dd, "1.4.2_MBP"), { recursive: true });
	mkdirSync(join(dd, "1.4.3_BP_260109"), { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root, createdAt: "2026-11-10T00:00:00Z" });
	const d = startDraft(store, kind, "2026-12-01", "user");
	mkdirSync(join(d.draft!.stagingDir, "01_AR"));
	writeFileSync(join(d.draft!.stagingDir, "AR-1_Generalplans.pdf"), "%PDF generalplans");
	writeFileSync(join(d.draft!.stagingDir, "01_AR", "AR-3_Fasades.pdf"), "%PDF fasades");
	refreshDraft(store, d.id, "user");
	return { root, dd, store, id: d.id, staging: d.draft!.stagingDir };
}

test("7.6 the kind folder: the existing 1.4.2_MBP; a dated folder (1.4.3_BP_260109) is not a kind folder; none → say so", async () => {
	const { dd } = await ready();
	assert.equal(kindFolderOf(dd, "MBP").dir, join(dd, "1.4.2_MBP"));
	assert.match(kindFolderOf(dd, "BP").why!, /nav mapes BP.*Izveido to pats/);
});

test("7.6 the plan says what stops the copy: not prepared; then, prepared, nothing and the exact target", async () => {
	const { store, id, dd } = await ready();
	assert.ok(copyPlan(store, id).blockers.some((b) => /Sagatavot/.test(b)));
	const r = await prepareDelivery(store, id, { dataDir: DATA, today: "2026-11-10" });
	assert.equal(r.open, 0, JSON.stringify(store.read("findings").filter((f) => f.state === "open").map((f) => f.message)));
	const p = copyPlan(store, id);
	assert.deepEqual(p.blockers, []);
	assert.equal(p.target, join(dd, "1.4.2_MBP", "261201"));
	assert.equal(p.files, 2);
});

test("7.6 the copy: the user only; files land with the same bytes, sections kept; the real folder takes the draft's id; a second copy is refused", async () => {
	const { store, id, dd, root } = await ready();
	await prepareDelivery(store, id, { dataDir: DATA, today: "2026-11-10" });
	await assert.rejects(copyDelivery(store, id, "agent"), /tikai lietotājs/);
	assert.throws(() => markSent(store, id, "user"), /Vispirms nokopē/);
	const r = await copyDelivery(store, id, "user");
	const target = join(dd, "1.4.2_MBP", "261201");
	assert.deepEqual(r, { target, files: 2 });
	assert.equal(readFileSync(join(target, "01_AR", "AR-3_Fasades.pdf"), "utf8"), "%PDF fasades");
	await refreshDeliveries(store, root);
	const mbp = store.read("deliveries").filter((x) => x.kind === "MBP");
	assert.equal(mbp.length, 1);
	assert.equal(mbp[0].id, id);
	assert.equal(mbp[0].folder, join("01_Projektesana", "1.4_Nodevumi", "1.4.2_MBP", "261201"));
	assert.equal(mbp[0].submittedDate, "2026-12-01");
	const again = copyPlan(store, id).blockers.join(" ");
	assert.match(again, /Jau nokopēts/);
	await assert.rejects(copyDelivery(store, id, "user"), /Nevar kopēt/);
	markSent(store, id, "user");
	assert.ok(store.read("deliveries").find((x) => x.id === id)!.sent);
});

test("7.6 refused: a missing kind folder, an existing YYMMDD folder, staging changed after the check, an open error", async () => {
	const bp = await ready("BP");
	await prepareDelivery(bp.store, bp.id, { dataDir: DATA, today: "2026-11-10" });
	assert.ok(copyPlan(bp.store, bp.id).blockers.some((b) => /nav mapes BP/.test(b)));

	const a = await ready();
	await prepareDelivery(a.store, a.id, { dataDir: DATA, today: "2026-11-10" });
	writeFileSync(join(a.staging, "AR-5_Griezums.pdf"), "%PDF new");
	refreshDraft(a.store, a.id, "user");
	assert.ok(copyPlan(a.store, a.id).blockers.some((b) => /mainīti pēc pēdējās pārbaudes/.test(b)));
	mkdirSync(join(a.dd, "1.4.2_MBP", "261201"));
	assert.ok(copyPlan(a.store, a.id).blockers.some((b) => /Mape jau ir/.test(b)));

	const b = await ready();
	registerCheck({ id: "t-copy", title: "t", on: ["delivery"], run: ({ deliveryId }) => ({ results: [{ key: "x", severity: "error", message: "trūkst fasāžu", where: { deliveryId } }] }) });
	try {
		await prepareDelivery(b.store, b.id, { dataDir: DATA, today: "2026-11-10" });
		assert.ok(copyPlan(b.store, b.id).blockers.some((x) => /atvērti atradumi.*trūkst fasāžu/.test(x)));
		await assert.rejects(copyDelivery(b.store, b.id, "user"), /trūkst fasāžu/);
		assert.ok(!existsSync(join(b.dd, "1.4.2_MBP", "261201")));
	} finally {
		unregisterCheck("t-copy");
	}
});

test("7.6 the guard: only 1.4_Nodevumi\\<kind>\\<YYMMDD> and files inside it", () => {
	const root = join(tmp(), "P");
	const dd = join(root, "01_Projektesana", "1.4_Nodevumi");
	const cfg = { sourceRoot: root, dataDir: tmp() };
	const t = join(dd, "1.4.2_MBP", "261201");
	assert.ok(checkDeliveryWrite(cfg, dd, t).ok);
	assert.ok(checkDeliveryWrite(cfg, dd, t, "01_AR\\AR-1_x.pdf").ok);
	assert.equal(checkDeliveryWrite(cfg, dd, t, "..\\..\\x.pdf").ok, false);
	assert.equal(checkDeliveryWrite(cfg, dd, join(dd, "1.4.2_MBP", "jauna")).ok, false);
	assert.equal(checkDeliveryWrite(cfg, dd, join(dd, "1.4.2_MBP", "a", "261201")).ok, false);
	assert.equal(checkDeliveryWrite(cfg, dd, join(dd, "261201")).ok, false);
	assert.equal(checkDeliveryWrite(cfg, join(root, "01_Projektesana", "1.1_Izejas dati"), join(root, "01_Projektesana", "1.1_Izejas dati", "x", "261201")).ok, false);
	assert.equal(checkDeliveryWrite(cfg, join(tmp(), "1.4_Nodevumi"), join(tmp(), "1.4_Nodevumi", "MBP", "261201")).ok, false);
});
