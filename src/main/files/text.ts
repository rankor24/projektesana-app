// Plain-text extraction for quote verification, the agent's read_doc and text diffs of documents.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const PLAIN = new Set([".txt", ".md", ".json", ".csv", ".tsv", ".xml", ".html", ".htm"]);

export async function extractText(abs: string): Promise<string> {
	const ext = extname(abs).toLowerCase();
	if (PLAIN.has(ext)) return readFileSync(abs, "utf8");
	if (ext === ".pdf") return pdfText(abs);
	if (ext === ".docx") return docxText(readFileSync(abs));
	if (ext === ".xlsx") return xlsxText(readFileSync(abs));
	throw new Error(`Formāts ${ext || "(bez paplašinājuma)"} vēl netiek lasīts. Pārvērt uz PDF, DOCX, XLSX vai tekstu.`);
}

async function pdfText(abs: string): Promise<string> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(abs)), useSystemFonts: true }).promise;
	const pages: string[] = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const tc = await (await doc.getPage(i)).getTextContent();
		pages.push(`--- lpp. ${i} ---\n` + tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
	}
	return pages.join("\n");
}

const unxml = (s: string) =>
	s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&amp;/g, "&");

/** Paragraph text of word/document.xml, one line per paragraph, table cells separated by tabs. */
export function docxText(buf: Uint8Array): string {
	const files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
	const xml = files["word/document.xml"];
	if (!xml) throw new Error("DOCX bez word/document.xml.");
	return strFromU8(xml)
		.replace(/<w:tab\/>/g, "\t")
		.replace(/<\/w:tc>/g, "\t")
		.replace(/<\/w:p>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((l) => unxml(l).trimEnd())
		.join("\n")
		.trim();
}

/** Every sheet as `Sheet n: A1=value` lines; shared strings resolved. */
export function xlsxText(buf: Uint8Array): string {
	const files = unzipSync(buf, { filter: (f) => f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
	const shared: string[] = [];
	const ss = files["xl/sharedStrings.xml"];
	if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
	const out: string[] = [];
	for (const name of Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
		const sheet = name.match(/sheet(\d+)/)![1];
		for (const c of strFromU8(files[name]).matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const body = c[3] ?? "";
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
			const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
			const val = /t="s"/.test(c[2]) ? shared[Number(v)] : inline !== undefined ? unxml(inline) : v;
			if (val !== undefined && val !== "") out.push(`Sheet ${sheet}: ${c[1]}=${val}`);
		}
	}
	return out.join("\n");
}

export const normText = (s: string) => s.replace(/\s+/g, " ").trim();
