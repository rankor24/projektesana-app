// 1.6 old Office formats through the installed Office (COM helper). Contract tests always run; the live tests make an
// invented .doc / .xls with Word / Excel itself and read it back, and are skipped when that Office app is absent.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { officeArgs, officeHas, officeText, parseOfficeOutput } from "../src/sources/text/office-com.ts";
import { tmp } from "./helpers.ts";

const SCRIPT = join(import.meta.dirname, "..", "resources", "office-text.ps1");

test("helper contract: arguments and JSON output", () => {
	assert.deepEqual(officeArgs("x.ps1", "C:\\a b\\c.doc", "doc"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "x.ps1", "-Path", "C:\\a b\\c.doc", "-Kind", "doc"]);
	assert.deepEqual(parseOfficeOutput('{"ok":true,"pages":["Būvprojekts"]}\r\n'), { state: "ok", pages: ["Būvprojekts"] });
	assert.deepEqual(parseOfficeOutput('{"ok":true,"pages":"Viena lapa"}'), { state: "ok", pages: ["Viena lapa"] });
	assert.equal(parseOfficeOutput('{"ok":false,"reason":"bojāts"}').reason, "bojāts");
	assert.equal(parseOfficeOutput("").state, "error");
	assert.equal(parseOfficeOutput('{"ok":true,"pages":["  "]}').state, "empty");
});

test("helper: a missing file and an unknown kind answer in JSON", { skip: process.platform !== "win32" }, async () => {
	const out = execFileSync("powershell.exe", officeArgs(SCRIPT, join(tmp(), "nav.doc"), "doc"), { encoding: "utf8" });
	assert.deepEqual(parseOfficeOutput(out), { state: "error", pages: [], reason: "fails nav atrasts" });
	assert.equal((await officeText(SCRIPT, "x.dwg", ".dwg")).state, "unsupported");
});

const ps = (script: string) => execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 120_000 });

test("live: an old .doc made by Word is read back", { timeout: 180_000 }, async (t) => {
	if (!(await officeHas("doc"))) return t.skip("Word nav instalēts");
	const f = join(tmp(), "PU vecais.doc");
	ps(`$w = New-Object -ComObject Word.Application; $w.Visible = $false; $d = $w.Documents.Add(); $d.Content.Text = "Projektēšanas uzdevums Nr. 7/TEST\`rPasūtītājs: Izdomātā biedrība"; $d.SaveAs2('${f}', 0); $d.Close(0); $w.Quit()`);
	const r = await officeText(SCRIPT, f, ".doc");
	assert.equal(r.state, "ok", r.reason);
	assert.match(r.pages[0], /Projektēšanas uzdevums Nr\. 7\/TEST/);
	assert.match(r.pages[0], /Izdomātā biedrība/);
});

test("live: an old .xls made by Excel is read back as rows", { timeout: 180_000 }, async (t) => {
	if (!(await officeHas("xls"))) return t.skip("Excel nav instalēts");
	const f = join(tmp(), "telpas.xls");
	ps(`$x = New-Object -ComObject Excel.Application; $x.Visible = $false; $x.DisplayAlerts = $false; $b = $x.Workbooks.Add(); $s = $b.Worksheets.Item(1); $s.Name = 'Telpas'; $s.Cells.Item(1,1).Value2 = 'Nr.'; $s.Cells.Item(1,2).Value2 = 'Nosaukums'; $s.Cells.Item(2,1).Value2 = '101'; $s.Cells.Item(2,2).Value2 = 'Gaitenis'; $b.SaveAs('${f}', 56); $b.Close($false); $x.Quit()`);
	const r = await officeText(SCRIPT, f, ".xls");
	assert.equal(r.state, "ok", r.reason);
	assert.match(r.pages[0], /# Telpas/);
	assert.match(r.pages[0], /101\tGaitenis/);
});
