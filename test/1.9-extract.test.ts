// 1.9 extraction and the agent's source tools on invented documents (test/fixtures/docs, pages split by form feed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { decideFact, proposeFact } from "../src/core/facts.ts";
import { profileOf, type Project } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { sourceTools, pageList } from "../src/agent/tools/sources.ts";
import { extractCadastral } from "../src/sources/extract/cadastral.ts";
import { extractPu, numberedRows } from "../src/sources/extract/pu.ts";
import { extractTaa } from "../src/sources/extract/taa.ts";
import { extractTn } from "../src/sources/extract/tn.ts";
import { extractTopo } from "../src/sources/extract/topo.ts";
import { FIX, tmp } from "./helpers.ts";

const doc = (name: string) => readFileSync(join(FIX, "docs", `${name}.txt`), "utf8").split("\f").map((p) => p.replace(/^\n/, ""));
const val = (c: { key: string; value: string }[], key: string) => c.filter((x) => x.key === key).map((x) => x.value);

test("PU: address, cadastral number, work type, group, stages, sections, numbered rows", () => {
	const p = doc("pu");
	const c = extractPu(p);
	assert.deepEqual(val(c, "profile.address"), ["Testa iela 1, Izdomāti, LV-0000"]);
	assert.deepEqual(val(c, "cadastral.building"), ["0000 000 0000 001"]);
	assert.deepEqual(val(c, "profile.workType"), ["reconstruction"]);
	assert.deepEqual(val(c, "profile.group"), ["3"]);
	// "skiču projektu un būvprojektu minimālā sastāvā": two stages, no plain BP
	assert.deepEqual(val(c, "profile.stagesInContract"), ["SKICE", "MBP"]);
	// ŪK starts with a Latvian letter: the ASCII \b would miss it; BIM is mentioned as "BIM vidē"
	assert.deepEqual(val(c, "profile.sections"), ["AR", "BK", "ŪK", "AVK", "EL", "DOP", "BIM"]);
	const rows = numberedRows(p);
	assert.deepEqual(rows.map((r) => r.no), ["1", "1.1", "1.2", "1.3", "1.4", "2", "2.1", "2.2", "2.3", "2.4"]);
	assert.equal(rows.find((r) => r.no === "2.3")!.page, 2);
	for (const x of c) assert.ok(p[x.page - 1].replace(/\s+/g, " ").includes(x.quote.replace(/\s+/g, " ")), `quote on page: ${x.quote}`);
});

test("property documents: designations by length, areas, owner", () => {
	const c = extractCadastral(doc("kadastrs"));
	assert.deepEqual(val(c, "cadastral.building"), ["0000 000 0000 001"]);
	assert.deepEqual(val(c, "profile.cadastralNo"), ["0000 000 0000"]);
	assert.deepEqual(val(c, "profile.totalAreaM2"), ["1234.5"]);
	assert.deepEqual(val(c, "cadastral.footprintM2"), ["456.7"]);
	assert.deepEqual(val(c, "cadastral.landArea"), ["0.4321 ha"]);
	assert.deepEqual(val(c, "cadastral.owner"), ["Izdomātā pašvaldība"]);
	assert.equal(c.find((x) => x.key === "profile.totalAreaM2")!.page, 2);
});

test("topo: author, survey date, approval date", () => {
	const c = extractTopo(doc("topo"));
	assert.deepEqual(val(c, "topo.author"), ['SIA "Izdomātie mērnieki"']);
	assert.deepEqual(val(c, "topo.surveyedOn"), ["2026-09-01"]);
	assert.deepEqual(val(c, "topo.approvedOn"), ["2026-09-15"]);
});

test("TAA: one finding per element with the condition as written, and the overall state", () => {
	const c = extractTaa(doc("taa"));
	assert.deepEqual(val(c, "taa.element.pamati"), ["apmierinošs"]);
	assert.deepEqual(val(c, "taa.element.ārsienas"), ["neapmierinošs"]);
	assert.deepEqual(val(c, "taa.element.jumta_konstrukcija"), ["avārijas"]);
	assert.deepEqual(val(c, "taa.overall"), ["neapmierinošs"]);
});

test("TN: issuer, number, date, validity, numbered conditions", () => {
	const c = extractTn(doc("tn"));
	assert.deepEqual(val(c, "tn.issuer"), ['SIA "Izdomātais tīkls"']);
	assert.deepEqual(val(c, "tn.number"), ["TN-2026/123"]);
	assert.deepEqual(val(c, "tn.date"), ["2026-10-05"]);
	assert.deepEqual(val(c, "tn.validUntil"), ["2028-10-05"]);
	assert.deepEqual(c.filter((x) => x.key.startsWith("tn.condition.")).map((x) => x.key), ["tn.condition.1", "tn.condition.2", "tn.condition.3"]);
});

function storeWithPu(): ProjectStore {
	const p: Project = { id: "BD999", name: "BD999 Testa", root: tmp(), createdAt: "2026-11-06T00:00:00Z" };
	const store = ProjectStore.open(tmp(), p);
	const sha = "b".repeat(64);
	store.write("sources", [{ id: "s_pu", kind: "document", folderKey: "1.1.4", paths: ["01_Projektesana/1.1_Izejas dati/1.1.4_PU/PU.docx"], title: "PU", role: "PU", roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: p.createdAt, seenAt: p.createdAt, textState: "ok", pages: 2 }], signers: [] }], { kind: "test.setup", by: "app" });
	store.writeText(sha, { pages: doc("pu"), state: "ok" });
	return store;
}

test("set_fact refuses a quote not in the text, or on another page; accepts a verbatim one", () => {
	const store = storeWithPu();
	assert.throws(() => proposeFact(store, { key: "profile.group", value: "2", source: { sourceId: "s_pu", page: 1, quote: "ēka atbilst 2. grupai" }, by: "agent" }), /nav atrodams/);
	assert.throws(() => proposeFact(store, { key: "profile.address", value: "x", source: { sourceId: "s_pu", page: 2, quote: "Objekta adrese: Testa iela 1" }, by: "agent" }), /tas ir 1\. lapā/);
	const f = proposeFact(store, { key: "profile.group", value: "3", source: { sourceId: "s_pu", page: 1, quote: "ēka   atbilst 3.\ngrupai" }, by: "agent" });
	assert.equal(f.state, "proposed");
	assert.equal(profileOf(store.read("facts")).group?.value, "3");
	decideFact(store, f.id, "confirmed");
	assert.equal(store.read("facts")[0].state, "confirmed");
});

test("agent tools: list, read pages, search, extract candidates, set_fact", async () => {
	const store = storeWithPu();
	const ctx = { projectsDir: store.projectsDir, projectId: "BD999", dataDir: join(import.meta.dirname, "..", "data"), appDir: tmp(), runDir: null };
	const t = Object.fromEntries(sourceTools.map((x) => [x.name, x]));
	assert.equal((await t.list_sources.run(ctx, {}) as { id: string }[])[0].id, "s_pu");
	const read = (await t.read_source.run(ctx, { id: "s_pu", pages: "2" })) as string;
	assert.match(read, /--- lpp\. 2 ---/);
	assert.doesNotMatch(read, /--- lpp\. 1 ---/);
	const hits = (await t.search_sources.run(ctx, { q: "kadastra apzīmējums" })) as { page: number }[];
	assert.equal(hits[0].page, 1);
	const ex = (await t.extract_candidates.run(ctx, { id: "s_pu" })) as { candidates: { key: string }[] };
	assert.ok(ex.candidates.some((c) => c.key === "profile.address"));
	const r = (await t.set_fact.run(ctx, { key: "profile.address", value: "Testa iela 1, Izdomāti, LV-0000", sourceId: "s_pu", page: 1, quote: "Objekta adrese: Testa iela 1, Izdomāti, LV-0000" })) as { ok: boolean };
	assert.equal(r.ok, true);
	const law = (await t.search_law.run(ctx, { q: "būvprojekts minimālā sastāvā", limit: 3 })) as { url: string }[];
	assert.ok(law.length > 0 && law[0].url.startsWith("https://likumi.lv/"));
	assert.deepEqual(pageList("1-3,7", 5), [1, 2, 3]);
});
