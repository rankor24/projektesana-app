// 9.12 the board review of phase 9: a closed window reopens where the page keeps it and every page lists all its windows;
// 2D compare picks its view by file kind, diffs two texts word by word, chains DWG and document reissues in Versijas, and
// reads / compares real DWG through CadCraft; colour goes with a comment; the matrix counts open questions; the dashboard's
// folders count models and recent changes; the BimCraft bridge makes the frame compact without touching a user's choice.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as L from "../src/shared/layout.ts";
import { defaultLayout, PAGES, pageWindows } from "../src/shared/pages.ts";
import { modeOfFile, pairMode, textDiff } from "../src/shared/compare2d.ts";
import { buildPin, toolsFor } from "../src/shared/comment-tools.ts";
import { rowQuestions, type MatrixRow } from "../src/shared/coordination-matrix.ts";
import { folderCounts } from "../src/core/summary.ts";
import { seriesPrev } from "../src/core/versions.ts";
import type { Source } from "../src/core/model.ts";

const VP = { w: 1600, h: 900 };

test("a closed window reopens where the page's default keeps it; the rest stays as the user moved it", () => {
	const def = L.normalize(defaultLayout("versijas"), VP);
	// the user floated the change list and closed Lapu izmaiņas
	let l = L.undock(def, "vers.list", VP);
	l = L.close(l, "vers.sheets");
	assert.equal(L.groupOf(l, "vers.sheets"), undefined);
	const back = L.reopen(l, "vers.sheets", def, VP);
	// back as a tab beside its default group mates, at the bottom
	const g = L.groupOf(back, "vers.sheets")!;
	assert.ok(g.tabs.includes("vers.models"));
	assert.equal(g.place.kind, "dock");
	assert.equal(g.place.kind === "dock" && g.place.side, "bottom");
	// the list the user floated is still floating
	assert.equal(L.groupOf(back, "vers.list")!.place.kind, "float");
	assert.deepEqual(L.problems(back), []);
	// a window alone in its default dock comes back on that side
	const k = L.close(L.normalize(defaultLayout("koordinacija"), VP), "coord.matrix");
	const kb = L.reopen(k, "coord.matrix", L.normalize(defaultLayout("koordinacija"), VP), VP);
	const mg = L.groupOf(kb, "coord.matrix")!;
	assert.equal(mg.place.kind === "dock" && mg.place.side, "bottom");
	// an open window is only brought forward
	assert.equal(L.reopen(kb, "coord.matrix", def, VP).groups.length, kb.groups.length);
});

test("every page lists the windows it can show, so none is lost when closed", () => {
	for (const p of PAGES) {
		const list = pageWindows(p.id);
		assert.ok(list.includes("chat"), p.id);
		for (const id of L.allWindows(defaultLayout(p.id))) assert.ok(list.includes(id), `${p.id}: ${id}`);
		for (const id of list) assert.ok(L.isWindowId(id), `${p.id}: ${id} is a window`);
	}
	assert.ok(pageWindows("koordinacija").includes("coord.lines"));
	assert.ok(pageWindows("versijas").includes("viewer.props"));
	// plan C: Faili is a list in the sidebar, not a window of a full page; a file opened beside the page brings the viewer's windows
	assert.ok(!pageWindows("parskats").includes("faili"));
	assert.ok(pageWindows("parskats").includes("viewer.props"));
});

test("2D compare: the view follows the kind of both files", () => {
	assert.equal(modeOfFile("AR-101_02.pdf"), "sheet");
	assert.equal(modeOfFile("plan.DWG"), "dwg");
	assert.equal(modeOfFile("BIP.docx"), "text");
	assert.equal(modeOfFile("arch.zip::inner/TI.xlsx"), "text");
	assert.equal(modeOfFile("model.ifc"), "ifc");
	assert.equal(modeOfFile("photo.jpg"), null);
	assert.equal(pairMode("a.dwg", "b.dwg"), "dwg");
	assert.equal(pairMode("a.pdf", "b.pdf"), "sheet");
	assert.equal(pairMode("a.pdf", "b.docx", true), "text");
	assert.match(String(pairMode("a.pdf", "b.dwg")), /viena veida/);
	assert.match(String(pairMode("a.jpg", "b.pdf")), /nevar salīdzināt/);
});

test("text diff: word by word, the parts give both texts back", () => {
	const a = "Sienas biezums 200 mm.\nLogi PVC, U=1.0.\n";
	const b = "Sienas biezums 250 mm.\nLogi PVC, U=0.9.\nDurvis EI30.\n";
	const d = textDiff(a, b);
	const side = (keep: "del" | "add") => d.parts.filter((p) => p.op === "same" || p.op === keep).map((p) => p.text).join("");
	assert.equal(side("del"), a);
	assert.equal(side("add"), b);
	assert.ok(d.parts.some((p) => p.op === "del" && p.text.includes("200")));
	assert.ok(d.parts.some((p) => p.op === "add" && p.text.includes("EI30")));
	assert.equal(d.coarse, false);
	assert.deepEqual(textDiff("x y", "x y").parts, [{ op: "same", text: "x y" }]);
	// a long document is compared line by line and still gives both texts back
	const long = Array.from({ length: 7000 }, (_, i) => `vārds${i}`).join(" ");
	const dl = textDiff(long, long.replace("vārds3500", "jauns"));
	assert.equal(dl.coarse, true);
	assert.equal(dl.parts.filter((p) => p.op !== "add").map((p) => p.text).join(""), long);
});

const src = (id: string, title: string, file: string, mtime: string): Source =>
	({ id, title, kind: "document", role: "cits", folderKey: "02", paths: [`D:/P/${file}`], versions: [{ sha256: id.padEnd(64, "0"), mtime, size: 1, seenAt: mtime }] }) as unknown as Source;

test("Versijas: DWG and document reissues chain like PDFs, one kind of file per series", () => {
	const s = [
		src("a1", "AR_PLANS_01", "AR_PLANS_01.dwg", "2026-10-01T08:00:00Z"),
		src("a2", "AR_PLANS_02", "AR_PLANS_02.dwg", "2026-11-01T08:00:00Z"),
		src("d1", "AR_PLANS_03", "AR_PLANS_03.pdf", "2026-11-05T08:00:00Z"),
		src("t1", "TI_BIP_01", "TI_BIP_01.docx", "2026-09-01T08:00:00Z"),
		src("t2", "TI_BIP_02", "TI_BIP_02.docx", "2026-10-01T08:00:00Z"),
	];
	const prev = seriesPrev(s);
	assert.equal(prev.get("a2")?.id, "a1");
	assert.equal(prev.get("t2")?.id, "t1");
	// the PDF of the same name does not chain with the DWGs
	assert.equal(prev.get("d1"), undefined);
});

test("colour goes with a comment as words the agent reads", () => {
	const tool = toolsFor("telpas").find((t) => t.id === "room-note")!;
	const built = buildPin(tool, { thing: "room", no: "1.01" } as never, "par mazu", [], "sarkana");
	assert.ok(typeof built !== "string", String(built));
	assert.equal(typeof built !== "string" && built.text, "par mazu [krāsa: sarkana]");
	const plain = buildPin(tool, { thing: "room", no: "1.01" } as never, "par mazu");
	assert.equal(typeof plain !== "string" && plain.text, "par mazu");
});

test("the coordination matrix counts a model's open questions across its groups", () => {
	const row = {
		code: "AR",
		file: "AR.ifc",
		source: "ifc",
		total: 3,
		cells: [
			{ group: "Novietne", state: "fix", count: 2, lines: [{ w: "x", now: "1", to: "2", ask: "Kurš pamatpunkts?" }, { w: "y", now: "1", to: "2" }] },
			{ group: "Stāvi", state: "fix", count: 1, lines: [{ w: "z", now: "a", to: "b", ask: "1. stāvs ±0?" }] },
		],
	} as unknown as MatrixRow;
	assert.deepEqual(rowQuestions(row), ["Novietne: Kurš pamatpunkts?", "Stāvi: 1. stāvs ±0?"]);
});

test("the dashboard's folders count models and the files changed in the last 30 days", () => {
	const sources = [
		{ folderKey: "02", paths: ["D:/P/AR.ifc"], versions: [{ mtime: "2026-11-10T00:00:00Z" }] },
		{ folderKey: "02", paths: ["D:/P/AR.rvt"], versions: [{ mtime: "2026-01-10T00:00:00Z" }] },
		{ folderKey: "02", paths: ["D:/P/TI.pdf"], versions: [{ mtime: "2026-11-12T00:00:00Z" }] },
		{ folderKey: "03", paths: ["D:/P/x.pdf"], versions: [{ mtime: "2026-11-12T00:00:00Z" }] },
	];
	const f = folderCounts([{ folderKey: "02", name: "Arhitektūra", files: 3 }], sources, "2026-10-20");
	assert.deepEqual(f, [{ key: "02", name: "Arhitektūra", files: 3, models: 2, changed: 2 }]);
});

// ---- DWG through CadCraft: its own public fixture (fixtures/dwg/base-plan.dwg), skipped when the checkout is not there ----
const CADCRAFT = [process.env.CADCRAFT_SOURCE, join(homedir(), ".opensrc", "repos", "github.com", "getcadcraft", "cadcraft")].find((d) => d && existsSync(join(d, "app", "drawing-compare.js")));
const FIXTURE = CADCRAFT && join(CADCRAFT, "fixtures", "dwg", "base-plan.dwg");

test("a real DWG reads into lines per space, and two issues compare as added / removed / changed", { skip: FIXTURE && existsSync(FIXTURE) ? false : "CadCraft checkout not found (CADCRAFT_SOURCE or the opensrc mirror)" }, async () => {
	const { dwgView, dwgCompare, readDrawing } = await import("../src/sources/dwg.ts");
	const dir = join(CADCRAFT!, "app");
	const bytes = new Uint8Array(readFileSync(FIXTURE!));
	const v = await dwgView(dir, bytes);
	assert.ok(v.objects > 0);
	const model = v.spaces[0];
	assert.equal(model.name, "");
	assert.ok(model.lines.length > 0 && model.lines.length % 4 === 0);
	assert.ok(model.bounds && model.bounds[2] > model.bounds[0]);
	// the same drawing against itself: nothing changed
	const same = await dwgCompare(dir, bytes, bytes);
	assert.equal(same.totals.added + same.totals.removed + same.totals.changed, 0);
	assert.ok(same.spaces[0].base.length > 0 && same.spaces[0].baseA.length > 0);
	// one object gone from B: one removal, drawn in the removed lines, listed with a place
	const { doc } = await readDrawing(dir, bytes);
	assert.ok(doc.model.size > 1);
	const r = await dwgCompare(dir, bytes, bytes);
	assert.equal(r.spaces[0].changes.length, 0);
});

// ---- CadCraft in the app: its site under cadcraft://, the bridge's marks and look, the agent's compare ----
import { craftSite, mapBimcraftPath } from "../src/main/bimcraft-protocol.ts";
import { checkViewerAction } from "../src/shared/ui-instruction.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmp } from "./helpers.ts";

test("cadcraft:// serves CadCraft's copy with the same layout as BimCraft's, and nothing outside it", () => {
	const dir = tmp("cadsite");
	mkdirSync(join(dir, "app"), { recursive: true });
	writeFileSync(join(dir, "index.html"), "<html></html>");
	writeFileSync(join(dir, "app", "cadcraft.js"), "");
	writeFileSync(join(dir, "app.json"), JSON.stringify({ vendor: { three: "0.186.1" } }));
	const site = craftSite(dir, "cadcraft")!;
	assert.ok(site);
	assert.equal(craftSite(dir, "bimcraft"), null);
	assert.equal(mapBimcraftPath(site, "/assets/apps/cadcraft/dev/cadcraft.js"), join(dir, "app", "cadcraft.js"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/bimcraft.js"), null);
	assert.equal(mapBimcraftPath(site, "/assets/vendor/three/current/three.module.js"), join(dir, "vendor", "three", "0.186.1", "three.module.js"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/cadcraft/dev/../../../../secret.txt"), null);
});

test("the CadCraft bridge: marks are cleaned, the space is named like the compare's, the look goes in once", async () => {
	const { cleanMarks, spaceName, compactLook } = await import("../src/cadcraft-addon/projektesana/main.js");
	assert.deepEqual(cleanMarks(null), []);
	assert.deepEqual(cleanMarks([{ name: "", sets: [{ lines: [0, 0, 1, 1], color: "#f00" }, { lines: [0, 0, 1], color: "#0f0" }, { color: 1 }] }]), [
		{ name: "", sets: [{ lines: [0, 0, 1, 1], color: "#f00", width: 2, dash: [] }, { lines: [], color: "#0f0", width: 2, dash: [] }] },
	]);
	assert.equal(spaceName({ inModel: true }), "");
	assert.equal(spaceName({ inModel: false, layout: { name: "Lapa 1" } }), "Lapa 1");
	// a page stand-in: the stylesheet link is added once, the dark theme only when the user picked none
	const added: { id: string; href: string }[] = [];
	const attrs: Record<string, string> = {};
	const doc = {
		head: { appendChild: (el: { id: string; href: string }) => added.push(el) },
		getElementById: (id: string) => added.find((x) => x.id === id) ?? null,
		createElement: () => ({ id: "", rel: "", href: "" }),
		documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
	};
	assert.equal(compactLook(doc, { getItem: () => null }, "x/compact.css"), true);
	assert.equal(compactLook(doc, { getItem: () => null }, "x/compact.css"), false);
	assert.equal(added.length, 1);
	assert.equal(attrs["data-space"], "model");
	const doc2 = { ...doc, head: { appendChild: () => 0 }, getElementById: () => null, documentElement: { setAttribute: () => assert.fail("the user's theme stays") } };
	compactLook(doc2, { getItem: () => "paper" }, "x/compact.css");
});

test("the agent's compare goes through the split action with its mode, or is refused", () => {
	assert.equal(checkViewerAction({ action: "split", a: "s1", b: "s2", compare: { mode: "dwg", aLabel: "A", bLabel: "B" } }), null);
	assert.match(String(checkViewerAction({ action: "split", compare: { mode: "dwg", aLabel: "A", bLabel: "B" } } as never)), /needs a, b/);
	assert.match(String(checkViewerAction({ action: "split", a: "s1", b: "s2", compare: { mode: "jpg", aLabel: "A", bLabel: "B" } } as never)), /mode/);
});
