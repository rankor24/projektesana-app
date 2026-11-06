// 2.4 first checks on an invented project: one wrong address, one missing MBP item, one file with diacritics →
// three findings, each naming its requirement.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { registerAppChecks } from "../src/checks/index.ts";
import { runChecks } from "../src/checks/run.ts";
import type { Delivery, Fact, Source } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { findOfficeQuote, OFFICE_RULES } from "../src/rules/office.ts";
import { refreshRequirements } from "../src/rules/refresh.ts";
import { normAddress } from "../src/checks/checks/one-truth.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const at = "2026-11-06T00:00:00.000Z";

// an invented office standard page with the phrases the office rules look for
const OFFICE_PAGES = [
	"1.4_Nodevumi\nPie nodevuma jābūt datumam atbilstošā formātā - gads mēnesis diena.\nKatrā mapē failu nosaukumus veidojam atbilstoši piemēram- AR-1_plans (Rasējuma numurs_nosaukums)",
	"VEIDOJOT MAPJU UN FAILU NOSAUKUMUS NELIETOJAM\nGARUMZĪMES UN MĪKSTINĀJUMA ZĪMES.",
];

function project(): ProjectStore {
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: at });
	const src = (id: string, role: string, title: string, sha: string): Source => ({ id, kind: "document", folderKey: "1.1.4", paths: [`${title}.pdf`], title, role, roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ok", pages: 1 }], signers: [] });
	s.write("sources", [src("s_pu", "PU", "PU", "1".repeat(64)), src("s_kl", "Īpašuma dokumenti", "Kadastrala lieta", "2".repeat(64))], { kind: "t", by: "app" });
	s.writeText("1".repeat(64), { state: "ok", pages: ["PROJEKTĒŠANAS UZDEVUMS\n1.1. Objekta adrese: Testa iela 1, Izdomāti, LV-0000\n1.2. Būvniecības veids – jauna būvniecība."] });
	s.writeText("2".repeat(64), { state: "ok", pages: ["KADASTRĀLĀS UZMĒRĪŠANAS LIETA\nAdrese: Testa iela 3, Izdomāti\nKopējā platība: 120,0 m2"] });
	const f = (key: string, value: string): Fact => ({ id: `f_${key}`, key: `profile.${key}`, value, source: { kind: "boris", at }, state: "confirmed", by: "boris", at });
	s.write("facts", [f("workType", "new_build"), f("use", "public"), f("group", "2"), f("stagesInContract", "MBP")], { kind: "t", by: "app" });
	const d: Delivery = {
		id: "d_mbp",
		stage: "Skice",
		kind: "MBP",
		label: "MBP 261005",
		plannedDate: null,
		submittedDate: "2026-10-05",
		folder: "01_Projektesana/1.4_Nodevumi/MBP/261005",
		items: [
			{ sheetNo: "VD-1", title: "Skaidrojošs apraksts", file: "VD-1_skaidrojoss apraksts.pdf", sha: null },
			{ sheetNo: "GP-1", title: "Ģenerālplāns", file: "GP-1_generalplans.pdf", sha: null },
			{ sheetNo: "AR-1", title: "1. stāva plāns", file: "AR-1_1 stava plans.pdf", sha: null },
			{ sheetNo: "AR-2", title: "Jumta plāns", file: "AR-2_jumta plāns.pdf", sha: null },
			{ sheetNo: "AR-3", title: "Griezums 1-1", file: "AR-3_griezums.pdf", sha: null },
		],
		checksRun: [],
	};
	s.write("deliveries", [d], { kind: "t", by: "app" });
	return s;
}

test("office rules find their quotes in the standard's text", () => {
	for (const r of OFFICE_RULES) assert.ok(findOfficeQuote(OFFICE_PAGES, r), r.id);
	assert.equal(findOfficeQuote(OFFICE_PAGES, OFFICE_RULES[2])!.quote, "VEIDOJOT MAPJU UN FAILU NOSAUKUMUS NELIETOJAM GARUMZĪMES UN MĪKSTINĀJUMA ZĪMES");
	assert.equal(normAddress("Testa  iela 1, Izdomāti, LV-0000"), "testa iela 1");
});

test("three findings — wrong address, missing facades, a file name with diacritics — each with its requirement", async () => {
	registerAppChecks();
	const s = project();
	refreshRequirements(s, DATA, { file: "C:\\standarts.pdf", pages: OFFICE_PAGES }, "2026-11-06");
	await runChecks(s, "manual", { dataDir: DATA, today: "2026-11-06" });
	const open = s.read("findings").filter((f) => f.state === "open" && f.severity === "error");
	const by = (check: string) => open.filter((f) => f.checkId === check);

	const addr = by("one-truth");
	assert.equal(addr.length, 1);
	assert.match(addr[0].message, /adrese atšķiras.*Testa iela 1.*Testa iela 3/);
	assert.equal(addr[0].requirementId, "doc:s_pu:1.1", "names the PU row that states the address");

	const miss = by("completeness");
	assert.equal(miss.length, 1, miss.map((m) => m.message).join("\n"));
	assert.match(miss[0].message, /Fasādes ar augstuma atzīmēm.*MK 529 26\.4\.2/);
	assert.equal(miss[0].requirementId, "law:mbp-facades:0");

	const names = by("filenames");
	assert.equal(names.length, 1);
	assert.match(names[0].message, /AR-2_jumta plāns\.pdf/);
	assert.equal(names[0].requirementId, "office:no-diacritics");
	const req = s.read("requirements").find((r) => r.id === "office:no-diacritics")!;
	assert.equal(req.citation.kind, "office");

	// the covered requirements are met
	assert.equal(s.read("requirements").find((r) => r.id === "law:mbp-gp:0")!.status, "met");
	assert.equal(s.read("requirements").find((r) => r.id === "law:mbp-facades:0")!.status, "failed");
});

test("without the office standard the finding says the requirement cannot be cited", async () => {
	registerAppChecks();
	const s = project();
	const r = refreshRequirements(s, DATA, null, "2026-11-06");
	assert.match(r.notes.join(" "), /Biroja standarts nav norādīts/);
	await runChecks(s, "delivery", { dataDir: DATA, today: "2026-11-06", deliveryId: "d_mbp" });
	const f = s.read("findings").find((x) => x.checkId === "filenames" && x.severity === "error")!;
	assert.equal(f.requirementId, null);
	assert.match(f.message, /biroja standarts nav norādīts/);
});

test("one truth: many buildings are not an error; a PU designation missing from the property documents is; non-addresses ignored", async () => {
	const { normAddress, isAddress, oneTruthCheck } = await import("../src/checks/checks/one-truth.ts");
	assert.equal(normAddress("…Testa bulvāris 9, Izdomāti"), "testa bulvaris 9");
	assert.equal(isAddress("… nav"), false);
	const s = ProjectStore.open(tmp(), { id: "BD998", name: "BD998", root: tmp(), createdAt: at });
	const src = (id: string, role: string, sha: string): Source => ({ id, kind: "document", folderKey: "1.1.2", paths: [`${id}.pdf`], title: id, role, roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ok", pages: 1 }], signers: [] });
	s.write("sources", [src("pu", "PU", "a".repeat(64)), src("kl", "Īpašuma dokumenti", "b".repeat(64))], { kind: "t", by: "app" });
	s.writeText("a".repeat(64), { state: "ok", pages: ["1.1. Objekta adrese: Testa iela 1\nBūves kadastra apzīmējums 0000 000 0000 001\nBūves kadastra apzīmējums 0000 000 0000 009\nAdrese: … nav"] });
	s.writeText("b".repeat(64), { state: "ok", pages: ["Adrese: Testa iela 1\nBūves kadastra apzīmējums 0000 000 0000 001\nBūves kadastra apzīmējums 0000 000 0000 002\nBūves kadastra apzīmējums 0000 000 0000 003"] });
	const r = await oneTruthCheck.run({ store: s, dataDir: DATA, today: "2026-11-06" });
	assert.deepEqual(r.results.map((x) => x.key), ["cadastral.building:00000000000009"], JSON.stringify(r.results.map((x) => x.message)));
	assert.match(r.results[0].message, /nav atrodams īpašuma dokumentos/);
});

test("one truth: designations the PU states with no property documents to check them against are shown, not silently skipped", async () => {
	const { oneTruthCheck } = await import("../src/checks/checks/one-truth.ts");
	const s = ProjectStore.open(tmp(), { id: "BD997", name: "BD997", root: tmp(), createdAt: at });
	s.write("sources", [{ id: "pu", kind: "document", folderKey: "1.1.2", paths: ["pu.pdf"], title: "pu", role: "PU", roleFrom: "folder", versions: [{ sha256: "c".repeat(64), size: 1, mtime: at, seenAt: at, textState: "ok", pages: 1 }], signers: [] }], { kind: "t", by: "app" });
	s.writeText("c".repeat(64), { state: "ok", pages: ["Būves kadastra apzīmējums 0000 000 0000 001\nBūves kadastra apzīmējums 0000 000 0000 002"] });
	const r = await oneTruthCheck.run({ store: s, dataDir: DATA, today: "2026-11-06" });
	assert.deepEqual(r.results.map((x) => [x.key, x.severity]), [["cadastral.building:no-property", "info"]]);
	assert.match(r.results[0].message, /nosauc 2, bet avotos nav īpašuma dokumentu/);
});
