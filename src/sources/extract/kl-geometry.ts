// Plan geometry from a vector Kadastrālā / Inventarizācijas lieta (task 3.4): the stroked line segments of each page,
// with the page's floor, as sheet millimetres (for CSV and for modelling) and as page fractions (for the preview overlay).
// Read from the pdfjs operator list: pdfjs 6 packs a path as constructPath [paintOp, [data], minMax] with drawing codes
// 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath, in the space of the current transform — so the
// transform stack (transform / save / restore) is tracked. Clipping paths (endPath) and fills without stroke are left out.

export interface Segment {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface PageGeometry {
	page: number;
	floor: string | null;
	/** sheet millimetres, origin bottom-left as in PDF */
	segments: Segment[];
	/** page fractions, origin top-left (for the overlay) */
	fractions: Segment[];
	/** distinct segment end points, sheet millimetres */
	points: { x: number; y: number }[];
	sheetMm: { w: number; h: number };
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const PT_MM = 25.4 / 72;
const r2 = (n: number) => Math.round(n * 100) / 100;

const FLOOR = /(\d{1,2})\.?\s*stāv|pagrab|cokolstāv|bēniņ|mansard/i;

export async function pdfGeometry(bytes: Uint8Array, opts: { minLengthPt?: number } = {}): Promise<PageGeometry[]> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const OPS = pdfjs.OPS as Record<string, number>;
	const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
	const minLen = opts.minLengthPt ?? 0.5;
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	const doc = await task.promise;
	try {
		const out: PageGeometry[] = [];
		for (let pn = 1; pn <= doc.numPages; pn++) {
			const page = await doc.getPage(pn);
			const [vx0, vy0, vx1, vy1] = page.view;
			const W = vx1 - vx0;
			const H = vy1 - vy0;
			const ol = await page.getOperatorList();
			const stack: M[] = [];
			let ctm: M = [1, 0, 0, 1, 0, 0];
			const segs: Segment[] = [];
			for (let i = 0; i < ol.fnArray.length; i++) {
				const fn = ol.fnArray[i];
				const args = ol.argsArray[i] as unknown[];
				if (fn === OPS.save) stack.push(ctm);
				else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
				else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as M);
				else if (fn === OPS.constructPath) {
					const paint = args[0] as number;
					if (!STROKE.has(paint)) continue;
					for (const raw of args[1] as ArrayLike<number>[]) {
						const d = Array.from(raw);
						let k = 0;
						let cur: [number, number] | null = null;
						let start: [number, number] | null = null;
						const seg = (a: [number, number], b: [number, number]) => {
							const p = apply(ctm, a[0], a[1]);
							const q = apply(ctm, b[0], b[1]);
							if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= minLen) segs.push({ x1: p[0], y1: p[1], x2: q[0], y2: q[1] });
						};
						while (k < d.length) {
							const op = d[k++];
							if (op === 0) cur = start = [d[k++], d[k++]];
							else if (op === 1) {
								const p: [number, number] = [d[k++], d[k++]];
								if (cur) seg(cur, p);
								cur = p;
							} else if (op === 2) {
								// a curve is kept as its chord: plan walls are straight; arcs (doors) become one segment
								k += 4;
								const p: [number, number] = [d[k++], d[k++]];
								if (cur) seg(cur, p);
								cur = p;
							} else if (op === 3) {
								k += 2;
								const p: [number, number] = [d[k++], d[k++]];
								if (cur) seg(cur, p);
								cur = p;
							} else if (op === 4) {
								if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) seg(cur, start);
								cur = start;
							} else break;
						}
					}
				}
			}
			// identical segments drawn twice count once
			const seen = new Set<string>();
			const uniq = segs.filter((s) => {
				const a = `${r2(s.x1)},${r2(s.y1)}`;
				const b = `${r2(s.x2)},${r2(s.y2)}`;
				const key = a < b ? `${a}|${b}` : `${b}|${a}`;
				return seen.has(key) ? false : (seen.add(key), true);
			});
			const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ");
			const fm = FLOOR.exec(text);
			const toMm = (s: Segment): Segment => ({ x1: r2((s.x1 - vx0) * PT_MM), y1: r2((s.y1 - vy0) * PT_MM), x2: r2((s.x2 - vx0) * PT_MM), y2: r2((s.y2 - vy0) * PT_MM) });
			const toFr = (s: Segment): Segment => ({ x1: (s.x1 - vx0) / W, y1: 1 - (s.y1 - vy0) / H, x2: (s.x2 - vx0) / W, y2: 1 - (s.y2 - vy0) / H });
			const mm = uniq.map(toMm);
			const pts = new Map<string, { x: number; y: number }>();
			for (const s of mm) for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) pts.set(`${x},${y}`, { x, y });
			out.push({ page: pn, floor: fm ? (fm[1] ?? fm[0].toLowerCase()) : null, segments: mm, fractions: uniq.map(toFr), points: [...pts.values()], sheetMm: { w: r2(W * PT_MM), h: r2(H * PT_MM) } });
			page.cleanup();
		}
		return out;
	} finally {
		await task.destroy();
	}
}

/** CSV: one line per segment, then one per point; sheet millimetres; ; as separator for Latvian Excel. */
export function geometryCsv(pages: PageGeometry[]): string {
	const rows = ["lapa;stāvs;tips;x1_mm;y1_mm;x2_mm;y2_mm"];
	for (const p of pages) {
		for (const s of p.segments) rows.push([p.page, p.floor ?? "", "līnija", s.x1, s.y1, s.x2, s.y2].join(";"));
		for (const q of p.points) rows.push([p.page, p.floor ?? "", "punkts", q.x, q.y, "", ""].join(";"));
	}
	return rows.join("\r\n").replace(/(\d)\.(\d)/g, "$1,$2") + "\r\n";
}
