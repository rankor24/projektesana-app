// 2D compare (A | B) for any two files: which view a pair opens in, the DWG result shapes (main reads the drawings with
// CadCraft, src/sources/dwg.ts) and the text diff of two documents (DOCX, XLSX, TXT, a PDF's text). Pure and node-free:
// the picker, the views, main and the tests use the same code.

/** Flat [x1, y1, x2, y2, …] in drawing units. */
export type Lines = number[];
export type Bounds = [number, number, number, number];

export interface DwgSpace {
	name: string;
	lines: Lines;
	bounds: Bounds | null;
}
export interface DwgView {
	spaces: DwgSpace[];
	objects: number;
	/** objects that drew nothing (points, images, types the reader counts but does not draw) */
	silent: number;
}
export interface DwgChange {
	what: "added" | "removed" | "changed";
	label: string;
	/** for "changed": what changed ("moved", "geometry", "text", "layer", …) */
	detail: string[];
	x: number;
	y: number;
}
export interface DwgCompareSpace {
	name: string;
	/** B as it is (the newer drawing), drawn grey under the marks */
	base: Lines;
	/** A as it was (the older drawing): the left side of A | B */
	baseA: Lines;
	added: Lines;
	removed: Lines;
	/** a changed object: its old lines and its new lines */
	changedOld: Lines;
	changedNew: Lines;
	bounds: Bounds | null;
	changes: DwgChange[];
	/** the space exists only in A or only in B */
	onlyIn: "a" | "b" | null;
}
export interface DwgCompare {
	spaces: DwgCompareSpace[];
	totals: { added: number; removed: number; changed: number; same: number };
	layersAdded: string[];
	layersRemoved: string[];
}

// ---- which compare a pair of files opens ----

export type CompareMode = "sheet" | "ifc" | "dwg" | "text";
const EXT = /\.([a-z0-9]+)$/i;
export const extOf = (name: string): string => (EXT.exec(name.split("::").pop() ?? name)?.[1] ?? "").toLowerCase();
const TEXT_EXT = new Set(["docx", "xlsx", "txt", "md", "csv", "json", "xml", "html", "htm"]);

/** The compare a file takes part in, by its name; null = nothing to compare it with. */
export function modeOfFile(name: string): CompareMode | null {
	const e = extOf(name);
	if (e === "pdf") return "sheet";
	if (e === "ifc") return "ifc";
	if (e === "dwg") return "dwg";
	if (TEXT_EXT.has(e)) return "text";
	return null;
}

/**
 * The compare two files open: both must be of one kind. A PDF can also be compared as text (`asText`): a written document
 * printed to PDF reads better as words than as a drawing. Returns a problem in words when they do not go together.
 */
export function pairMode(a: string, b: string, asText = false): CompareMode | string {
	const ma = modeOfFile(a), mb = modeOfFile(b);
	if (!ma) return `Šo failu nevar salīdzināt: ${a}`;
	if (!mb) return `Šo failu nevar salīdzināt: ${b}`;
	if (asText && (ma === "sheet" || ma === "text") && (mb === "sheet" || mb === "text")) return "text";
	if (ma !== mb) return `Salīdzina tikai viena veida failus: ${extOf(a).toUpperCase()} un ${extOf(b).toUpperCase()} nesader.`;
	return ma;
}

// ---- the text diff ----

export interface DiffPart {
	/** "same" on both sides, "del" only in A, "add" only in B */
	op: "same" | "del" | "add";
	text: string;
}
export interface TextDiff {
	parts: DiffPart[];
	added: number;
	removed: number;
	/** the diff was cut to lines (the documents were too long to compare word by word) */
	coarse: boolean;
}

/** Words with the spaces after them, so the parts put back together give the text again. */
const tokens = (s: string): string[] => s.match(/\S+\s*|\s+/g) ?? [];
/** Word by word up to this many tokens on each side; longer texts are compared line by line. */
const WORD_LIMIT = 6000;

/** Longest common subsequence over two token lists, as same / del / add runs (the classic table; the inputs are bounded). */
function lcsDiff(a: string[], b: string[]): DiffPart[] {
	// strip the common start and end first: most reissues differ in a few places
	let s = 0;
	while (s < a.length && s < b.length && a[s] === b[s]) s++;
	let e = 0;
	while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
	const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
	const n = A.length, m = B.length;
	const out: DiffPart[] = [];
	const push = (op: DiffPart["op"], text: string) => {
		const last = out[out.length - 1];
		if (last && last.op === op) last.text += text;
		else if (text) out.push({ op, text });
	};
	push("same", a.slice(0, s).join(""));
	if (n * m > 40_000_000) {
		// too big for the table even after trimming: everything between is one removal and one addition
		push("del", A.join(""));
		push("add", B.join(""));
	} else {
		const w = m + 1;
		const t = new Uint32Array((n + 1) * w);
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = A[i] === B[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
		let i = 0, j = 0;
		while (i < n && j < m) {
			if (A[i] === B[j]) (push("same", A[i]), i++, j++);
			else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) push("del", A[i++]);
			else push("add", B[j++]);
		}
		while (i < n) push("del", A[i++]);
		while (j < m) push("add", B[j++]);
	}
	push("same", a.slice(a.length - e).join(""));
	return out;
}

/** What changed from text A (the older) to text B, word by word (line by line for long texts). */
export function textDiff(a: string, b: string): TextDiff {
	const ta = tokens(a), tb = tokens(b);
	const coarse = ta.length > WORD_LIMIT || tb.length > WORD_LIMIT;
	const parts = coarse ? lcsDiff(a.split(/(?<=\n)/), b.split(/(?<=\n)/)) : lcsDiff(ta, tb);
	const count = (op: DiffPart["op"]) => parts.filter((p) => p.op === op).reduce((n, p) => n + (p.text.trim() ? tokens(p.text).filter((x) => x.trim()).length : 0), 0);
	return { parts, added: count("add"), removed: count("del"), coarse };
}
