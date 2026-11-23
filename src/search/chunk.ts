// Cutting text into pieces that get a vector each.
// Why: a page of a PDF is one piece of text, but a Word or Excel source is stored as ONE "page" of up to a quarter of a million
// characters, and an embedding model reads about 512 tokens at a time. A piece must be short enough to say one thing (so its
// vector can match a question about that thing) and long enough to carry a whole fact (a table row with its heading, a clause
// with its number). About 900 characters (~250 tokens of Latvian) with a small overlap does both; the cut is made at a paragraph
// or sentence end when there is one near the limit, so a fact is rarely torn in half.
// A piece's text is stored as written (with its line breaks), not with the extra spaces that table cells and OCR leave: those are
// folded to one space here, because they carry no meaning and waste the model's window.

export const CHUNK_CHARS = 900;
export const CHUNK_OVERLAP = 120;
/** A piece shorter than this is page furniture (a number, a heading alone), not something anyone searches for. */
export const CHUNK_MIN = 24;

/** The text with runs of spaces and tabs folded to one space and runs of blank lines to one line break. */
export function tidy(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t ]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

/** Where to cut near `limit`: the last paragraph end, else sentence end, else space, in the last third of the window; else the limit itself. */
function cutAt(s: string, limit: number): number {
	if (s.length <= limit) return s.length;
	const floor = Math.floor(limit * 0.6);
	const win = s.slice(0, limit);
	const nl = win.lastIndexOf("\n");
	if (nl >= floor) return nl + 1;
	const m = [...win.matchAll(/[.!?;:]["”)]?\s/g)].pop();
	if (m && m.index !== undefined && m.index + m[0].length >= floor) return m.index + m[0].length;
	const sp = win.lastIndexOf(" ");
	return sp >= floor ? sp + 1 : limit;
}

/** The pieces of one page's text, in order. Empty when there is nothing worth a vector. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
	const s = tidy(text);
	if (s.length < CHUNK_MIN) return [];
	const out: string[] = [];
	let at = 0;
	while (at < s.length) {
		const rest = s.slice(at);
		const len = cutAt(rest, size);
		const piece = rest.slice(0, len).trim();
		if (piece.length >= CHUNK_MIN) out.push(piece);
		if (at + len >= s.length) break;
		// the next piece starts a little before the cut (on a word start), so a sentence that straddles it is whole in one of them
		let next = at + len - overlap;
		if (next <= at) next = at + len;
		else {
			const sp = s.indexOf(" ", next);
			if (sp !== -1 && sp < at + len) next = sp + 1;
		}
		at = next;
	}
	return out;
}
