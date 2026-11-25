// Offscreen page renderer: a hidden window main uses to turn PDF pages into PNG images (for OCR, and later for the sheet
// pixel compare). Node has no canvas and the app takes no native modules, so Chromium's canvas does the rasterising.
import { PDF_WASM_URL } from "../pdf-assets";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function fromBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Renders the given 1-based pages at `scale` (1 = 72 dpi) and returns PNG data URLs in the same order. */
async function renderPages(b64: string, pages: number[], scale: number): Promise<{ page: number; png: string; width: number; height: number }[]> {
	const task = pdfjs.getDocument({ data: fromBase64(b64), wasmUrl: PDF_WASM_URL });
	const doc = await task.promise;
	try {
		const out = [];
		for (const n of pages) {
			if (n < 1 || n > doc.numPages) throw new Error(`Lapa ${n} nav dokumentā (${doc.numPages} lapas).`);
			const page = await doc.getPage(n);
			const vp = page.getViewport({ scale });
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(vp.width);
			canvas.height = Math.ceil(vp.height);
			const ctx = canvas.getContext("2d")!;
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
			out.push({ page: n, png: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height });
			page.cleanup();
		}
		return out;
	} finally {
		await task.destroy();
	}
}

/** One page's part: `region` is fractions of the page (x, y from the top left, w, h), drawn at `scale` into a canvas of the part's own size, so a zoom into a corner of an A0 sheet costs
 *  what the corner costs, not the whole sheet. The canvas is at most `maxSide` pixels on its long side (the scale is lowered to fit). */
async function renderRegion(b64: string, pageNo: number, scale: number, region: { x: number; y: number; w: number; h: number }, maxSide: number): Promise<{ png: string; width: number; height: number; scale: number }> {
	const task = pdfjs.getDocument({ data: fromBase64(b64), wasmUrl: PDF_WASM_URL });
	const doc = await task.promise;
	try {
		if (pageNo < 1 || pageNo > doc.numPages) throw new Error(`Lapa ${pageNo} nav dokumentā (${doc.numPages} lapas).`);
		const page = await doc.getPage(pageNo);
		const base = page.getViewport({ scale: 1 });
		const r = { x: Math.max(0, Math.min(1, region.x)), y: Math.max(0, Math.min(1, region.y)), w: Math.max(0.005, Math.min(1, region.w)), h: Math.max(0.005, Math.min(1, region.h)) };
		r.w = Math.min(r.w, 1 - r.x);
		r.h = Math.min(r.h, 1 - r.y);
		const partW = base.width * r.w;
		const partH = base.height * r.h;
		const s = Math.min(scale, maxSide / Math.max(partW, partH));
		const vp = page.getViewport({ scale: s, offsetX: -r.x * base.width * s, offsetY: -r.y * base.height * s });
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.ceil(partW * s));
		canvas.height = Math.max(1, Math.ceil(partH * s));
		const ctx = canvas.getContext("2d")!;
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
		page.cleanup();
		return { png: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height, scale: s };
	} finally {
		await task.destroy();
	}
}

(window as unknown as { __renderPages: typeof renderPages; __renderRegion: typeof renderRegion }).__renderPages = renderPages;
(window as unknown as { __renderRegion: typeof renderRegion }).__renderRegion = renderRegion;
document.title = "ready";
