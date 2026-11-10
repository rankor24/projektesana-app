// 7.2 the checklist of a draft: law rows for the kind met by the staged files (covering()), the sheets against the model's
// sheet list, the IFC, and the TN clocks. Invented requirements and names.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checklistOf, checklistSummary } from "../src/checks/checklist.ts";
import type { Requirement } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { refreshDraft, startDraft } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

const law = (id: string, point: string, text: string, kinds = ["MBP"]): Requirement => ({
	id,
	origin: "law",
	citation: { kind: "law", act: "MK 529", actId: "0", actVersionDate: null, readOn: "2026-11-01", point, url: "https://likumi.lv/", quote: text },
	text,
	appliesTo: { deliveries: kinds as Requirement["appliesTo"]["deliveries"] },
	checkId: "completeness",
	status: "open",
	evidence: [],
	state: "confirmed",
	by: "app",
	at: "2026-11-01T00:00:00Z",
});

function setup() {
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root, createdAt: "2026-11-10T00:00:00Z" });
	store.write("requirements", [law("r1", "26.1", "ģenerālplāns"), law("r2", "26.3", "fasādes"), law("r3", "26.4", "griezumi (attiecas, ja: ēkai ir vairāki stāvi)"), law("r9", "71.1", "fasādes", ["BP"])], { kind: "t", by: "app" });
	store.writeMeta("clocks", [{ id: "c1", kind: "tn", issuer: "Izdomātais tīkls", issuerKind: "network_owner", requestedOn: "2026-11-02", extended: false, receivedOn: null, sourceId: null, by: "user" }]);
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	const put = (name: string) => writeFileSync(join(d.draft!.stagingDir, name), "x");
	return { store, d, put };
}

const sheets = [
	{ id: "1", number: "AR-1", name: "Ģenerālplāns" },
	{ id: "2", number: "AR-3", name: "Fasādes" },
	{ id: "3", number: "AR-4", name: "Griezums 1-1" },
];

test("7.2 a fresh MBP: every MK 529 26 row of the kind, nothing done; BP rows left out; TN open; IFC required", () => {
	const { store, d } = setup();
	const rows = checklistOf(store, d.id, { today: "2026-11-10", sheets: null });
	const law = rows.filter((r) => r.group === "Likums");
	assert.deepEqual(law.map((r) => [r.citation, r.status]), [["MK 529 26.1", "trūkst"], ["MK 529 26.3", "trūkst"], ["MK 529 26.4", "pārbaudi"]]);
	assert.equal(rows.find((r) => r.id === "ifc")!.status, "trūkst");
	assert.equal(rows.find((r) => r.id === "sheets")!.status, "trūkst");
	const tn = rows.find((r) => r.group === "Saskaņojumi")!;
	assert.equal(tn.status, "trūkst");
	assert.equal(tn.citation, "MK 500 27.2");
	assert.match(tn.detail!, /d\.d\./);
});

test("7.2 staged A-3_Fasades.pdf closes the fasādes row and nothing else", () => {
	const { store, d, put } = setup();
	put("AR-3_Fasades.pdf");
	refreshDraft(store, d.id, "user");
	const rows = checklistOf(store, d.id, { today: "2026-11-10", sheets: null });
	const done = rows.filter((r) => r.group === "Likums" && r.status === "gatavs");
	assert.deepEqual(done.map((r) => [r.citation, r.files]), [["MK 529 26.3", ["AR-3_Fasades.pdf"]]]);
	// without Revit the sheet row asks for a look, it is not "done"
	assert.equal(rows.find((r) => r.id === "sheets")!.status, "pārbaudi");
});

test("7.2 sheets against the model: all matched → done; another name → look; a sheet not in the model → look", () => {
	const { store, d, put } = setup();
	put("AR-1_Generalplans.pdf");
	put("AR-3_Fasades.pdf");
	put("AR-4_Griezums 1-1.pdf");
	put("BP_265_modelis.ifc");
	refreshDraft(store, d.id, "user");
	let rows = checklistOf(store, d.id, { today: "2026-11-10", sheets });
	assert.equal(rows.find((r) => r.id === "sheets")!.status, "gatavs");
	assert.equal(rows.find((r) => r.id === "ifc")!.status, "gatavs");
	rows = checklistOf(store, d.id, { today: "2026-11-10", sheets: [...sheets.slice(0, 2), { id: "3", number: "AR-4", name: "Griezums 2-2" }] });
	assert.equal(rows.find((r) => r.id === "sheets")!.status, "pārbaudi");
	assert.match(rows.find((r) => r.id === "sheets")!.detail!, /AR-4 “Griezums 1-1” ≠ “Griezums 2-2”/);
	rows = checklistOf(store, d.id, { today: "2026-11-10", sheets: sheets.slice(0, 2) });
	assert.match(rows.find((r) => r.id === "sheets")!.detail!, /nav modelī: AR-4_Griezums 1-1\.pdf/);
	assert.deepEqual(checklistSummary(rows).gatavs >= 2, true);
	// a staged TN document named like a sheet is not "not in the model": its prefix is not one the model's sheets use
	put("TN-1_Izdomatais tikls.pdf");
	refreshDraft(store, d.id, "user");
	rows = checklistOf(store, d.id, { today: "2026-11-10", sheets });
	assert.equal(rows.find((r) => r.id === "sheets")!.status, "gatavs");
});

test("7.2 a justified requirement and a received TN count as done; no law requirements loaded says so", () => {
	const { store, d } = setup();
	store.update("requirements", (all) => all.map((r) => (r.id === "r1" ? { ...r, status: "justified" as const } : r)), { kind: "t", by: "user" });
	store.writeMeta("clocks", [{ id: "c1", kind: "tn", issuer: "Izdomātais tīkls", issuerKind: "network_owner", requestedOn: "2026-11-02", extended: false, receivedOn: "2026-11-09", sourceId: null, by: "user" }]);
	const rows = checklistOf(store, d.id, { today: "2026-11-10", sheets: null });
	assert.equal(rows.find((r) => r.requirementId === "r1")!.status, "pamatots");
	assert.equal(rows.find((r) => r.group === "Saskaņojumi")!.status, "gatavs");
	store.write("requirements", [], { kind: "t", by: "app" });
	assert.equal(checklistOf(store, d.id, { today: "2026-11-10", sheets: null }).find((r) => r.id === "req:none")!.action, "requirements");
});
