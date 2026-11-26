// 1.10 VZD "Būves eksplikācija" read from OCR text (fixture: invented building, two room groups, three floors, scan noise):
// every room is kept with its floor, group, area and height, the document's group and building totals check the rows, and the
// inventory (Telpas, comparison with the model) takes this reader for such a document and the old one for any other.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { isEksplikacija, roomsFromEksplikacija } from "../src/sources/extract/eksplikacija.ts";
import { totalsCheck } from "../src/sources/extract/kl.ts";
import { inventoryTables, withRowIds } from "../src/sources/room-table.ts";
import { FIX, tmp } from "./helpers.ts";

const PAGES = readFileSync(join(FIX, "docs", "eksplikacija-ocr.txt"), "utf8").split("\f");
const at = "2026-11-26T00:00:00Z";

test("the reader keeps every room of the scan with floor, group, area and height", () => {
	const t = roomsFromEksplikacija(PAGES);
	assert.equal(t.rows.length, 13);
	assert.deepEqual(t.unread, []);
	const row = (floor: string, group: string, no: string) => t.rows.find((r) => r.floor === floor && r.group === group && r.no === no)!;
	// a clean row, and a row whose area and height are in the usual order
	assert.deepEqual(
		{ name: row("1", "001", "1").name, area: row("1", "001", "1").area, height: row("1", "001", "1").height, page: row("1", "001", "1").page },
		{ name: "gaitenis", area: 17.6, height: 2.95, page: 1 },
	);
	// table borders read as | I !, the type misread (Nedzlvojama, iek~telpa), the trailing "pazīme" digit: still the room
	assert.deepEqual([row("1", "002", "1").name, row("1", "002", "1").area, row("1", "002", "1").height], ["vestibils", 24.5, 3.4]);
	assert.deepEqual([row("1", "002", "3").area, row("1", "002", "3").height], [6.2, 3.4]);
	assert.deepEqual([row("-1", "001", "1").name, row("-1", "001", "1").area], ["noliktava", 31.4]);
	// "Stays: 2" and "Srnvs: -1" are floors; names get their diacritics back from the room names the documents use
	assert.equal(row("-1", "001", "2").name, "palīgtelpa");
	assert.equal(row("-1", "001", "3").name, "tehniskā telpa");
	// height before area (the scan swapped the columns): the number nearest the floor's usual height is the height
	assert.deepEqual([row("-1", "001", "3").area, row("-1", "001", "3").height], [14.6, 2.95]);
	// a page read column by column: the names first, the "type area height" lines after, in the same order
	assert.deepEqual([row("2", "002", "4").name, row("2", "002", "4").area, row("2", "002", "4").height], ["zāle", 116.2, 3.45]);
	assert.deepEqual([row("2", "002", "5").name, row("2", "002", "5").area], ["sēžu telpa", 24.8]);
	// the room number moved behind the name ("noliktava Nedzīvojama iekštelpa 6 7.9 3.45")
	assert.deepEqual([row("2", "002", "6").name, row("2", "002", "6").area, row("2", "002", "6").height], ["noliktava", 7.9, 3.45]);
});

test("the document's group and building totals check the rows", () => {
	const t = roomsFromEksplikacija(PAGES);
	const check = totalsCheck(t);
	assert.deepEqual(
		check.map((x) => [x.group ?? "visa ēka", x.stated, x.sum, x.ok]),
		[
			["001", 96.3, 96.3, true],
			["002", 194.9, 194.9, true],
			["visa ēka", 291.2, 291.2, true],
		],
	);
	// a room the scan lost shows as a total that does not add up
	t.rows = t.rows.filter((r) => !(r.group === "002" && r.no === "5"));
	const bad = totalsCheck(t);
	assert.deepEqual(bad.map((x) => x.ok), [true, false, false]);
	assert.equal(bad[1]!.sum, 170.1);
});

test("a line that looks like a room but has no sizes goes to the unread list, not into the table", () => {
	const t = roomsFromEksplikacija(["Stāvs: 1\nTelpu grupas numurs: 001\n1 gaitenis Nedzīvojama iekštelpa 17.6 2.95\ngarderobe Nedzīvojama iekštelpa\n2 kabinets Nedzīvojama iekštelpa 12.4 2.95"]);
	assert.deepEqual(t.rows.map((r) => r.no), ["1", "2"]);
	assert.equal(t.unread.length, 1);
	assert.match(t.unread[0]!.line, /garderobe/);
});

test("only a document with room groups and room types is an eksplikācija", () => {
	assert.equal(isEksplikacija(PAGES), true);
	assert.equal(isEksplikacija(["Telpu eksplikācija\n1. stāvs\n1 101 Vējtveris 4,2\n2 102 Gaitenis 18,6\n3 103 Kabinets 12,5"]), false);
});

test("the inventory reads such a scan with this reader, the rows keep their group, and its state is skenēts", async () => {
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: at });
	const sha = "e".repeat(64);
	s.write("sources", [{ id: "s_ek", kind: "document", folderKey: "1.1.2", paths: ["eksplikacija.pdf"], title: "Eksplikācija", role: "Īpašuma dokumenti", roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ocr" }], signers: [] }], { kind: "t", by: "app" });
	s.writeText(sha, { state: "ocr", pages: PAGES });
	const [t] = await inventoryTables(s);
	assert.ok(t);
	assert.equal(t.state, "skenēts");
	assert.equal(t.table.rows.length, 13);
	assert.ok(totalsCheck(t.table).every((x) => x.ok));
	// the same room number in two groups gets two ids, and every row names its group
	const ids = withRowIds(t.table.rows).map((r) => r.id);
	assert.equal(new Set(ids).size, 13);
	assert.ok(t.table.rows.every((r) => r.group === "001" || r.group === "002"));
});
