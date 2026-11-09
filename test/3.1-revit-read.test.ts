// 3.1 Revit read parsers on reply shapes recorded from a live Revit 2026 (values invented, test/fixtures/revit).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { defaultRevitLaunch, launchSpec, resolveRevitLaunch } from "../src/revit/client.ts";
import { parseInstances, parseLevels, parseRooms, revitRead } from "../src/revit/commands.ts";
import { FIX, tmp } from "./helpers.ts";

const rec = (name: string) => readFileSync(join(FIX, "revit", `${name}.json`), "utf8");

test("instances: pid, version, active document and view", () => {
	const r = parseInstances(rec("list_revit_instances"));
	assert.equal(r.selectedPid, null);
	assert.deepEqual(r.instances[0], { pid: 11111, version: "2026", document: "BD999-AR-Testa-iela-1", documentPath: r.instances[0].documentPath, activeView: "1. STĀVA PLĀNS" });
});

test("rooms: number, name, level, area converted from square feet to m²", () => {
	const rooms = parseRooms(rec("export_room_data"));
	assert.deepEqual(rooms.map((r) => [r.number, r.name, r.level, r.areaM2]), [
		["102", "Gaitenis", "1. stāvs", 18.6],
		["103", "Kabinets", "1. stāvs", 15.3],
		["202", "Zāle", "2. stāvs", 8.1],
	]);
	assert.equal(rooms[0].heightMm, 3100);
	assert.equal(rooms[0].id, "1000001");
});

test("levels: elevations from feet to mm, sorted", () => {
	assert.deepEqual(parseLevels(rec("analyze_model_statistics")).map((l) => [l.name, l.elevationMm]), [
		["Zeme", 0],
		["1. stāvs", 450],
		["2. stāvs", 3400],
	]);
});

test("a failed reply is an error with Revit's message, never an empty list", () => {
	assert.throws(() => parseRooms('{"success":false,"message":"No active document"}'), /No active document/);
	assert.throws(() => parseRooms("Revit is not running"), /nav JSON/);
});

test("commands make one short call each to a read tool", async () => {
	const calls: string[] = [];
	const r = { call: async (tool: string) => (calls.push(tool), rec(tool)) };
	await revitRead.rooms(r);
	await revitRead.levels(r);
	await revitRead.instances(r);
	assert.deepEqual(calls, ["export_room_data", "analyze_model_statistics", "list_revit_instances"]);
});

test("launch: settings first, else the installer's location; nothing found → not configured", () => {
	assert.equal(defaultRevitLaunch(tmp()), null);
	assert.equal(resolveRevitLaunch({ revitServerJs: "C:\\nav\\index.js", revitNode: null }), null);
	assert.deepEqual(launchSpec({ serverJs: "s.js", node: null }, "electron.exe"), { command: "electron.exe", args: ["s.js"], env: { ELECTRON_RUN_AS_NODE: "1" } });
	assert.deepEqual(launchSpec({ serverJs: "s.js", node: "node.exe" }, "electron.exe"), { command: "node.exe", args: ["s.js"], env: {} });
});

test("the standard install is found automatically and says so; Boris's path wins and says so", async () => {
	const { mkdirSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const local = tmp();
	mkdirSync(join(local, "Revit-MCP-Node", "node-server", "build"), { recursive: true });
	mkdirSync(join(local, "Revit-MCP-Node", "node-runtime"), { recursive: true });
	writeFileSync(join(local, "Revit-MCP-Node", "node-server", "build", "index.js"), "");
	writeFileSync(join(local, "Revit-MCP-Node", "node-runtime", "node.exe"), "");
	const auto = defaultRevitLaunch(local)!;
	assert.equal(auto.source, "automātiski");
	assert.ok(auto.node?.endsWith("node.exe"));
	const own = resolveRevitLaunch({ revitServerJs: auto.serverJs, revitNode: null })!;
	assert.equal(own.source, "iestatījumi");
	assert.equal(own.node, null);
});
