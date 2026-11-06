// Offscreen page renderer: a hidden window main uses to turn PDF pages into PNG images (for OCR, and later for the sheet
// pixel compare). Node has no canvas and the app takes no native modules, so Chromium's canvas does the rasterising.
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
	const task = pdfjs.getDocument({ data: fromBase64(b64) });
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

(window as unknown as { __renderPages: typeof renderPages }).__renderPages = renderPages;
document.title = "ready";
