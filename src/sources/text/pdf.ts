// PDF text layer per page, with pdfjs (legacy build, the one that runs in Node). Carried from v1 src/main/files/text.ts pdfText,
// changed to return pages separately: quotes, citations and OCR all work per page.
import { readFileSync } from "node:fs";

export interface PdfText {
	pages: string[];
	/** pages whose text layer is empty or nearly so: candidates for OCR */
	emptyPages: number[];
}

/** Under this many letters a page is treated as having no text layer (scan, drawing with outlined text). */
export const MIN_PAGE_LETTERS = 20;

export async function pdfText(data: Uint8Array | string): Promise<PdfText> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const bytes = typeof data === "string" ? new Uint8Array(readFileSync(data)) : data;
	const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
	const doc = await task.promise;
	try {
		const pages: string[] = [];
		const emptyPages: number[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const tc = await page.getTextContent();
			const text = tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("").replace(/[ \t]+\n/g, "\n").trim();
			pages.push(text);
			if ((text.match(/\p{L}/gu)?.length ?? 0) < MIN_PAGE_LETTERS) emptyPages.push(i);
			page.cleanup();
		}
		return { pages, emptyPages };
	} finally {
		await task.destroy();
	}
}
