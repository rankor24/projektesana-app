// 3.5 PU room programme vs model rooms, on an invented programme.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareProgramme, programmeRows } from "../src/checks/checks/programme.ts";

const PU = [
	"PROJEKTĒŠANAS UZDEVUMS\n1. Vispārīgi\nĒka atrodas Testa ielā 1.",
	"2. pielikums. Telpu programma\n1. Kabinets – 3 gab. – 15 m²\n2. Zāle – min. 60 m²\n3. Noliktava – 8 m²\n4. Sanitārais mezgls – 2 gab. – 4 m²",
];

test("programme rows: name, count, area, minimum, page", () => {
	const rows = programmeRows(PU);
	assert.deepEqual(
		rows.map((r) => [r.name, r.count, r.area, r.minimum, r.page]),
		[
			["Kabinets", 3, 15, false, 2],
			["Zāle", 1, 60, true, 2],
			["Noliktava", 1, 8, false, 2],
			["Sanitārais mezgls", 2, 4, false, 2],
		],
	);
});

test("findings per missing, undersized and oversized room", () => {
	const model = [
		{ number: "101", name: "Kabinets", area: 15.2, id: "a" },
		{ number: "102", name: "Kabinets", area: 18.0, id: "b" }, // +20 % → oversized
		{ number: "201", name: "Zāle", area: 48.5, id: "c" }, // under min 60
		{ number: "203", name: "Noliktava", area: 8.5, id: "d" }, // within 10 %
		{ number: "104", name: "Sanitārais mezgls", area: 3.8, id: "e" },
		{ number: "105", name: "Sanitārais mezgls", area: 4.1, id: "f" },
	];
	const d = compareProgramme(programmeRows(PU), model);
	assert.deepEqual(d.map((x) => [x.kind, x.id ?? ""]).sort(), [
		["missing", ""], // kabineti: 2 of 3
		["oversized", "b"],
		["undersized", "c"],
	].sort());
	assert.match(d.find((x) => x.kind === "missing")!.message, /Kabinets” 3 gab\., modelī 2/);
});
