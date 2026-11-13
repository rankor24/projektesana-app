// 9.9 the Versijas page: the filters over invented change rows, and how a picked change opens as the right split — two models
// side by side with the camera linked, BimCraft's compare as one tab, a sheet pair in the sheet compare, a lone file as it is.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { VersionRow } from "../src/shared/api.ts";
import { changeId, filterRows, kindCounts, modesFor, planFor } from "../src/shared/versions-view.ts";
import * as V from "../src/shared/viewer.ts";

const row = (kind: VersionRow["kind"], at: string, label: string, extra: Partial<VersionRow> = {}): VersionRow => ({ at, kind, label, ...extra });
const ROWS: VersionRow[] = [
	row("source", "2026-11-12T08:00:00Z", "Plāns A-101 — versija 2", { compare: { a: "blob:aa", b: "blob:bb", mode: "sheet", aLabel: "A-101 v1", bLabel: "A-101 v2" }, open: { sourceId: "s1" } }),
	row("revision", "2026-11-10T09:00:00Z", "Revīzija r3", { compare: { a: "rev:r2", b: "rev:r3", mode: "ifc", aLabel: "AR r2", bLabel: "AR r3" } }),
	row("delivery", "2026-11-05T09:00:00Z", "Nodevums MBP 1", { open: { sourceId: "s9" } }),
	row("data", "2026-11-01T09:00:00Z", "Lietotnes dati 2026-11-01"),
	row("source", "2026-10-20T08:00:00Z", "IFC AR — pirmā versija", { open: { ifc: "BD1/AR.ifc" } }),
];

test("the kind filters: none chosen shows everything, one or several narrow the list, the order is kept; counts per kind", () => {
	assert.equal(filterRows(ROWS, new Set()).length, 5);
	assert.deepEqual(filterRows(ROWS, new Set(["source"])).map((r) => r.label), ["Plāns A-101 — versija 2", "IFC AR — pirmā versija"]);
	assert.deepEqual(filterRows(ROWS, new Set(["revision", "data"])).map((r) => r.kind), ["revision", "data"]);
	assert.deepEqual(filterRows([], new Set(["source"])), []);
	assert.deepEqual(kindCounts(ROWS), { source: 2, delivery: 1, revision: 1, data: 1 });
	assert.deepEqual(kindCounts([]), { source: 0, delivery: 0, revision: 0, data: 0 });
	assert.equal(changeId(ROWS[0]), "2026-11-12 Plāns A-101 — versija 2");
	assert.ok(changeId(row("data", "2026-11-01", "x".repeat(300))).length <= 120);
});

test("a model pair side by side: two IFC tabs in two panes, the camera linked; the other modes are BimCraft's own compare in one tab", () => {
	const p = planFor(ROWS[1], "side");
	assert.equal(p.how, "split");
	if (p.how !== "split") return;
	assert.deepEqual([p.a.label, p.b.label, p.dir, p.linkedCamera], ["AR r2", "AR r3", "h", true]);
	assert.deepEqual([p.a.target, p.b.target], [{ kind: "ifc", path: "rev:r2", label: "AR r2" }, { kind: "ifc", path: "rev:r3", label: "AR r3" }]);
	assert.equal((planFor(ROWS[1], "side", "v") as { dir: string }).dir, "v");
	// the plan makes the right split in the viewer
	const s = V.compareSplit(V.emptyViewer(), p.a, p.b, p.dir);
	assert.deepEqual(V.problems(s), []);
	assert.deepEqual([s.split, s.panes.length, s.linkedCamera, s.tabs.map((t) => t.label)], ["h", 2, true, ["AR r2", "AR r3"]]);
	for (const mode of ["overlay", "changes"] as const) {
		const o = planFor(ROWS[1], mode);
		assert.equal(o.how, "compare");
		assert.deepEqual(o.how === "compare" && o.target, { kind: "compare", a: "rev:r2", b: "rev:r3", aLabel: "AR r2", bLabel: "AR r3", mode: "ifc" }, `${mode}: BimCraft paints the changes itself`);
	}
});

test("a sheet pair is the sheet compare in every mode; \"only changes\" asks it to list only the sheets that differ", () => {
	const overlay = planFor(ROWS[0], "overlay");
	assert.deepEqual(overlay.how === "compare" && overlay.target, { kind: "compare", a: "blob:aa", b: "blob:bb", aLabel: "A-101 v1", bLabel: "A-101 v2", mode: "sheet" });
	const changes = planFor(ROWS[0], "changes");
	assert.equal(changes.how === "compare" && changes.target.only, true);
	assert.equal(changes.how === "compare" && changes.label, "A-101 v1 ↔ A-101 v2");
	const side = planFor(ROWS[0], "side");
	assert.equal(side.how, "compare", "a sheet pair shows both issues itself: no split");
	// one tab, and opening the same pair in the other mode updates that tab
	const a = V.open(V.emptyViewer(), (overlay as { target: V.ViewTarget }).target, "x");
	const b = V.open(a, (changes as { target: V.ViewTarget }).target, "x");
	assert.equal(b.tabs.length, 1);
	assert.equal((b.tabs[0].target as { only?: boolean }).only, true);
});

test("a change with no compare opens its file: a model in 3D, a source as a document; a change with nothing says so", () => {
	assert.deepEqual(planFor(ROWS[4], "side"), { how: "open", target: { kind: "ifc", path: "BD1/AR.ifc", label: "IFC AR — pirmā versija" }, label: "IFC AR — pirmā versija" });
	assert.deepEqual(planFor(ROWS[2], "overlay"), { how: "open", target: { kind: "source", sourceId: "s9" }, label: "Nodevums MBP 1" });
	assert.deepEqual(planFor(ROWS[3], "overlay"), { how: "none", why: "Šai izmaiņai nav, ko atvērt." });
});

test("the mode buttons: a model pair has side / overlay / changes, a sheet pair overlay / changes, a lone file or nothing none", () => {
	assert.deepEqual(modesFor(ROWS[1]), ["side", "overlay", "changes"]);
	assert.deepEqual(modesFor(ROWS[0]), ["overlay", "changes"]);
	assert.deepEqual(modesFor(ROWS[4]), []);
	assert.deepEqual(modesFor(null), []);
});

test("stepping through a month of changes: each pick opens in the viewer without breaking it", () => {
	let s = V.emptyViewer();
	for (const r of ROWS) {
		for (const mode of ["side", "overlay", "changes"] as const) {
			const p = planFor(r, mode);
			if (p.how === "split") s = V.compareSplit(s, p.a, p.b, p.dir);
			else if (p.how === "compare" || p.how === "open") s = V.open(s, p.target, p.label);
			assert.deepEqual(V.problems(s), [], `${r.label} / ${mode}`);
		}
	}
});
