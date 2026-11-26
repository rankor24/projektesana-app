// 19.1 Telpas: deleting and editing rooms of a document's inventory (the screen's multi-select, the agent's tools).
// A deleted room must stay deleted when the document is read again, and must not come back with the agent's full rewrite.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { APP_CALL_LEVEL } from "../src/shared/app-calls.ts";
import { deleteRooms, editRoom, inventoryTables, setCorrectedRooms, withRowIds } from "../src/sources/room-table.ts";
import { tmp } from "./helpers.ts";

const at = "2026-11-06T00:00:00Z";
const TEXT = "Telpu eksplikācija\n1. stāvs\n1 101 Vējtveris 4,2\n2 102 Gaitenis 18,6\n3 103 Kabinets 12,5\n4 104 Blakus telpa 7,0";

function project() {
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: at });
	const sha = "f".repeat(64);
	s.write("sources", [{ id: "s_kl", kind: "document", folderKey: "1.1.2", paths: ["kl.txt"], title: "KL", role: "Īpašuma dokumenti", roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ocr" }], signers: [] }], { kind: "t", by: "app" });
	s.writeText(sha, { state: "ocr", pages: [TEXT] });
	return { s, sha };
}
const rows = async (s: ProjectStore) => (await inventoryTables(s))[0]!;

test("deleting rooms makes the table a correction without them, and they stay deleted when the text is read again", async () => {
	const { s, sha } = project();
	const before = await rows(s);
	assert.equal(before.state, "skenēts");
	const ids = withRowIds(before.table.rows).map((r) => r.id);
	assert.equal(new Set(ids).size, 4);

	const r = await deleteRooms(s, "s_kl", [ids[1]!, ids[3]!], "user");
	assert.deepEqual({ removed: r.removed, left: r.left }, { removed: 2, left: 2 });
	const after = await rows(s);
	assert.equal(after.state, "labots");
	assert.equal(after.correctedBy, "user");
	assert.deepEqual(after.table.rows.map((x) => x.no), ["101", "103"]);

	// the document is read again (new text with the same rooms plus one): the corrected table stays as it was
	s.writeText(sha, { state: "ocr", pages: [TEXT + "\n5 105 Jauna telpa 9,0"] });
	assert.deepEqual((await rows(s)).table.rows.map((x) => x.no), ["101", "103"]);
	assert.ok(s.events().some((e) => e.kind === "inventory.rooms.deleted"));
});

test("a full rewrite leaves out rooms that were deleted, and says how many", async () => {
	const { s } = project();
	const ids = withRowIds((await rows(s)).table.rows).map((r) => r.id);
	await deleteRooms(s, "s_kl", [ids[0]!], "user");
	const again = [
		{ floor: "1", no: "101", name: "Vējtveris", area: 4.2, height: null, page: 1 },
		{ floor: "1", no: "102", name: "Gaitenis", area: 18.6, height: null, page: 1 },
	];
	const w = setCorrectedRooms(s, "s_kl", again, "agent");
	assert.deepEqual(w, { rooms: 1, skipped: 1 });
	assert.deepEqual((await rows(s)).table.rows.map((x) => x.no), ["102"]);
	// clear: back to what code reads, and the deletions are forgotten
	setCorrectedRooms(s, "s_kl", null, "user");
	const back = await rows(s);
	assert.equal(back.state, "skenēts");
	assert.equal(back.table.rows.length, 4);
});

test("delete all leaves an empty table that can be restored; unknown ids are refused", async () => {
	const { s } = project();
	await assert.rejects(() => deleteRooms(s, "s_kl", ["nope"], "user"), /nav/);
	assert.deepEqual(await deleteRooms(s, "s_kl", "all", "user"), { removed: 4, left: 0, unknown: [] });
	const t = await rows(s);
	assert.equal(t.state, "labots");
	assert.equal(t.table.rows.length, 0);
	setCorrectedRooms(s, "s_kl", null, "user");
	assert.equal((await rows(s)).table.rows.length, 4);
});

test("editing one room changes only it, keeps the others, and checks the values", async () => {
	const { s } = project();
	const ids = withRowIds((await rows(s)).table.rows).map((r) => r.id);
	const e = await editRoom(s, "s_kl", ids[2]!, { name: "Darba kabinets", area: 13.1, height: 2.95 }, "agent");
	assert.equal(e.name, "Darba kabinets");
	const t = await rows(s);
	assert.equal(t.state, "labots");
	assert.equal(t.correctedBy, "agent");
	assert.deepEqual(t.table.rows.map((r) => [r.no, r.name, r.area, r.height]), [
		["101", "Vējtveris", 4.2, null],
		["102", "Gaitenis", 18.6, null],
		["103", "Darba kabinets", 13.1, 2.95],
		["104", "Blakus telpa", 7, null],
	]);
	await assert.rejects(() => editRoom(s, "s_kl", e.id, { area: 0 }, "agent"), /platību/);
	await assert.rejects(() => editRoom(s, "s_kl", "nope", { name: "x" }, "agent"), /nav/);
});

test("the agent has the tools, deleting the app's own table needs no click (2.15.0), and the screen's calls are levelled", async () => {
	const { planningTools, PLANNING_TOOL_DATA } = await import("../src/agent/tools/planning.ts");
	const del = planningTools.find((t) => t.name === "delete_inventory_rooms")!;
	const edit = planningTools.find((t) => t.name === "edit_inventory_room")!;
	assert.equal(del.level, "confirm");
	assert.equal(edit.level, "run");
	assert.ok(PLANNING_TOOL_DATA.delete_inventory_rooms?.includes("rooms") && PLANNING_TOOL_DATA.edit_inventory_room?.includes("rooms"));
	assert.equal(APP_CALL_LEVEL["rooms.delete"], "run");
	assert.equal(APP_CALL_LEVEL["rooms.update"], "run");
	assert.equal(APP_CALL_LEVEL["rooms.restore"], "run");

	const { s } = project();
	const ctx = { projectsDir: s.projectsDir, projectId: "BD999", dataDir: "", appDir: "", runDir: null };
	const ids = withRowIds((await rows(s)).table.rows).map((r) => r.id);
	await assert.rejects(async () => del.run(ctx, { sourceId: "s_kl" }), /rowIds/);
	const d = (await del.run(ctx, { sourceId: "s_kl", rowIds: [ids[0]!, "zzz"] })) as { removed: number; left: number; unknownIds: string[] };
	assert.deepEqual({ removed: d.removed, left: d.left, unknownIds: d.unknownIds }, { removed: 1, left: 3, unknownIds: ["zzz"] });
	const e = (await edit.run(ctx, { sourceId: "s_kl", roomId: withRowIds((await rows(s)).table.rows)[0]!.id, name: "Gaitenis 2" })) as { ok: boolean };
	assert.equal(e.ok, true);
});
