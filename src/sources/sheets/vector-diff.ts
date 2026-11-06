// Sheet comparison from the PDF vectors (task 5.4): what changed between two issues of a sheet, named — lines added,
// removed or moved, texts added / removed / moved, dimension values changed. Pixel diffs (BIM Crew blueprint-diff) show
// where; this says what.
//
// Pages are paired by sheet number (read from the page text) and else by order. Both pages are aligned on their sheet
// frame (the largest rectangle of stroked lines): coordinates become millimetres from the frame's corner, scaled to A's
// frame, so a sheet re-plotted with another margin or paper size still lines up.
import { pdfGeometry, type Segment } from "../extract/kl-geometry.js";

export interface PageText {
	str: string;
	x: number;
	y: number;
}

export interface SheetPage {
	page: number;
	sheetNo: string | null;
	segments: Segment[];
	texts: PageText[];
	frame: { x0: number; y0: number; x1: number; y1: number } | null;
	sizeMm: { w: number; h: number };
}

export type SheetChange =
	| { kind: "line-added" | "line-removed"; seg: Segment; length: number }
	| { kind: "line-moved"; from: Segment; to: Segment; dx: number; dy: number; length: number }
	| { kind: "text-added" | "text-removed"; text: PageText }
	| { kind: "text-moved"; from: PageText; to: PageText }
	| { kind: "dimension-changed"; from: PageText; to: PageText };

export interface PageDiff {
	a: number;
	b: number;
	sheetNo: string | null;
	changes: SheetChange[];
	/** short sentences for the agent and the list */
	summary: string[];
}

const PT_MM = 25.4 / 72;
const SHEET_NO = /\b([A-ZĀ-Ž]{1,4}[- ]?\d{1,3}(?:\.\d{1,2})?)\b/u;
const DIMENSION = /^\d{2,6}(?:[.,]\d{1,2})?$/;
const len = (s: Segment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Lines (sheet mm) and positioned texts (sheet mm, origin bottom-left) of every page. */
export async function readSheet(bytes: Uint8Array): Promise<SheetPage[]> {
	const geo = await pdfGeometry(bytes, { minLengthPt: 1 });
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	const doc = await task.promise;
	try {
		const out: SheetPage[] = [];
		for (const g of geo) {
			const page = await doc.getPage(g.page);
			const [vx0, vy0] = page.view;
			const tc = await page.getTextContent();
			const texts = tc.items
				.filter((it): it is Extract<typeof it, { str: string }> => "str" in it && it.str.trim() !== "")
				.map((it) => ({ str: it.str.trim(), x: Math.round((it.transform[4] - vx0) * PT_MM * 100) / 100, y: Math.round((it.transform[5] - vy0) * PT_MM * 100) / 100 }));
			// the sheet number sits in the title block, lower right: take the match nearest to that corner
			const cand = texts.filter((t) => SHEET_NO.test(t.str) && !DIMENSION.test(t.str)).sort((p, q) => q.x - q.y - (p.x - p.y));
			out.push({ page: g.page, sheetNo: cand[0] ? SHEET_NO.exec(cand[0].str)![1].replace(" ", "-") : null, segments: g.segments, texts, frame: frameOf(g.segments), sizeMm: g.sheetMm });
			page.cleanup();
		}
		return out;
	} finally {
		await task.destroy();
	}
}

/** The sheet frame: the bounding box of the longest horizontal and vertical lines (the border is the longest thing drawn). */
export function frameOf(segs: Segment[]): SheetPage["frame"] {
	const hv = segs.filter((s) => Math.abs(s.x1 - s.x2) < 0.05 || Math.abs(s.y1 - s.y2) < 0.05);
	if (hv.length < 4) return null;
	const longest = Math.max(...hv.map(len));
	const border = hv.filter((s) => len(s) > longest * 0.6);
	const xs = border.flatMap((s) => [s.x1, s.x2]);
	const ys = border.flatMap((s) => [s.y1, s.y2]);
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function aligner(a: SheetPage, b: SheetPage): (x: number, y: number) => [number, number] {
	if (!a.frame || !b.frame) return (x, y) => [x, y];
	const sx = (a.frame.x1 - a.frame.x0) / (b.frame.x1 - b.frame.x0 || 1);
	const sy = (a.frame.y1 - a.frame.y0) / (b.frame.y1 - b.frame.y0 || 1);
	return (x, y) => [(x - b.frame!.x0) * sx + a.frame!.x0, (y - b.frame!.y0) * sy + a.frame!.y0];
}

const segKey = (s: Segment, tol: number) => {
	const r = (v: number) => Math.round(v / tol);
	const p = `${r(s.x1)},${r(s.y1)}`;
	const q = `${r(s.x2)},${r(s.y2)}`;
	return p < q ? `${p}|${q}` : `${q}|${p}`;
};

const near = (s: Segment, t: Segment, tol: number) => {
	const d1 = Math.hypot(s.x1 - t.x1, s.y1 - t.y1) + Math.hypot(s.x2 - t.x2, s.y2 - t.y2);
	const d2 = Math.hypot(s.x1 - t.x2, s.y1 - t.y2) + Math.hypot(s.x2 - t.x1, s.y2 - t.y1);
	return Math.min(d1, d2) <= tol * 2;
};

const direction = (s: Segment) => {
	const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
	return ((a % Math.PI) + Math.PI) % Math.PI;
};

export function diffPages(a: SheetPage, b: SheetPage, tol = 0.3): PageDiff {
	const al = aligner(a, b);
	const bSegs = b.segments.map((s) => {
		const [x1, y1] = al(s.x1, s.y1);
		const [x2, y2] = al(s.x2, s.y2);
		return { x1, y1, x2, y2 };
	});
	const bTexts = b.texts.map((t) => {
		const [x, y] = al(t.x, t.y);
		return { ...t, x, y };
	});
	const aKeys = new Map(a.segments.map((s) => [segKey(s, tol), s]));
	const bKeys = new Map(bSegs.map((s) => [segKey(s, tol), s]));
	let removed = a.segments.filter((s) => !bKeys.has(segKey(s, tol)) && !bSegs.some((t) => near(s, t, tol)));
	let added = bSegs.filter((s) => !aKeys.has(segKey(s, tol)) && !a.segments.some((t) => near(s, t, tol)));
	const changes: SheetChange[] = [];
	// a removed line and an added line of the same length and direction: the line moved
	for (const r of [...removed]) {
		const m = added.find((x) => Math.abs(len(x) - len(r)) <= tol && Math.abs(direction(x) - direction(r)) < 0.01);
		if (!m) continue;
		const dx = Math.round(((m.x1 + m.x2) / 2 - (r.x1 + r.x2) / 2) * 100) / 100;
		const dy = Math.round(((m.y1 + m.y2) / 2 - (r.y1 + r.y2) / 2) * 100) / 100;
		changes.push({ kind: "line-moved", from: r, to: m, dx, dy, length: Math.round(len(r) * 100) / 100 });
		removed = removed.filter((x) => x !== r);
		added = added.filter((x) => x !== m);
	}
	for (const s of removed) changes.push({ kind: "line-removed", seg: s, length: Math.round(len(s) * 100) / 100 });
	for (const s of added) changes.push({ kind: "line-added", seg: s, length: Math.round(len(s) * 100) / 100 });

	const used = new Set<number>();
	const tTol = 1;
	for (const t of a.texts) {
		const same = bTexts.findIndex((u, i) => !used.has(i) && u.str === t.str && Math.hypot(u.x - t.x, u.y - t.y) <= tTol);
		if (same >= 0) {
			used.add(same);
			continue;
		}
		const at = bTexts.findIndex((u, i) => !used.has(i) && Math.hypot(u.x - t.x, u.y - t.y) <= tTol);
		if (at >= 0 && DIMENSION.test(t.str) && DIMENSION.test(bTexts[at].str)) {
			used.add(at);
			changes.push({ kind: "dimension-changed", from: t, to: bTexts[at] });
			continue;
		}
		const moved = bTexts.findIndex((u, i) => !used.has(i) && u.str === t.str);
		if (moved >= 0) {
			used.add(moved);
			changes.push({ kind: "text-moved", from: t, to: bTexts[moved] });
			continue;
		}
		changes.push({ kind: "text-removed", text: t });
	}
	bTexts.forEach((u, i) => !used.has(i) && changes.push({ kind: "text-added", text: u }));
	return { a: a.page, b: b.page, sheetNo: a.sheetNo ?? b.sheetNo, changes, summary: changes.map(describe) };
}

const mm = (v: number) => `${v.toFixed(1)} mm`;
export function describe(c: SheetChange): string {
	switch (c.kind) {
		case "line-moved":
			return `līnija ${mm(c.length)} pārvietota par ${mm(Math.hypot(c.dx, c.dy))} (x ${c.dx >= 0 ? "+" : ""}${c.dx.toFixed(1)}, y ${c.dy >= 0 ? "+" : ""}${c.dy.toFixed(1)} mm lapā)`;
		case "line-added":
			return `jauna līnija ${mm(c.length)} pie (${c.seg.x1.toFixed(0)}; ${c.seg.y1.toFixed(0)}) mm`;
		case "line-removed":
			return `noņemta līnija ${mm(c.length)} pie (${c.seg.x1.toFixed(0)}; ${c.seg.y1.toFixed(0)}) mm`;
		case "dimension-changed":
			return `izmērs ${c.from.str} → ${c.to.str}`;
		case "text-moved":
			return `teksts “${c.from.str}” pārvietots`;
		case "text-added":
			return `jauns teksts “${c.text.str}”`;
		case "text-removed":
			return `noņemts teksts “${c.text.str}”`;
	}
}

/** Pairs pages by sheet number, then the rest by order. */
export function pairPages(a: SheetPage[], b: SheetPage[]): [SheetPage, SheetPage][] {
	const pairs: [SheetPage, SheetPage][] = [];
	const freeB = new Set(b);
	const restA: SheetPage[] = [];
	for (const p of a) {
		const q = p.sheetNo ? b.find((x) => freeB.has(x) && x.sheetNo === p.sheetNo) : undefined;
		if (q) {
			pairs.push([p, q]);
			freeB.delete(q);
		} else restA.push(p);
	}
	const rb = b.filter((x) => freeB.has(x));
	restA.forEach((p, i) => rb[i] && pairs.push([p, rb[i]]));
	return pairs;
}

/** Where a change sits on A's page, as page fractions (top-left origin) for a pin. */
export function whereOnA(c: SheetChange, a: SheetPage): { x: number; y: number } {
	const p = c.kind === "line-moved" ? { x: (c.from.x1 + c.from.x2) / 2, y: (c.from.y1 + c.from.y2) / 2 } : "seg" in c ? { x: (c.seg.x1 + c.seg.x2) / 2, y: (c.seg.y1 + c.seg.y2) / 2 } : "from" in c ? c.from : c.text;
	return { x: Math.min(1, Math.max(0, p.x / a.sizeMm.w)), y: Math.min(1, Math.max(0, 1 - p.y / a.sizeMm.h)) };
}

export async function diffSheets(a: Uint8Array, b: Uint8Array): Promise<PageDiff[]> {
	const [pa, pb] = await Promise.all([readSheet(a), readSheet(b)]);
	return pairPages(pa, pb).map(([x, y]) => diffPages(x, y));
}
