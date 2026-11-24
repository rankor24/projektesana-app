// LBN 202-18 markas (shared/markas.ts): the list equals the annex of the law text the app ships; the BD roles hold the markas of docs/BD 00_README; a marka is read from
// a sheet number, a file name or a folder; the agents' standing text carries the rule and the markas; a saved spec keeps (and checks) its markas.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateSpec, standingFor } from "../src/agent/agents.ts";
import type { AgentSpec } from "../src/shared/agent-types.ts";
import {
	ALL_MARKAS,
	DEFAULT_MARKAS_OF,
	EXTRA_MARKAS,
	MARKAS,
	markaByCode,
	markaOfDeliveryFile,
	markaOfName,
	markaPill,
	markasOf,
	markasOfSkillGroup,
	markasOfDelivery,
	markasText,
	normMarka,
	ownersOfMarka,
	parseMarkas,
} from "../src/shared/markas.ts";

const snapshot = readFileSync(new URL("../data/law-snapshots/301303.txt", import.meta.url), "utf8");
const spec = (id: string, extra: Partial<AgentSpec> = {}): AgentSpec => ({ id, name: id.toUpperCase(), description: "", prompt: "x".repeat(40), tools: [], ...extra });

test("the list is the annex of LBN 202-18, row by row, in the law's order", () => {
	const annex = snapshot.slice(snapshot.indexOf("p.k.MarkaNosaukums") + "p.k.MarkaNosaukums".length, snapshot.indexOf("Tiesību akta pase"));
	// the law's text prints row number, code and name run together («4.ARArhitektūras risinājumi») and a space inside «ESS- CI»: compare with the spaces out
	const rows = annex
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => /^\d+\./.test(l))
		.map((l) => l.replace(/\s+/g, ""));
	assert.equal(rows.length, 68);
	assert.equal(MARKAS.length, 68);
	MARKAS.forEach((m, i) => assert.equal(rows[i], `${i + 1}.${m.code}${m.name}`.replace(/\s+/g, ""), `row ${i + 1}`));
	assert.equal(new Set(ALL_MARKAS.map((m) => m.code)).size, ALL_MARKAS.length, "no code twice");
	assert.ok(MARKAS.every((m) => m.official) && EXTRA_MARKAS.every((m) => !m.official));
	assert.match(snapshot, /17\. Būvprojekta atsevišķu daļu, darbu vai rasējumu nosaukumus saīsina, apzīmējot ar marku/, "the rule the agents are told is in the text");
	assert.match(snapshot, /Ja nepieciešams, var veidot arī papildu markas/);
});

test("codes as typed: case, spaces and dashes are forgiven, the rest is refused", () => {
	assert.equal(normMarka(" ess- ci "), "ESS-CI");
	assert.equal(markaByCode("avk–a")?.name, "Apkure");
	assert.equal(markaByCode("XYZ"), undefined);
	assert.deepEqual(parseMarkas("ar, bk; AVK-A\nar, nav, ess- tk"), { codes: ["AR", "BK", "AVK-A", "ESS-TK"], unknown: ["nav"] });
	assert.deepEqual(parseMarkas(""), { codes: [], unknown: [] });
});

test("the BD roles hold the markas of docs/BD 00_README; every default code is a known marka and each annex row has at most the owners the README gives", () => {
	for (const [id, codes] of Object.entries(DEFAULT_MARKAS_OF)) for (const c of codes) assert.ok(markaByCode(c), `${id}: ${c}`);
	assert.deepEqual(markasOf(spec("bk")), ["BK", "DZK", "MK", "KK", "MUK", "SK", "PK"]);
	assert.deepEqual(markasOf(spec("aa")), ["GP", "TS-L"]);
	assert.deepEqual(markasOf(spec("eks")), [], "the expertise holds none: it reads every section");
	assert.deepEqual(markasOf(spec("dokumenti")), [], "an agent of another id has none until it is given some");
	// a list of its own wins; [] takes them away
	assert.deepEqual(markasOf(spec("bk", { markas: ["BK"] })), ["BK"]);
	assert.deepEqual(markasOf(spec("bk", { markas: [] })), []);
	// owners are a list: an annex row can be held by more than one agent
	const team = Object.keys(DEFAULT_MARKAS_OF).map((id) => spec(id));
	assert.deepEqual(ownersOfMarka("ess-vn", team), ["ess"]);
	assert.deepEqual(ownersOfMarka("DVP", team), [], "an annex row nobody holds");
});

test("a skill group belongs to the markas of the agent its folder number names", () => {
	const team = ["bpv", "ar", "bk"].map((id) => spec(id));
	assert.deepEqual(markasOfSkillGroup("07-buvkonstrukcijas", team), ["BK", "DZK", "MK", "KK", "MUK", "SK", "PK"]);
	assert.deepEqual(markasOfSkillGroup("07-buvkonstrukcijas", [spec("bk", { markas: ["BK"] })]), ["BK"], "the person's own list wins");
	assert.deepEqual(markasOfSkillGroup("01-buvprojekta-vaditajs", team), ["SA"]);
	assert.deepEqual(markasOfSkillGroup("00-kopigie", team), [], "the common skills belong to nobody");
	assert.deepEqual(markasOfSkillGroup("08-uk", team), [], "no agent uk in this team");
	assert.deepEqual(markasOfSkillGroup("Revit prasmes (iebūvētās)", team), []);
});

test("the pill: one or two codes whole, more as the first and a count, none for an agent without markas; the tooltip names them", () => {
	assert.equal(markaPill([]), null);
	assert.equal(markaPill(["BAA"])?.text, "BAA");
	assert.equal(markaPill(["GP", "TS-L"])?.text, "GP · TS-L");
	assert.equal(markaPill(["UK", "UKT", "LKT", "DT"])?.text, "UK +3");
	assert.match(markaPill(["UK", "UKT"])!.title, /UK — Ūdensapgāde un kanalizācija \(iekšējā\)/);
	assert.match(markaPill(["LCA"], "own marka")!.title, /\(own marka\)/, "an office marka is marked as such");
});

test("a marka from a sheet number, a file name or a folder: a whole word only, the longest code first", () => {
	assert.equal(markaOfName("AR-01"), "AR");
	assert.equal(markaOfName("AVK-A-03 Apkures plāns.pdf"), "AVK-A");
	assert.equal(markaOfName("02_SA"), "SA");
	assert.equal(markaOfName("1.4.2_ESS_TK_plans"), "ESS");
	assert.equal(markaOfName("ESS-TK_03.pdf"), "ESS-TK");
	assert.equal(markaOfName("BD427_BK_00_Pamati.pdf"), "BK", "the BIS form NUMURS_MARKA_REVĪZIJA_LAPAS");
	assert.equal(markaOfName("ARHITEKTŪRA.pdf"), null, "AR inside a word is no marka");
	assert.equal(markaOfName("Tāme.xlsx"), null, "T is not the first letter of a word");
	assert.equal(markaOfName("T-01.pdf"), "T");
	assert.equal(markaOfName("Pārskats.pdf"), null);
	// a delivery file: the sheet number first, then the file name, then the folders nearest first
	assert.equal(markaOfDeliveryFile({ sheetNo: "BK-12", file: "p/1.4_Nodevumi/BP/x/anything.pdf" }), "BK");
	assert.equal(markaOfDeliveryFile({ sheetNo: null, file: "p/1.4.3_BP/02_SA/apraksts.pdf" }), "SA");
	assert.equal(markaOfDeliveryFile({ sheetNo: null, file: "p\\1.4.3_BP\\AR\\plans.pdf" }), "AR");
	assert.equal(markaOfDeliveryFile({ sheetNo: null, file: "p/1.4.3_BP/plans.pdf" }), null);
	const sum = markasOfDelivery([
		{ sheetNo: "BK-1", file: "a.pdf" },
		{ sheetNo: "AR-1", file: "b.pdf" },
		{ sheetNo: "AR-2", file: "c.pdf" },
		{ sheetNo: null, file: "d.pdf" },
	]);
	assert.deepEqual(sum, { counts: [{ code: "AR", files: 2 }, { code: "BK", files: 1 }], none: 1 }, "in the annex's order, files with none counted apart");
});

test("the agents' standing text: every agent has the rule; the lead the whole annex and who holds what; a specialist its own markas with names", () => {
	const team = ["bpv", "ar", "bk", "uk", "eks"].map((id) => spec(id));
	const lead = markasText(null, team);
	assert.match(lead, /LBN 202-18/);
	assert.match(lead, /likumi\.lv\/ta\/id\/301303/);
	for (const m of MARKAS) assert.ok(lead.includes(`${m.code} ${m.name}`), m.code);
	assert.match(lead, /- bk: BK, DZK, MK, KK, MUK, SK, PK/);
	assert.match(lead, /Markas bez aģenta: .*DVP/, "the annex rows nobody holds are named: the person says who takes them");
	assert.doesNotMatch(lead, /Markas bez aģenta: .*\bAR\b/);
	const bk = markasText(team[2], team);
	assert.match(bk, /Tavas markas: BK Būvkonstrukcijas; DZK Dzelzsbetona konstrukcijas/);
	assert.match(bk, /- uk: UK, UKT, LKT, DT/);
	assert.doesNotMatch(bk, /- bk:/, "not told its own line twice");
	assert.match(markasText(team[4], team), /Tev nav piešķirtu marku/);
	// the whole text of a run: the lead and a specialist both carry it
	const d = { appDir: mkdtempSync(join(tmpdir(), "markas-")), userName: "", specs: team, skills: [], knowledge: "" };
	assert.match(standingFor(null, d), /Pielikuma markas \(kods nosaukums\)/);
	assert.match(standingFor(team[1], d), /Tavas markas: UR Uzmērījuma rasējumi; VI /);
	// a lane (delegate) has no mail lines and no roster: no marka text either, it is the main agent's task text that names what it needs
	assert.doesNotMatch(standingFor(team[1], { ...d, lane: true }), /Tavas markas/);
	// the size: the lead carries the annex once; keep it under ~1 400 tokens at 4 characters a token so the 16 roles still fit LEAD_FIXED_MAX
	assert.ok(lead.length < 5_600, `lead marka text is ${lead.length} characters`);
	assert.ok(bk.length < 2_200, `specialist marka text is ${bk.length} characters`);
});

test("a saved spec keeps its markas, checks the codes, and an empty list is kept", () => {
	const levelOf = () => "read" as const;
	const base = { id: "bk", name: "BK", description: "", prompt: "Konstrukciju projektētājs, izdomāts teksts.", tools: [] };
	const ok = validateSpec({ ...base, markas: ["bk", "ess- tk", "BK"] }, levelOf, []);
	assert.ok(ok.ok && JSON.stringify(ok.spec.markas) === JSON.stringify(["BK", "ESS-TK"]), "normalised, once each");
	const none = validateSpec({ ...base, markas: [] }, levelOf, []);
	assert.ok(none.ok && JSON.stringify(none.spec.markas) === "[]");
	const absent = validateSpec(base, levelOf, []);
	assert.ok(absent.ok && absent.spec.markas === undefined, "absent stays absent: the default of the id");
	const bad = validateSpec({ ...base, markas: ["BK", "QQ"] }, levelOf, []);
	assert.ok(!bad.ok && /QQ/.test(bad.error));
	const notList = validateSpec({ ...base, markas: "BK" }, levelOf, []);
	assert.ok(!notList.ok);
});
