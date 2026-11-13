// 8.14 Ekspertīze: an invented review of 12 remarks across 4 daļas in three layouts (markdown checklist, numbered remarks under daļa
// headings, a Check | Result | Comment table) — all found, each with its words on its page — then the store (import, the agent's
// remark with a checked quote, the user's decisions), the `expert` check (open remark = finding, closed remark closes it), the
// fix lists and the agent's tools. Invented names and text only.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { registerAppChecks } from "../src/checks/index.ts";
import { runChecks } from "../src/checks/run.ts";
import { addRemark, editRemark, fixList, importReview, readRemarks, remarkId, setRemarkState, summarize } from "../src/core/expertise.ts";
import { ProjectStore } from "../src/core/store.ts";
import { DOC_ROLES } from "../src/shared/roles.ts";
import { daļaOf, parseExpertReview } from "../src/sources/extract/expert.ts";
import { quoteOnPage } from "../src/sources/extract/common.ts";
import { proposeFreeRole } from "../src/sources/roles.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");

const PAGES = [
	`EKSPERTĪZES ATZINUMS
Projekts: Testa iela 1, Rīga
Auditors: Izdomāts Eksperts SIA

## A. Arhitektūras daļa (AR)
- [ ] **A1** ⚠️ — Nav norādīts evakuācijas ceļu platums 2. stāva plānā.
- [x] **A2** — Fasādes materiālu apraksts ir papildināts.
- [ ] **A3** — Jāprecizē durvju ugunsdrošības klase pie kāpņu telpas.
`,
	`Būvkonstrukciju daļa

1. Nav pievienots pamatu aprēķins ar grunts nestspējas pārbaudi. Atbildīgais: Jānis Testa
2. Pārseguma plātnes biezums rasējumā BK-3 neatbilst aprēķinam
   un jāprecizē pirms nodošanas.
3. Jāpievieno armējuma specifikācija kolonnām.

AVK daļa

4. Nav parādīts ventilācijas agregāta novietojums jumtā un tā svars.
5. Apkures sistēmas hidrauliskais aprēķins nav iesniegts.
6. Jāpievieno gaisa apmaiņas aprēķins telpām ar paaugstinātu mitrumu.
`,
	`UK daļa

| Pārbaude | Rezultāts | Komentārs |
|---|---|---|
| Pievada diametrs | Atbilst | |
| Kanalizācijas izlaides augstums | Nav norādīts pievienojuma punkta augstums | Precizēsim 2. redakcijā |
| Ūdens skaitītāja mezgls | Trūkst mezgla shēmas | |
| Lietus ūdeņu atvade | Jāpievieno aprēķins | |
`,
];

const byQuote = (rs: ReturnType<typeof parseExpertReview>["remarks"], part: string) => rs.find((r) => r.quote.includes(part))!;

// ---- the parser ---------------------------------------------------------------------------------------------------------------

test("8.14 parser: 12 remarks across 4 daļas, every one with its words on its page", () => {
	const { remarks, meta } = parseExpertReview(PAGES);
	assert.equal(remarks.length, 12, JSON.stringify(remarks.map((r) => r.quote)));
	const count = (d: string) => remarks.filter((r) => r.daļa === d).length;
	assert.deepEqual([count("AR"), count("BK"), count("AVK"), count("UK")], [3, 3, 3, 3]);
	for (const r of remarks) assert.ok(quoteOnPage(PAGES[r.page - 1], r.quote), `not on page ${r.page}: ${r.quote}`);
	assert.deepEqual(meta, { auditor: "Izdomāts Eksperts SIA", project: "Testa iela 1, Rīga" });
});

test("8.14 parser: checklist details — code, critical, the reviewer's own [x]", () => {
	const { remarks } = parseExpertReview(PAGES);
	const a1 = byQuote(remarks, "evakuācijas ceļu");
	assert.deepEqual([a1.code, a1.critical, a1.done, a1.page], ["A1", true, false, 1]);
	const a2 = byQuote(remarks, "Fasādes materiālu");
	assert.deepEqual([a2.done, a2.critical], [true, false]);
	assert.equal(byQuote(remarks, "durvju ugunsdrošības").code, "A3");
});

test("8.14 parser: numbered remarks — wrapped lines join, the person is read only when the text names one", () => {
	const { remarks } = parseExpertReview(PAGES);
	const bk1 = byQuote(remarks, "pamatu aprēķins");
	assert.deepEqual([bk1.code, bk1.daļa, bk1.responsible, bk1.page], ["1", "BK", "Jānis Testa", 2]);
	const bk2 = byQuote(remarks, "Pārseguma plātnes");
	assert.match(bk2.quote, /neatbilst aprēķinam un jāprecizē pirms nodošanas\.$/, "the wrapped line is part of the remark");
	assert.equal(remarks.filter((r) => r.responsible).length, 1, "nobody else is named, nobody is guessed");
	assert.equal(byQuote(remarks, "ventilācijas agregāta").daļa, "AVK");
});

test("8.14 parser: table rows — only the rows that say something is wrong, the reply kept", () => {
	const { remarks } = parseExpertReview(PAGES);
	const uk = remarks.filter((r) => r.daļa === "UK");
	assert.equal(uk.length, 3, "“Atbilst” is not a remark");
	assert.ok(!remarks.some((r) => r.quote === "Atbilst"));
	const k = byQuote(remarks, "pievienojuma punkta augstums");
	assert.equal(k.reply, "Precizēsim 2. redakcijā");
	assert.equal(k.page, 3);
	assert.equal(byQuote(remarks, "mezgla shēmas").reply, null);
});

test("8.14 parser: a contents list, a heading and plain prose are not remarks; a text with no review in it gives none", () => {
	const toc = parseExpertReview([`SATURS\n1. Ievads ................ 3\n2. Arhitektūras daļas vērtējums ........ 4\n\nIevads\nŠis dokuments apraksta projekta stāvokli un ir informatīvs. Nekādu trūkumu nav.\n`]);
	assert.deepEqual(toc.remarks, []);
	assert.deepEqual(parseExpertReview([""]).remarks, []);
	assert.deepEqual(parseExpertReview([]).remarks, []);
});

test("8.14 parser: daļa from a heading or a word stem; ambiguous short words are not trusted", () => {
	assert.equal(daļaOf("AVK-A daļa"), "AVK-A");
	assert.equal(daļaOf("Būvkonstrukciju daļa"), "BK");
	assert.equal(daļaOf("Elektroapgādes shēma"), "EL");
	assert.equal(daļaOf("Ūdensapgāde un kanalizācija"), "UK");
	assert.equal(daļaOf("IN DA DN"), null);
	assert.equal(daļaOf("Vispārīgi"), null);
});

// ---- the store ----------------------------------------------------------------------------------------------------------------

function setup() {
	registerAppChecks();
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.1_Izejas dati"), { recursive: true });
	const store = ProjectStore.open(tmp(), { id: "BD999", name: "BD999 Testa iela 1", root, createdAt: "2026-11-13T00:00:00Z" });
	store.writeText("sha_exp", { pages: PAGES, state: "ok" });
	store.write(
		"sources",
		[{ id: "s_exp", kind: "document", folderKey: "1.1.9", paths: ["01_Projektesana\\1.1_Izejas dati\\Atzinums.pdf"], title: "Atzinums.pdf", role: "Cits", roleFrom: "unconfirmed", versions: [{ sha256: "sha_exp", size: 1, mtime: "2026-11-01T00:00:00Z", seenAt: "2026-11-13T00:00:00Z", textState: "ok", pages: 3 }], signers: [] } as never],
		{ kind: "t", by: "app" },
	);
	return store;
}
const NOW = new Date("2026-11-13T10:00:00Z");

test("8.14 import: 12 remarks, the reviewer's [x] arrives done with that reason; reading again adds nothing and keeps the user's work", () => {
	const store = setup();
	const r = importReview(store, "s_exp", "user", NOW);
	assert.deepEqual([r.found, r.added, r.kept], [12, 12, 0]);
	assert.equal(r.meta.auditor, "Izdomāts Eksperts SIA");
	const all = readRemarks(store);
	assert.equal(all.filter((x) => x.state === "open").length, 11);
	const done = all.find((x) => x.state === "done")!;
	assert.match(done.note!, /atzīmēts atzinumā/);
	// the user works on one, then the review is read again
	const target = all.find((x) => x.quote.includes("pamatu aprēķins"))!;
	setRemarkState(store, target.id, "done", "aprēķins pievienots", NOW);
	editRemark(store, target.id, { responsible: "Anna Paraugs" });
	const again = importReview(store, "s_exp", "user", NOW);
	assert.deepEqual([again.found, again.added, again.kept], [12, 0, 12]);
	const kept = readRemarks(store).find((x) => x.id === target.id)!;
	assert.deepEqual([kept.state, kept.note, kept.responsible], ["done", "aprēķins pievienots", "Anna Paraugs"]);
	assert.equal(readRemarks(store).length, 12);
	assert.throws(() => importReview(store, "s_nav"), /nav atrasts/);
});

test("8.14 agent remark: the quote must be on that page of that source; the daļa is upper-cased; the same remark is one", () => {
	const store = setup();
	const quote = "Pārseguma plātnes biezums rasējumā BK-3 neatbilst aprēķinam\n   un jāprecizē pirms nodošanas.";
	const r = addRemark(store, { sourceId: "s_exp", page: 2, quote, daļa: "bk", critical: true }, "agent", NOW);
	assert.deepEqual([r.daļa, r.critical, r.state, r.by, r.id], ["BK", true, "open", "agent", remarkId("s_exp", 2, quote)]);
	assert.equal(addRemark(store, { sourceId: "s_exp", page: 2, quote }, "agent", NOW).id, r.id);
	assert.equal(readRemarks(store).length, 1);
	assert.throws(() => addRemark(store, { sourceId: "s_exp", page: 1, quote }, "agent"), /tas ir 2\. lapā/);
	assert.throws(() => addRemark(store, { sourceId: "s_exp", page: 2, quote: "šī teksta atzinumā nav nekur" }, "agent"), /nav atrodams/);
	assert.throws(() => addRemark(store, { sourceId: "s_exp", page: 9, quote }, "agent"), /nav lapas 9/);
	// the code import then finds the same remark and does not duplicate it
	importReview(store, "s_exp", "user", NOW);
	assert.equal(readRemarks(store).filter((x) => x.quote.includes("Pārseguma plātnes")).length, 1);
});

test("8.14 decisions: not applicable needs a reason; a closed remark can be reopened; unknown id is said", () => {
	const store = setup();
	importReview(store, "s_exp", "user", NOW);
	const id = readRemarks(store).find((x) => x.state === "open")!.id;
	assert.throws(() => setRemarkState(store, id, "na", "  "), /pamatojums/);
	assert.throws(() => setRemarkState(store, id, "na", null), /pamatojums/);
	const na = setRemarkState(store, id, "na", "attiecas uz citu ēku", NOW);
	assert.deepEqual([na.state, na.note, na.decidedAt], ["na", "attiecas uz citu ēku", NOW.toISOString()]);
	const re = setRemarkState(store, id, "open", "ignorēts", NOW);
	assert.deepEqual([re.state, re.note, re.decidedAt], ["open", null, null]);
	assert.throws(() => setRemarkState(store, "nav", "done", null), /nav atrasta/);
	assert.throws(() => editRemark(store, "nav", { daļa: "AR" }), /nav atrasta/);
	assert.equal(editRemark(store, id, { daļa: "el" }).daļa, "EL");
	assert.equal(editRemark(store, id, { daļa: "" }).daļa, null);
});

// ---- the check ---------------------------------------------------------------------------------------------------------------

test("8.14 check: an open remark is a finding on its source and page; closing the remark closes the finding", async () => {
	const store = setup();
	const run = () => runChecks(store, "manual", { dataDir: DATA, today: "2026-11-13", only: ["expert"] });
	await run();
	assert.deepEqual(store.read("findings").filter((f) => f.checkId === "expert"), [], "nothing to say before a review is read");
	importReview(store, "s_exp", "user", NOW);
	await run();
	const open = () => store.read("findings").filter((f) => f.checkId === "expert" && f.state === "open");
	assert.equal(open().length, 11);
	const crit = open().filter((f) => f.severity === "error");
	assert.equal(crit.length, 1);
	assert.match(crit[0].message, /Ekspertīze \(AR\) A1, Atzinums\.pdf 1\. lpp\.: «Nav norādīts evakuācijas ceļu platums/);
	assert.deepEqual([crit[0].where.sourceId, crit[0].where.page], ["s_exp", 1]);
	const bk1 = readRemarks(store).find((x) => x.quote.includes("pamatu aprēķins"))!;
	assert.match(open().find((f) => f.message.includes("pamatu aprēķins"))!.message, /atbildīgais: Jānis Testa/);
	setRemarkState(store, bk1.id, "done", null, NOW);
	await run();
	assert.equal(open().length, 10, "closed with the remark");
	assert.equal(store.read("findings").filter((f) => f.checkId === "expert" && f.state === "closed").length, 1);
	setRemarkState(store, bk1.id, "open", null, NOW);
	await run();
	assert.equal(open().length, 11, "reopened with the remark");
	assert.ok(open().every((f) => !f.where.deliveryId), "a remark does not block a delivery");
});

// ---- views --------------------------------------------------------------------------------------------------------------------

test("8.14 summary and fix lists: counts per daļa and person; open remarks only, critical first, with page and words", () => {
	const store = setup();
	importReview(store, "s_exp", "user", NOW);
	const all = readRemarks(store);
	const s = summarize(all);
	assert.deepEqual([s.total, s.open, s.done, s.na, s.critical, s.openCritical], [12, 11, 1, 0, 1, 1]);
	assert.deepEqual(s.byDaļa.map((g) => [g.key, g.total, g.open]).sort(), [["AR", 3, 2], ["AVK", 3, 3], ["BK", 3, 3], ["UK", 3, 3]]);
	assert.equal(s.byDaļa[s.byDaļa.length - 1].key, "AR", "sorted by what is still open: the daļa with a closed remark comes last");
	assert.deepEqual(s.byResponsible.find((g) => g.key === "Jānis Testa"), { key: "Jānis Testa", total: 1, open: 1, critical: 0 });
	assert.equal(s.byResponsible.find((g) => g.key === "nenorādīts")!.total, 11);
	const ar = fixList(all, "AR", { project: "BD999 Testa iela 1", date: "2026-11-13", titleOf: () => "Atzinums.pdf" });
	assert.match(ar, /^# Labojumu saraksts — AR/);
	assert.match(ar, /## Veicamie labojumi \(2\)/);
	assert.ok(ar.indexOf("evakuācijas ceļu") < ar.indexOf("durvju ugunsdrošības"), "critical first");
	assert.ok(!ar.includes("Fasādes materiālu"), "a remark the review marks done is not on the list");
	assert.match(ar, /\(Atzinums\.pdf, 1\. lpp\.\)/);
	assert.match(ar, /\*\*Statuss:\*\* \[ \] neizpildīts/);
	assert.match(fixList(all, "BK", { titleOf: () => "x" }), /\*\*Atbildīgais:\*\* Jānis Testa/);
	assert.match(fixList(all, "UK", { titleOf: () => "x" }), /\*\*Atbilde dokumentā:\*\* Precizēsim 2\. redakcijā/);
	assert.match(fixList(all, "ES", {}), /Atvērtu piezīmju nav\./);
	assert.match(fixList(all, null, {}), /daļa nav norādīta/);
});

test("8.14 role: the review has its own role, proposed from a folder name, and a document can be given it", () => {
	assert.equal(proposeFreeRole("1.1.12_Ekspertīzes atzinumi"), "Ekspertīzes atzinums");
	assert.equal(proposeFreeRole("1.1.9_Atzinums"), "Ekspertīzes atzinums");
	assert.equal(proposeFreeRole("1.1.10_Saskaņojumi"), "Saskaņojumi", "the other roles are as they were");
	assert.ok(DOC_ROLES.includes("Ekspertīzes atzinums"));
});

// ---- the agent's tools --------------------------------------------------------------------------------------------------------

test("8.14 tools: levels, import then add, the quote is checked, and no tool closes a remark", async () => {
	const store = setup();
	const tools = allTools();
	const lv = (n: string) => tools.find((t) => t.name === n)?.level;
	assert.deepEqual(["expert_import", "expert_add", "expert_remarks", "expert_fix_list"].map(lv), ["run", "propose", "read", "read"]);
	assert.deepEqual(tools.map((t) => t.name).filter((n) => /expert/.test(n) && /state|close|done|resolve|decide/.test(n)), []);
	const ctx: ToolCtx = { projectsDir: join(store.dir, ".."), projectId: "BD999", dataDir: DATA, appDir: tmp(), runDir: null };
	const run = (n: string, a: Record<string, unknown>) => tools.find((t) => t.name === n)!.run(ctx, a as never) as Promise<Record<string, unknown>> | Record<string, unknown>;
	assert.match(String(await run("expert_remarks", {})), /no data/);
	const imp = (await run("expert_import", { sourceId: "s_exp" })) as { found: number; added: number; now: { open: number } };
	assert.deepEqual([imp.found, imp.added, imp.now.open], [12, 12, 11]);
	assert.equal(store.read("findings").filter((f) => f.checkId === "expert" && f.state === "open").length, 11, "the findings follow the import");
	await assert.rejects(Promise.resolve(run("expert_add", { sourceId: "s_exp", page: 2, quote: "izdomāts teksts, kas atzinumā nav" })), /nav atrodams/);
	const listed = (await run("expert_remarks", { daļa: "uk", state: "open" })) as { remarks: { daļa: string }[]; summary: { total: number } };
	assert.deepEqual([listed.remarks.length, listed.summary.total], [3, 12]);
	assert.ok(listed.remarks.every((r) => r.daļa === "UK"));
	const fl = String(await run("expert_fix_list", { daļa: "AVK" }));
	assert.match(fl, /Labojumu saraksts — AVK/);
	assert.match(fl, /BD999 Testa iela 1/);
	assert.match(String(await run("expert_fix_list", { daļa: "nenoteikta" })), /daļa nav norādīta/);
});
