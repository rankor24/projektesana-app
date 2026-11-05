import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppApi } from "../src/main/api.ts";
import { Store } from "../src/main/store.ts";
import { Library } from "../src/main/library/library.ts";
import { loadFiles } from "../src/kernel/files.ts";
import { scanFolder, loadScan } from "../src/main/gather/scan.ts";
import { projectRefs } from "../src/main/gather/refs.ts";
import { appendChat, completeness, confirmFact, deriveFacts, factState, loadBrief, rejectFact, setFact } from "../src/main/chat/brief.ts";
import { loadRules } from "../src/main/rules/verify.ts";
import { GATHER_TOOLS } from "../src/main/engines/types.ts";
import * as tools from "../src/mcp/tools.ts";
import { piFor, pdf } from "./helpers.ts";
import type { Engine } from "../src/main/engines/types.ts";

const dataDir = join(import.meta.dirname, "..", "data");
const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(s, "utf8").reverse(), decrypt: (b: Buffer) => Buffer.from(b).reverse().toString("utf8") };

const PU = "Projektēšanas uzdevums\nObjekts: Duntes iela 8, Rīga\nPasūtītājs: SIA Tests\nJauna publiska ēka, 4 stāvi virs zemes, kopējā platība 1800 m2.\nProjektēt saskaņā ar LBN 208-15 un MK noteikumiem Nr. 500, Būvniecības likumu un LVS EN 1991-1-1.\nEnerģijas veiktspēja: Direktīva 2010/31/ES.";
const TR = "Tehniskie noteikumi Nr. 5\nIzsniedz AS Sadales tīkls, elektroapgāde.\nPieprasīts 2026-09-01, saņemts 2026-09-20.";
const LAND = "Zemesgrāmatas apliecība\nKadastra apzīmējums 0100 000 1234, platība 2400 m2.";

/** A project folder the way Boris has one: his own subfolders, no .bv yet. */
function folder() {
	const dir = mkdtempSync(join(tmpdir(), "bvg-"));
	const root = join(dir, "Duntes 8");
	mkdirSync(join(root, "01 PU"), { recursive: true });
	mkdirSync(join(root, "02 TN"), { recursive: true });
	writeFileSync(join(root, "01 PU", "PU.txt"), PU);
	writeFileSync(join(root, "02 TN", "SadalesTikls.txt"), TR);
	writeFileSync(join(root, "Zemes dok.txt"), LAND);
	writeFileSync(join(root, "plans.dwg"), "binary");
	writeFileSync(join(root, "skenets.pdf"), pdf(""));
	return { dir, root };
}

function mk(run?: Engine["run"], ready = true) {
	const dir = mkdtempSync(join(tmpdir(), "bvapp-"));
	const store = new Store(join(dir, "data"), crypto);
	const events: { channel: string; e: any }[] = [];
	const eng: Engine = {
		id: "pi",
		status: async () => ({ id: "pi", ready, reason: ready ? "" : "Nav ievadīta API atslēga", canLogin: false }),
		run: run ?? (async (o) => o.onEvent({ type: "done", text: "" })),
	};
	const api = new AppApi({ store, engine: eng, pi: piFor(store), serverJs: "server.js", dataDir, emit: (channel, e) => events.push({ channel, e }) });
	return { api, store, events, dir };
}

test("opening a folder adds .bv, registers every file in place, reads text once and PROPOSES roles", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	assert.ok(existsSync(join(root, ".bv", "project.json")));
	const files = loadFiles(root);
	assert.deepEqual(files.map((f) => f.path).sort(), ["01 PU/PU.txt", "02 TN/SadalesTikls.txt", "Zemes dok.txt", "plans.dwg", "skenets.pdf"]);
	const pu = files.find((f) => f.path === "01 PU/PU.txt")!;
	assert.equal(pu.role, "PU");
	assert.deepEqual(pu.roleSource, { by: "app", quote: "Projektēšanas uzdevums", confirmed: false });
	assert.equal(files.find((f) => f.path === "02 TN/SadalesTikls.txt")!.role, "Tehniskie noteikumi");
	assert.equal(files.find((f) => f.path === "Zemes dok.txt")!.role, "Zemes dokumenti");
	assert.equal(readFileSync(join(root, "01 PU", "PU.txt"), "utf8"), PU, "the source is untouched");
	const scan = loadScan(root)!;
	assert.equal(scan.found, 5);
	assert.equal(scan.files.find((f) => f.path === "plans.dwg")!.text, "unsupported");
	assert.equal(scan.files.find((f) => f.path === "skenets.pdf")!.text, "empty", "a scan without a text layer is flagged, not silently skipped");
	assert.ok(existsSync(join(root, ".bv", "text")));
});

test("a role Boris confirmed is never replaced by a later scan; a second scan registers nothing twice", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	api.filesSetRole(root, "Zemes dok.txt", "Topogrāfija");
	writeFileSync(join(root, "jauns.txt"), "Inventarizācijas lieta Nr. 7");
	const r = await api.gatherScan(root);
	assert.equal(r.registered, 1);
	assert.equal(loadFiles(root).find((f) => f.path === "Zemes dok.txt")!.role, "Topogrāfija");
	assert.equal(loadFiles(root).find((f) => f.path === "jauns.txt")!.role, "Inventarizācijas lieta");
	assert.equal(loadFiles(root).length, 6);
	api.roleConfirm(root, "01 PU/PU.txt");
	assert.equal(loadFiles(root).find((f) => f.path === "01 PU/PU.txt")!.roleSource!.confirmed, true);
});

test("the .bv folder and hidden files are not scanned", async () => {
	const { root } = folder();
	const { api } = mk();
	await api.projectsOpenFolder(root);
	writeFileSync(join(root, "~$temp.docx"), "x");
	const r = await scanFolder(root);
	assert.ok(!r.files.some((f) => f.path.startsWith(".bv") || f.path.includes("~$")));
});

test("references: what the project's own documents name, by category, with the words around it", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	const refs = await projectRefs(root);
	const by = (c: string) => refs.filter((r) => r.category === c).map((r) => r.ref);
	assert.deepEqual(by("mk"), ["LBN 208-15", "MK noteikumi Nr. 500"]);
	assert.deepEqual(by("lvs"), ["LVS EN 1991-1-1"]);
	assert.deepEqual(by("es"), ["Direktīva 2010/31/ES"]);
	assert.deepEqual(by("likums"), ["Būvniecības likums"]);
	const lbn = refs.find((r) => r.ref === "LBN 208-15")!;
	assert.equal(lbn.path, "01 PU/PU.txt");
	assert.match(lbn.quote, /saskaņā ar LBN 208-15/);
	const listed = await api.refsList(root, "mk");
	assert.equal(listed.find((r) => r.ref === "LBN 208-15")!.inLibrary, false, "not in the library: the panel says so instead of pretending");
	assert.equal(listed.find((r) => r.ref === "MK noteikumi Nr. 500")!.inLibrary, true, "MK 500 is a built-in text");
});

test("the gather agent has no mark_unknown, and no tool that approves anything", () => {
	assert.ok(!(GATHER_TOOLS as readonly string[]).includes("mark_unknown"));
	assert.ok(!GATHER_TOOLS.some((t) => /approve|review/.test(t)));
});

test("set_file_role: the words must be in the file or its name; a confirmed role stays", async () => {
	const { api } = mk();
	const { root, dir } = folder();
	await api.projectsOpenFolder(root);
	const c = { root, engine: "pi", dataDir, libraryDir: join(dir, "lib") };
	await assert.rejects(tools.setFileRoleTool(c, "Zemes dok.txt", "Topogrāfija", "topogrāfiskais plāns"), /nav atrodams/);
	await assert.rejects(tools.setFileRoleTool(c, "Zemes dok.txt", "Neesoša", "Zemesgrāmatas"), /Nezināma loma/);
	await tools.setFileRoleTool(c, "Zemes dok.txt", "Zemes dokumenti", "Zemesgrāmatas apliecība");
	api.roleConfirm(root, "Zemes dok.txt");
	await tools.setFileRoleTool(c, "Zemes dok.txt", "Cits", "Zemesgrāmatas");
	assert.equal(loadFiles(root).find((f) => f.path === "Zemes dok.txt")!.role, "Zemes dokumenti");
});

test("add_tr: file and quote are checked, duplicates are not added twice, Boris's 'nav pieprasīts' is not the agent's to say", async () => {
	const { api } = mk();
	const { root, dir } = folder();
	await api.projectsOpenFolder(root);
	const c = { root, engine: "pi", dataDir, libraryDir: join(dir, "lib") };
	const a = { who: "AS Sadales tīkls", issuer: "network_owner" as const, status: "saņemts" as const, requested_on: "2026-09-01", received_on: "2026-09-20", file: "02 TN/SadalesTikls.txt", quote: "Izsniedz AS Sadales tīkls" };
	await assert.rejects(tools.addTrTool(c, { ...a, quote: "Izsniedz Latvenergo" }), /nav atrodams/);
	await assert.rejects(tools.addTrTool(c, { ...a, status: "nav pieprasīts" as never }), /tikai Boriss/);
	assert.match(await tools.addTrTool(c, a), /^ok tr1/);
	assert.match(await tools.addTrTool(c, a), /Jau ir/);
	const tr = api.trList(root);
	assert.equal(tr.length, 1);
	assert.equal(tr[0].file, "02 TN/SadalesTikls.txt");
	assert.equal(tr[0].found!.confirmed, false);
	api.trConfirm(root, "tr1");
	assert.equal(api.trList(root)[0].found!.confirmed, true);
	api.trRemove(root, "tr1");
	assert.equal(api.trList(root).length, 0);
});

test("cite_law: the quote must be a real paragraph of that library source; the reason is required", async () => {
	const { api } = mk();
	const { root, dir } = folder();
	await api.projectsOpenFolder(root);
	const libraryDir = join(dir, "lib");
	const lib = new Library(libraryDir, join(dataDir, "law-snapshots"));
	const hit = lib.search("grupa", { category: "mk", limit: 1 })[0];
	assert.ok(hit, "the built-in MK texts contain 'grupa'");
	const c = { root, engine: "pi", dataDir, libraryDir };
	const good = { category: "mk" as const, source_id: hit.source, quote: hit.paragraph.slice(0, 80), why: "Ēkas grupa nosaka procedūru" };
	await assert.rejects(tools.citeLawTool(c, { ...good, quote: "izdomāts pants, kura šajā tekstā nav nekur" }), /nav atrodams/);
	await assert.rejects(tools.citeLawTool(c, { ...good, why: " " }), /kāpēc/);
	await assert.rejects(tools.citeLawTool(c, { ...good, category: "lvs" }), /kategorijā/);
	assert.match(await tools.citeLawTool(c, good), /^ok a1/);
	assert.match(await tools.citeLawTool(c, good), /^ok a1/, "same paragraph twice is one entry");
	assert.equal(api.applicableList(root, "mk").length, 1);
	assert.equal(api.applicableList(root, "lvs").length, 0);
	assert.equal(api.applicableList(root)[0].confirmed, false);
	api.applicableConfirm(root, "a1");
	assert.equal(api.applicableList(root)[0].confirmed, true);
	api.applicableRemove(root, "a1");
	assert.equal(api.applicableList(root).length, 0);
});

test("facts from a file are PROPOSED until Boris confirms; setup cannot complete on proposals", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	await setFact(root, "engine.work", "new_build", { kind: "file", path: "01 PU/PU.txt", quote: "Jauna publiska ēka" }, "agent:pi");
	await setFact(root, "engine.use", "public", { kind: "file", path: "01 PU/PU.txt", quote: "Jauna publiska ēka" }, "agent:pi");
	let b = loadBrief(root);
	assert.equal(factState(b, b.facts["engine.work"]), "proposed");
	assert.equal(b.facts["engine.work"].by, "agent:pi");
	assert.equal(completeness(root).complete, false);
	confirmFact(root, "engine.work");
	b = loadBrief(root);
	assert.equal(factState(b, b.facts["engine.work"]), "confirmed");
	rejectFact(root, "engine.use");
	b = loadBrief(root);
	assert.equal(b.facts["engine.use"], undefined);
	assert.equal(b.engine.use, undefined, "rejecting a rules input removes it from the engine too");
	assert.ok(readFileSync(join(root, ".bv", "log.jsonl"), "utf8").includes("brief.fact.rejected"), "the log keeps what was rejected");
});

test("engine.work and engine.use accept only the engine's own values, and say which", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	await assert.rejects(setFact(root, "engine.work", "jaunbūve", { kind: "file", path: "01 PU/PU.txt", quote: "Jauna publiska ēka" }, "agent:pi"), /Atļautas: new_build/);
});

test("group and procedure are computed by the rules engine and carry the rule's own words; a person's answer is not overwritten", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	const src = (q: string) => ({ kind: "file" as const, path: "01 PU/PU.txt", quote: q });
	await setFact(root, "engine.work", "new_build", src("Jauna publiska ēka"), "agent:pi");
	await setFact(root, "engine.use", "public", src("Jauna publiska ēka"), "agent:pi");
	await setFact(root, "engine.totalAreaM2", "1800", src("kopējā platība 1800 m2"), "agent:pi");
	await setFact(root, "engine.floorsAbove", "4", src("4 stāvi virs zemes"), "agent:pi");
	const rules = loadRules(dataDir);
	let b = deriveFacts(root, rules);
	assert.match(b.facts.group.value, /^3\. grupa/);
	assert.equal(b.facts.group.source.kind, "rules");
	assert.ok((b.facts.group.source as { quote: string }).quote.length > 20);
	assert.match(b.facts.procedure.value, /MBP/);
	assert.equal(factState(b, b.facts.group), "proposed", "rests on inputs Boris has not confirmed");
	for (const id of ["engine.work", "engine.use", "engine.totalAreaM2", "engine.floorsAbove"]) confirmFact(root, id);
	b = loadBrief(root);
	assert.equal(factState(b, b.facts.group), "confirmed");
	appendChat(root, "boris", "grupa ir 2");
	await setFact(root, "group", "2. grupa (pēc Borisa)", { kind: "boris", quote: "grupa ir 2", at: new Date().toISOString() }, "boris");
	b = deriveFacts(root, rules);
	assert.equal(b.facts.group.value, "2. grupa (pēc Borisa)");
});

test("a gather run: scan, agent proposes through the real tools, panels read the rows; run is recorded", async () => {
	let launched: { tools: readonly string[]; env: Record<string, string> } | null = null;
	let prompt = "";
	const { api, events, dir } = mk();
	const { root } = folder();
	(api as unknown as { d: { engine: Engine } }).d.engine.run = async (o) => {
		launched = o.mcp.projektesana;
		prompt = o.prompt;
		const c = { root: o.mcp.projektesana.env.PROJEKTESANA_ROOT, engine: "pi", dataDir, libraryDir: join(dir, "lib") };
		const src = (q: string) => ({ kind: "file" as const, path: "01 PU/PU.txt", quote: q });
		o.onEvent({ type: "tool", name: "set_fact", detail: "object" });
		await tools.setFactTool(c, "object", "Duntes iela 8, Rīga", src("Objekts: Duntes iela 8, Rīga"));
		o.onEvent({ type: "tool_result", name: "set_fact", ok: true });
		await tools.setFactTool(c, "engine.work", "new_build", src("Jauna publiska ēka"));
		await tools.setFactTool(c, "engine.use", "public", src("Jauna publiska ēka"));
		await assert.rejects(tools.setFactTool(c, "client", "SIA Izdomāts", src("Pasūtītājs: SIA Izdomāts")), /nav atrodams/);
		o.onEvent({ type: "done", text: "Ierakstīju 3 punktus. Pasūtītājs: SIA Tests — neierakstīju." });
	};
	await api.projectsOpenFolder(root);
	events.length = 0;
	const r = await api.gatherRun(root, "pu");
	assert.deepEqual(r, { ok: true, summary: "Ierakstīju 3 punktus. Pasūtītājs: SIA Tests — neierakstīju." });
	assert.equal(launched!.env.PROJEKTESANA_MODE, "gather");
	assert.ok(launched!.tools.includes("add_tr") && !launched!.tools.includes("mark_unknown"));
	assert.ok(prompt.indexOf("# Noteikumi") < prompt.indexOf("# Projekta faili"), "rules first, long file list last");
	assert.match(prompt, /01 PU\/PU\.txt \[PU\]/);
	assert.match(prompt, /plans\.dwg .* netiek lasīts/);
	const rows = api.gatherFacts(root, "pu");
	const row = (id: string) => rows.find((x) => x.id === id)!;
	assert.equal(row("object").state, "proposed");
	assert.equal(row("object").source!.quote, "Objekts: Duntes iela 8, Rīga");
	assert.equal(row("client").state, "open", "a refused quote leaves the item open");
	assert.equal(row("engine.work").value, "new_build");
	assert.equal(api.gatherState(root).runs.pu!.ok, true);
	assert.equal(api.gatherState(root).runs.pu!.tools, 1);
	const kinds = events.filter((x) => x.channel === "gather:event").map((x) => x.e.type);
	assert.deepEqual([kinds[0], kinds.at(-1)], ["start", "end"]);
	assert.ok(kinds.includes("agent"));
	assert.equal(api.gatherState(root).running, null);
	// the group is already computed from the (unconfirmed) inputs, and says so
	assert.equal(api.gatherFacts(root, "laws").find((x) => x.id === "group")!.state, "proposed");
});

test("Boris corrects a proposal by typing: his words go into the chat and become the source", async () => {
	const { api } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	await setFact(root, "engine.use", "warehouse", { kind: "file", path: "01 PU/PU.txt", quote: "Jauna publiska ēka" }, "agent:pi");
	await api.factEdit(root, "engine.use", "public");
	const b = loadBrief(root);
	assert.equal(b.facts["engine.use"].value, "public");
	assert.equal(b.facts["engine.use"].source.kind, "boris");
	assert.equal(b.engine.use, "public");
	assert.match(readFileSync(join(root, ".bv", "chat.jsonl"), "utf8"), /Labojums — Ēkas lietojums: public/);
	await assert.rejects(api.factEdit(root, "engine.use", "daudzdzīvokļu"), /Atļautas/);
	assert.doesNotMatch(readFileSync(join(root, ".bv", "chat.jsonl"), "utf8"), /daudzdzīvokļu/, "a refused edit writes nothing");
});

test("no agent connected: the run says why, records it, and the panel can show it", async () => {
	const { api } = mk(undefined, false);
	const { root } = folder();
	await api.projectsOpenFolder(root);
	assert.deepEqual(await api.gatherRun(root, "tr"), { ok: false, reason: "Nav ievadīta API atslēga" });
	assert.equal(api.gatherState(root).runs.tr!.error, "Nav ievadīta API atslēga");
	const all = await api.gatherAll(root);
	assert.deepEqual(Object.keys(all), ["pu"], "stops at the first section that cannot run");
});

test("one agent at a time: a second gather while one runs is refused", async () => {
	const { api } = mk();
	const { root } = folder();
	let release: () => void = () => {};
	(api as unknown as { d: { engine: Engine } }).d.engine.run = (o) => new Promise<void>((res) => (release = () => (o.onEvent({ type: "done", text: "" }), res())));
	await api.projectsOpenFolder(root);
	const first = api.gatherRun(root, "pu");
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(api.gatherState(root).running, "pu");
	await assert.rejects(api.gatherRun(root, "data"), /jau strādā/);
	release();
	await first;
	assert.equal(api.gatherState(root).running, null);
});

test("attach in chat: copied into the project, role proposed from the text, logged; the original stays", async () => {
	const { api, dir } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	const src = join(dir, "Topo.txt");
	writeFileSync(src, "Topogrāfiskais plāns M1:500, ģeodēziskā uzmērīšana 2026");
	const [a] = await api.chatAttach(root, [src]);
	assert.deepEqual(a, { path: "Izejas dati/Topo.txt", role: "Topogrāfija", quote: "Topogrāfiskais" });
	assert.equal(readFileSync(src, "utf8").slice(0, 5), "Topog");
	assert.ok(readFileSync(join(root, ".bv", "log.jsonl"), "utf8").includes("chat.attach"));
});

test("received technical rules: the picked file is copied in, registered as Tehniskie noteikumi and linked to the request", async () => {
	const { api, dir } = mk();
	const { root } = folder();
	await api.projectsOpenFolder(root);
	const t = api.trAdd(root, { who: "Rīgas būvvalde", issuer: "state_municipal", status: "pieprasīts", requestedOn: "2026-10-01", receivedOn: null, file: null, note: "" });
	const src = join(dir, "TN.txt");
	writeFileSync(src, "Tehniskie noteikumi Nr. 77");
	const r = await api.trAttachFile(root, t.id, src);
	assert.equal(r.file, "Izejas dati/TN.txt");
	assert.equal(loadFiles(root).find((f) => f.path === "Izejas dati/TN.txt")!.role, "Tehniskie noteikumi");
});

test("open a project file in its own program: only inside the project, only if it exists", async () => {
	const opened: string[] = [];
	const { api } = mk();
	(api as unknown as { d: { openPath: (p: string) => Promise<string> } }).d.openPath = async (p) => (opened.push(p), "");
	const { root, dir } = folder();
	await api.projectsOpenFolder(root);
	assert.equal(await api.fileOpen(root, "01 PU/PU.txt"), true);
	assert.deepEqual(opened, [join(root, "01 PU", "PU.txt")]);
	await assert.rejects(api.fileOpen(root, join(dir, "..", "x.txt")), /./);
	await assert.rejects(api.fileOpen(root, "nav.txt"), /nav atrasts/);
	(api as unknown as { d: { openPath: (p: string) => Promise<string> } }).d.openPath = async () => "Nav programmas, kas atver šo failu";
	await assert.rejects(api.fileOpen(root, "01 PU/PU.txt"), /Nav programmas/);
});
