// 0.2 carried rules: every rule quote is in its likumi.lv snapshot; working days with holidays; engine answers.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { groupOf, procedureOf, technicalRulesDeadline } from "../src/rules/engine.ts";
import { Library } from "../src/rules/library.ts";
import { htmlToText, loadRules, verifyRules } from "../src/rules/rules.ts";
import { addWorkingDays, easterSunday, isWorkingDay, workingDaysBetween } from "../src/rules/workdays.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");

test("rules: all shipped quotes are verbatim in the snapshots", () => {
	const rules = loadRules(DATA);
	assert.ok(rules.length >= 50);
	const v = verifyRules(rules, join(DATA, "law-snapshots"));
	assert.deepEqual(v.failures, []);
});

test("rules: a changed quote fails verification", () => {
	const [r] = loadRules(DATA);
	const v = verifyRules([{ ...r, quote: r.quote.replace("atkāpes", "izņēmumi") }], join(DATA, "law-snapshots"));
	assert.equal(v.ok, false);
	assert.match(v.failures[0].reason, /citāts/);
});

test("rules: html to text keeps 7.1 whole", () => {
	assert.equal(htmlToText("<p>punkts 7.<sup>1</sup></p><p>Nākamais&nbsp;teksts</p>"), "punkts 7.1 Nākamais teksts");
});

test("workdays: Easter and the fixed holidays", () => {
	assert.equal(easterSunday(2027).toISOString().slice(0, 10), "2027-03-28");
	assert.equal(isWorkingDay(new Date("2026-11-18T00:00:00Z")), false);
	assert.equal(isWorkingDay(new Date("2026-11-19T00:00:00Z")), true);
	assert.equal(isWorkingDay(new Date("2027-03-26T00:00:00Z")), false, "Good Friday");
});

test("workdays: counts skip weekends and holidays", () => {
	assert.equal(addWorkingDays("2026-11-16", 3), "2026-11-20");
	assert.equal(addWorkingDays("2026-12-23", 2), "2026-12-29");
	assert.equal(workingDaysBetween("2026-12-23", "2026-12-29"), 2);
	assert.equal(workingDaysBetween("2026-12-29", "2026-12-23"), -2);
	assert.equal(technicalRulesDeadline("2026-11-16", "network_owner").due, addWorkingDays("2026-11-16", 11));
});

test("engine: public building over 1000 m2 is group 3, MBP route", () => {
	const f = { work: "new_build", use: "public", floorsAbove: 3, totalAreaM2: 1200 } as const;
	const g = groupOf(f);
	assert.equal(g.value, 3);
	assert.deepEqual(g.because, ["grp3-public-area"]);
	assert.equal(procedureOf(f).value, "mbp_buvatlauja");
});

test("library: search returns verbatim paragraphs of the built-in acts with their citation", () => {
	const lib = new Library(tmp(), join(DATA, "law-snapshots"));
	const hits = lib.search("tehniskos noteikumus", { limit: 5 });
	assert.ok(hits.length > 0);
	assert.ok(hits.every((h) => h.url?.startsWith("https://likumi.lv/ta/id/") && h.readOn === "2026-11-03"));
});
