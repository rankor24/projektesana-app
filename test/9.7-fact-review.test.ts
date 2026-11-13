// 9.7 facts reviewed next to their quote: the walk order (waiting first, by key), next / previous, a decided fact leaving the walk,
// the quote found on an invented page (across text items, ignoring case, diacritics and line breaks), the keyboard, and the rule
// that a value is never confirmed without its quote on screen.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fact } from "../src/core/model.ts";
import { afterDecision, confirmProblem, findQuote, keyAction, othersFor, plain, position, reviewQueue, step } from "../src/shared/fact-review.ts";
import { PROFILE_LABEL } from "../src/shared/dashboard.ts";

let n = 0;
const doc = (key: string, value: string, state: Fact["state"], at: string, sourceId = "s1", page = 1, quote = `citāts ${value}`): Fact => ({ id: `f${++n}`, key, value, source: { sourceId, page, quote } as never, state, by: "agent", at });
const typed = (key: string, value: string, state: Fact["state"] = "proposed"): Fact => ({ id: `u${++n}`, key, value, source: { name: "B", at: "2026-11-01T00:00:00Z" } as never, state, by: "user", at: "2026-11-01T00:00:00Z" });
const labelOf = (k: string) => PROFILE_LABEL[k.replace(/^profile\./, "") as keyof typeof PROFILE_LABEL] ?? k;

const FACTS: Fact[] = [
	doc("profile.group", "3", "proposed", "2026-11-10T10:00:00Z"),
	doc("profile.workType", "Jaunbūve", "proposed", "2026-11-09T10:00:00Z"),
	doc("profile.workType", "Pārbūve", "proposed", "2026-11-11T10:00:00Z", "s2", 4),
	doc("profile.use", "Biroju", "confirmed", "2026-11-08T10:00:00Z"),
	doc("profile.funding", "ES", "rejected", "2026-11-08T10:00:00Z"),
	typed("profile.address", "Brīvības 1"),
	doc("note.x", "zzz", "proposed", "2026-11-12T10:00:00Z"),
	doc("area.total", "1200", "proposed", "2026-11-12T11:00:00Z"),
	doc("profile.cadastralNo", "0100 000 0001", "proposed", "2026-11-12T12:00:00Z"),
];

test("the walk: waiting proposals that cite a document, profile keys in table order, other keys by name, the newest first within a key", () => {
	const q = reviewQueue(FACTS, labelOf);
	assert.deepEqual(q.map((i) => `${i.key}=${i.value}`), ["profile.workType=Pārbūve", "profile.workType=Jaunbūve", "profile.group=3", "profile.cadastralNo=0100 000 0001", "area.total=1200", "note.x=zzz"]);
	assert.ok(!q.some((i) => i.key === "profile.use" || i.key === "profile.funding" || i.key === "profile.address"), "confirmed, rejected and typed are not in the walk");
	assert.deepEqual([q[0].label, q[0].sourceId, q[0].page, q[0].quote], ["Būvniecības veids", "s2", 4, "citāts Pārbūve"]);
	assert.equal(q[4].label, "area.total", "an unknown key is shown as it is");
	assert.deepEqual(reviewQueue([]), []);
});

test("next and previous stop at the ends; with nothing chosen the walk starts at the first (next) or the last (previous)", () => {
	const q = reviewQueue(FACTS);
	assert.equal(step(q, null, 1)?.factId, q[0].factId);
	assert.equal(step(q, null, -1)?.factId, q.at(-1)!.factId);
	assert.equal(step(q, q[0].factId, 1)?.factId, q[1].factId);
	assert.equal(step(q, q[1].factId, -1)?.factId, q[0].factId);
	assert.equal(step(q, q[0].factId, -1), null, "no wrap at the start");
	assert.equal(step(q, q.at(-1)!.factId, 1), null, "no wrap at the end");
	assert.equal(step([], null, 1), null);
	assert.equal(step(q, "nav", 1)?.factId, q[0].factId, "an unknown fact starts the walk");
	assert.equal(position(q, q[2].factId), "3 / 6");
	assert.equal(position(q, "nav"), "– / 6");
});

test("a decided fact leaves the walk: the next one takes its place, the last one falls back, the walk ends with an empty queue", () => {
	let q = reviewQueue(FACTS);
	const [a, b, c] = q;
	let r = afterDecision(q, a.factId);
	assert.deepEqual([r.queue.length, r.next?.factId], [5, b.factId]);
	r = afterDecision(q, b.factId);
	assert.equal(r.next?.factId, c.factId);
	const last = q.at(-1)!;
	r = afterDecision(q, last.factId);
	assert.equal(r.next?.factId, q.at(-2)!.factId, "after the last one decided: the one before it");
	assert.ok(!r.queue.some((i) => i.factId === last.factId));
	assert.deepEqual(afterDecision([a], a.factId), { queue: [], next: null });
	assert.equal(afterDecision(q, "nav").queue.length, q.length, "an unknown id changes nothing");
	for (const item of [...q]) q = afterDecision(q, item.factId).queue;
	assert.deepEqual(q, []);
});

test("the other values of the key: proposed, confirmed or typed, newest first; not the rejected, not the fact itself", () => {
	const q = reviewQueue(FACTS);
	const wt = q.find((i) => i.value === "Jaunbūve")!;
	assert.deepEqual(othersFor(FACTS, wt).map((f) => f.value), ["Pārbūve"]);
	const more = [...FACTS, doc("profile.workType", "Atjaunošana", "confirmed", "2026-11-12T00:00:00Z"), doc("profile.workType", "Nojaukšana", "rejected", "2026-11-12T00:00:00Z")];
	assert.deepEqual(othersFor(more, wt).map((f) => f.value), ["Atjaunošana", "Pārbūve"]);
});

test("the quote on the page: whole, across text items, ignoring case, diacritics, line breaks and odd quotes", () => {
	const page = ["Būvniecības ieceres dokumentācijas", "izstrādei piemēro 3. grupas", "ēkas prasības.", "Cits teksts šeit."];
	const m = findQuote(page, "Piemēro 3. GRUPAS ēkas   prasības");
	assert.deepEqual(m?.kind, "whole");
	assert.deepEqual(m?.hits, [{ item: 1, from: 10, to: plain(page[1]).length }, { item: 2, from: 0, to: 13 }]);
	// diacritics and dashes are not a reason to miss it
	assert.equal(findQuote(["Platība – 1 200 m²"], "platiba - 1 200 m2")?.kind, "whole");
	assert.equal(findQuote(["Teica: „viņš nāks”"], 'teica: "viņš nāks"')?.kind, "whole", "typographic quotes");
	// a quote inside one item
	assert.deepEqual(findQuote(["abc def ghi"], "def")?.hits, [{ item: 0, from: 4, to: 7 }]);
	// empty items and short quotes
	assert.equal(findQuote(["", "x", ""], "x"), null, "a quote under three characters is not searched");
	assert.deepEqual(findQuote(["", "abc", ""], "abc")?.hits, [{ item: 1, from: 0, to: 3 }]);
});

test("a quote broken differently: the first six words are found and the match says it is only the start; a quote not on the page is null", () => {
	const page = ["Ēkas grupu nosaka pēc būves", "lietošanas veida un augstuma", "saskaņā ar noteikumiem"];
	const long = "Ēkas grupu nosaka pēc būves lietošanas veida, augstuma un platības (apjoma)";
	const m = findQuote(page, long);
	assert.equal(m?.kind, "start");
	assert.deepEqual(m?.hits.map((h) => h.item), [0, 1], "the first six words span two items");
	assert.deepEqual(findQuote(page, "ēkas grupu nosaka pēc būves"), { kind: "whole", hits: [{ item: 0, from: 0, to: 27 }] }, "a short quote is found whole");
	assert.equal(findQuote(page, "ēkas grupu nosaka pēc tāda vārda kas šeit nav")?.kind, undefined, "six words or fewer that are not on the page: null, not a guess");
	assert.equal(findQuote(page, "tāda teikuma šeit nav vispār un nekad nebija"), null);
	assert.equal(findQuote([], "jebkas"), null);
	assert.equal(findQuote(page, "  "), null);
});

test("the keyboard: Enter confirms, Delete rejects, the arrows walk; nothing while typing or with a modifier", () => {
	assert.equal(keyAction({ key: "Enter" }, false), "confirm");
	assert.equal(keyAction({ key: "Delete" }, false), "reject");
	assert.equal(keyAction({ key: "Backspace" }, false), "reject");
	assert.equal(keyAction({ key: "ArrowRight" }, false), "next");
	assert.equal(keyAction({ key: "ArrowLeft" }, false), "prev");
	assert.equal(keyAction({ key: "Enter" }, true), null, "typing in the write-it-yourself box");
	assert.equal(keyAction({ key: "Enter", ctrlKey: true }, false), null);
	assert.equal(keyAction({ key: "Delete", shiftKey: true }, false), null);
	assert.equal(keyAction({ key: "a" }, false), null);
});

test("a value is never confirmed without its quote on screen: the cited source and page must be the ones shown, by this card", () => {
	const item = reviewQueue(FACTS)[0]; // s2, page 4
	assert.equal(confirmProblem(item, { sourceId: "s2", page: 4 }, item.factId), null);
	assert.match(confirmProblem(null, null, null) ?? "", /Nav fakta/);
	assert.match(confirmProblem(item, { sourceId: "s2", page: 4 }, "citas") ?? "", /citu faktu/);
	assert.match(confirmProblem(item, null, item.factId) ?? "", /nav atvērts/);
	assert.match(confirmProblem(item, { sourceId: "s1", page: 4 }, item.factId) ?? "", /nav atvērts/);
	assert.match(confirmProblem(item, { sourceId: "s2", page: 2 }, item.factId) ?? "", /lappusi 4/);
});
