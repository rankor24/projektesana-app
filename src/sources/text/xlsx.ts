// XLSX cells. Carried from v1 src/main/files/text.ts xlsxText. Changed: sheet names come from workbook.xml (not "Sheet n"),
// and the cells are also returned as rows so tables (room lists, BIP grafiks) can be read without re-parsing text.
import { strFromU8, unzipSync } from "fflate";
import { unxml } from "./xml.js";

export interface XlsxSheet {
	name: string;
	/** row number (1-based) → column letter → value */
	rows: Map<number, Map<string, string>>;
}

const colIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

export function xlsxSheets(buf: Uint8Array): XlsxSheet[] {
	const files = unzipSync(buf, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
	const shared: string[] = [];
	const ss = files["xl/sharedStrings.xml"];
	if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")));
	// sheet file → sheet name through the workbook relationships
	const names = new Map<string, string>();
	const wb = files["xl/workbook.xml"];
	const rels = files["xl/_rels/workbook.xml.rels"];
	if (wb && rels) {
		const target = new Map<string, string>();
		for (const r of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
			const id = /Id="([^"]+)"/.exec(r[0])?.[1];
			const t = /Target="([^"]+)"/.exec(r[0])?.[1];
			if (id && t) target.set(id, `xl/${t.replace(/^\/?xl\//, "")}`);
		}
		for (const s of strFromU8(wb).matchAll(/<sheet\b[^>]*>/g)) {
			const name = /name="([^"]+)"/.exec(s[0])?.[1];
			const rid = /r:id="([^"]+)"/.exec(s[0])?.[1];
			if (name && rid && target.has(rid)) names.set(target.get(rid)!, unxml(name));
		}
	}
	const out: XlsxSheet[] = [];
	for (const file of Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
		const rows = new Map<number, Map<string, string>>();
		for (const c of strFromU8(files[file]).matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const body = c[4] ?? "";
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
			const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
			const val = /t="s"/.test(c[3]) ? shared[Number(v)] : inline !== undefined ? unxml(inline) : v !== undefined ? unxml(v) : undefined;
			if (val === undefined || val === "") continue;
			const r = Number(c[2]);
			if (!rows.has(r)) rows.set(r, new Map());
			rows.get(r)!.set(c[1], val);
		}
		out.push({ name: names.get(file) ?? file.match(/sheet(\d+)/)![0], rows });
	}
	return out;
}

/** Every sheet as tab-separated rows under a `# <sheet name>` line. */
export function xlsxText(buf: Uint8Array): string {
	return xlsxSheets(buf)
		.map((s) => {
			const lines = [...s.rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => {
				const cols = [...cells.keys()].sort((a, b) => colIndex(a) - colIndex(b));
				const width = colIndex(cols[cols.length - 1] ?? "A");
				const row: string[] = Array(width).fill("");
				for (const c of cols) row[colIndex(c) - 1] = cells.get(c)!;
				return row.join("\t").trimEnd();
			});
			return `# ${s.name}\n${lines.join("\n")}`;
		})
		.join("\n\n");
}
