// 3.2 inventory vs model rooms: the invented 3-floor inventory (kl-rooms.pdf) against the recorded room reply shape
// (export_room_data.json, invented values) plus a few rooms built here. Known differences only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compareRooms, floorOf, tolerance, type InvRoom } from "../src/checks/checks/rooms.ts";
import { pdfLayoutLines, roomsFromLines } from "../src/sources/extract/kl.ts";
import { parseRooms } from "../src/revit/commands.ts";
import { FIX } from "./helpers.ts";

test("floor names: model levels and inventory floors meet", () => {
	assert.equal(floorOf("1. stāvs"), "1");
	assert.equal(floorOf("2. stāvs Cokols"), "2");
	assert.equal(floorOf("Cokols"), "pagrabs");
	assert.equal(floorOf("Bēniņi"), "beniņi");
});

test("tolerance per room type", () => {
	assert.equal(tolerance("Sanitārais mezgls", 3.8), 0.2);
	assert.equal(tolerance("Kabinets", 15.3), 0.2);
	assert.equal(tolerance("Kabinets", 35), 0.35);
	assert.equal(tolerance("Zāle", 48.5), 0.73);
});

test("the known differences of the fixtures, nothing else", async () => {
	const inv: InvRoom[] = roomsFromLines(await pdfLayoutLines(new Uint8Array(readFileSync(join(FIX, "kl-rooms.pdf"))))).rows.map((r) => ({ floor: r.floor, no: r.no, name: r.name, area: r.area }));
	const recorded = parseRooms(readFileSync(join(FIX, "revit", "export_room_data.json"), "utf8")).map((r) => ({ number: r.number, name: r.name, level: r.level, area: r.areaM2, id: r.uniqueId }));
	const model = [
		...recorded,
		{ number: "101", name: "Vējtveris", level: "1. stāvs", area: 4.3, id: "m101" }, // within ±0.2
		{ number: "104", name: "WC", level: "1. stāvs", area: 3.8, id: "m104" }, // name differs
		{ number: "201", name: "Kāpņu telpa", level: "1. stāvs", area: 12.0, id: "m201" }, // wrong level
		{ number: "203", name: "Noliktava", level: "2. stāvs", area: 6.7, id: "m203" },
		{ number: "301", name: "Bēniņu telpa", level: "3. stāvs", area: 55.1, id: "m301" },
		{ number: "999", name: "Izdomāta telpa", level: "3. stāvs", area: 2.0, id: "m999" }, // not in inventory
	];
	const { diffs, matched } = compareRooms(inv, model);
	assert.equal(matched, 8);
	assert.deepEqual(
		diffs.map((d) => [d.kind, d.no]).sort(),
		[
			["area", "202"], // Zāle: 48.5 vs 8.1
			["floor", "201"],
			["missing-in-inventory", "999"],
			["missing-in-model", "302"],
			["name", "104"],
		].sort(),
	);
	assert.match(diffs.find((d) => d.kind === "area")!.message, /48\.5 m², modelī 8\.1 m²/);
});

test("duplicate numbers on either side are reported", () => {
	const { diffs } = compareRooms(
		[
			{ floor: "1", no: "101", name: "A", area: 10 },
			{ floor: "1", no: "101", name: "B", area: 11 },
		],
		[{ number: "101", name: "A", level: "1. stāvs", area: 10, id: "x" }],
	);
	assert.ok(diffs.some((d) => d.kind === "duplicate" && /Inventarizācijā/.test(d.message)));
});
