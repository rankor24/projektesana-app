// 8.13 Word documents: op validation, markdown → docx and the outline (all in Node), then the edit ops and PDF through the real Word
// on an invented document (skipped, with the reason, when Word is not installed). Invented names and text only.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { listCheckpoints, trackCreated } from "../src/core/checkpoints.ts";
import { inToolScope } from "../src/core/scope.ts";
import { ProjectStore } from "../src/core/store.ts";
import { applyUndo, undoRows } from "../src/core/undo.ts";
import { markdownToDocx, parseMarkdown, inlineRuns } from "../src/sources/export/docx-md.ts";
import { validateOps, type OpInput } from "../src/sources/export/word-ops.ts";
import { applyDocxOps, docxOutline, docxToPdf, outlineText } from "../src/sources/export/word.ts";
import { officeHas } from "../src/sources/text/office-com.ts";
import { docxText } from "../src/sources/text/docx.ts";
import { refreshDraft, startDraft } from "../src/sources/staging.ts";
import { tmp } from "./helpers.ts";

const SCRIPT = join(import.meta.dirname, "..", "resources", "office-word.ps1");
const HAS_WORD = await officeHas("doc");
const live = { skip: HAS_WORD ? false : "Word nav instalēts: COM daļa netiek pārbaudīta" };

const MD = `# Paskaidrojuma raksts

Objekts atrodas **Testa ielā 1**, Rīgā. Kadastra numurs XXXX.

## Telpu saraksts

| Telpa | Platība | Piezīmes |
|---|---|---|
| Virtuve | 12.5 | gaisma |
| Guļamistaba | 18.0 | |

- pirmais punkts
- otrais punkts

1. viens
2. divi

Otrs saraksts:

1. A
2. B
`;

const op = (o: Partial<OpInput> & { op: OpInput["op"] }): OpInput => o as OpInput;

// ---- op validation ------------------------------------------------------------------------------------------------------------

test("8.13 ops: a valid list gets its defaults and hex colours", () => {
	const r = validateOps([op({ op: "replace", find: "a", replace: "b" }), op({ op: "insert_after", anchor: "x", text: "y", color: "dark red", bold: true }), op({ op: "set_cell", row_match: "Virtuve", col: 1, text: "13" }), op({ op: "add_row", table: 0, cells: ["a", "b"] })]);
	assert.ok(r.ok);
	if (!r.ok) return;
	assert.deepEqual([r.ops[0].match_case, r.ops[0].count, r.ops[0].headers], [true, 0, true]);
	assert.deepEqual([r.ops[1].color, r.ops[1].occurrence, r.ops[1].bold], ["C00000", 1, true]);
	assert.equal(r.ops[2].row_match, "Virtuve");
});

test("8.13 ops: each missing field is said with the op number, nothing is sent to Word", () => {
	const r = validateOps([
		op({ op: "replace" }),
		op({ op: "insert_after", anchor: "x", text: "y", color: "rozā" }),
		op({ op: "set_cell", text: "x" }),
		op({ op: "add_row", cells: ["a"] }),
		op({ op: "append_text", anchor: "x", text: "a\nb" }),
		op({ op: "replace", find: "x".repeat(300), replace: "y" }),
		op({ op: "replace", find: "a", replace: "a" }),
		op({ op: "delete_paragraph" }),
	]);
	assert.equal(r.ok, false);
	if (r.ok) return;
	const t = r.errors.join("\n");
	assert.match(t, /op 1 \(replace\): trūkst find/);
	assert.match(t, /op 2 \(insert_after\): nezināma krāsa/);
	assert.match(t, /op 3 \(set_cell\): norādi table/);
	assert.match(t, /op 3 .*norādi row vai row_match/);
	assert.match(t, /op 3 .*norādi col vai col_match/);
	assert.match(t, /op 4 \(add_row\): norādi table vai table_match/);
	assert.match(t, /op 5 \(append_text\): .*jaunai rindkopai/);
	assert.match(t, /op 6 .*garāks par 255/);
	assert.match(t, /op 7 .*vienādi/);
	assert.match(t, /op 8 \(delete_paragraph\): trūkst anchor/);
	assert.equal(validateOps([]).ok, false);
});

test("8.13 ops: an invalid list never reaches Word", async () => {
	const r = await applyDocxOps("nav-tāda-skripta.ps1", "a.docx", "b.docx", [op({ op: "replace" })], { workDir: tmp() });
	assert.equal(r.ok, false);
	assert.match(r.reason!, /trūkst find/);
});

// ---- markdown → docx, outline --------------------------------------------------------------------------------------------------

test("8.13 markdown: blocks and inline marks", () => {
	assert.deepEqual(parseMarkdown(MD).map((b) => b.k), ["h", "p", "h", "table", "ul", "ol", "p", "ol"]);
	assert.deepEqual(inlineRuns("a **b** *c* `d` e"), [{ text: "a " }, { text: "b", b: true }, { text: " " }, { text: "c", i: true }, { text: " " }, { text: "d", code: true }, { text: " e" }]);
	assert.deepEqual(inlineRuns("2 * 3 * 4 und **offen"), [{ text: "2 * 3 * 4 und **offen" }], "unclosed or spaced stars stay as written");
	const t = parseMarkdown("| a | b |\n|---|---|\n| 1 \\| x | 2 |\n");
	assert.deepEqual(t[0], { k: "table", rows: [["a", "b"], ["1 | x", "2"]] });
});

test("8.13 markdown → docx: the text round-trips, headings have real styles, the table and both lists are there", () => {
	const buf = markdownToDocx(MD, { title: "Test" });
	const text = docxText(buf);
	assert.match(text, /^Paskaidrojuma raksts\n/);
	assert.match(text, /Objekts atrodas Testa ielā 1, Rīgā\. Kadastra numurs XXXX\./);
	assert.match(text, /Virtuve\t12\.5\tgaisma/);
	assert.match(text, /Guļamistaba\t18\.0/);
	const o = docxOutline(buf);
	assert.deepEqual([o.tables, o.items.filter((i) => i.level !== undefined).map((i) => [i.level, i.text])], [1, [[1, "Paskaidrojuma raksts"], [2, "Telpu saraksts"]]]);
	const tb = o.items.find((i) => i.kind === "table")!;
	assert.deepEqual([tb.table, tb.rows, tb.cols, tb.header], [0, 3, 3, ["Telpa", "Platība", "Piezīmes"]]);
	assert.deepEqual(tb.firstCol, ["Telpa", "Virtuve", "Guļamistaba"]);
	// each numbered list restarts: two lists, two w:num with a restart
	const xml = Buffer.from(buf).toString("latin1");
	assert.ok(xml.length > 0);
});

test("8.13 outline: find narrows paragraphs and table rows; max truncates; special characters stay", () => {
	const buf = markdownToDocx(`${MD}\n& <tag> "q"\n`);
	const f = docxOutline(buf, { find: "Virtuve" });
	assert.deepEqual(f.items.map((i) => i.kind), ["table"]);
	assert.deepEqual(f.items[0].matchingRows, [1]);
	assert.equal(docxOutline(buf, { max: 2 }).truncated, true);
	assert.match(outlineText(docxOutline(buf), "x.docx"), /& <tag> "q"/);
	assert.match(outlineText(docxOutline(buf), "x.docx"), /TABULA 0 \(3×3\)/);
	assert.throws(() => docxOutline(new Uint8Array([1, 2, 3])));
});

// ---- through Word -----------------------------------------------------------------------------------------------------------

test("8.13 Word: the ops edit the text, the table and the lists, and keep the rest", live, async () => {
	const dir = tmp();
	const src = join(dir, "in.docx");
	const out = join(dir, "out.docx");
	const original = markdownToDocx(MD);
	writeFileSync(src, original);
	const r = await applyDocxOps(
		SCRIPT,
		src,
		out,
		[
			op({ op: "replace", find: "Testa ielā 1", replace: "Vecpilsētas ielā 5" }),
			op({ op: "set_cell", table: 0, row_match: "Virtuve", col_match: "Platība", text: "13.2", color: "blue" }),
			op({ op: "add_row", table: 0, cells: ["Vannas istaba", "4.1", "ar logu"] }),
			op({ op: "insert_after", anchor: "otrais punkts", text: "trešais punkts\nceturtais punkts", bold: true }),
			op({ op: "append_text", anchor: "Kadastra numurs", text: " (precizēts)", color: "red" }),
			op({ op: "delete_row", table: 0, row_match: "Guļamistaba" }),
			op({ op: "delete_paragraph", anchor: "Otrs saraksts" }),
		],
		{ workDir: dir },
	);
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(r.saved, true);
	assert.deepEqual((r.done ?? []).map((d) => d.matched).sort(), [1, 1, 1, 1, 1, 1, 1]);
	const text = docxText(new Uint8Array(readFileSync(out)));
	assert.match(text, /Vecpilsētas ielā 5, Rīgā\. Kadastra numurs XXXX\. \(precizēts\)/);
	assert.doesNotMatch(text, /Testa ielā/);
	assert.match(text, /Virtuve\t13\.2\tgaisma/);
	assert.match(text, /Vannas istaba\t4\.1\tar logu/);
	assert.doesNotMatch(text, /Guļamistaba/);
	assert.doesNotMatch(text, /Otrs saraksts/);
	assert.match(text, /otrais punkts\ntrešais punkts\nceturtais punkts\n/, "two new paragraphs after the anchor, in order");
	const o = docxOutline(new Uint8Array(readFileSync(out)));
	assert.deepEqual(o.items.filter((i) => i.level !== undefined).map((i) => i.text), ["Paskaidrojuma raksts", "Telpu saraksts"], "headings keep their style");
	assert.equal(readFileSync(src).equals(Buffer.from(original)), true, "the source file is untouched");
});

test("8.13 Word: all or nothing: a missed op saves nothing and names the op; dry run saves nothing", live, async () => {
	const dir = tmp();
	const src = join(dir, "in.docx");
	const out = join(dir, "out.docx");
	writeFileSync(src, markdownToDocx(MD));
	const bad = await applyDocxOps(SCRIPT, src, out, [op({ op: "replace", find: "Virtuve", replace: "Kopmītne" }), op({ op: "delete_paragraph", anchor: "nav tāda teksta" })], { workDir: dir });
	assert.equal(bad.ok, false);
	assert.equal(bad.op, 2);
	assert.match(bad.reason!, /nav atrasts/);
	assert.equal(existsSync(out), false, "nothing saved");
	const missingRow = await applyDocxOps(SCRIPT, src, out, [op({ op: "set_cell", table: 0, row_match: "Nav tādas", col: 0, text: "x" })], { workDir: dir });
	assert.match(missingRow.reason!, /rinda .* nav atrasta/);
	const badTable = await applyDocxOps(SCRIPT, src, out, [op({ op: "add_row", table: 4, cells: ["x"] })], { workDir: dir });
	assert.match(badTable.reason!, /tabulas 4 nav/);
	const tooMany = await applyDocxOps(SCRIPT, src, out, [op({ op: "add_row", table: 0, cells: ["1", "2", "3", "4"] })], { workDir: dir });
	assert.match(tooMany.reason!, /4 vērtības, tabulā ir 3 kolonnas/);
	const dry = await applyDocxOps(SCRIPT, src, out, [op({ op: "replace", find: "Virtuve", replace: "Kopmītne" })], { workDir: dir, dryRun: true });
	assert.deepEqual([dry.ok, dry.saved], [true, false]);
	assert.equal(existsSync(out), false);
});

test("8.13 Word: replace respects match_case and count; a missing style is said", live, async () => {
	const dir = tmp();
	const src = join(dir, "in.docx");
	writeFileSync(src, markdownToDocx("Ala ala ALA ala\n\nOtra ala"));
	const r = await applyDocxOps(SCRIPT, src, join(dir, "o.docx"), [op({ op: "replace", find: "ala", replace: "X", count: 2 })], { workDir: dir });
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.match(docxText(new Uint8Array(readFileSync(join(dir, "o.docx")))), /^Ala X ALA X\nOtra ala$/);
	const ci = await applyDocxOps(SCRIPT, src, join(dir, "ci.docx"), [op({ op: "replace", find: "ala", replace: "X", match_case: false })], { workDir: dir });
	assert.match(docxText(new Uint8Array(readFileSync(join(dir, "ci.docx")))), /^X X X X\nOtra X$/);
	const st = await applyDocxOps(SCRIPT, src, join(dir, "st.docx"), [op({ op: "insert_after", anchor: "Otra", text: "x", style: "Nav tāda stila" })], { workDir: dir });
	assert.equal(st.ok, false);
	assert.match(st.reason!, /stils .* nav/);
	assert.equal(existsSync(join(dir, "st.docx")), false);
});

test("8.13 Word: PDF of a document", live, async () => {
	const dir = tmp();
	writeFileSync(join(dir, "in.docx"), markdownToDocx(MD));
	const r = await docxToPdf(SCRIPT, join(dir, "in.docx"), join(dir, "in.pdf"));
	assert.equal(r.ok, true, JSON.stringify(r));
	assert.equal(readFileSync(join(dir, "in.pdf")).subarray(0, 4).toString(), "%PDF");
});

// ---- the agent tools --------------------------------------------------------------------------------------------------------

function setup() {
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.1_Izejas dati"), { recursive: true });
	writeFileSync(join(root, "01_Projektesana", "1.1_Izejas dati", "Paraugs.docx"), markdownToDocx(MD));
	const projectsDir = tmp();
	const store = ProjectStore.open(projectsDir, { id: "BD999", name: "BD999", root, createdAt: "2026-11-13T00:00:00Z" });
	store.write("sources", [{ id: "s1", kind: "document", paths: ["01_Projektesana\\1.1_Izejas dati\\Paraugs.docx"] } as never], { kind: "t", by: "app" });
	const d = startDraft(store, "MBP", "2026-12-01", "user");
	const runDir = join(tmp(), "run_w1");
	mkdirSync(runDir, { recursive: true });
	const ctx: ToolCtx = { projectsDir, projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir, skillsDir: join(import.meta.dirname, "..", "resources", "skills") };
	return { store, ctx, id: d.id, dir: d.draft!.stagingDir, root };
}
const asAgent = (store: ProjectStore, ctx: ToolCtx, tool: string, args: Record<string, unknown>) => {
	const t = allTools().find((x) => x.name === tool)!;
	return inToolScope({ run: "run_w1", tool }, () => trackCreated(store, () => t.run(ctx, args as never)));
};

test("8.13 tools: levels; the outline of a source and of a staged file; no office-folder write", async () => {
	const { store, ctx, dir } = setup();
	const tools = allTools();
	assert.deepEqual(["docx_outline", "docx_apply", "write_document"].map((n) => tools.find((t) => t.name === n)?.level), ["read", "run", "run"]);
	const o = (await asAgent(store, ctx, "docx_outline", { sourceId: "s1" })) as string;
	assert.match(o, /Paraugs\.docx: .* 1 tabulas/);
	assert.match(o, /H1: Paskaidrojuma raksts/);
	writeFileSync(join(dir, "AR-1_Dok.docx"), markdownToDocx("# X\n\nteksts"));
	refreshDraft(store, "draft_MBP_261201", "user");
	assert.match((await asAgent(store, ctx, "docx_outline", { staged: "AR-1_Dok.docx", find: "teksts" })) as string, /\[1\] p: teksts/);
	await assert.rejects(asAgent(store, ctx, "docx_outline", { path: "..\\..\\..\\Windows\\win.ini" }), /Ārpus projekta mapes|nav atrasts|nav .docx/);
	await assert.rejects(asAgent(store, ctx, "docx_outline", { sourceId: "nav" }), /nav atrasts/);
	await assert.rejects(asAgent(store, ctx, "docx_outline", {}), /Norādi/);
});

test("8.13 tools: write_document writes into staging only, never over a file, fixes the name", async () => {
	const { store, ctx, dir, id } = setup();
	await asAgent(store, ctx, "write_document", { name: "Paskaidrojuma raksts", markdown: MD });
	assert.ok(existsSync(join(dir, "Paskaidrojuma raksts.docx")));
	assert.match(docxText(new Uint8Array(readFileSync(join(dir, "Paskaidrojuma raksts.docx")))), /Telpu saraksts/);
	assert.ok(store.read("deliveries").find((d) => d.id === id)!.items.some((i) => i.file.endsWith("Paskaidrojuma raksts.docx")), "the draft lists it");
	await assert.rejects(asAgent(store, ctx, "write_document", { name: "Paskaidrojuma raksts.docx", markdown: "x" }), /jau ir/);
	// a path in the name is folded into a plain name inside staging, never followed
	await asAgent(store, ctx, "write_document", { name: "..\\..\\x.docx", markdown: "x" });
	assert.equal(existsSync(join(dir, "..", "..", "x.docx")), false);
	assert.equal(existsSync(join(dir, "..", "x.docx")), false);
	assert.ok(readdirSync(dir).some((n) => /x\.docx$/.test(n)));
	// the run's undo lists the new file as created
	assert.ok(listCheckpoints(store, "run_w1").some((c) => c.created && /Paskaidrojuma raksts\.docx$/.test(c.path)));
});

test("8.13 tools: write_document with pdf makes the PDF through Word", live, async () => {
	const { store, ctx, dir } = setup();
	await asAgent(store, ctx, "write_document", { name: "Vēstule", markdown: "# Vēstule\n\nTeksts.", pdf: true });
	assert.equal(readFileSync(join(dir, "Vestule.pdf")).subarray(0, 4).toString(), "%PDF");
});

test("8.13 tools: docx_apply: a source is copied to a new name, a staged file is edited in place with a copy kept, undo brings it back", live, async () => {
	const { store, ctx, dir, root } = setup();
	await assert.rejects(asAgent(store, ctx, "docx_apply", { sourceId: "s1", ops: [{ op: "replace", find: "Testa", replace: "X" }] }), /out/);
	await asAgent(store, ctx, "docx_apply", { sourceId: "s1", out: "Paskaidrojums", ops: [{ op: "replace", find: "Testa ielā 1", replace: "Vecpilsētas ielā 5" }] });
	const copy = join(dir, "Paskaidrojums.docx");
	assert.match(docxText(new Uint8Array(readFileSync(copy))), /Vecpilsētas ielā 5/);
	assert.match(docxText(new Uint8Array(readFileSync(join(root, "01_Projektesana", "1.1_Izejas dati", "Paraugs.docx")))), /Testa ielā 1/, "the source is untouched");
	await assert.rejects(asAgent(store, ctx, "docx_apply", { sourceId: "s1", out: "Paskaidrojums", ops: [{ op: "replace", find: "a", replace: "b" }] }), /jau ir/);
	// in place
	await asAgent(store, ctx, "docx_apply", { staged: "Paskaidrojums.docx", ops: [{ op: "replace", find: "Vecpilsētas", replace: "Brīvības" }] }).then(() => undefined);
	assert.match(docxText(new Uint8Array(readFileSync(copy))), /Brīvības ielā 5/);
	// a failed in-place edit changes nothing
	await assert.rejects(asAgent(store, ctx, "docx_apply", { staged: "Paskaidrojums.docx", ops: [{ op: "replace", find: "Brīvības", replace: "Y" }, { op: "delete_paragraph", anchor: "nav tāda" }] }), /Darbība 2 .* Nekas nav saglabāts/);
	assert.match(docxText(new Uint8Array(readFileSync(copy))), /Brīvības ielā 5/);
	assert.equal(readdirSync(dir).some((n) => n.startsWith("~edit_")), false, "no side file left behind");
	assert.equal(listCheckpoints(store, "run_w1").filter((c) => !c.created).length, 1, "the failed batch took no copy");
	const dry = (await asAgent(store, ctx, "docx_apply", { staged: "Paskaidrojums.docx", dryRun: true, ops: [{ op: "replace", find: "Brīvības", replace: "Z" }] })) as string;
	assert.match(dry, /nekas nav saglabāts/);
	assert.match(docxText(new Uint8Array(readFileSync(copy))), /Brīvības ielā 5/);
	// undo of the in-place edit: the earlier text comes back (the 8.7 list shows a file replaced)
	const rows = undoRows(store, "run_w1").filter((r) => r.kind === "file" && !/Izveidots/.test(r.label));
	assert.ok(rows.length >= 1, JSON.stringify(undoRows(store, "run_w1").map((r) => r.label)));
	applyUndo(store, rows[rows.length - 1].key);
	assert.match(docxText(new Uint8Array(readFileSync(copy))), /Vecpilsētas ielā 5/);
});
