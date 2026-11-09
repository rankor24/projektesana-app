// 2.2 requirements: law rows by profile (MK 529 72 for a group-3 public new build), PU rows with page and quote, merge.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Fact, Source } from "../src/core/model.ts";
import { documentRequirements, lawRequirements, mergeRequirements } from "../src/rules/requirements.ts";
import { loadRules } from "../src/rules/rules.ts";
import { FIX } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const at = "2026-11-06T00:00:00.000Z";
const fact = (key: string, value: string, state: Fact["state"] = "confirmed"): Fact => ({ id: `f_${key}_${value}`, key: `profile.${key}`, value, source: { kind: "user", at }, state, by: "user", at });

const PROFILE_G3 = [fact("workType", "new_build"), fact("use", "public"), fact("group", "3"), fact("funding", "pašvaldības budžets"), fact("stagesInContract", "BP")];

test("group-3 public new build in BP: every MK 529 72 row, 74 and 74.1, none of 71", () => {
	const rules = loadRules(DATA);
	const { rows } = lawRequirements(rules, PROFILE_G3, DATA, "2026-11-06");
	const points = rows.map((r) => (r.citation.kind === "law" ? r.citation.point : ""));
	const want72 = rules.filter((r) => r.article.startsWith("72.")).map((r) => r.article);
	assert.ok(want72.length >= 6);
	for (const p of want72) assert.ok(points.includes(p), `missing ${p}`);
	assert.ok(!points.some((p) => p.startsWith("71.")), "group 2 rows must not appear");
	assert.ok(points.includes("74. punkts"), "economic part (public funds)");
	assert.ok(points.includes("74.1 punkts"), "BIM model (public, group 3, new build)");
	assert.ok(rows.every((r) => r.state === "confirmed"));
	const r72 = rows.find((r) => r.citation.kind === "law" && r.citation.point.startsWith("72.2.1"))!;
	assert.equal(r72.citation.kind === "law" && r72.citation.url, "https://likumi.lv/ta/id/269164#p72.2.1");
	assert.equal(r72.citation.kind === "law" && r72.citation.actVersionDate, "2026-01-01");
	assert.deepEqual(r72.appliesTo.stages, ["Tehniskais", "Detalizācijas"]);
	// a condition the profile does not know is shown, not assumed
	const dop80 = rows.find((r) => r.id.startsWith("law:bp-dop-inuse"))!;
	assert.match(dop80.text, /attiecas, ja: pārbūve, nepārtraucot/);
});

test("rows rest on proposed facts → the rows are proposals too; no stages → no law rows and a note", () => {
	const rules = loadRules(DATA);
	const p = lawRequirements(rules, [...PROFILE_G3.slice(0, 4), fact("stagesInContract", "MBP", "proposed")], DATA, "2026-11-06");
	assert.ok(p.rows.length > 0 && p.rows.every((r) => r.state === "proposed"));
	assert.ok(p.rows.every((r) => r.appliesTo.deliveries?.[0] === "MBP"));
	const none = lawRequirements(rules, PROFILE_G3.slice(0, 4), DATA, "2026-11-06");
	assert.equal(none.rows.length, 0);
	assert.match(none.notes.join(" "), /nav līgumā ietverto stadiju/);
});

test("PU fixture: numbered requirement rows with page and quote; headings left out", () => {
	const pages = readFileSync(join(FIX, "docs", "pu.txt"), "utf8").split("\f").map((p) => p.replace(/^\n/, ""));
	const s: Source = { id: "s_pu", kind: "document", folderKey: "1.1.4", paths: ["pu.docx"], title: "PU", role: "PU", roleFrom: "folder", versions: [{ sha256: "c".repeat(64), size: 1, mtime: at, seenAt: at, textState: "ok" }], signers: [] };
	const rows = documentRequirements([s], () => ({ pages }));
	assert.deepEqual(rows.map((r) => r.id), ["doc:s_pu:1.1", "doc:s_pu:1.2", "doc:s_pu:1.3", "doc:s_pu:1.4", "doc:s_pu:2.1", "doc:s_pu:2.2", "doc:s_pu:2.3", "doc:s_pu:2.4"]);
	const r = rows.find((x) => x.id === "doc:s_pu:2.3")!;
	assert.equal(r.origin, "pu");
	assert.equal(r.citation.kind === "document" && r.citation.page, 2);
	assert.ok(pages[1].includes(r.citation.quote));
});

test("TN conditions become tn rows", () => {
	const pages = [readFileSync(join(FIX, "docs", "tn.txt"), "utf8")];
	const s: Source = { id: "s_tn", kind: "document", folderKey: "1.1.5", paths: ["tn.pdf"], title: "TN", role: "Tehniskie noteikumi", roleFrom: "folder", versions: [{ sha256: "d".repeat(64), size: 1, mtime: at, seenAt: at, textState: "ok" }], signers: [] };
	assert.deepEqual(documentRequirements([s], () => ({ pages })).map((r) => [r.id, r.origin]), [
		["doc:s_tn:1", "tn"],
		["doc:s_tn:2", "tn"],
		["doc:s_tn:3", "tn"],
	]);
});

test("merge keeps the user's decisions and the agent's own rows", () => {
	const pages = readFileSync(join(FIX, "docs", "pu.txt"), "utf8").split("\f");
	const s: Source = { id: "s_pu", kind: "document", folderKey: "1.1.4", paths: ["pu.docx"], title: "PU", role: "PU", roleFrom: "folder", versions: [{ sha256: "c".repeat(64), size: 1, mtime: at, seenAt: at, textState: "ok" }], signers: [] };
	const first = documentRequirements([s], () => ({ pages }));
	const decided = first.map((r) => (r.id === "doc:s_pu:2.1" ? { ...r, state: "rejected" as const } : r));
	const agent = { ...first[0], id: "req_agent1", by: "agent" as const };
	const merged = mergeRequirements([...decided, agent], documentRequirements([s], () => ({ pages })));
	assert.equal(merged.find((r) => r.id === "doc:s_pu:2.1")!.state, "rejected");
	assert.ok(merged.some((r) => r.id === "req_agent1"));
	assert.equal(merged.length, first.length + 1);
});
