// 1.11 office delivery folders → BIM stages, folder dates; the profile view's rule (confirmed beats proposed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { dateOfFolder, deliveryKindOf, stageOfDelivery, STAGES_OF } from "../src/core/stages.ts";

test("delivery folder names → kinds", () => {
	assert.equal(deliveryKindOf("SKICE"), "SKICE");
	assert.equal(deliveryKindOf("Skiču projekts"), "SKICE");
	assert.equal(deliveryKindOf("MBP"), "MBP");
	assert.equal(deliveryKindOf("BP"), "BP");
	assert.equal(deliveryKindOf("Starpnodevums"), "STARP");
	assert.equal(deliveryKindOf("DT"), "DT");
	assert.equal(deliveryKindOf("Cits"), "custom");
});

test("kinds → BIM stages: SKICE and MBP are Skice; BP spans Tehniskais to Detalizācijas", () => {
	assert.deepEqual(STAGES_OF.SKICE, ["Skice"]);
	assert.deepEqual(STAGES_OF.MBP, ["Skice"]);
	assert.deepEqual(STAGES_OF.BP, ["Tehniskais", "Detalizācijas"]);
	assert.equal(stageOfDelivery("BP"), "Tehniskais");
	assert.equal(stageOfDelivery("STARP", { after: "BP" }), "Tehniskais");
	assert.equal(stageOfDelivery("STARP", { before: "MBP" }), "Skice");
	assert.equal(stageOfDelivery("custom"), "Koncept");
});

test("YYMMDD and other folder dates", () => {
	assert.equal(dateOfFolder("261005"), "2026-10-05");
	assert.equal(dateOfFolder("20261005_iesniegts"), "2026-10-05");
	assert.equal(dateOfFolder("2026-10-05"), "2026-10-05");
	assert.equal(dateOfFolder("261340"), null);
	assert.equal(dateOfFolder("versija 2"), null);
});

test("real 1.4 names (read on this PC): numbering prefix, kind anywhere, date anywhere", async () => {
	const { dateInName, deliveryKindOf } = await import("../src/core/stages.ts");
	const k = (n: string) => deliveryKindOf(n);
	assert.deepEqual(["1.4.1_Skices", "1.4.1_Pirmas skices", "1.4.2_MBP", "1.4.3_BP_260109", "1.4.4_BP_65%", "BP_Nodevums_260320", "BP BIS", "1.4.1_Paskaidrojuma raksts 260119", "2.starpziņojums", "Koku_cirsanas_iesniegums"].map(k), ["SKICE", "SKICE", "MBP", "BP", "BP", "BP", "BP", "PR", "STARP", "custom"]);
	assert.equal(dateInName("1.4.3_BP_260109"), "2026-01-09");
	assert.equal(dateInName("BP_Nodevums_260320"), "2026-03-20");
	assert.equal(dateInName("1.4.4_BP_65%"), null);
	assert.equal(dateInName("1.4.2_MBP"), null, "the numbering is not a date");
});
