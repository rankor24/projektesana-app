// The OCR hook of the source pipeline: render each page without a text layer, OCR it in Latvian, page by page.
// A page that gives nothing readable is returned empty and the pipeline marks it (never silently empty).
import type { PipelineHooks } from "../sources/pipeline.js";
import type { Ocr } from "../sources/text/ocr.js";
import type { PageRenderer } from "./offscreen.js";

export function ocrHook(renderer: PageRenderer, ocr: Ocr): NonNullable<PipelineHooks["ocr"]> {
	return async (bytes, pages, onPage) => {
		const out = new Map<number, string>();
		if (!ocr.available()) return out;
		const pdf = bytes();
		for (const p of pages) {
			onPage(p);
			const [img] = await renderer.render(pdf, [p], 3);
			const r = await ocr.recognize(img.png);
			out.set(p, r.text);
		}
		return out;
	};
}
