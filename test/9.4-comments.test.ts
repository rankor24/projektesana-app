// 9.4 comment tools on every page: a pin can point at any thing a page shows; validation per kind (an unknown cell, a region
// off the page, an unknown requirement refused); the marks' geometry checked; each kind round-trips through the store; the
// Fokuss item and the prompt text per kind; comment → task; each page's tools; only element pins go to BCF (BimCraft's own
// reader). Invented projects.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pinsText } from "../src/agent/tools/pins.ts";
import { pinsToBcf } from "../src/checks/bcf.ts";
import { addPin } from "../src/core/pins.ts";
import { addTask } from "../src/core/tasks.ts";
import { COORD_GROUPS, TILE_IDS, type Markup, type Pin, type PinTarget } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { buildPin, pagesWithTools, toolProblem, toolsFor, TOOLS_BY_PAGE, VIEWER_TOOLS } from "../src/shared/comment-tools.ts";
import { checkMarkup, checkTarget, pinFocus, pinMeaning, pinTaskInput, pinWhere, targetKind } from "../src/shared/pins-view.ts";
import { PAGES } from "../src/shared/pages.ts";
import { focusText, isFocusItem } from "../src/agent/focus.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, tmp } from "./helpers.ts";

const store = () => ProjectStore.open(tmp(), { id: "BD931", name: "BD931", root: tmp(), createdAt: "2026-11-13T00:00:00Z" });
const RECT: Markup = { shape: "rect", points: [[0.1, 0.2], [0.4, 0.5]] };

const KINDS: { target: PinTarget; kind: string; where: RegExp }[] = [
	{ target: { thing: "cell", model: "BD931_AR.ifc", group: "Novietne" }, kind: "cell", where: /koordinācijas šūna BD931_AR\.ifc · Novietne/ },
	{ target: { thing: "change", version: "v3", side: "B", region: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }, kind: "change", where: /izmaiņa v3, B puse, apgabals lapā/ },
	{ target: { thing: "room", no: "12", floor: "2" }, kind: "room", where: /telpa 12, 2\. stāvs/ },
	{ target: { thing: "fact", key: "profile.group" }, kind: "fact", where: /fakts profile\.group/ },
	{ target: { thing: "tile", id: "deadline" }, kind: "tile", where: /Pārskata kartīte deadline/ },
	{ target: { thing: "item", delivery: "d1", item: "mbp" }, kind: "item", where: /nodevuma d1 punkts mbp/ },
	{ target: { thing: "requirement", id: "r1" }, kind: "requirement", where: /prasība r1/ },
	{ target: { thing: "finding", id: "f1" }, kind: "finding", where: /atradums f1/ },
	{ target: { elementGuid: "0Wall0000000000000001", model: "BD931_AR.ifc" }, kind: "element", where: /elements 0Wall0000000000000001 modelī BD931_AR\.ifc/ },
	{ target: { sourceId: "s1", page: 2, x: 0.5, y: 0.5 }, kind: "page", where: /s1, lpp\. 2/ },
];

test("validation per kind: what a page can point at, and what is refused", () => {
	for (const k of KINDS) assert.equal(checkTarget(k.target), null, k.kind);
	const bad: [PinTarget, RegExp][] = [
		[{ thing: "cell", model: "", group: "Novietne" }, /vajag modeli/],
		[{ thing: "cell", model: "AR", group: "Augstums" as never }, /Šūna nav zināma/],
		[{ thing: "change", version: "", side: "A" }, /versijas rindu/],
		[{ thing: "change", version: "v1", side: "C" as never }, /A vai B/],
		[{ thing: "change", version: "v1", side: "A", region: { x: 0.8, y: 0.1, w: 0.5, h: 0.1 } }, /ārpus lapas/],
		[{ thing: "change", version: "v1", side: "A", region: { x: -0.1, y: 0.1, w: 0.2, h: 0.1 } }, /ārpus lapas/],
		[{ thing: "change", version: "v1", side: "A", region: { x: 0.1, y: 0.1, w: 0, h: 0.1 } }, /ārpus lapas/],
		[{ thing: "room", no: " " }, /numuru/],
		[{ thing: "fact", key: "" }, /atslēgu/],
		[{ thing: "tile", id: "nav" as never }, /Kartīte nav zināma/],
		[{ thing: "item", delivery: "d1", item: "" }, /punktu/],
		[{ thing: "requirement", id: "" }, /vajag id/],
		[{ thing: "wat" } as never, /Nezināms/],
	];
	for (const [t, re] of bad) assert.match(checkTarget(t) ?? "", re, JSON.stringify(t));
	assert.match(checkTarget(null as never) ?? "", /Nederīga/);
	assert.equal(checkTarget({ thing: "requirement", id: "r9" }, { requirements: new Set(["r1"]) }), "Prasība r9 nav atrasta.");
	assert.equal(checkTarget({ thing: "finding", id: "f9" }, { findings: new Set(["f1"]) }), "Atradums f9 nav atrasts.");
	assert.equal(COORD_GROUPS.length, 3);
	assert.ok(TILE_IDS.includes("findings"));
});

test("a pin of every kind is stored, read back and named: the store checks requirements and findings it knows", () => {
	const s = store();
	assert.throws(() => addPin(s, { thing: "requirement", id: "r1" }, "x piezīme", "user"), /nav atrasta/, "the store has no r1");
	assert.throws(() => addPin(s, { thing: "finding", id: "f1" }, "x piezīme", "user"), /nav atrasts/);
	for (const k of KINDS.filter((x) => x.kind !== "requirement" && x.kind !== "finding")) {
		const p = addPin(s, k.target, `teksts ${k.kind}`, "user", { intent: k.kind === "room" ? "colour" : "note" });
		assert.deepEqual(p.target, k.target);
		assert.equal(targetKind(p.target), k.kind);
	}
	const back = s.read("pins");
	assert.equal(back.length, 8);
	assert.deepEqual(back.find((p) => targetKind(p.target) === "room")?.intent, "colour");
	assert.equal(back.find((p) => targetKind(p.target) === "cell")?.intent, undefined, "a plain note keeps no intent");
	for (const k of KINDS.filter((x) => x.kind !== "requirement" && x.kind !== "finding")) assert.match(pinWhere(back.find((p) => targetKind(p.target) === k.kind) as Pin), k.where, k.kind);
	assert.throws(() => addPin(s, { thing: "room", no: "" }, "telpa", "user"), /numuru/);
	assert.throws(() => addPin(s, { thing: "room", no: "1" }, "telpa", "user", { intent: "nezinams" as never }), /Nezināms nolūks/);
	assert.throws(() => addPin(s, { thing: "room", no: "1" }, "  ", "user"), /Tukša/);
	assert.equal(s.read("pins").length, 8, "refusals write nothing");
	// stored requirements and findings are known
	s.write("requirements", [{ id: "r1" } as never], { kind: "t", by: "test" });
	s.write("findings", [{ id: "f1" } as never], { kind: "t", by: "test" });
	assert.equal(addPin(s, { thing: "requirement", id: "r1" }, "pamatojums", "user", { intent: "justify" }).intent, "justify");
	assert.equal(addPin(s, { thing: "finding", id: "f1" }, "ignorēt", "user", { intent: "override" }).target.thing, "finding");
});

test("marks: geometry kept and validated — every point inside the page, the right number of points per shape", () => {
	assert.equal(checkMarkup(undefined), null);
	assert.equal(checkMarkup([RECT, { shape: "line", points: [[0, 0], [1, 1]] }, { shape: "circle", points: [[0.5, 0.5], [0.6, 0.5]] }, { shape: "free", points: [[0.1, 0.1], [0.2, 0.15], [0.3, 0.1]] }]), null);
	assert.match(checkMarkup([{ shape: "rect", points: [[0.1, 0.1]] }]) ?? "", /tieši divus punktus/);
	assert.match(checkMarkup([{ shape: "line", points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }]) ?? "", /tieši divus punktus/);
	assert.match(checkMarkup([{ shape: "free", points: [[0.1, 0.1]] }]) ?? "", /2 līdz 200/);
	assert.match(checkMarkup([{ shape: "free", points: Array.from({ length: 201 }, () => [0.5, 0.5] as [number, number]) }]) ?? "", /2 līdz 200/);
	assert.equal(checkMarkup([{ shape: "free", points: Array.from({ length: 200 }, () => [0.5, 0.5] as [number, number]) }]), null);
	assert.match(checkMarkup([{ shape: "rect", points: [[0.1, 0.1], [1.2, 0.5]] }]) ?? "", /ārpus lapas/);
	assert.match(checkMarkup([{ shape: "rect", points: [[-0.1, 0.1], [0.5, 0.5]] }]) ?? "", /ārpus lapas/);
	assert.match(checkMarkup([{ shape: "rect", points: [[Number.NaN, 0.1], [0.5, 0.5]] }]) ?? "", /ārpus lapas/);
	assert.match(checkMarkup([{ shape: "star", points: [] } as never]) ?? "", /Nezināma forma/);
	assert.match(checkMarkup("x" as never) ?? "", /saraksts/);
	assert.match(checkMarkup(Array.from({ length: 21 }, () => RECT)) ?? "", /Ne vairāk kā 20/);
	const s = store();
	const p = addPin(s, { sourceId: "s1", page: 1, x: 0.3, y: 0.3 }, "apvilkts", "user", { intent: "mark", markup: [RECT] });
	assert.deepEqual(s.read("pins")[0].markup, [RECT], "kept exactly as drawn");
	assert.equal(p.intent, "mark");
	assert.throws(() => addPin(s, { sourceId: "s1", page: 1, x: 0.3, y: 0.3 }, "ārpus", "user", { markup: [{ shape: "rect", points: [[0.1, 0.1], [2, 0.5]] }] }), /ārpus lapas/);
	assert.equal(s.read("pins").length, 1);
	// a 3D mark rides with the pin's camera
	const q = addPin(s, { elementGuid: "g1", model: "AR.ifc", camera: { position: [1, 2, 3], target: [0, 0, 0], fov: 50 } }, "ap sienu", "user", { markup: [{ shape: "circle", points: [[0.5, 0.5], [0.6, 0.5]] }] });
	assert.deepEqual([q.markup?.length, "camera" in q.target], [1, true]);
});

test("what the agent reads: the where, the intent and the marks in the pins block; the Fokuss item of a comment from any page", () => {
	const s = store();
	const fix = addPin(s, { thing: "fact", key: "profile.group" }, "jābūt 3. grupai", "user", { intent: "fix" });
	const cell = addPin(s, { thing: "cell", model: "AR.ifc", group: "Stāvi" }, "stāvu nav", "user", { intent: "mark", markup: [RECT] });
	const note = addPin(s, { thing: "room", no: "7" }, "mazs", "user");
	const text = pinsText(s.read("pins"));
	assert.match(text, /\[labot\] jābūt 3\. grupai \(fakts profile\.group\)/);
	assert.match(text, /\[atzīmēt\] stāvu nav · 1 atzīmējumi \(rect\) \(koordinācijas šūna AR\.ifc · Stāvi\)/);
	assert.match(text, /mazs \(telpa 7\)/);
	assert.doesNotMatch(text.split("\n").find((l) => l.includes("mazs"))!, /\[piezīme\]/, "a plain note is not tagged");
	assert.equal(pinMeaning(note), "mazs");
	const f = pinFocus(cell);
	assert.deepEqual([f.kind, f.id], ["pin", cell.id]);
	assert.ok(isFocusItem(f));
	assert.equal((f.data as { where: string; intent: string }).where, "koordinācijas šūna AR.ifc · Stāvi");
	assert.equal((f.data as { intent: string }).intent, "mark");
	assert.deepEqual((f.data as { markup: Markup[] }).markup, [RECT]);
	assert.match(focusText([pinFocus(fix)]), /\[pin:.*jābūt 3\. grupai.*"intent":"fix"/);
	assert.equal((pinFocus(note).data as { intent?: string }).intent, undefined);
});

test("comment → task: the text as the title, the pin and the finding as the links; the marks stay with the pin", () => {
	const s = store();
	s.write("findings", [{ id: "f1" } as never], { kind: "t", by: "test" });
	const p = addPin(s, { thing: "finding", id: "f1" }, "ignorēt ar pamatojumu", "user", { intent: "override", markup: [RECT] });
	const input = pinTaskInput(p);
	assert.deepEqual(input.refs, { pinId: p.id, findingId: "f1" });
	assert.equal(input.title, "[ignorēt ar pamatojumu] ignorēt ar pamatojumu");
	assert.equal(input.note, "atradums f1");
	const t = addTask(s, input, "user");
	assert.deepEqual([t.state, t.refs.pinId, t.refs.findingId], ["open", p.id, "f1"]);
	const plain = addPin(s, { thing: "room", no: "3" }, "x".repeat(300), "user");
	assert.ok(pinTaskInput(plain).title.length <= 120);
	assert.equal(pinTaskInput(plain).refs.findingId, undefined);
});

test("each page's tools: the table covers the pages that have comments, every tool fits its subject, and a tool says why it cannot be used", () => {
	assert.deepEqual(pagesWithTools().sort(), ["koordinacija", "nodevumi", "parskats", "prasibas", "telpas", "telpaslapa", "versijas"]);
	for (const id of pagesWithTools()) assert.ok(PAGES.some((p) => p.id === id), `${id} is a page`);
	const ids = [...new Set(Object.values(TOOLS_BY_PAGE))].flat().map((t) => t.id); // the Telpas page shares the sidebar's list
	assert.equal(new Set(ids).size, ids.length, "tool ids are unique");
	assert.deepEqual(toolsFor("koordinacija").map((t) => t.id), ["cell-note", "storey-mark", "correct"]);
	assert.deepEqual(toolsFor("versijas").map((t) => t.id), ["region-note", "accept-change", "reject-change"]);
	assert.deepEqual(toolsFor("nodevumi").map((t) => t.intent), ["note", "block", "approve"]);
	assert.deepEqual(toolsFor("nezinama"), []);
	assert.deepEqual(VIEWER_TOOLS.map((t) => t.id), ["pin", "line", "circle", "rect", "free"]);
	const tool = (id: string) => Object.values(TOOLS_BY_PAGE).flat().find((t) => t.id === id)!;
	const cell: PinTarget = { thing: "cell", model: "AR.ifc", group: "Novietne" };
	assert.match(toolProblem(tool("cell-note"), null, "x") ?? "", /izvēlies, pie kā/);
	assert.match(toolProblem(tool("cell-note"), { thing: "room", no: "1" }, "teksts") ?? "", /izvēlēts ir room/);
	assert.match(toolProblem(tool("correct"), cell, " ") ?? "", /ieraksti tekstu/);
	assert.match(toolProblem(tool("storey-mark"), cell, "1. stāvs") ?? "", /grupā Stāvi/);
	assert.equal(toolProblem(tool("storey-mark"), { ...cell, group: "Stāvi" } as PinTarget, "1. stāvs"), null);
	assert.equal(toolProblem(tool("approve"), { thing: "item", delivery: "d1", item: "i" }, ""), null, "approving needs no text");
});

test("a tool builds its pin: the intent, the label as the text when none is typed, a region from the first rectangle", () => {
	const tool = (id: string) => Object.values(TOOLS_BY_PAGE).flat().find((t) => t.id === id)!;
	const a = buildPin(tool("approve"), { thing: "item", delivery: "d1", item: "mbp" }, "") as Exclude<ReturnType<typeof buildPin>, string>;
	assert.deepEqual([a.text, a.opts.intent], ["Apstiprināt", "approve"]);
	const c = buildPin(tool("correct"), { thing: "cell", model: "AR.ifc", group: "Hierarhija" }, " pareizi: Ēka A ", []) as Exclude<ReturnType<typeof buildPin>, string>;
	assert.deepEqual([c.text, c.opts.intent, c.opts.markup], ["pareizi: Ēka A", "correct", undefined]);
	const change: PinTarget = { thing: "change", version: "v3", side: "A" };
	assert.match(buildPin(tool("region-note"), change, "lūk", []) as string, /velc taisnstūri/);
	const r = buildPin(tool("region-note"), change, "lūk", [{ shape: "rect", points: [[0.5, 0.6], [0.2, 0.3]] }]) as Exclude<ReturnType<typeof buildPin>, string>;
	assert.equal(r.target && "thing" in r.target && r.target.thing === "change" && r.target.region?.w.toFixed(2), "0.30");
	assert.deepEqual(r.opts.markup?.length, 1);
	assert.match(buildPin(tool("region-note"), change, "lūk", [{ shape: "rect", points: [[0.5, 0.6], [1.7, 0.3]] }]) as string, /ārpus lapas/, "a region off the page is refused");
	const b = buildPin(tool("region-note"), change, "lūk", [{ shape: "line", points: [[0, 0], [1, 1]] }, { shape: "rect", points: [[0.1, 0.1], [0.2, 0.2]] }]) as Exclude<ReturnType<typeof buildPin>, string>;
	assert.deepEqual(b.opts.markup?.map((m) => m.shape), ["rect"], "only the shapes the tool takes are kept");
	// what a built pin does in the store
	const s = store();
	const made = addPin(s, c.target, c.text, "user", c.opts);
	assert.deepEqual([made.intent, made.text], ["correct", "pareizi: Ēka A"]);
});

const APP = join(BIMCRAFT_DIR ?? "", "app");
test("only element pins go to BCF, the others are left out; BimCraft's own reader gives that one back", { skip: existsSync(join(APP, "bcf.js")) ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const s = store();
	addPin(s, { elementGuid: "0Wall0000000000000001", model: "BD931_AR.ifc" }, "siena", "user", { intent: "fix" });
	for (const k of KINDS.filter((x) => x.kind !== "element" && x.kind !== "requirement" && x.kind !== "finding")) addPin(s, k.target, `piezīme ${k.kind}`, "user");
	const bytes = await pinsToBcf(APP, s.read("pins"), { name: "BD931_AR.ifc" });
	const bcf = await import(new URL(`file:///${join(APP, "bcf.js").replace(/\\/g, "/")}`).href);
	const back = await bcf.readBcf(bytes);
	assert.equal(back.topics.length, 1, "page, cell, change, room, fact, tile and item comments have no place in a model");
	assert.equal(back.topics[0].title, "siena");
});
