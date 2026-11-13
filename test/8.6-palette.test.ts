// 8.6 the command palette's ranking: every word must match, the start of the label or of a word in it beats the middle,
// case and diacritics are ignored, and an empty query offers recent things, then panels. Invented items.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, rank, type PaletteItem } from "../src/shared/palette.ts";

const I = (id: string, group: PaletteItem["group"], label: string, hint?: string, keywords?: string): PaletteItem => ({ id, group, label, hint, keywords });
const items: PaletteItem[] = [
	I("p:nodevumi", "panel", "Nodevumi", "nodot projektu, termiņi", "tn saskaņojumi"),
	I("p:avoti", "panel", "Avoti", "visi dokumenti"),
	I("p:faili", "panel", "Faili", "mapju koks"),
	I("p:grafiks", "panel", "Grafiks", "kalendārs un uzdevumi"),
	I("pr:BD427", "project", "BD427 Pilsētas iela 9"),
	I("pr:BD431", "project", "BD431 Mežaparka aleja 3"),
	I("t:nod", "template", "Nodot projektu", "aģenta uzdevums"),
	I("s:uzd", "source", "Uzdevums projektēšanai.pdf", "Uzdevums"),
	I("s:tn", "source", "TN_Ūdens_2026.pdf", "Tehniskie noteikumi"),
	I("r:1", "recent", "Plāns 1. stāvs.pdf"),
];
const ids = (q: string) => rank(items, q).map((i) => i.id);

test("diacritics and case are ignored on both sides", () => {
	assert.equal(fold("Pasūtījums ĀĒĪŪ"), "pasutijums aeiu");
	assert.deepEqual(ids("pilsetas"), ["pr:BD427"]);
	assert.deepEqual(ids("UDENS"), ["s:tn"]);
	assert.deepEqual(ids("mezaparka"), ["pr:BD431"]);
});

test("the start of the label beats the start of a word, which beats the middle, which beats the hint", () => {
	// "pro": label start of none; word start in "Nodot projektu" (template) and "Uzdevums projektēšanai"; hint of a panel
	assert.deepEqual(ids("proj"), ["t:nod", "s:uzd", "p:nodevumi"], "word starts first, then the panel that only says it in its hint");
	assert.deepEqual(ids("nod").slice(0, 2), ["p:nodevumi", "t:nod"], "both start with it: equal score, the panel comes before the template");
	assert.deepEqual(ids("tn"), ["s:tn", "p:nodevumi"], "label word start beats a keyword hit");
	const mid = rank([I("a", "source", "Nodevums_2026.pdf"), I("b", "source", "Piezimes par nodevumu.pdf")], "devum");
	assert.deepEqual(mid.map((i) => i.id), ["a", "b"].sort(), "both are middle matches: shorter label first");
});

test("every word must match; words can match different parts of an item", () => {
	assert.deepEqual(ids("bd427 iela"), ["pr:BD427"]);
	assert.deepEqual(ids("nodot tn"), ["p:nodevumi"], "the panel says \"nodot\" in its hint and \"tn\" in its keywords");
	assert.deepEqual(ids("nodot avoti"), [], "no item has both");
	assert.deepEqual(ids("uzdevums pdf"), ["s:uzd"]);
	assert.deepEqual(ids("zzz"), []);
});

test("with no query: recent things first, then the panels; nothing else", () => {
	assert.deepEqual(ids(""), ["r:1", "p:nodevumi", "p:avoti", "p:faili", "p:grafiks"]);
	assert.deepEqual(ids("   "), ["r:1", "p:nodevumi", "p:avoti", "p:faili", "p:grafiks"]);
});

test("ties go by group, then the shorter label; the list is cut at the limit", () => {
	const t = [I("x1", "source", "Atskaite"), I("x2", "panel", "Atskaite"), I("x3", "project", "Atskaite plus"), I("x4", "source", "Atskaite plus vēl")];
	assert.deepEqual(rank(t, "atskaite").map((i) => i.id), ["x2", "x3", "x1", "x4"], "equal score: panel, project, source; inside one group the shorter label first");
	assert.equal(rank(Array.from({ length: 50 }, (_, i) => I(`n${i}`, "source", `Fails ${i}`)), "fails").length, 30);
	assert.equal(rank(Array.from({ length: 50 }, (_, i) => I(`n${i}`, "source", `Fails ${i}`)), "fails", 5).length, 5);
});
