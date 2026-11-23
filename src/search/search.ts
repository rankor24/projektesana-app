// Hybrid search over a project: keyword (FTS5) and meaning (vector nearest neighbours), merged by Reciprocal Rank Fusion.
// Why both: a keyword index finds the exact code, number or name (a cadastral number, "AK-41") but misses a question put in other
// words; vectors find the passage that says the same thing in other words but are vague about exact strings. Each is run alone, and
// their two ranked lists are merged by rank only, so the two kinds of score (bm25 and cosine) never have to be made comparable: a
// passage scores the sum of weight / (60 + rank) over the lists it appears in (Cormack et al.: the constant 60 is theirs; the keyword
// + vector pattern is the one Alex Garcia and Simon Willison describe). A passage both lists like beats one that only one likes.
//
// The keyword side is deliberately an OR of the question's content words ranked by bm25, not the AND the conversation search uses:
// a question has words ("kāds", "ir", "cik") that the answer does not, and an AND of them finds nothing (3 of 29 on the test set,
// against 24 of 29 for OR). Plain words are matched by their beginning, as in ftsMatch, because Latvian endings change.
//
// Vectors are compared in plain code: one project is thousands of pieces of a few hundred numbers, which is a few milliseconds.
// (sqlite-vec was tried: it loads in Node's SQLite and in Electron's, but at this size it saves nothing and adds a native file to ship.)
import type { DatabaseSync } from "node:sqlite";
import type { Passage, SearchKind, SearchResult } from "../shared/search-types.js";
import type { Embedder } from "./embedder.js";
import { vectorOf } from "./index.js";
import { hasSearchSchema } from "./schema.js";

export type { Passage, SearchKind, SearchResult };

const RRF_K = 60;
/** The meaning side counts half as much as the words: on the Latvian test it found fewer of the right pages alone than the words did (codes, numbers and OCR-damaged text do not embed well), and merged at equal weight it pushed some right pages out of the top five. At 0.5 the merge kept every page the words found and added the ones only the meaning found. */
const MEANING_WEIGHT = 0.5;
const DEPTH = 40;
const PASSAGE_CHARS = 700;

/** Words that open a question and say nothing about its subject. */
const QUESTION_WORDS = new Set(["kāds", "kāda", "kādi", "kādas", "kādu", "kādā", "kāpēc", "kurā", "kurš", "kura", "kuras", "kuru", "kurai", "kuri", "kamēr", "kad", "kur", "cik", "kas", "vai", "līdz", "pēc", "par", "what", "which", "where", "when", "how", "the", "and"]);

/** An FTS5 query that finds any of the question's content words, each quoted (so `AND`, `*`, `:` in the question are words, not syntax). A word of four or more letters is searched by its beginning without its last one or two letters; a token with a digit or sign is exact. Null when nothing searchable is left. */
export function ftsAny(query: string): string | null {
	const terms = new Set<string>();
	for (const raw of query.split(/\s+/)) {
		const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/"/g, "");
		if (!token || QUESTION_WORDS.has(token.toLowerCase())) continue;
		if (token.length < 3 && !/\d/.test(token)) continue;
		if (/^\p{L}{4,}$/u.test(token)) {
			const letters = [...token];
			terms.add(`"${letters.slice(0, letters.length - (letters.length >= 6 ? 2 : 1)).join("")}"*`);
		} else terms.add(`"${token}"`);
	}
	return terms.size ? [...terms].join(" OR ") : null;
}

/** Reciprocal Rank Fusion of ranked lists of ids (best first): id → sum over lists of weight / (k + rank), rank from 1; every weight 1 unless given. */
export function rrf(lists: string[][], k = RRF_K, weights: number[] = []): Map<string, number> {
	const score = new Map<string, number>();
	lists.forEach((list, li) => list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + (weights[li] ?? 1) / (k + i + 1))));
	return score;
}

const byScore = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);

/** The ids of the `limit` rows with the highest dot product with `q` (vectors are unit length, so that is the cosine). */
function nearest(db: DatabaseSync, q: Float32Array, model: string, kind: "source" | "message", limit: number): { id: number; sim: number }[] {
	const top: { id: number; sim: number }[] = [];
	let floor = -Infinity;
	const rows = db.prepare("SELECT v.chunk_id AS id, v.vec AS vec FROM chunk_vectors v JOIN chunks c ON c.id = v.chunk_id WHERE v.model = ? AND c.kind = ?").iterate(model, kind) as Iterable<{ id: number; vec: Uint8Array }>;
	for (const r of rows) {
		const v = vectorOf(r.vec);
		if (v.length !== q.length) continue;
		let s = 0;
		for (let i = 0; i < v.length; i++) s += v[i] * q[i];
		if (top.length < limit || s > floor) {
			top.push({ id: Number(r.id), sim: s });
			top.sort((a, b) => b.sim - a.sim);
			if (top.length > limit) top.pop();
			floor = top[top.length - 1].sim;
		}
	}
	return top;
}

const clip = (s: string) => (s.length > PASSAGE_CHARS ? `${s.slice(0, PASSAGE_CHARS)}…` : s);

interface ChunkRow {
	id: number;
	text: string;
	page: number | null;
	source: string | null;
	label: string | null;
}

function sourcePassages(db: DatabaseSync, q: string, qv: Float32Array | null, model: string | null, limit: number): Passage[] {
	const match = ftsAny(q);
	const keyword = match ? (db.prepare("SELECT c.id AS id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid WHERE chunks_fts MATCH ? AND c.kind = 'source' ORDER BY bm25(chunks_fts) LIMIT ?").all(match, DEPTH) as { id: number }[]).map((r) => String(r.id)) : [];
	const meaning = qv && model ? nearest(db, qv, model, "source", DEPTH).map((r) => String(r.id)) : [];
	const fused = byScore(rrf([keyword, meaning], RRF_K, [1, MEANING_WEIGHT])).slice(0, limit);
	const get = db.prepare("SELECT id, text, page, source, label FROM chunks WHERE id = ?");
	const out: Passage[] = [];
	for (const [id, score] of fused) {
		const c = get.get(Number(id)) as ChunkRow | undefined;
		if (!c) continue;
		out.push({ kind: "source", citation: `${c.label ?? "?"}, lpp. ${c.page ?? "?"}`, text: clip(c.text), score, via: [...(keyword.includes(id) ? (["keyword"] as const) : []), ...(meaning.includes(id) ? (["meaning"] as const) : [])], sourceId: c.source ?? undefined, page: c.page ?? undefined });
	}
	return out;
}

interface MsgRow {
	id: number;
	thread_id: string;
	at: string;
	role: string;
	text: string;
	title: string | null;
	agent: string | null;
}

function conversationPassages(db: DatabaseSync, q: string, qv: Float32Array | null, model: string | null, limit: number): Passage[] {
	const match = ftsAny(q);
	// the existing message index (its own tokenizer settings, same as the conversation search)
	const keyword = match ? (db.prepare("SELECT m.id AS id FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid WHERE messages_fts MATCH ? AND m.kind = 'text' ORDER BY bm25(messages_fts) LIMIT ?").all(match, DEPTH) as { id: number }[]).map((r) => String(r.id)) : [];
	// the best piece of each message, as the nearest pieces say
	const bestPiece = new Map<string, number>();
	const meaning: string[] = [];
	if (qv && model) {
		const pieceMsg = db.prepare("SELECT message_id AS mid FROM chunks WHERE id = ?");
		for (const n of nearest(db, qv, model, "message", DEPTH)) {
			const mid = String((pieceMsg.get(n.id) as { mid: number | null } | undefined)?.mid ?? "");
			if (!mid || bestPiece.has(mid)) continue;
			bestPiece.set(mid, n.id);
			meaning.push(mid);
		}
	}
	const fused = byScore(rrf([keyword, meaning], RRF_K, [1, MEANING_WEIGHT])).slice(0, limit);
	const msg = db.prepare("SELECT m.id AS id, m.thread_id AS thread_id, m.at AS at, m.role AS role, m.text AS text, t.title AS title, t.agent AS agent FROM messages m LEFT JOIN threads t ON t.id = m.thread_id WHERE m.id = ?");
	const piece = db.prepare("SELECT text FROM chunks WHERE id = ?");
	const out: Passage[] = [];
	for (const [id, score] of fused) {
		const m = msg.get(Number(id)) as MsgRow | undefined;
		if (!m) continue;
		const pid = bestPiece.get(id);
		const text = pid !== undefined ? (piece.get(pid) as { text: string } | undefined)?.text ?? m.text : m.text;
		out.push({ kind: "conversation", citation: `${m.title ?? "saruna"}, ${m.at.slice(0, 10)} (${m.role === "user" ? "lietotājs" : (m.agent ?? "aģents")})`, text: clip(text), score, via: [...(keyword.includes(id) ? (["keyword"] as const) : []), ...(meaning.includes(id) ? (["meaning"] as const) : [])], threadId: m.thread_id, at: m.at });
	}
	return out;
}

export interface SearchOptions {
	query: string;
	kind?: SearchKind;
	limit?: number;
	/** the model that built the project's vectors; null = none were built */
	embedder: Embedder | null;
	/** why there is no embedder, for the note (not downloaded, failed to load) */
	embedderNote?: string;
}

/** Searches an open threads.db (read-only is enough). */
export async function searchProject(db: DatabaseSync, o: SearchOptions): Promise<SearchResult> {
	const limit = Math.max(1, Math.min(o.limit ?? 6, 20));
	const kind = o.kind ?? "all";
	if (!hasSearchSchema(db)) return { hits: [], mode: "keyword", note: "Meklēšanas indekss vēl nav izveidots." };
	let qv: Float32Array | null = null;
	let model: string | null = null;
	let note = o.embedderNote;
	if (o.embedder) {
		const built = (db.prepare("SELECT value FROM meta WHERE key = 'search.model'").get() as { value: string } | undefined)?.value ?? null;
		if (built === o.embedder.model) {
			qv = (await o.embedder.embed([o.query], "query"))[0];
			model = built;
		} else note = "Vektori vēl nav uzbūvēti ar šo modeli; meklē tikai pēc atslēgvārdiem.";
	}
	const want = (k: SearchKind) => kind === "all" || kind === k;
	const src = want("sources") ? sourcePassages(db, o.query, qv, model, limit) : [];
	const conv = want("conversations") ? conversationPassages(db, o.query, qv, model, limit) : [];
	const hits = [...src, ...conv].sort((a, b) => b.score - a.score).slice(0, limit);
	// a build that is still going: the meaning side only sees what has a vector so far
	const left = qv ? Number((db.prepare("SELECT COUNT(*) n FROM chunks c LEFT JOIN chunk_vectors v ON v.chunk_id = c.id WHERE v.chunk_id IS NULL").get() as { n: number }).n) : 0;
	return { hits, mode: qv ? "hybrid" : "keyword", ...(qv ? (left ? { note: `Indekss vēl tiek veidots: ${left} fragmentiem vēl nav vektora, tie atrodami tikai pēc vārdiem.` } : {}) : { note: note ?? "Meklē tikai pēc atslēgvārdiem." }) };
}
