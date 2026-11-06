// DOCX body text, one line per paragraph, one line per table row with cells separated by tabs.
// Carried from v1 src/main/files/text.ts docxText. Changed: paragraphs inside a cell no longer break the row apart
// (v1 put a newline before every cell); headers/footers are not body text and are not read.
import { strFromU8, unzipSync } from "fflate";
import { unxml } from "./xml.js";

export function docxText(buf: Uint8Array): string {
	const files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" });
	const xml = files["word/document.xml"];
	if (!xml) throw new Error("DOCX bez word/document.xml.");
	return strFromU8(xml)
		.replace(/<w:tab\/>/g, "\t")
		.replace(/<w:br\/>/g, " ")
		// inside a cell, paragraph ends are spaces; the cell end is a tab; the row end is a line
		.replace(/<w:tc\b[\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, " ").replace(/<\/w:tc>$/, "\t"))
		.replace(/<\/w:tr>/g, "\n")
		.replace(/<\/w:p>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.split("\n")
		.map((l) => unxml(l).replace(/ +\t/g, "\t").trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
