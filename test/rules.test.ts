import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { groupOf, procedureOf, requiredContent, technicalRulesDeadline, bimModelRequired } from "../src/main/rules/engine.ts";
import { loadRules, verifyRules, quoteStillInPage } from "../src/main/rules/verify.ts";
import { checklistFor } from "../src/main/rules/checklist.ts";
import { easterSunday, holidaysOf } from "../src/main/rules/holidays.ts";

const data = join(import.meta.dirname, "..", "data");
const rules = loadRules(data);

test("every shipped rule has a verbatim quote found in its likumi.lv snapshot", () => {
	const v = verifyRules(rules, join(data, "law-snapshots"));
	assert.deepEqual(v.failures, []);
	assert.ok(v.checked >= 40);
});

test("a tampered quote fails verification", () => {
	const bad = rules.map((r, i) => (i === 0 ? { ...r, quote: r.quote + " un vēl kaut kas" } : r));
	const v = verifyRules(bad, join(data, "law-snapshots"));
	assert.equal(v.ok, false);
	assert.equal(v.failures[0].id, rules[0].id);
});

test("quoteStillInPage flags a changed page", () => {
	assert.equal(quoteStillInPage(rules[0], "kaut kas cits"), false);
	assert.equal(quoteStillInPage(rules[0], `xx ${rules[0].quote} yy`), true);
});

test("group: public building over 1000 m2 is group 3, with its rule", () => {
	const g = groupOf({ work: "new_build", use: "public", floorsAbove: 3, totalAreaM2: 1200 });
	assert.equal(g.value, 3);
	assert.deepEqual(g.because, ["grp3-public-area"]);
});

test("group: 7 floors is group 3; 6 is not", () => {
	assert.equal(groupOf({ work: "new_build", use: "residential_other", floorsAbove: 7 }).value, 3);
	assert.equal(groupOf({ work: "new_build", use: "residential_other", floorsAbove: 6 }).value, 2);
});

test("group: single storey 60 m2 is group 1, 61 m2 is group 2", () => {
	assert.equal(groupOf({ work: "new_build", use: "auxiliary", floorsAbove: 1, footprintM2: 60 }).value, 1);
	assert.equal(groupOf({ work: "new_build", use: "auxiliary", floorsAbove: 1, footprintM2: 61 }).value, 2);
});

test("group: documented group (Inv.lieta) wins and asks for a check", () => {
	const g = groupOf({ work: "reconstruction", use: "public", documentedGroup: 2 });
	assert.equal(g.value, 2);
	assert.ok(g.check.length > 0);
});

test("group: missing area for a public building is flagged, not guessed", () => {
	assert.ok(groupOf({ work: "new_build", use: "public", floorsAbove: 2 }).check.length > 0);
});

test("procedure: public group-3 new build goes to MBP + būvatļauja (7.3)", () => {
	const p = procedureOf({ work: "new_build", use: "public", floorsAbove: 3, totalAreaM2: 2500 });
	assert.equal(p.value, "mbp_buvatlauja");
	assert.deepEqual(p.because, ["proc-mbp"]);
});

test("procedure: group-1 shed new build is a notice (7.1 4.)", () => {
	assert.equal(procedureOf({ work: "new_build", use: "auxiliary", floorsAbove: 1, footprintM2: 30 }).value, "pazinojums");
});

test("procedure: use change without reconstruction is explanatory note (7.2 7.)", () => {
	assert.equal(procedureOf({ work: "use_change", use: "public" }).value, "paskaidrojuma_raksts");
});

test("every rule id cited by the engine exists in rules.json", () => {
	const ids = new Set(rules.map((r) => r.id));
	const works = ["new_build", "reconstruction", "simple_reconstruction", "renovation", "simplified_renovation", "use_change", "demolition"] as const;
	const uses = ["residential_1_2", "residential_other", "public", "auxiliary"] as const;
	for (const work of works)
		for (const use of uses) {
			const f = { work, use, floorsAbove: 1, footprintM2: 40, totalAreaM2: 40 };
			for (const id of [...procedureOf(f).because, ...groupOf(f).because]) assert.ok(ids.has(id), id);
		}
});

test("required content for a group-3 new build at MBP: AR plans, facades, sections and GP, each with article", () => {
	const f = { work: "new_build" as const, use: "public" as const, floorsAbove: 3, totalAreaM2: 2500 };
	const r = requiredContent(rules, f, "mbp");
	const items = r.items.map((x) => x.item);
	assert.ok(items.includes("Ģenerālplāns"));
	assert.ok(items.includes("Fasādes ar augstuma atzīmēm"));
	assert.ok(items.includes("Raksturīgie griezumi ar augstuma atzīmēm"));
	assert.ok(r.items.every((x) => x.article.startsWith("MK 529") && x.quote.length > 0));
});

test("skice stage warns that the law prescribes no content list", () => {
	const r = requiredContent(rules, { work: "new_build", use: "public", floorsAbove: 3, totalAreaM2: 2500 }, "skice");
	assert.ok(r.notes[0].includes("LBN 202-18"));
	assert.ok(r.items.length > 0);
});

test("BP group 3 uses 72.x, group 2 uses 71.x", () => {
	const g3 = requiredContent(rules, { work: "new_build", use: "public", floorsAbove: 3, totalAreaM2: 2500 }, "bp");
	assert.ok(g3.items.some((x) => x.ruleId === "bp3-ar-details"));
	const g2 = requiredContent(rules, { work: "new_build", use: "residential_other", floorsAbove: 4 }, "bp");
	assert.ok(g2.items.some((x) => x.ruleId === "bp2-ar-sections") && !g2.items.some((x) => x.ruleId.startsWith("bp3")));
});

test("BIM model is required only for publicly funded group-3 new builds", () => {
	const f = { work: "new_build" as const, use: "public" as const, floorsAbove: 3, totalAreaM2: 2500 };
	assert.equal(bimModelRequired({ ...f, publicFunded: true }), true);
	assert.equal(bimModelRequired(f), false);
});

test("technical rules: 11 working days skip weekends AND public holidays (18 November 2026 is a holiday)", () => {
	const d = technicalRulesDeadline("2026-11-03", "state_municipal");
	assert.equal(d.due, "2026-11-19");
	assert.equal(d.holidaysExcluded, true);
	assert.match(d.caveat, /Dziesmu un deju svētku/);
	assert.equal(d.rule, "tr-deadline-state");
	// no holiday in between: plain 11 weekdays
	assert.equal(technicalRulesDeadline("2026-02-02", "network_owner").due, "2026-02-17");
});

test("holidays: Easter by computus, weekend moves, Christmas block, one-offs", () => {
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	assert.equal(iso(easterSunday(2024)), "2024-03-31");
	assert.equal(iso(easterSunday(2025)), "2025-04-20");
	assert.equal(iso(easterSunday(2026)), "2026-04-05");
	const h26 = holidaysOf(2026);
	for (const d of ["2026-04-03", "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-24", "2026-06-23", "2026-06-24", "2026-11-18", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31"]) assert.ok(h26.has(d), d);
	// 4 May 2025 is a Sunday -> Monday 5 May is a day off; 18 Nov 2023 is a Saturday -> Monday 20 Nov
	assert.ok(holidaysOf(2025).has("2025-05-05"));
	assert.ok(holidaysOf(2023).has("2023-11-20"));
	assert.ok(holidaysOf(2023).has("2023-05-29"));
	assert.ok(!holidaysOf(2026).has("2026-05-05"));
});

test("every holiday rule cites the holidays act and exists in rules.json", () => {
	for (const id of ["hol-list", "hol-easter", "hol-christmas", "hol-move"]) assert.ok(rules.some((r) => r.id === id && r.actId === "72608"), id);
});

test("checklist: rooms required for new builds; BIM item only when required", () => {
	const f = { work: "new_build" as const, use: "public" as const, floorsAbove: 3, totalAreaM2: 2500 };
	const c = checklistFor(f);
	assert.equal(c.find((x) => x.id === "rooms")?.required, true);
	assert.ok(!c.some((x) => x.id === "bim"));
	assert.ok(checklistFor({ ...f, publicFunded: true }).some((x) => x.id === "bim"));
});
