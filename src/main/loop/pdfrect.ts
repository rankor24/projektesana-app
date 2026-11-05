// Where does the drawing sit on a PDF page? Union bounding box of all vector paths, normalised 0..1 from top-left.
// With crop boundaries visible in the export (spec §6), this is the cropped view's rectangle, which pin → model needs.
// ASSUMPTION [unverified against a real Revit PDF]: nothing but the view's own graphics is drawn outside the crop frame.
import { readFileSync } from "node:fs";

export interface PageRect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
	a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
	a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
	a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export async function pdfContentRect(pdfPath: string, pageNo = 1): Promise<PageRect> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise;
	const page = await doc.getPage(pageNo);
	const [px0, py0, px1, py1] = page.view;
	const ops = await page.getOperatorList();
	const OPS = pdfjs.OPS;
	let ctm: M = [1, 0, 0, 1, 0, 0];
	const stack: M[] = [];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const grow = (x: number, y: number) => {
		const [tx, ty] = apply(ctm, x, y);
		minX = Math.min(minX, tx); minY = Math.min(minY, ty); maxX = Math.max(maxX, tx); maxY = Math.max(maxY, ty);
	};
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		const args = ops.argsArray[i] as unknown[];
		if (fn === OPS.save) stack.push(ctm);
		else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
		else if (fn === OPS.transform) ctm = mul(ctm, args as unknown as M);
		else if (fn === OPS.constructPath) {
			// pdf.js ≥4 passes the path's bounding box as a Float32Array [minX, minY, maxX, maxY] in the last argument
			const bb = args[args.length - 1];
			if (bb && typeof bb === "object" && "length" in (bb as object) && (bb as ArrayLike<number>).length === 4) {
				const [a, b, c, d] = Array.from(bb as ArrayLike<number>);
				if ([a, b, c, d].every(Number.isFinite)) for (const [x, y] of [[a, b], [c, b], [a, d], [c, d]]) grow(x, y);
			}
		}
	}
	if (!Number.isFinite(minX)) throw new Error("Lapā nav vektoru grafikas — nevar noteikt skata laukumu.");
	const w = px1 - px0;
	const h = py1 - py0;
	const clamp = (v: number) => Math.min(1, Math.max(0, v));
	return { x0: clamp((minX - px0) / w), x1: clamp((maxX - px0) / w), y0: clamp(1 - (maxY - py0) / h), y1: clamp(1 - (minY - py0) / h) };
}
