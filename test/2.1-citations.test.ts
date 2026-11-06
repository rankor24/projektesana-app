// 2.1 law citations: version dates from the acts' own amendment notes, anchors, upcoming points, changed text.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { actVersionDate, anchorOf, citationOf, snapshotOf, upcoming, validFromOf } from "../src/rules/citations.ts";
import { loadRules } from "../src/rules/rules.ts";

const DATA = join(import.meta.dirname, "..", "data");

test("act version on the read day = latest amendment date not after it", () => {
	const t = "1. Teksts (Grozīts ar MK 01.01.2020. noteikumiem, kas stājas spēkā 15.01.2020.) 2. Cits (Punkts stājas spēkā 01.03.2027.)";
	assert.equal(actVersionDate(t, "2026-11-03"), "2020-01-15");
	assert.deepEqual(upcoming(t, "2026-11-06").map((u) => u.from), ["2027-03-01"]);
});

test("the shipped MK 529 snapshot: version on 2026-11-03 and the 2027 points as upcoming", () => {
	const t = snapshotOf(DATA, "269164")!;
	assert.equal(actVersionDate(t, "2026-11-03"), "2026-01-01");
	assert.ok(upcoming(t, "2026-11-06").some((u) => u.from === "2027-03-01" && /26\.3\.1|Punkts/.test(u.note)));
});

test("anchors open the point on likumi.lv", () => {
	assert.equal(anchorOf("26. punkts"), "p26");
	assert.equal(anchorOf("9.1 panta trešā daļa"), "p9.1");
	assert.equal(anchorOf("72.3. apakšpunkts"), "p72.3");
	assert.equal(anchorOf("1. pielikums 2.2.1. apakšpunkts"), "piel1");
	for (const r of loadRules(DATA)) assert.match(citationOf(r, snapshotOf(DATA, r.actId), "2026-11-06").url, /^https:\/\/likumi\.lv\/ta\/id\/\d+(#(p|piel)[\d.]+)?$/, r.id);
});

test("a rule whose quote is gone from the snapshot is flagged; one with validFrom in the future is upcoming", () => {
	const [r] = loadRules(DATA);
	const text = snapshotOf(DATA, r.actId)!;
	assert.equal(citationOf(r, text, "2026-11-06").status, "spēkā");
	assert.equal(citationOf(r, text.replace(r.quote.slice(0, 40), "MAINĪTS TEKSTS"), "2026-11-06").status, "teksts mainījies");
	assert.equal(citationOf({ ...r, valid_from: "2027-03-01" }, text, "2026-11-06").status, "vēl nav spēkā");
	assert.equal(citationOf({ ...r, valid_from: "2027-03-01" }, text, "2027-03-02").status, "spēkā");
	assert.equal(citationOf(r, null, "2026-11-06").status, "nav pārbaudīts");
});

test("validFrom read from the note right after the quote", () => {
	assert.equal(validFromOf("74.2 Prasība par BIM modeli. (Punkts stājas spēkā 01.03.2027. un iekļauts …)", "Prasība par BIM modeli.", "2026-11-03"), "2027-03-01");
	assert.equal(validFromOf("74.1 Cita prasība. (MK 01.01.2020. noteikumu redakcijā, kas stājas spēkā 15.01.2020.)", "Cita prasība.", "2026-11-03"), null);
});

test("the next point's note does not leak into the previous point (26.2 vs 26.3.1)", () => {
	const t = "26.2. ģenerālplānu, kurā norādīta eksplikācija; 26.3. sadalījumu pa kārtām; 26.3.1 (apakšpunkts stājas spēkā 01.03.2027. un iekļauts …)";
	assert.equal(validFromOf(t, "26.2. ģenerālplānu, kurā norādīta eksplikācija;", "2026-11-03"), null);
});
