// Facts reviewed next to their quote (task 9.7). The waiting proposals are a walk: waiting first, by profile key; the user
// confirms or rejects each with its source PDF open at the cited page and the quote highlighted, and the card floats by it. A
// value is never confirmed without its quote on screen. Pure and node-free: the card, the PDF view and the tests use the same
// functions.
import { PROFILE_KEYS, type Fact } from "../core/model.js";

export interface ReviewItem {
	factId: string;
	/** the full fact key, e.g. "profile.workType" */
	key: string;
	/** how the key reads to the user ("Būvniecības veids"); other keys are shown as they are */
	label: string;
	value: string;
	sourceId: string;
	page: number;
	quote: string;
	by: Fact["by"];
}

const keyOrder = (key: string): number => {
	const i = (PROFILE_KEYS as readonly string[]).indexOf(key.replace(/^profile\./, ""));
	return i < 0 ? PROFILE_KEYS.length : i;
};

/**
 * The waiting proposals that cite a document (a proposal the user typed himself has no quote and is not in the walk), in the
 * order the walk goes: profile keys in their table order, other keys by name, and within a key the newest first.
 */
export function reviewQueue(facts: Fact[], labelOf: (key: string) => string = (k) => k): ReviewItem[] {
	return facts
		.filter((f) => f.state === "proposed" && "sourceId" in f.source)
		.sort((a, b) => keyOrder(a.key) - keyOrder(b.key) || (keyOrder(a.key) === PROFILE_KEYS.length ? a.key.localeCompare(b.key) : 0) || b.at.localeCompare(a.at))
		.map((f) => {
			const s = f.source as { sourceId: string; page: number; quote: string };
			return { factId: f.id, key: f.key, label: labelOf(f.key), value: f.value, sourceId: s.sourceId, page: s.page, quote: s.quote, by: f.by };
		});
}

/** The other values the same key has (proposed, confirmed or typed), for the card: the user may prefer one of them. */
export function othersFor(facts: Fact[], item: Pick<ReviewItem, "key" | "factId">): Fact[] {
	return facts.filter((f) => f.key === item.key && f.id !== item.factId && f.state !== "rejected").sort((a, b) => b.at.localeCompare(a.at));
}

/** Next / previous in the walk; it stops at the ends (no wrap), so the user knows when the last one is done. */
export function step(queue: ReviewItem[], factId: string | null, dir: 1 | -1): ReviewItem | null {
	if (!queue.length) return null;
	const i = factId ? queue.findIndex((q) => q.factId === factId) : -1;
	if (i < 0) return dir === 1 ? queue[0] : queue[queue.length - 1];
	return queue[i + dir] ?? null;
}

/** After a fact is decided it leaves the walk; the walk goes on with the one that took its place, else the one before it. */
export function afterDecision(queue: ReviewItem[], decidedId: string): { queue: ReviewItem[]; next: ReviewItem | null } {
	const i = queue.findIndex((q) => q.factId === decidedId);
	const rest = queue.filter((q) => q.factId !== decidedId);
	return { queue: rest, next: rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? null };
}

/** "3 / 12" for the card's header. */
export const position = (queue: ReviewItem[], factId: string): string => {
	const i = queue.findIndex((q) => q.factId === factId);
	return i < 0 ? `– / ${queue.length}` : `${i + 1} / ${queue.length}`;
};

// ---- the quote on the page ----

const FOLD = /[̀-ͯ]/g;
/** Text as it is compared: no diacritics, lower case, one space between words, ligatures and odd quotes made plain. */
export const plain = (s: string): string =>
	s
		.normalize("NFKD")
		.replace(FOLD, "")
		.toLowerCase()
		.replace(/[“”„‟«»]/g, '"')
		.replace(/[‘’‚‛]/g, "'")
		.replace(/[‐‑‒–—―]/g, "-")
		.replace(/\s+/g, " ")
		.trim();

export interface QuoteHit {
	/** index of a text item of the page and the range of characters of it that belong to the quote (plain text, in item order) */
	item: number;
	from: number;
	to: number;
}
export interface QuoteMatch {
	hits: QuoteHit[];
	/** "whole": the quote found as written; "start": only its first words (a line broken or hyphenated differently) */
	kind: "whole" | "start";
}

/**
 * Where a quote is on a page, from the text items the PDF text layer holds (each item is one run of text). The items are joined
 * with a space and compared without case, diacritics or line breaks. If the whole quote is not found, its first six words are
 * looked for (the extractor and the text layer can break a line differently), and the match says so. Null = not on this page.
 */
export function findQuote(items: string[], quote: string): QuoteMatch | null {
	const q = plain(quote);
	if (q.length < 3) return null;
	const spans: { start: number; end: number }[] = [];
	let joined = "";
	for (const raw of items) {
		const t = plain(raw);
		if (joined) joined += " ";
		spans.push({ start: joined.length, end: joined.length + t.length });
		joined += t;
	}
	const locate = (needle: string, kind: QuoteMatch["kind"]): QuoteMatch | null => {
		const at = joined.indexOf(needle);
		if (at < 0) return null;
		const end = at + needle.length;
		const hits: QuoteHit[] = [];
		spans.forEach((s, item) => {
			if (s.end <= at || s.start >= end || s.end === s.start) return;
			hits.push({ item, from: Math.max(at, s.start) - s.start, to: Math.min(end, s.end) - s.start });
		});
		return hits.length ? { hits, kind } : null;
	};
	const whole = locate(q, "whole");
	if (whole) return whole;
	const words = q.split(" ");
	return words.length > 6 ? locate(words.slice(0, 6).join(" "), "start") : null;
}

// ---- the keyboard ----

export type ReviewKey = "confirm" | "reject" | "next" | "prev";
/**
 * What a key does in the review: Enter confirms, Delete rejects, → / ← walk. Nothing while the user types in a field (the
 * "write it myself" box), and nothing with a modifier key held.
 */
export function keyAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }, typing: boolean): ReviewKey | null {
	if (typing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
	if (e.key === "Enter") return "confirm";
	if (e.key === "Delete" || e.key === "Backspace") return "reject";
	if (e.key === "ArrowRight") return "next";
	if (e.key === "ArrowLeft") return "prev";
	return null;
}

/**
 * A value is never confirmed without its quote on screen: the page of the cited source must be the one shown, and the card (which
 * always prints the quote) must be showing this fact. Anything else leaves the buttons off and says why.
 */
export function confirmProblem(item: ReviewItem | null, shown: { sourceId: string | null; page: number | null } | null, cardFact: string | null): string | null {
	if (!item) return "Nav fakta, ko pārskatīt.";
	if (cardFact !== item.factId) return "Karte rāda citu faktu.";
	if (!shown || shown.sourceId !== item.sourceId) return "Avota dokuments nav atvērts: atver to, lai redzētu citātu.";
	if (shown.page !== item.page) return `Atver lappusi ${item.page}: tur ir citāts.`;
	return null;
}
