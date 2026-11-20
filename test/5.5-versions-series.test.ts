// 5.5 follow-up: the office reissues a document as a new file ("…_01.pdf" → "…_02.pdf", or the same name in another folder),
// which the scan keeps as separate Sources. The Changes list chains them by name so each reissue opens as a sheet diff.
import assert from "node:assert/strict";
import { test } from "node:test";
import { seriesKey, seriesPrev, versionsBetween } from "../src/core/versions.ts";
import { ProjectStore } from "../src/core/store.ts";
import type { Source } from "../src/core/model.ts";
import { tmp } from "./helpers.ts";

const src = (id: string, title: string, at: string, file = `${title}.pdf`): Source => ({
	id,
	kind: "document",
	folderKey: "1.1.4",
	paths: [file],
	title,
	role: "Topogrāfija",
	roleFrom: "folder",
	versions: [{ sha256: id.padEnd(64, "0"), size: 1, mtime: at, seenAt: at, textState: "ok" }],
	signers: [],
});

test("series key: office revision suffixes go, sheet numbers stay", () => {
	assert.equal(seriesKey("DUN8_RA_TI_00001_02"), "dun8_ra_ti_00001");
	assert.equal(seriesKey("DUN8_RA_TI_00001_01"), "dun8_ra_ti_00001");
	assert.equal(seriesKey("Plans_v3"), "plans");
	assert.equal(seriesKey("Plans rev2"), "plans");
	assert.equal(seriesKey("Plans (1)"), "plans");
	assert.equal(seriesKey("AR-3"), "ar-3");
	assert.equal(seriesKey("DUN8_TD_BIM_00001_BIP"), "dun8_td_bim_00001_bip");
	assert.equal(seriesKey("00_PU"), "00_pu");
});

test("series: reissues chain by first date; sheets, non-PDFs and lone files do not", () => {
	const prev = seriesPrev([
		src("a", "DUN8_RA_TI_00001_01", "2026-10-28T00:00:00Z"),
		src("b", "DUN8_RA_TI_00001_02", "2026-11-02T00:00:00Z"),
		src("c", "AR-1", "2026-10-01T00:00:00Z"),
		src("d", "AR-2", "2026-10-02T00:00:00Z"),
		src("e", "Model_01", "2026-10-01T00:00:00Z", "Model_01.ifc"),
		src("f", "Model_02", "2026-10-05T00:00:00Z", "Model_02.ifc"),
	]);
	assert.equal(prev.get("b")?.id, "a");
	assert.deepEqual([...prev.keys()], ["b"]);
});

test("Changes list: a reissue under a new name, and the same name in another folder, get a sheet compare", () => {
	const s = ProjectStore.open(tmp(), { id: "BD998", name: "BD998", root: tmp(), createdAt: "2026-09-01T00:00:00Z" });
	s.write(
		"sources",
		[
			src("s1", "DUN8_RA_TI_00001_01", "2026-10-28T10:00:00Z"),
			src("s2", "DUN8_RA_TI_00001_02", "2026-11-02T10:00:00Z"),
			src("m1", "Riga_Duntes_iela_8_melnraksts", "2026-10-28T09:00:00Z", "a/Riga_Duntes_iela_8_melnraksts.pdf"),
			src("m2", "Riga_Duntes_iela_8_melnraksts", "2026-11-02T09:00:00Z", "b/Riga_Duntes_iela_8_melnraksts.pdf"),
			src("x", "Laktas 8 topo", "2026-11-04T00:00:00Z"),
		],
		{ kind: "t", by: "app" },
	);
	s.log({ kind: "project.created", by: "user" });
	const rows = versionsBetween(s, "2026-08-21", "2099-01-01");
	const r2 = rows.find((r) => r.open?.sourceId === "s2")!;
	assert.equal(r2.label, "DUN8_RA_TI_00001_02 — jauna versija");
	assert.deepEqual([r2.compare?.a, r2.compare?.b, r2.compare?.mode], ["src:s1", "src:s2", "sheet"]);
	assert.match(r2.detail ?? "", /iepriekšējā: DUN8_RA_TI_00001_01 \(2026-10-28\)/);
	assert.deepEqual([rows.find((r) => r.open?.sourceId === "m2")?.compare?.a], ["src:m1"]);
	assert.equal(rows.find((r) => r.open?.sourceId === "s1")?.compare, undefined);
	assert.equal(rows.find((r) => r.open?.sourceId === "x")?.label, "Laktas 8 topo — pirmā versija");
	assert.ok(!rows.some((r) => r.kind === "data" && /project\.created/.test(r.detail ?? "")), "project.created is not a change");
});
