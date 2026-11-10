// 7.5 the agent's delivery tools: levels (start and remove wait for the user; staging runs; no copy and no "sent" tool at
// all), the tools refuse without a draft, start opens the Nodevumi panel, the checklist answers without Revit.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TASKS } from "../src/agent/tasks.ts";
import { SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { ProjectStore } from "../src/core/store.ts";
import { readUi } from "../src/shared/ui-instruction.ts";
import { tmp } from "./helpers.ts";

function ctx(): { c: ToolCtx; store: ProjectStore; root: string } {
	const projectsDir = tmp();
	const root = join(tmp(), "BD999 Testa iela 1");
	mkdirSync(join(root, "01_Projektesana", "1.1_Izejas dati"), { recursive: true });
	writeFileSync(join(root, "01_Projektesana", "1.1_Izejas dati", "TN.pdf"), "tn");
	const store = ProjectStore.open(projectsDir, { id: "BD999", name: "BD999", root, createdAt: "2026-11-10T00:00:00Z" });
	return { c: { projectsDir, projectId: "BD999", dataDir: tmp(), appDir: tmp(), runDir: null }, store, root };
}
const run = (name: string, c: ToolCtx, args: Record<string, unknown>) => allTools().find((t) => t.name === name)!.run(c, args as never);

test("7.5 levels: start and unstage wait for the user, staging runs, the checklist reads; nothing copies or marks sent", () => {
	const lv = appLevels();
	assert.equal(lv.start_delivery, "confirm");
	assert.equal(lv.unstage_file, "confirm");
	for (const t of ["stage_revit_sheets", "stage_ifc", "stage_source_file"]) assert.equal(lv[t], "run", t);
	assert.equal(lv.delivery_checklist, "read");
	const names = allTools().map((t) => t.name);
	assert.ok(!names.some((n) => /copy_deliver|deliver.*copy|mark.*sent|sent|nosut/i.test(n)), names.filter((n) => /sent|copy/.test(n)).join(","));
});

test("7.5 without a draft the staging tools say to start one; start_delivery opens the panel on the new draft", async () => {
	const { c, store } = ctx();
	await assert.rejects(async () => run("stage_ifc", c, {}), /start_delivery/);
	assert.throws(() => run("stage_source_file", c, { path: "x", name: "TN-1_x.pdf" }), /start_delivery/);
	const out = run("start_delivery", c, { kind: "MBP", date: "2026-12-01" }) as string;
	assert.deepEqual(readUi(out), { open_panel: { name: "nodevumi", filter: "draft_MBP_261201" } });
	assert.ok(store.read("deliveries").some((d) => d.id === "draft_MBP_261201"));
});

test("7.5 stage_source_file copies a source under the given name; the checklist lists it without Revit", async () => {
	const { c, store } = ctx();
	run("start_delivery", c, { kind: "MBP", date: "2026-12-01" });
	store.write("sources", [{ id: "s1", kind: "document", paths: ["01_Projektesana\\1.1_Izejas dati\\TN.pdf"] } as never], { kind: "t", by: "app" });
	run("stage_source_file", c, { sourceId: "s1", name: "TN-1_Izdomātais tīkls.pdf" });
	const r = (await run("delivery_checklist", c, { withRevit: false })) as { staged: string[]; rows: { id: string; status: string }[]; revit: string };
	assert.deepEqual(r.staged, ["TN-1_Izdomatais tikls.pdf"]);
	// without Revit a staged PDF with a sheet-like number cannot be told from a sheet: a person looks
	assert.equal(r.rows.find((x) => x.id === "sheets")!.status, "pārbaudi");
	assert.match(r.revit, /nav prasīts/);
});

test("7.5 the Nodot projektu task and the standing rule: the copy and 'sent' stay the user's", () => {
	const t = TASKS.find((x) => x.id === "deliver")!;
	assert.equal(t.label, "Nodot projektu");
	assert.match(t.text, /start_delivery[\s\S]*delivery_checklist[\s\S]*stage_revit_sheets[\s\S]*stage_ifc/);
	assert.ok(!TASKS.some((x) => x.id === "check-delivery"));
	assert.match(SYSTEM_PROMPT, /kopēšanu uz 1\.4_Nodevumi un "nosūtīts" dara tikai lietotājs/);
});
