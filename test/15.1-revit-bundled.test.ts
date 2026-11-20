// The Revit MCP shipped inside the app: found when nothing else is set, and the add-in installs without deleting anything.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundledRevitLaunch, resolveRevitLaunch, setBundledRevitDir } from "../src/revit/client.ts";
import { addinStatus, installAddins } from "../src/revit/addin-install.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pj-rv-"));
function fakeBundle(): string {
	const b = tmp();
	mkdirSync(join(b, "node-server", "build"), { recursive: true });
	writeFileSync(join(b, "node-server", "build", "index.js"), "");
	mkdirSync(join(b, "node-runtime"), { recursive: true });
	writeFileSync(join(b, "node-runtime", "node.exe"), "");
	const a = join(b, "addins", "2026");
	mkdirSync(join(a, "revit_mcp_plugin", "Commands"), { recursive: true });
	writeFileSync(join(a, "revit_mcp_plugin", "RevitMCPPlugin.dll"), "new");
	writeFileSync(join(a, "revit_mcp_plugin", "Commands", "commandRegistry.json"), "fresh");
	writeFileSync(join(a, "mcp-servers-for-revit.addin"), "<manifest/>");
	return b;
}

test("bundled server is the last place to look; the user's own path still wins", () => {
	const b = fakeBundle();
	assert.equal(bundledRevitLaunch(b)?.source, "iekļauts");
	assert.equal(bundledRevitLaunch(join(b, "nope")), null);
	setBundledRevitDir(b);
	const l = resolveRevitLaunch({ revitServerJs: null, revitNode: null });
	// a machine with a standard install finds that first; either way something is found
	assert.ok(l);
	assert.equal(resolveRevitLaunch({ revitServerJs: "C:\nav\index.js", revitNode: null }), null);
	setBundledRevitDir(null);
});

test("add-in install copies, backs up the old plugin, keeps the user's command list", () => {
	const b = fakeBundle();
	const appData = tmp();
	assert.deepEqual(addinStatus(b, appData), [{ year: "2026", available: true, installed: false }]);
	installAddins(b, ["2026"], join(tmp(), "bk"), appData);
	const plugin = join(appData, "Autodesk", "Revit", "Addins", "2026", "revit_mcp_plugin");
	assert.equal(readFileSync(join(plugin, "RevitMCPPlugin.dll"), "utf8"), "new");
	assert.equal(addinStatus(b, appData)[0]?.installed, true);
	// the user changes the command list; a second install keeps it and backs the plugin up
	writeFileSync(join(plugin, "Commands", "commandRegistry.json"), "mine");
	const bk = join(tmp(), "bk");
	installAddins(b, ["2026"], bk, appData);
	assert.equal(readFileSync(join(plugin, "Commands", "commandRegistry.json"), "utf8"), "mine");
	assert.ok(existsSync(join(bk, "2026", "revit_mcp_plugin", "RevitMCPPlugin.dll")));
});

test("add-in install refuses a bad year and a missing bundle", () => {
	assert.throws(() => installAddins(null, ["2026"], tmp(), tmp()), /nav iekļauts/);
	assert.throws(() => installAddins(fakeBundle(), ["../x"], tmp(), tmp()), /Nederīgs/);
	assert.throws(() => installAddins(fakeBundle(), ["2030"], tmp(), tmp()), /nav iekļauts/);
});
