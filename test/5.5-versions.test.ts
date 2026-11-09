// 5.5 "kas mainījās starp": source versions (with kept PDF copies to compare), deliveries paired by sheet number, the
// app's own decisions — in one list between two dates.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { versionsBetween } from "../src/core/versions.ts";
import { ProjectStore } from "../src/core/store.ts";
import { FIX, tmp } from "./helpers.ts";

test("between two dates: a source's second version with its compare, a delivery against the previous one, data changes", () => {
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-09-01T00:00:00Z" });
	const sha1 = "1".repeat(64);
	const sha2 = "2".repeat(64);
	mkdirSync(join(s.dir, "blobs"), { recursive: true });
	copyFileSync(join(FIX, "sheet-a.pdf"), join(s.dir, "blobs", `${sha1}.pdf`));
	copyFileSync(join(FIX, "sheet-b.pdf"), join(s.dir, "blobs", `${sha2}.pdf`));
	const v = (sha: string, at: string) => ({ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ok" as const });
	s.write("sources", [{ id: "s1", kind: "document", folderKey: "1.1.4", paths: ["pu.pdf"], title: "PU", role: "PU", roleFrom: "folder", versions: [v(sha1, "2026-09-10T00:00:00Z"), v(sha2, "2026-10-20T00:00:00Z")], signers: [] }], { kind: "t", by: "app" });
	const item = (no: string, f: string) => ({ sheetNo: no, title: "plans", file: f, sha: null });
	s.write(
		"deliveries",
		[
			{ id: "d1", stage: "Skice", kind: "MBP", label: "MBP 260915", plannedDate: null, submittedDate: "2026-09-15", folder: "x", items: [item("AR-3", "1.4/MBP/260915/AR-3_plans.pdf")], checksRun: [] },
			{ id: "d2", stage: "Skice", kind: "MBP", label: "MBP 261025", plannedDate: null, submittedDate: "2026-10-25", folder: "y", items: [item("AR-3", "1.4/MBP/261025/AR-3_plans.pdf")], checksRun: [] },
		],
		{ kind: "t", by: "app" },
	);
	s.log({ kind: "fact.confirmed", by: "user" });
	const rows = versionsBetween(s, "2026-10-01", new Date().toISOString().slice(0, 10));
	const src = rows.find((r) => r.kind === "source")!;
	assert.equal(src.label, "PU — versija 2");
	assert.deepEqual(src.compare, { a: `blob:${sha1}`, b: `blob:${sha2}`, mode: "sheet", aLabel: "PU v1", bLabel: "PU v2" });
	const del = rows.find((r) => r.kind === "delivery")!;
	assert.equal(del.label, "MBP 261025 (Skice)");
	assert.deepEqual([del.compare?.a, del.compare?.b], ["1.4/MBP/260915/AR-3_plans.pdf", "1.4/MBP/261025/AR-3_plans.pdf"]);
	assert.ok(rows.some((r) => r.kind === "data" && /fact\.confirmed ×1/.test(r.detail ?? "")));
	assert.ok(!rows.some((r) => r.label === "PU — pirmā versija"), "the first version is before the range");
});
