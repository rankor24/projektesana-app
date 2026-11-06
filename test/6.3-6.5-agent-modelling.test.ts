// 6.3 Revit allow-list, rules and skills; 6.4 pins as tasks (prompt order, resolve vs close); 6.5 the existing-building task.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildPrompt } from "../src/agent/prompt.ts";
import { listSkills, readSkill, skillsText } from "../src/agent/skills.ts";
import { TASKS } from "../src/agent/tasks.ts";
import { appLevels } from "../src/agent/tools/defs.ts";
import { makeLevelOf, offered } from "../src/agent/tools/levels.ts";
import { REVIT_LEVELS, REVIT_TOOLS } from "../src/agent/tools/revit-levels.ts";
import { REVIT_RULES } from "../src/agent/tools/revit.ts";
import { addPin, closePin, resolvePin } from "../src/core/pins.ts";
import type { Pin } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { tmp } from "./helpers.ts";

test("6.3 Revit allow-list: create and modify wait for Boris; delete and code are never offered", () => {
	const levelOf = makeLevelOf(appLevels(), REVIT_LEVELS);
	const off = offered(REVIT_TOOLS, levelOf);
	for (const t of ["create_level", "create_grid", "create_line_based_element", "create_room", "operate_element", "tag_all_rooms"]) {
		assert.ok(off.includes(t), t);
		assert.equal(levelOf(t), "confirm", t);
	}
	for (const t of ["delete_element", "send_code_to_revit"]) assert.ok(!off.includes(t), t);
	for (const t of ["export_room_data", "get_current_view_info", "list_revit_instances"]) assert.equal(levelOf(t), "read", t);
	assert.equal(levelOf("a_new_tool_nobody_rated"), "never");
});

test("6.3 the rules the agent works by", () => {
	for (const rule of [/Vispirms asis un līmeņi/, /Katra siena ir viena siena/, /tikai ārējās un iekšējās sienas savienojumā/, /plānas sienas/, /Nekad nepārbūvē to, ko Boris ir izlabojis/, /Viena darbība — viens īss izsaukums/, /darba kopijā/]) assert.match(REVIT_RULES, rule);
});

test("6.3 skills: listed with descriptions, read inside their folder only", () => {
	const dir = tmp();
	mkdirSync(join(dir, "revit-modeling", "snippets"), { recursive: true });
	writeFileSync(join(dir, "revit-modeling", "SKILL.md"), "---\nname: revit-modeling\ndescription: Use when creating walls, floors, rooms through the Revit MCP.\n---\n# Revit modeling\nWalls one by one.");
	writeFileSync(join(dir, "revit-modeling", "snippets", "walls.md"), "wall snippet");
	const s = listSkills(dir);
	assert.deepEqual(s.map((x) => [x.name, x.description]), [["revit-modeling", "Use when creating walls, floors, rooms through the Revit MCP."]]);
	assert.deepEqual(s[0].files.sort(), ["SKILL.md", "snippets/walls.md"]);
	assert.match(readSkill(dir, "revit-modeling"), /Walls one by one/);
	assert.equal(readSkill(dir, "revit-modeling", "snippets/walls.md"), "wall snippet");
	assert.throws(() => readSkill(dir, "revit-modeling", "../../etc/passwd"), /ārpus/);
	assert.throws(() => readSkill(dir, "../x"), /Nederīgs/);
	assert.match(skillsText(s), /revit-modeling: Use when creating walls/);
});

test("6.4 prompt order: open pins first (oldest first), then resolved ones, then the Fokuss, then Boris's words", () => {
	const p = (id: string, state: Pin["state"], at: string): Pin => ({ id, target: { sourceId: "s1", page: 2, x: 0.5, y: 0.5 }, text: `piezīme ${id}`, comments: [], by: "boris", at, state, findingId: null, requirementId: null });
	const prompt = buildPrompt([p("p3", "resolved", "2026-11-01"), p("p2", "open", "2026-11-03"), p("p1", "open", "2026-11-02"), p("p0", "closed", "2026-10-01")], [{ kind: "source", id: "s1", label: "PU" }], "Turpini.");
	const iP1 = prompt.indexOf("[p1]");
	const iP2 = prompt.indexOf("[p2]");
	const iP3 = prompt.indexOf("[p3]");
	assert.ok(prompt.startsWith("Borisa piezīmes"));
	assert.ok(iP1 < iP2 && iP2 < iP3, "open oldest first, then resolved");
	assert.ok(!prompt.includes("[p0]"), "closed pins are no task");
	assert.ok(prompt.indexOf("Fokuss (1)") > iP3 && prompt.endsWith("Turpini."));
	assert.equal(buildPrompt([], [], "Sveiks"), "Fokuss: nekas\n\nSveiks");
});

test("6.4 the agent resolves a pin; only Boris closes it", () => {
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-06T00:00:00Z" });
	const pin = addPin(s, { sourceId: "s1", page: 1, x: 0.2, y: 0.3 }, "Šeit trūkst durvju", "boris");
	resolvePin(s, pin.id, "Pievienotas durvis D-1 telpā 102");
	assert.equal(s.read("pins")[0].state, "resolved");
	assert.equal(s.read("pins")[0].comments[0].by, "agent");
	assert.throws(() => closePin(s, pin.id, "agent"), /tikai Boris/);
	closePin(s, pin.id, "boris");
	assert.equal(s.read("pins")[0].state, "closed");
	assert.throws(() => addPin(s, { x: 2, y: 0 }, "ārpus lapas", "agent"), /Nederīga/);
});

test("6.5 the existing-building task: levels and grids first, batches per floor, the room check after each", () => {
	const t = TASKS.find((x) => x.id === "existing-building")!.text;
	assert.ok(t.indexOf("līmeņi un asis") < t.indexOf("ārsienas"));
	assert.match(t, /list_findings checkId=rooms/);
	assert.match(t, /nepārbūvē/);
});

test("6.1/6.3 the app's named Revit commands: exports and the working copy run, view and sheet creation waits for Boris", async () => {
	const lv = appLevels();
	for (const t of ["export_room_table", "revit_export_pdf", "revit_export_ifc", "revit_save_copy", "revit_view_geometry"]) assert.equal(lv[t], "run", t);
	for (const t of ["revit_create_plans", "revit_set_view_scale", "revit_create_elevations", "revit_create_sheet"]) assert.equal(lv[t], "confirm", t);
	const { CREATE_SNIPPETS } = await import("../src/agent/tools/revit-commands.ts");
	for (const [k, code] of Object.entries(CREATE_SNIPPETS)) assert.ok(code.split("\n").length <= 7, `${k} is short`);
});

test("export_room_table writes the inventory table to the data folder", async () => {
	const { readFileSync, existsSync } = await import("node:fs");
	const { revitCommandTools } = await import("../src/agent/tools/revit-commands.ts");
	const { FIX } = await import("./helpers.ts");
	const s = ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-06T00:00:00Z" });
	const sha = "e".repeat(64);
	s.write("sources", [{ id: "s_kl", kind: "document", folderKey: "1.1.2", paths: ["kl.txt"], title: "KL", role: "Īpašuma dokumenti", roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: "2026-11-06T00:00:00Z", seenAt: "2026-11-06T00:00:00Z", textState: "ocr" }], signers: [] }], { kind: "t", by: "app" });
	s.writeText(sha, { state: "ocr", pages: ["Telpu eksplikācija\n1. stāvs\n1 101 Vējtveris 4,2\n2 102 Gaitenis 18,6"] });
	void readFileSync;
	void FIX;
	const t = revitCommandTools.find((x) => x.name === "export_room_table")!;
	const r = (await t.run({ projectsDir: s.projectsDir, projectId: "BD999", dataDir: "", appDir: "", runDir: null }, {})) as { ok: boolean; file: string };
	assert.equal(r.ok, true);
	assert.ok(existsSync(r.file) && r.file.startsWith(s.dir));
});
