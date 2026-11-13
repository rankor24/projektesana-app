// Markdown to a real .docx without Word or Python (task 8.13; ported from BIM Crew core/md_to_docx.py: headings, paragraphs,
// bullet and numbered lists, pipe tables with a shaded header row, horizontal rules, **bold** / *italic* / `code`). Written with fflate
// like the xlsx writer: A4, 2 cm margins, Calibri 11, Latvian proofing language, real heading styles (so Word's navigation pane and the
// outline of docx_outline see them), real list numbering. Word is only needed to turn the result into a PDF.
import { strToU8, zipSync } from "fflate";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Run {
	text: string;
	b?: boolean;
	i?: boolean;
	code?: boolean;
}

/** **bold**, *italic* (or _italic_), `code`; everything else is text. Unclosed markers stay as written. */
export function inlineRuns(s: string): Run[] {
	const out: Run[] = [];
	const re = /(\*\*([^*]+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w]))/g;
	let last = 0;
	for (let m = re.exec(s); m; m = re.exec(s)) {
		if (m.index > last) out.push({ text: s.slice(last, m.index) });
		if (m[2] !== undefined) out.push(...inlineRuns(m[2]).map((r) => ({ ...r, b: true })));
		else if (m[3] !== undefined) out.push({ text: m[3], code: true });
		else out.push(...inlineRuns(m[4] ?? m[5]).map((r) => ({ ...r, i: true })));
		last = m.index + m[0].length;
	}
	if (last < s.length) out.push({ text: s.slice(last) });
	return out;
}

interface Look {
	size?: number;
	color?: string;
	bold?: boolean;
}

// rPr children in the order the schema wants them: rFonts, b, i, color, sz
const runXml = (r: Run, look: Look = {}) => {
	const bold = r.b || look.bold;
	const rpr = `${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ""}${bold ? "<w:b/>" : ""}${r.i ? "<w:i/>" : ""}${look.color ? `<w:color w:val="${look.color}"/>` : ""}${look.size ?? (r.code ? 20 : 0) ? `<w:sz w:val="${look.size ?? 20}"/>` : ""}`;
	return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
};
const runsXml = (s: string, look?: Look) => inlineRuns(s).map((r) => runXml(r, look)).join("");

type Block =
	| { k: "h"; level: number; text: string }
	| { k: "p"; text: string }
	| { k: "ul"; items: string[] }
	| { k: "ol"; items: string[] }
	| { k: "table"; rows: string[][] }
	| { k: "hr" };

const splitRow = (l: string) =>
	l
		.trim()
		.replace(/^\||\|$/g, "")
		.split(/(?<!\\)\|/)
		.map((c) => c.trim().replace(/\\\|/g, "|"));
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");

export function parseMarkdown(md: string): Block[] {
	const lines = md.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let para: string[] = [];
	const flush = () => {
		if (para.length) blocks.push({ k: "p", text: para.join(" ") });
		para = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!l.trim()) {
			flush();
			continue;
		}
		const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(l);
		if (h) {
			flush();
			blocks.push({ k: "h", level: h[1].length, text: h[2] });
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
			flush();
			blocks.push({ k: "hr" });
			continue;
		}
		if (l.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
			flush();
			const rows = [splitRow(l)];
			i += 2;
			for (; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) rows.push(splitRow(lines[i]));
			i--;
			blocks.push({ k: "table", rows });
			continue;
		}
		const ul = /^\s*[-*+]\s+(.*)$/.exec(l);
		const ol = /^\s*\d+[.)]\s+(.*)$/.exec(l);
		if (ul || ol) {
			flush();
			const kind = ul ? "ul" : "ol";
			const items: string[] = [];
			for (; i < lines.length; i++) {
				const m = (kind === "ul" ? /^\s*[-*+]\s+(.*)$/ : /^\s*\d+[.)]\s+(.*)$/).exec(lines[i]);
				if (m) items.push(m[1]);
				else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
				else break;
			}
			i--;
			blocks.push({ k: kind, items });
			continue;
		}
		para.push(l.trim().replace(/^>\s?/, ""));
	}
	flush();
	return blocks;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD_BG = "2F5496";
const ALT_BG = "F2F2F2";

function styles(): string {
	const heading = (n: number, size: number) =>
		`<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${HEAD_BG}"/><w:sz w:val="${size}"/></w:rPr></w:style>`;
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:lang w:val="lv-LV"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 36)}${heading(2, 28)}${heading(3, 24)}${heading(4, 22)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
}

/** abstractNum 0 = bullets, 1 = decimal; every numbered list gets its own w:num that restarts at 1. */
function numbering(orderedLists: number): string {
	const lvl = (fmt: string, text: string, font?: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ""}</w:lvl>`;
	const nums = Array.from({ length: orderedLists }, (_, i) => `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join("");
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvl("bullet", "•", "Calibri")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvl("decimal", "%1.")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums}</w:numbering>`;
}

const listItem = (text: string, numId: number) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runsXml(text)}</w:p>`;

function tableXml(rows: string[][]): string {
	const cols = Math.max(...rows.map((r) => r.length));
	const w = Math.floor(9638 / cols);
	const cell = (t: string, ri: number) => {
		const head = ri === 0;
		const shade = head ? HEAD_BG : ri % 2 === 0 ? ALT_BG : null;
		return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ""}</w:tcPr><w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${runsXml(t, { size: 20, bold: head, color: head ? "FFFFFF" : undefined })}</w:p></w:tc>`;
	};
	const body = rows
		.map((r, ri) => `<w:tr>${ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${Array.from({ length: cols }, (_, ci) => cell(r[ci] ?? "", ri)).join("")}</w:tr>`)
		.join("");
	return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${body}</w:tbl>`;
}

export interface MdDocxOptions {
	/** document title in the file's properties (not repeated as text) */
	title?: string;
}

/** The .docx bytes for a markdown text. */
export function markdownToDocx(md: string, opts: MdDocxOptions = {}): Uint8Array {
	const blocks = parseMarkdown(md);
	let ordered = 0;
	const body = blocks
		.map((b) => {
			switch (b.k) {
				case "h":
					return `<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${runsXml(b.text)}</w:p>`;
				case "p":
					return `<w:p>${runsXml(b.text)}</w:p>`;
				case "ul":
					return b.items.map((t) => listItem(t, 1)).join("");
				case "ol": {
					const id = 2 + ordered++;
					return b.items.map((t) => listItem(t, id)).join("");
				}
				case "table":
					return `${tableXml(b.rows)}<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
				case "hr":
					return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A6A6A6"/></w:pBdr></w:pPr></w:p>`;
			}
		})
		.join("");
	const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body || "<w:p/>"}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
	const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
	const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
	const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title ?? "")}</dc:title><dc:language>lv-LV</dc:language></cp:coreProperties>`;
	return zipSync({
		"[Content_Types].xml": strToU8(ct),
		"_rels/.rels": strToU8(rels),
		"word/document.xml": strToU8(document),
		"word/_rels/document.xml.rels": strToU8(docRels),
		"word/styles.xml": strToU8(styles()),
		"word/numbering.xml": strToU8(numbering(ordered)),
		"docProps/core.xml": strToU8(core),
	});
}
