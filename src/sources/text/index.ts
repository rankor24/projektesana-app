// One entry for text extraction. Each format reader lives in its own file; this picks the reader and reports the state
// the data model knows: ok / ocr / empty / unsupported / error. Nothing is ever returned silently empty.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { docxText } from "./docx.js";
import { pdfText } from "./pdf.js";
import { xlsxText } from "./xlsx.js";

export type TextState = "ok" | "ocr" | "empty" | "unsupported" | "error";

export interface Extracted {
	state: TextState;
	/** one string per page; formats without pages give one */
	pages: string[];
	/** why the state is not `ok` */
	reason?: string;
	/** PDF pages without a text layer (OCR candidates) */
	emptyPages?: number[];
}

const PLAIN = new Set([".txt", ".md", ".json", ".csv", ".tsv", ".xml", ".html", ".htm"]);
export const TEXT_FORMATS = new Set([...PLAIN, ".pdf", ".docx", ".xlsx"]);

export async function extractText(abs: string): Promise<Extracted> {
	const ext = extname(abs).toLowerCase();
	try {
		if (PLAIN.has(ext)) return fromPages([readFileSync(abs, "utf8")]);
		if (ext === ".pdf") {
			const r = await pdfText(abs);
			const out = fromPages(r.pages);
			return r.emptyPages.length ? { ...out, emptyPages: r.emptyPages, reason: out.state === "empty" ? "PDF bez teksta slāņa (skenēts)" : `bez teksta slāņa: lpp. ${r.emptyPages.join(", ")}` } : out;
		}
		if (ext === ".docx") return fromPages([docxText(readFileSync(abs))]);
		if (ext === ".xlsx") return fromPages([xlsxText(readFileSync(abs))]);
		return { state: "unsupported", pages: [], reason: `Formāts ${ext || "(bez paplašinājuma)"} netiek lasīts.` };
	} catch (e) {
		return { state: "error", pages: [], reason: (e as Error).message };
	}
}

function fromPages(pages: string[]): Extracted {
	const letters = pages.join("").match(/\p{L}/gu)?.length ?? 0;
	return letters === 0 ? { state: "empty", pages, reason: "Tekstā nav neviena burta." } : { state: "ok", pages };
}

export const normText = (s: string) => s.replace(/\s+/g, " ").trim();
