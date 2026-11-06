// Room table from a Kadastrālā / Inventarizācijas lieta (telpu eksplikācija): floor, room number, name, area (as written,
// to the decimals of the document), height when given. From a PDF the lines are rebuilt from the text positions (VZD
// documents place every cell on its own); from an OCR'd scan the cached text lines are used.
// A row is kept only when it parses whole: number, name, area. Totals ("Kopā …") are read separately to check the sum.
import { num } from "./common.js";

export interface RoomRow {
	floor: string;
	no: string;
	name: string;
	area: number;
	height: number | null;
	page: number;
	/** the whole line, as rebuilt */
	quote: string;
}

export interface RoomTable {
	rows: RoomRow[];
	/** "Kopā …" lines: floor → stated total */
	totals: { floor: string; area: number; page: number }[];
	/** rows that looked like room rows but did not parse, for Boris to see */
	unread: { page: number; line: string }[];
}

/** PDF text items → lines per page, ordered top to bottom, cells left to right, separated by three spaces. */
export async function pdfLayoutLines(bytes: Uint8Array): Promise<string[][]> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	const doc = await task.promise;
	try {
		const out: string[][] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const tc = await page.getTextContent();
			const items = tc.items
				.filter((it): it is Extract<typeof it, { str: string }> => "str" in it && it.str.trim() !== "")
				.map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || 8, s: it.str }));
			items.sort((a, b) => b.y - a.y || a.x - b.x);
			const lines: { y: number; h: number; cells: typeof items }[] = [];
			for (const it of items) {
				const l = lines.find((x) => Math.abs(x.y - it.y) <= Math.min(x.h, it.h) * 0.5);
				if (l) l.cells.push(it);
				else lines.push({ y: it.y, h: it.h, cells: [it] });
			}
			lines.sort((a, b) => b.y - a.y);
			out.push(
				lines.map((l) => {
					const cells = l.cells.sort((a, b) => a.x - b.x);
					let s = "";
					let end = -Infinity;
					for (const c of cells) {
						const gap = c.x - end;
						s += s ? (gap > c.h * 0.8 ? "   " : gap > c.h * 0.15 ? " " : "") : "";
						s += c.s;
						end = c.x + c.w;
					}
					return s.trim();
				}),
			);
			page.cleanup();
		}
		return out;
	} finally {
		await task.destroy();
	}
}

const FLOOR = /^(?:(\d{1,2})\.?\s*stāvs\p{L}*|stāvs\s*[:\-–]?\s*(\d{1,2})|(pagrabs|pagrabstāvs|cokolstāvs|bēniņi|mansarda|jumta\s+stāvs))\b/iu;
// [Nr. p.k.]  room no  name  area  [height]
const ROW = /^(?:\d{1,4}\.?\s{2,}|\d{1,4}\.?\s+(?=\d))?(\d{1,4}[A-Za-z]?(?:[./-]\d{1,3})?)\s+(\p{L}[^\t]*?)\s+(\d{1,5}[,.]\d{1,2})(?:\s+(\d{1,2}[,.]\d{1,2}))?\s*$/u;
const TOTAL = /^(?:kopā|pavisam|kopējā\s+platība)\p{L}*\s*(?:(\d{1,2})\.?\s*stāv\p{L}*)?[^\d]*?(\d{1,6}[,.]\d{1,2})/iu;

export function roomsFromLines(pages: string[][]): RoomTable {
	const rows: RoomRow[] = [];
	const totals: RoomTable["totals"] = [];
	const unread: RoomTable["unread"] = [];
	let floor = "";
	pages.forEach((lines, pi) => {
		for (const raw of lines) {
			const line = raw.replace(/\s+$/, "");
			const flat = line.replace(/\s+/g, " ").trim();
			if (!flat) continue;
			const f = FLOOR.exec(flat);
			if (f && flat.length < 40) {
				floor = f[1] ?? f[2] ?? f[3].toLowerCase();
				continue;
			}
			const t = TOTAL.exec(flat);
			if (t) {
				totals.push({ floor: t[1] ?? (/kopējā|pavisam/i.test(flat) ? "*" : floor), area: num(t[2])!, page: pi + 1 });
				continue;
			}
			const m = ROW.exec(line.replace(/ {3,}/g, "  ")) ?? ROW.exec(flat);
			if (m) {
				rows.push({ floor, no: m[1], name: m[2].replace(/\s+/g, " ").trim(), area: num(m[3])!, height: m[4] ? num(m[4]) : null, page: pi + 1, quote: flat });
			} else if (floor && /^\d{1,4}[A-Za-z]?\s+\p{L}/u.test(flat) && /\d[,.]\d/.test(flat)) {
				unread.push({ page: pi + 1, line: flat });
			}
		}
	});
	return { rows, totals, unread };
}

/** Sum check: each stated floor total against the rows of that floor (to 0.05 m²). */
export function totalsCheck(t: RoomTable): { floor: string; stated: number; sum: number; ok: boolean }[] {
	return t.totals.map((x) => {
		const sum = Math.round(t.rows.filter((r) => x.floor === "*" || r.floor === x.floor).reduce((s, r) => s + r.area, 0) * 100) / 100;
		return { floor: x.floor, stated: x.area, sum, ok: Math.abs(sum - x.area) < 0.05 };
	});
}
