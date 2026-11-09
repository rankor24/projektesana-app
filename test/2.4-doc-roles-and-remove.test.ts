// A role set on one document (a cadastral file sent inside the PU folder) wins over its folder's role and is what the
// one-truth check compares; with nothing to compare against, one note lists the real values; an info note the user
// removes does not come back unchanged; errors and warnings cannot be removed; the badge counts errors and warnings.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { registerAppChecks } from "../src/checks/index.ts";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { removeFinding, runChecks } from "../src/checks/run.ts";
import type { Source } from "../src/core/model.ts";
import { Registry } from "../src/core/registry.ts";
import { projectHandlers } from "../src/main/handlers/projects.ts";
import { applyDocRoles, DOC_ROLES } from "../src/sources/roles.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const at = "2026-11-06T10:00:00.000Z";
const doc = (id: string, title: string, sha: string): Source => ({ id, kind: "document", folderKey: "1.1.4", paths: [`01_Projektesana/1.1_Izejas dati/1.1.04_PU/${title}.pdf`], title, role: "PU", roleFrom: "folder", versions: [{ sha256: sha, size: 1, mtime: at, seenAt: at, textState: "ok", pages: 1 }], signers: [] });

/** A registered project whose PU folder holds the PU and a cadastral file (as on BD427), with handlers around it. */
function setup() {
	const dir = tmp();
	const root = join(tmp(), "BD996 Testa iela 1");
	mkdirSync(root, { recursive: true });
	const registry = new Registry(join(dir, "projects.json"), join(dir, "projects"));
	const p = registry.add(root);
	const store = registry.store(p.id);
	store.write("sources", [doc("pu", "DPU", "a".repeat(64)), doc("kl", "Kadastrālā lieta", "b".repeat(64))], { kind: "t", by: "app" });
	store.writeText("a".repeat(64), { state: "ok", pages: ["Būves kadastra apzīmējums 0000 000 0000 001\nkopējā platība – 730.6 m²"] });
	store.writeText("b".repeat(64), { state: "ok", pages: ["Būves kadastra apzīmējums 0000 000 0000 001\nKopējā platība: 730,6 m2"] });
	store.writeMeta("scan", { at, inputsRel: null, files: 2, surveys: 0, added: 2, changed: 0, gone: 0, skipped: { archive: 0, junk: 0 }, problems: [], folders: [{ folderKey: "1.1.4", name: "1.1.04_PU", rel: "x", role: "PU", roleFrom: "folder", files: 2 }] });
	registerAppChecks();
	const h = projectHandlers({ registry, emit: () => {}, openPath: async () => "", hooks: () => ({}), afterChange: (s) => runChecks(s, "roles", { dataDir: DATA, today: "2026-11-06" }).then(() => undefined) });
	return { id: p.id, store, h };
}

test("applyDocRoles: a document's own role wins; the rest keep the folder's", () => {
	const out = applyDocRoles([doc("pu", "DPU", "a"), doc("kl", "KL", "b")], { kl: "Īpašuma dokumenti" });
	assert.deepEqual(out.map((s) => [s.id, s.role, s.roleFrom]), [["pu", "PU", "folder"], ["kl", "Īpašuma dokumenti", "document"]]);
	assert.ok(DOC_ROLES.includes("Īpašuma dokumenti") && !DOC_ROLES.includes("Arhīvs") && !DOC_ROLES.includes("Fotofiksācija"));
});

test("everything in the PU folder: one note with the real values, not one count per key", async () => {
	const { store } = setup();
	await runChecks(store, "roles", { dataDir: DATA, today: "2026-11-06" });
	const open = store.read("findings").filter((f) => f.state === "open");
	assert.deepEqual(open.map((f) => [f.key, f.severity]), [["one-truth:not-compared", "info"]]);
	assert.match(open[0].message, /^Nav neviena avota ar lomu “Īpašuma dokumenti”/);
	assert.match(open[0].message, /būves kadastra apzīmējums — “0000 000 0000 001” \(DPU, lpp\. 1\)/);
	assert.match(open[0].message, /kopējā platība — “730\.6” \(DPU, lpp\. 1\)/);
});

test("the user sets the cadastral file's role: the check compares and finds them equal; the role survives a folder confirmation and goes back with null", async () => {
	const { id, store, h } = setup();
	await h["sources.setRole"](id, "kl", "Īpašuma dokumenti");
	const kl = store.read("sources").find((s) => s.id === "kl")!;
	assert.deepEqual([kl.role, kl.roleFrom], ["Īpašuma dokumenti", "document"]);
	assert.deepEqual(store.readMeta("source-roles", {}), { kl: "Īpašuma dokumenti" });
	assert.deepEqual(store.read("findings").filter((f) => f.state === "open"), [], "same building number and area in both: nothing to report");

	await h["projects.confirmRole"](id, "1.1.4", "Cits");
	assert.equal(store.read("sources").find((s) => s.id === "kl")!.role, "Īpašuma dokumenti", "a folder confirmation leaves a document's own role");

	await h["sources.setRole"](id, "kl", null);
	const back = store.read("sources").find((s) => s.id === "kl")!;
	assert.deepEqual([back.role, back.roleFrom], ["Cits", "confirmed"], "back to what the folder is now");
	await assert.rejects(async () => h["sources.setRole"](id, "kl", "Arhīvs"), /Nezināma loma/);
});

test("a removed info note does not come back unchanged; new values bring it back; errors and warnings stay", async () => {
	let message = "piezīme A";
	let severity: "info" | "error" = "info";
	registerCheck({ id: "t-note", title: "t", on: ["manual"], run: () => ({ results: [{ key: "k", severity, message, where: {} }] }) });
	try {
		const { store } = setup();
		await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-06", only: ["t-note"] });
		const f = store.read("findings").find((x) => x.checkId === "t-note")!;
		assert.throws(() => removeFinding(store, f.id, "agent"), /tikai lietotājs, ne aģents/);
		removeFinding(store, f.id);
		assert.equal(store.read("findings").some((x) => x.checkId === "t-note"), false);
		assert.equal(store.events().at(-1)?.kind, "finding.removed");

		await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-06", only: ["t-note"] });
		assert.equal(store.read("findings").some((x) => x.checkId === "t-note"), false, "same result: stays removed");

		message = "piezīme B";
		await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-06", only: ["t-note"] });
		assert.equal(store.read("findings").find((x) => x.checkId === "t-note")?.message, "piezīme B", "new values: shown again");

		severity = "error";
		await runChecks(store, "manual", { dataDir: DATA, today: "2026-11-06", only: ["t-note"] });
		const e = store.read("findings").find((x) => x.checkId === "t-note")!;
		assert.throws(() => removeFinding(store, e.id), /novērs cēloni vai pieņem/);
	} finally {
		unregisterCheck("t-note");
	}
});

test("the project row counts errors and warnings; info is counted apart", async () => {
	const { id, store, h } = setup();
	store.write(
		"findings",
		[
			{ id: "x1", checkId: "c", requirementId: null, severity: "info", where: {}, message: "i", key: "a", state: "open", firstSeen: at, lastSeen: at },
			{ id: "x2", checkId: "c", requirementId: null, severity: "warning", where: {}, message: "w", key: "b", state: "open", firstSeen: at, lastSeen: at },
			{ id: "x3", checkId: "c", requirementId: null, severity: "error", where: {}, message: "e", key: "c", state: "closed", firstSeen: at, lastSeen: at },
		],
		{ kind: "t", by: "app" },
	);
	const row = (await h["projects.list"]()).find((p) => p.id === id)!;
	assert.deepEqual([row.openFindings, row.openInfo], [1, 1]);
});
