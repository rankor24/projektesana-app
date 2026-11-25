// 21.2 Revit is never driven from a shell (the user's rule, 2026-11-24): run_command that clicks through Revit's windows, takes hold of its process or goes round the Revit MCP is
// refused before any click; the agent has named Revit tools instead (open a view, schedules, parameters, view settings); the add-in follows the app. No Revit needed: the
// snippets are checked as text, the gate and the add-in copy run on temp folders.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { mergeRegistry, syncAddins } from "../src/revit/addin-install.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import { Gate, appShellBlock, makeLevelOf, neverByArgs, revitShellBlock, type ConfirmRequest } from "../src/agent/tools/levels.ts";
import { MODEL_SNIPPETS } from "../src/agent/tools/revit-model.ts";
import { tmp } from "./helpers.ts";

const FROM_THE_SCREENSHOT = `Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes; $p=Get-Process -Id 29400 -ErrorAction Stop; if($p.ProcessName -ne 'Revit' -or !$p.MainWindowHandle){throw 'Revit window not found'}; $w=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)`;

test("21.2 run_command that drives Revit is refused: the screenshot's script, process control, the add-in's side door, any UI automation", () => {
	for (const c of [
		FROM_THE_SCREENSHOT,
		"Get-Process Revit | Stop-Process",
		"taskkill /IM Revit.exe /F",
		'Start-Process "C:\\Program Files\\Autodesk\\Revit 2025\\Revit.exe"',
		"Get-Content $env:LOCALAPPDATA\\RevitMCP\\instances\\1.json",
		"[System.Windows.Forms.SendKeys]::SendWait('^o')",
		"Get-Process | Where-Object { $_.ProcessName -like 'rev*' } | Select Revit",
	]) assert.ok(revitShellBlock(c), c);
	assert.match(revitShellBlock(FROM_THE_SCREENSHOT)!, /revit_open_view/, "the refusal names the tool to use");
});

test("21.2 ordinary commands, and files that happen to be Revit files, still run", () => {
	for (const c of ["Get-ChildItem D:\\Projekti -Filter *.rvt", 'Copy-Item "D:\\Revit\\AR.rvt" "D:\\Revit\\AR_WORK.rvt"', "python convert.py a.docx", "Get-Process node", "dir"]) assert.equal(revitShellBlock(c), null, c);
	assert.equal(neverByArgs("run_command", { command: "dir" }), null);
	assert.equal(neverByArgs("write_file", { command: FROM_THE_SCREENSHOT }), null, "only run_command");
});

test("21.2 the gate refuses the command without asking, and leaves it out of the card of the other calls", async () => {
	const levelOf = makeLevelOf({ run_command: "confirm", write_file: "confirm" });
	const asked: ConfirmRequest[] = [];
	const g = new Gate(levelOf, async (q) => (asked.push(q), true));
	const content = [
		{ type: "toolCall", id: "1", name: "run_command", arguments: { command: FROM_THE_SCREENSHOT } },
		{ type: "toolCall", id: "2", name: "write_file", arguments: { path: "C:\\x\\a.docx", content: "x" } },
	];
	const msg = { role: "assistant", content } as never;
	const call = (i: number) => ({ assistantMessage: msg, toolCall: content[i], args: content[i].arguments, context: {} }) as never;
	const r = await g.before(call(0));
	assert.equal((r as { block?: boolean }).block, true);
	assert.equal(asked.length, 0, "no click was asked for it");
	assert.equal(await g.before(call(1)), undefined);
	assert.deepEqual(asked[0].batch.map((b) => b.tool), ["write_file"]);
});

test("21.2 run_command itself refuses it too (where it would run)", async () => {
	const t = allTools().find((x) => x.name === "run_command")!;
	await assert.rejects(async () => t.run({ projectsDir: tmp(), projectId: null, dataDir: "", appDir: "", runDir: null } as never, { command: "Get-Process Revit | Stop-Process" } as never), /nedrīkst vadīt Revit/);
});

test("21.2 the named Revit tools exist at the right levels: reads and opening a view run, changes to the model wait for the user", () => {
	const lv = appLevels();
	for (const n of ["revit_list_views", "revit_open_view", "revit_get_schedule", "revit_read_parameters", "revit_list_models", "revit_get_view_settings"]) assert.equal(lv[n], "run", n);
	for (const n of ["revit_set_schedule_filter", "revit_set_parameter", "revit_set_view_settings"]) assert.equal(lv[n], "confirm", n);
	const names = new Set(allTools().map((t) => t.name));
	assert.equal(names.size, allTools().length, "no tool name twice");
});

test("21.2 the snippets are short single actions on the right API calls", () => {
	assert.match(MODEL_SNIPPETS.openView, /RequestViewChange/);
	assert.match(MODEL_SNIPPETS.setScheduleFilter, /AddFilter[\s\S]*SetFilter|SetFilter[\s\S]*AddFilter/);
	assert.match(MODEL_SNIPPETS.setScheduleFilter, /RemoveFilter/);
	assert.match(MODEL_SNIPPETS.setParameter, /SetValueString/);
	assert.doesNotMatch(MODEL_SNIPPETS.setParameter, /\.Set\(double|AsDouble/, "a number with units is never written raw");
	assert.match(MODEL_SNIPPETS.setViewSettings, /SetCategoryHidden/);
	assert.match(MODEL_SNIPPETS.setViewSettings, /SetViewRange/);
	assert.match(MODEL_SNIPPETS.readParameters, /Application\.Documents/);
	for (const [k, code] of Object.entries(MODEL_SNIPPETS)) {
		assert.equal((code.match(/\{/g) ?? []).length, (code.match(/\}/g) ?? []).length, `${k}: braces balance`);
		assert.equal((code.match(/\(/g) ?? []).length, (code.match(/\)/g) ?? []).length, `${k}: parentheses balance`);
	}
});

test("21.2 the add-in follows the app: placed when missing or another version, left alone when it is the same, a user's command list kept", () => {
	const bundled = tmp("pj-bundle-");
	const appData = tmp("pj-appdata-");
	const programFiles = tmp("pj-pf-");
	mkdirSync(join(programFiles, "Autodesk", "Revit 2025"), { recursive: true });
	const ship = (text: string) => {
		const d = join(bundled, "addins", "2025");
		mkdirSync(join(d, "revit_mcp_plugin", "Commands"), { recursive: true });
		writeFileSync(join(d, "mcp-servers-for-revit.addin"), "<a/>");
		writeFileSync(join(d, "revit_mcp_plugin", "plugin.dll"), text);
		writeFileSync(join(d, "revit_mcp_plugin", "Commands", "commandRegistry.json"), "[]");
	};
	ship("v1");
	const backups = join(tmp("pj-bk-"), "b");
	const installed = join(appData, "Autodesk", "Revit", "Addins", "2025");
	assert.equal(syncAddins(bundled, backups, appData, programFiles).length, 1);
	assert.equal(readFileSync(join(installed, "revit_mcp_plugin", "plugin.dll"), "utf8"), "v1");
	assert.deepEqual(syncAddins(bundled, backups, appData, programFiles), [], "same add-in: nothing to do");
	// the user enabled a command of their own; a new add-in version keeps that list
	writeFileSync(join(installed, "revit_mcp_plugin", "Commands", "commandRegistry.json"), '["mine"]');
	ship("v2");
	assert.equal(syncAddins(bundled, backups, appData, programFiles).length, 1);
	assert.equal(readFileSync(join(installed, "revit_mcp_plugin", "plugin.dll"), "utf8"), "v2");
	assert.equal(readFileSync(join(installed, "revit_mcp_plugin", "Commands", "commandRegistry.json"), "utf8"), '["mine"]');
	assert.ok(existsSync(join(backups, "2025", "revit_mcp_plugin", "plugin.dll")), "the old plugin was backed up");
	// no Revit of that year on the PC and no add-in there yet: nothing is placed
	const other = tmp("pj-appdata2-");
	assert.deepEqual(syncAddins(bundled, backups, other, tmp("pj-pf2-")), []);
});

test("21.2 an update switches on the commands the user's list lacks, and keeps their own choices", () => {
	const cmd = (commandName: string, enabled = true) => ({ commandName, enabled });
	const m = mergeRegistry({ Commands: [cmd("a", false), cmd("b")], settings: { port: 9000 } }, { Commands: [cmd("a"), cmd("b"), cmd("open_view"), cmd("list_views")], settings: { port: 8080 } });
	assert.deepEqual(m.added, ["open_view", "list_views"]);
	assert.deepEqual(m.registry.Commands?.map((c) => [c.commandName, c.enabled]), [["a", false], ["b", true], ["open_view", true], ["list_views", true]], "their off switch on a stays off");
	assert.deepEqual(m.registry.settings, { port: 9000 }, "their settings stay");
	assert.deepEqual(mergeRegistry({ Commands: [cmd("a")] }, { Commands: [cmd("a")], settings: { port: 8080 } }).registry.settings, { port: 8080 }, "settings only when they had none");

	// through the real copy: the installed list gets the new commands, nothing else changes
	const bundled = tmp("pj-bundle-");
	const appData = tmp("pj-appdata-");
	const programFiles = tmp("pj-pf-");
	mkdirSync(join(programFiles, "Autodesk", "Revit 2026"), { recursive: true });
	const plugin = join(bundled, "addins", "2026", "revit_mcp_plugin");
	mkdirSync(join(plugin, "Commands"), { recursive: true });
	writeFileSync(join(bundled, "addins", "2026", "mcp-servers-for-revit.addin"), "<a/>");
	writeFileSync(join(plugin, "plugin.dll"), "v1");
	writeFileSync(join(plugin, "Commands", "commandRegistry.json"), JSON.stringify({ Commands: [cmd("a"), cmd("open_view")] }));
	const installedPlugin = join(appData, "Autodesk", "Revit", "Addins", "2026", "revit_mcp_plugin");
	mkdirSync(join(installedPlugin, "Commands"), { recursive: true });
	writeFileSync(join(installedPlugin, "Commands", "commandRegistry.json"), JSON.stringify({ Commands: [cmd("a", false)] }));
	const log = syncAddins(bundled, join(tmp("pj-bk-"), "b"), appData, programFiles);
	assert.match(log.join(" | "), /open_view/, "the log says which commands were switched on");
	const after = JSON.parse(readFileSync(join(installedPlugin, "Commands", "commandRegistry.json"), "utf8"));
	assert.deepEqual(after.Commands.map((c: { commandName: string; enabled: boolean }) => [c.commandName, c.enabled]), [["a", false], ["open_view", true]]);
});

test("2.14.5 run_command may not start or stop the app itself (a second copy with no window stays running); ordinary commands on the project folder still run", () => {
	for (const c of [
		"Start-Process 'D:\Code\BIM\projektesana-app\release\win-unpacked\Projektesana.exe'",
		"& .\Projektesana.exe --inspect",
		"cmd /c start Projektesana.exe",
		"taskkill /IM Projektesana.exe /F",
		"taskkill /F /IM Projektesana",
		"Get-Process Projektesana | Stop-Process",
		"Get-Process -Name projektesana | Stop-Process -Force",
		"Stop-Process -Name Projektesana",
		"Start-Process .\Projektesana-Setup-2.14.5.exe",
		"cd release\win-unpacked; dir",
	]) assert.ok(appShellBlock(c), c);
	assert.match(appShellBlock("taskkill /IM Projektesana.exe")!, /pašu lietotni/);
	assert.equal(neverByArgs("run_command", { command: "taskkill /IM Projektesana.exe" })?.includes("lietotni"), true, "the gate refuses it before asking");
	for (const c of ["Get-ChildItem D:\Code\BIM\projektesana-app\docs", "python convert.py a.docx", "Get-Process node", "Stop-Process -Name notepad", "git -C D:\Code\BIM\projektesana-app status"]) assert.equal(appShellBlock(c), null, c);
});
