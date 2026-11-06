// Test helpers: temp folders and in-memory office files built from invented content.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

export const FIX = join(import.meta.dirname, "fixtures");
export const tmp = (prefix = "pj-") => mkdtempSync(join(tmpdir(), prefix));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A .docx whose body has the given paragraphs; a paragraph that is an array becomes a one-row table. */
export function makeDocx(paragraphs: (string | string[])[]): Uint8Array {
	const body = paragraphs
		.map((p) =>
			Array.isArray(p)
				? `<w:tbl><w:tr>${p.map((c) => `<w:tc><w:p><w:r><w:t>${esc(c)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr></w:tbl>`
				: `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`,
		)
		.join("");
	return zipSync({
		"[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
		"word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
	});
}

/** A .xlsx with named sheets; each sheet is rows of cells (strings become shared strings, numbers stay numbers). */
export function makeXlsx(sheets: Record<string, (string | number)[][]>): Uint8Array {
	const shared: string[] = [];
	const si = (s: string) => {
		let i = shared.indexOf(s);
		if (i < 0) i = shared.push(s) - 1;
		return i;
	};
	const col = (i: number) => String.fromCharCode(65 + i);
	const files: Record<string, Uint8Array> = {};
	const names = Object.keys(sheets);
	names.forEach((name, n) => {
		const rows = sheets[name]
			.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)).join("")}</row>`)
			.join("");
		files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
	});
	files["xl/workbook.xml"] = strToU8(
		`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
	);
	files["xl/_rels/workbook.xml.rels"] = strToU8(
		`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
	);
	files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`);
	return zipSync(files);
}
