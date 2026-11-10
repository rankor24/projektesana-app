// 7.3 Revit sheets → one PDF per sheet into staging; 7.4 the IFC. Revit is replaced by a caller that answers in the add-in's
// recorded envelope and writes the file where Revit would; names and numbers invented.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { ifcFileName, sheetFileName, sheetFileNames } from "../src/revit/sheet-names.ts";
import { pickSheets, stageRevitIfc, stageRevitSheets } from "../src/revit/stage.ts";
import { revitExport } from "../src/revit/exports.ts";
import { startDraft } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

const envelope = (nonce: string, value: unknown) => `Code execution successful!\nResult: ${JSON.stringify({ success: true, result: JSON.stringify({ nonce, value }), errorMessage: "" }, null, 2)}`;

const SHEETS = [
	{ id: "2001", number: "AR-1", name: "Ģenerālplāns", revision: null },
	{ id: "2002", number: "AR-3", name: "Fasādes ziemeļu/dienvidu", revision: "B" },
	{ id: "2003", number: "AR-4", name: "Griezums 1-1", revision: "" },
];

/** A Revit that lists SHEETS and "exports" by writing the file; `failOn` makes one sheet fail; `noFile` writes nothing. */
function fakeRevit(o: { failOn?: string; noFile?: string; foreign?: boolean } = {}) {
	const calls: { kind: string; params: string[]; mode: string }[] = [];
	return {
		calls,
		call: async (_t: string, a: Record<string, unknown> = {}) => {
			const code = String(a.code);
			const p = a.parameters as string[];
			const nonce = o.foreign ? "pj-ffffffffffff" : p.at(-1)!;
			if (code.includes("typeof(ViewSheet)")) {
				calls.push({ kind: "list", params: p, mode: String(a.transactionMode) });
				return envelope(nonce, SHEETS);
			}
			if (code.includes("PDFExportOptions")) {
				calls.push({ kind: "pdf", params: p, mode: String(a.transactionMode) });
				if (p[2] === o.failOn) return `Code execution failed: Export error on sheet ${p[2]}`;
				if (p[2] !== o.noFile) writeFileSync(join(p[0], `${p[1]}.pdf`), "%PDF");
				return envelope(nonce, true);
			}
			if (code.includes("IFCExportOptions")) {
				calls.push({ kind: "ifc", params: p, mode: String(a.transactionMode) });
				writeFileSync(join(p[0], p[1]), "ISO-10303-21;");
				return envelope(nonce, true);
			}
			throw new Error("unexpected snippet");
		},
	};
}

function draft() {
	const root = join(tmp(), "BD427-2026_Testa iela 1");
	mkdirSync(root, { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD427", name: "BD427", root, createdAt: "2026-11-10T00:00:00Z" });
	return { store, d: startDraft(store, "MBP", "2026-11-10", "user") };
}

test("7.3 sheet file names: <number>_<name>, diacritics folded, slashes out; no number refused; folded clashes refused", () => {
	assert.equal(sheetFileName("AR-3", "Fasādes ziemeļu/dienvidu"), "AR-3_Fasades ziemelu_dienvidu");
	assert.equal(sheetFileName(" AR 5 ", "Jumta plāns"), "AR-5_Jumta plans");
	assert.throws(() => sheetFileName("", "Plāns"), /nav numura/);
	assert.throws(() => sheetFileNames([{ number: "AR-1", name: "Plāns" }, { number: "ar-1", name: "plans" }]), /viens faila nosaukums/);
});

test("7.3 listSheets parses the recorded envelope; a reply with another call's nonce is refused", async () => {
	const s = await revitExport.listSheets(fakeRevit());
	assert.deepEqual(s.map((x) => [x.number, x.revision]), [["AR-1", null], ["AR-3", "B"], ["AR-4", null]]);
	await assert.rejects(revitExport.listSheets(fakeRevit({ foreign: true })), /nepieder šim izsaucienam/);
	assert.deepEqual(pickSheets(s, ["ar-3", "AR-9"]).unknown, ["AR-9"]);
});

test("7.3 all sheets: one call per sheet, no transaction, files in staging, draft items refreshed; existing kept unless replace", async () => {
	const { store, d } = draft();
	const r = fakeRevit();
	const progress: string[] = [];
	const res = await stageRevitSheets(store, r, d.id, { onProgress: (n, t, c) => progress.push(`${n}/${t} ${c}`) }, "user");
	assert.deepEqual(res.exported, ["AR-1_Generalplans.pdf", "AR-3_Fasades ziemelu_dienvidu.pdf", "AR-4_Griezums 1-1.pdf"]);
	assert.deepEqual(r.calls.filter((c) => c.kind === "pdf").map((c) => [c.params[2], c.mode]), [["2001", "none"], ["2002", "none"], ["2003", "none"]]);
	assert.equal(progress.at(-1), "3/3 ");
	const items = store.read("deliveries").find((x) => x.id === d.id)!.items;
	assert.deepEqual(items.map((i) => i.sheetNo), ["AR-1", "AR-3", "AR-4"]);
	const again = await stageRevitSheets(store, fakeRevit(), d.id, { numbers: ["AR-3"] }, "user");
	assert.deepEqual([again.exported, again.kept], [[], ["AR-3_Fasades ziemelu_dienvidu.pdf"]]);
	const replaced = await stageRevitSheets(store, fakeRevit(), d.id, { numbers: ["AR-3"], replace: true }, "user");
	assert.deepEqual(replaced.exported, ["AR-3_Fasades ziemelu_dienvidu.pdf"]);
});

test("7.3 a failed sheet stops the run and says which; what was exported stays in the draft", async () => {
	const { store, d } = draft();
	await assert.rejects(stageRevitSheets(store, fakeRevit({ failOn: "2002" }), d.id, {}, "user"), /Lapa AR-3 “Fasādes ziemeļu\/dienvidu”.*eksportētas 1 no 3/);
	assert.equal(store.read("deliveries").find((x) => x.id === d.id)!.items.length, 1);
	await assert.rejects(stageRevitSheets(store, fakeRevit({ noFile: "2001" }), d.id, { replace: true }, "user"), /Revit neizveidoja AR-1_Generalplans\.pdf/);
});

test("7.4 IFC: <BD code>_<daļa>_<YYMMDD>.ifc into staging, in a transaction; a second one refused unless replace", async () => {
	assert.equal(ifcFileName("BD427", "ar", "2026-11-10"), "BD427_AR_261110.ifc");
	assert.equal(ifcFileName("BD427-2026_Testa", "BK", "2027-01-05"), "BD427_BK_270105.ifc");
	const { store, d } = draft();
	const r = fakeRevit();
	const { file } = await stageRevitIfc(store, r, d.id, {}, "user");
	assert.ok(existsSync(file));
	assert.ok(file.endsWith("BD427_AR_261110.ifc"));
	assert.equal(r.calls[0].mode, "auto");
	assert.equal(store.read("deliveries").find((x) => x.id === d.id)!.items.length, 1);
	await assert.rejects(stageRevitIfc(store, fakeRevit(), d.id, {}, "user"), /jau ir IFC/);
	await stageRevitIfc(store, fakeRevit(), d.id, { replace: true }, "user");
});
