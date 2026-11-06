// 4.1 deliveries from 1.4_Nodevumi (invented tree), 4.2 clocks in working days, 4.3 the delivery gate.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { blocking, markSent, prepareDelivery } from "../src/checks/gate.ts";
import { registerAppChecks } from "../src/checks/index.ts";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { ProjectStore } from "../src/core/store.ts";
import { clockOf } from "../src/rules/clocks.ts";
import { itemOf, mergeDeliveries, plannedFromSchedule, readDeliveries } from "../src/sources/deliveries.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");

function tree(): string {
	const root = join(tmp(), "BD999 Testa iela 1");
	const d = (...p: string[]) => {
		const f = join(root, "01_Projektesana", "1.4_Nodevumi", ...p);
		mkdirSync(f, { recursive: true });
		return f;
	};
	writeFileSync(join(d("SKICE", "260515"), "AR-1_skice.pdf"), "x");
	writeFileSync(join(d("MBP", "261005"), "GP-1_generalplans.pdf"), "x");
	writeFileSync(join(d("MBP", "261005"), "AR-2_fasades.pdf"), "x");
	writeFileSync(join(d("Starpnodevums", "270115"), "AR-5_plans.pdf"), "x");
	writeFileSync(join(d("BP", "270301"), "AR-1_1 stava plans.pdf"), "x");
	writeFileSync(join(d("BP", "270301", "arhivs"), "vecs.pdf"), "x");
	return root;
}

test("4.1 kinds, stages and dates from the 1.4 tree; items with sheet numbers; archive left out", async () => {
	const list = mergeDeliveries([], await readDeliveries(tree()), []);
	assert.deepEqual(
		list.map((d) => [d.kind, d.stage, d.submittedDate]),
		[
			["SKICE", "Skice", "2026-05-15"],
			["MBP", "Skice", "2026-10-05"],
			["STARP", "Tehniskais", "2027-01-15"],
			["BP", "Tehniskais", "2027-03-01"],
		],
	);
	const bp = list.find((d) => d.kind === "BP")!;
	assert.equal(bp.items.length, 1, "arhivs not read");
	assert.deepEqual(itemOf("x/AR-2_fasades.pdf"), { sheetNo: "AR-2", title: "fasades", file: "x/AR-2_fasades.pdf", sha: null });
	assert.equal(itemOf("x/plans.pdf").sheetNo, null);
});

test("4.1 planned dates from the BIP grafiks go to the deliveries of that kind; the rest become planned rows", async () => {
	const planned = plannedFromSchedule(["Grafiks\nMBP iesniegšana būvvaldē 01.10.2026\nBP iesniegšana 2027-02-20\nDT nodošana 15.06.2027"]);
	assert.deepEqual(planned.map((p) => [p.kind, p.date]), [["MBP", "2026-10-01"], ["BP", "2027-02-20"], ["DT", "2027-06-15"]]);
	const list = mergeDeliveries([], await readDeliveries(tree()), planned);
	assert.equal(list.find((d) => d.kind === "MBP")!.plannedDate, "2026-10-01");
	const dt = list.find((d) => d.kind === "DT")!;
	assert.equal(dt.submittedDate, null);
	assert.equal(dt.stage, "Detalizācijas");
	// Boris's planned date stays after a re-read
	const kept = mergeDeliveries(list.map((d) => (d.kind === "BP" ? { ...d, plannedDate: "2027-02-25", plannedFrom: "boris" as const } : d)), await readDeliveries(tree()), planned);
	assert.equal(kept.find((d) => d.kind === "BP")!.plannedDate, "2027-02-25");
});

test("4.2 a TN deadline across a holiday: 11 working days, 20 when extended; approvals 15", () => {
	// requested Mon 2026-11-09; 18 Nov (Wed) is a holiday → 11 working days end on 2026-11-25
	const c = clockOf({ id: "c1", kind: "tn", issuer: "Izdomātais tīkls", issuerKind: "network_owner", requestedOn: "2026-11-09", extended: false, receivedOn: null, sourceId: null, by: "boris" }, "2026-11-16");
	assert.equal(c.due, "2026-11-25");
	assert.equal(c.daysLeft, 6);
	assert.equal(c.point, "MK 500 27.2");
	assert.equal(clockOf({ ...c, extended: true }, "2026-11-16").due, "2026-12-08");
	assert.equal(clockOf({ ...c, kind: "approval" }, "2026-11-16").point, "MK 500 27.3");
	assert.equal(clockOf(c, "2026-11-26").state, "kavē");
	assert.equal(clockOf({ ...c, receivedOn: "2026-11-20" }, "2026-12-30").state, "saņemts");
});

test("4.3 the gate: prepare runs the checks; an open finding refuses 'sent'; after an override Boris can send", async () => {
	registerAppChecks();
	registerCheck({ id: "t-gate", title: "t", on: ["delivery"], run: ({ deliveryId }) => ({ results: [{ key: "x", severity: "error", message: "trūkst fasāžu", where: { deliveryId } }] }) });
	try {
		const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-06T00:00:00Z" });
		store.write("deliveries", mergeDeliveries([], await readDeliveries(tree()), []), { kind: "t", by: "app" });
		const mbp = store.read("deliveries").find((d) => d.kind === "MBP")!;
		assert.throws(() => markSent(store, mbp.id, "boris"), /Vispirms sagatavo/);
		const r = await prepareDelivery(store, mbp.id, { dataDir: DATA, today: "2026-11-06" });
		assert.ok(r.open >= 1);
		assert.throws(() => markSent(store, mbp.id, "boris"), /nevar atzīmēt.*trūkst fasāžu/);
		assert.throws(() => markSent(store, mbp.id, "agent"), /tikai Boris/);
		const { overrideFinding } = await import("../src/checks/run.ts");
		for (const f of blocking(store, mbp.id)) overrideFinding(store, f.id, "Fasādes iesniegtas atsevišķi, ar pavadvēstuli.");
		markSent(store, mbp.id, "boris");
		assert.ok(store.read("deliveries").find((d) => d.id === mbp.id)!.sent);
	} finally {
		unregisterCheck("t-gate");
	}
});
