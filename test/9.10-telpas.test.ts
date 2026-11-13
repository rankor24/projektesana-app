// 9.10 the Telpas page: rooms coloured by difference kind from invented compare rows, the floor strip with each floor's sum check,
// the floor pick, and the tile plan (a treemap sized by area: inside its box, no overlap, proportional).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InventoryTable, RoomCompareRow } from "../src/shared/api.ts";
import { DIFF_TONE, diffByRoom, floorStrip, pickFloor, planRooms, tiles, type PlanRoom } from "../src/shared/rooms-plan.ts";

type Diff = RoomCompareRow["diffs"][number];
const row = (floor: string, no: string, name: string, area: number) => ({ floor, no, name, area, height: 2.7, page: 1 });
const TABLE: InventoryTable = {
	sourceId: "s1",
	title: "Telpu eksplikācija",
	rows: [row("1", "101", "Vestibils", 20), row("1", "102", "Birojs", 30), row("1", "103", "WC", 5), row("2", "201", "Birojs", 40), row("2", "202", "Sanāksmju telpa", 25)],
	totals: [
		{ floor: "1", stated: 55, sum: 55, ok: true },
		{ floor: "2", stated: 70, sum: 65, ok: false },
		{ floor: "*", stated: 120, sum: 120, ok: true },
	],
	unread: [],
};
const inv = (floor: string, no: string, name: string, area: number) => ({ floor, no, name, area });
const DIFFS: Diff[] = [
	{ kind: "area", no: "102", message: "m", inventory: inv("1", "102", "Birojs", 30), model: { number: "102", name: "Birojs", level: "1. stāvs", area: 27, id: "9001" }, delta: -3, tolerance: 0.5 },
	{ kind: "name", no: "102", message: "m", inventory: inv("1", "102", "Birojs", 30), model: { number: "102", name: "Kabinets", level: "1. stāvs", area: 30, id: "9001" } },
	{ kind: "missing-in-model", no: "201", message: "m", inventory: inv("2", "201", "Birojs", 40) },
	{ kind: "name", no: "202", message: "m", inventory: inv("2", "202", "Sanāksmju telpa", 25), model: { number: "202", name: "Sēde", level: "2. stāvs", area: 25, id: "9002" } },
	{ kind: "missing-in-inventory", no: "205", message: "m", model: { number: "205", name: "Noliktava", level: "2. stāvs", area: 12, id: "9005" } },
	{ kind: "missing-in-inventory", no: "399", message: "m", model: { number: "399", name: "Jumts", level: "3. stāvs", area: 50, id: "9399" } },
	{ kind: "rubbish", no: "103", message: "m" },
];

test("each room is coloured by its worst difference: missing and area are red, name and floor amber; an unknown kind is ignored", () => {
	const m = diffByRoom(DIFFS);
	assert.equal(m.get("102"), "area", "area outranks name");
	assert.equal(m.get("201"), "missing-in-model");
	assert.equal(m.get("202"), "name");
	assert.equal(m.get("205"), "missing-in-inventory");
	assert.equal(m.has("103"), false);
	assert.deepEqual([DIFF_TONE.area, DIFF_TONE["missing-in-model"], DIFF_TONE.name, DIFF_TONE.floor, DIFF_TONE.duplicate], ["bad", "bad", "warn", "warn", "bad"]);
	assert.equal(diffByRoom([{ kind: "name", no: "1", message: "" }, { kind: "duplicate", no: "1", message: "" }]).get("1"), "duplicate", "the worst, whatever the order");
	assert.equal(diffByRoom([]).size, 0);
});

test("the floor strip: a chip per floor with its rooms, its sum and its stated total; a failing sum shows; the grand total belongs to no floor", () => {
	const s = floorStrip([TABLE], DIFFS);
	assert.deepEqual(s.map((c) => c.floor), ["1", "2"]);
	assert.deepEqual([s[0].rooms, s[0].sum, s[0].stated, s[0].ok], [3, 55, 55, true]);
	assert.deepEqual([s[1].rooms, s[1].sum, s[1].stated, s[1].ok], [2, 65, 70, false], "the document says 70, the rows add up to 65");
	assert.deepEqual(s.map((c) => c.diffs), [1, 2], "floor 1: room 102; floor 2: 201 and 202 (205 is not in the inventory)");
	assert.deepEqual(floorStrip([TABLE]).map((c) => c.diffs), [0, 0], "no comparison made: no differences claimed");
	assert.deepEqual(floorStrip([]), []);
	const two = floorStrip([TABLE, { ...TABLE, sourceId: "s2", rows: [row("1", "104", "Sporta zāle", 10.555)], totals: [] }]);
	assert.deepEqual([two[0].rooms, two[0].sum], [4, 65.56], "a second table adds to the same floor");
});

test("the floor pick: the one chosen, else the first whose sum fails, else the first; nothing when there are no floors", () => {
	const s = floorStrip([TABLE]);
	assert.equal(pickFloor(s), "2", "the floor that does not add up");
	assert.equal(pickFloor(s, "1"), "1");
	assert.equal(pickFloor(s, "9"), "2", "a floor that is not there is not picked");
	assert.equal(pickFloor(floorStrip([{ ...TABLE, totals: [] }])), "1");
	assert.equal(pickFloor([]), null);
});

test("the rooms of a floor: every inventory row with its difference, the model-only rooms of that floor, biggest first", () => {
	const f2 = planRooms([TABLE], DIFFS, "2");
	assert.deepEqual(f2.map((r) => [r.no, r.diff, !!r.modelOnly]), [["201", "missing-in-model", false], ["202", "name", false], ["205", "missing-in-inventory", true]]);
	assert.equal(f2[1].modelId, "9002", "a room the model has can be selected in Revit");
	assert.equal(f2[0].modelId, undefined, "a room the model lacks cannot");
	assert.ok(!f2.some((r) => r.no === "399"), "a room of floor 3 is not on floor 2");
	const f1 = planRooms([TABLE], DIFFS, "1");
	assert.deepEqual(f1.map((r) => [r.no, r.diff]), [["102", "area"], ["101", null], ["103", null]]);
	assert.deepEqual(planRooms([TABLE], [], "1").map((r) => r.diff), [null, null, null]);
	assert.deepEqual(planRooms([TABLE], DIFFS, "7"), []);
});

const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const R = (no: string, area: number): PlanRoom => ({ no, name: no, area, floor: "1", diff: null });

test("the tile plan: every tile inside the box, none overlapping, the box filled, areas proportional to the rooms'", () => {
	const rooms = [R("a", 30), R("b", 20), R("c", 10), R("d", 5), R("e", 5)];
	const t = tiles(rooms, 600, 300);
	assert.equal(t.length, 5);
	for (const x of t) assert.ok(x.x >= -1e-6 && x.y >= -1e-6 && x.x + x.w <= 600 + 1e-6 && x.y + x.h <= 300 + 1e-6 && x.w > 0 && x.h > 0, x.room.no);
	for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) assert.ok(!overlap(t[i], t[j]), `${t[i].room.no} / ${t[j].room.no}`);
	const filled = t.reduce((s, x) => s + x.w * x.h, 0);
	assert.ok(Math.abs(filled - 600 * 300) < 1, `the box is filled (${filled})`);
	const total = 70;
	for (const x of t) assert.ok(Math.abs((x.w * x.h) / (600 * 300) - x.room.area / total) < 1e-6, `${x.room.no} proportional`);
	assert.deepEqual(tiles([], 600, 300), []);
	assert.deepEqual(tiles(rooms, 0, 300), []);
	const one = tiles([R("a", 12)], 100, 50);
	assert.deepEqual([one[0].x, one[0].y, one[0].w, one[0].h], [0, 0, 100, 50]);
});

test("a room with no area still gets a tile to click; a tall box and a wide box both work", () => {
	const t = tiles([R("a", 40), R("b", 0), R("c", 0)], 200, 400);
	assert.equal(t.length, 3);
	assert.ok(t.every((x) => x.w > 1 && x.h > 1));
	for (const [w, h] of [[200, 400], [400, 200], [100, 100]]) {
		const x = tiles([R("a", 9), R("b", 7), R("c", 5), R("d", 3), R("e", 2), R("f", 1)], w, h);
		const filled = x.reduce((s, y) => s + y.w * y.h, 0);
		assert.ok(Math.abs(filled - w * h) < 1, `${w}x${h}`);
	}
});
