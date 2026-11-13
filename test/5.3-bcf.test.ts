// 5.3 BCF: findings out and back in through BimCraft's own bcf.js; stable topic GUIDs; BIM Crew's discipline pairs.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { disciplinesOf, findingOfTopic, findingsToBcf, readBcfFile, stableGuid, topicOf } from "../src/checks/bcf.ts";
import type { Finding, Requirement } from "../src/core/model.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED } from "./helpers.ts";

const APP = join(BIMCRAFT_DIR ?? "", "app");
const at = "2026-11-06T10:00:00.000Z";

test("BIM Crew discipline pairs", () => {
	assert.equal(disciplinesOf("ARC vs STR clash", "").label, "AR vs BK");
	assert.equal(disciplinesOf("Clash (CON ARC) and (PLU X)", "").label, "BK vs UK");
	assert.equal(disciplinesOf("Sienas biezums", "", ["BD999-AR-modelis.ifc"]).label, "AR vs AR");
	assert.equal(disciplinesOf("bez koda", "").label, "unknown");
});

test("a decision without a stamped name is signed lietotājs, never the name set today", () => {
	const f: Finding = { id: "x9", checkId: "rooms", requirementId: null, severity: "error", where: {}, message: "m", key: "k9", state: "overridden", decision: { by: "user", at, reason: "pieņemts" }, firstSeen: at, lastSeen: at };
	const t = topicOf(f, undefined);
	assert.equal(t.comments[0].author, "lietotājs");
	assert.equal(t.description, "m\nlietotājs (2026-11-06): pieņemts");
});

test("stable GUIDs: the same finding is the same topic in every export", () => {
	assert.equal(stableGuid("x1"), stableGuid("x1"));
	assert.notEqual(stableGuid("x1"), stableGuid("x2"));
	assert.match(stableGuid("x1"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("round trip: finding → BCF 2.1 → topic with its requirement, decision and element", { skip: existsSync(join(APP, "bcf.js")) ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const req: Requirement = { id: "law:mbp-facades:0", origin: "law", citation: { kind: "law", act: "MK 529", actId: "269164", actVersionDate: "2026-01-01", readOn: "2026-11-03", point: "26.4.2. apakšpunkts", url: "https://likumi.lv/ta/id/269164#p26.4.2", quote: "26.4.2. ēkas fasādes ar augstuma atzīmēm;" }, text: "Fasādes ar augstuma atzīmēm", appliesTo: {}, checkId: "completeness", status: "failed", evidence: [], state: "confirmed", by: "app", at };
	const findings: Finding[] = [
		{ id: "x1", checkId: "completeness", requirementId: req.id, severity: "error", where: { deliveryId: "d1" }, message: "MBP 261005: nav atrasts “Fasādes ar augstuma atzīmēm”", key: "k1", state: "open", firstSeen: at, lastSeen: at },
		{ id: "x2", checkId: "rooms", requirementId: null, severity: "error", where: { roomNo: "202", elementGuid: "0Wall0000000000000002" }, message: "Telpa 202: platība atšķiras", key: "k2", state: "overridden", decision: { by: "user", name: "Jānis Testa", at, reason: "Mērīts pa apdari, pieņemts." }, firstSeen: at, lastSeen: at },
	];
	const bytes = await findingsToBcf(APP, findings, [req], { name: "BD999-AR.ifc" });
	const back = await readBcfFile(APP, bytes, ["BD999-AR.ifc"]);
	assert.equal(back.topics.length, 2);
	const t1 = back.topics.find((t) => t.guid === stableGuid("x1"))!;
	assert.equal(t1.status, "Open");
	assert.match(t1.description, /Prasība: Fasādes ar augstuma atzīmēm/);
	assert.match(t1.description, /MK 529 26\.4\.2\. apakšpunkts \(https:\/\/likumi\.lv\/ta\/id\/269164#p26\.4\.2\)/);
	const t2 = back.topics.find((t) => t.guid === stableGuid("x2"))!;
	assert.equal(t2.status, "Closed");
	assert.deepEqual(t2.viewpoints[0].selection, ["0Wall0000000000000002"]);
	assert.equal(t2.comments[0].text, "Mērīts pa apdari, pieņemts.");
	assert.equal(t2.comments[0].author, "Jānis Testa", "the comment is signed by whoever accepted the finding");
	assert.ok(t2.description.includes("Jānis Testa (2026-11-06): Mērīts pa apdari"), t2.description);
	assert.equal(t1.discipline, "AR vs AR");
	// and in again as a finding
	const f = findingOfTopic(t2);
	assert.equal(f.state, "closed");
	assert.equal(f.where.elementGuid, "0Wall0000000000000002");
	assert.equal(f.checkId, "bcf");
});
