// The edit ops for a Word document (task 8.13), validated in Node before Word is started. The ops are those of BIM Crew's
// core/docx_edit.py (replace, insert_after, append_text, set_cell, add_row, delete_row, delete_paragraph); they run through Word
// itself (resources/office-word.ps1), so a regular expression is not one of them (Word has wildcards, not regex) and a
// replacement is plain text. Pure and node-free: what reaches Word is a list this file has already checked.
import { z } from "zod";

export const OP_NAMES = ["replace", "insert_after", "append_text", "set_cell", "add_row", "delete_row", "delete_paragraph"] as const;
export type OpName = (typeof OP_NAMES)[number];

/** One op as an agent writes it: a flat object, the fields each op uses are named in the description. */
export const opInput = z.object({
	op: z.enum(OP_NAMES),
	find: z.string().optional().describe("replace: text to find (max 255 characters)"),
	replace: z.string().optional().describe("replace: the new text (default empty = delete the match)"),
	match_case: z.boolean().optional().describe("replace: default true"),
	count: z.number().int().min(0).optional().describe("replace: at most this many (0 or none = all)"),
	headers: z.boolean().optional().describe("replace: also headers, footers, text boxes (default true)"),
	anchor: z.string().optional().describe("insert_after / append_text / delete_paragraph: text the target paragraph contains (max 255 characters)"),
	occurrence: z.number().int().min(1).optional().describe("which paragraph with the anchor, 1-based (default 1)"),
	all: z.boolean().optional().describe("every paragraph with the anchor"),
	text: z.string().optional().describe("insert_after / append_text / set_cell: the new text; a new line starts a new paragraph"),
	style: z.string().optional().describe("insert_after: a paragraph style that exists in the document"),
	color: z.string().optional().describe("blue, red, dark red, green, orange, purple, black or a hex like 0070C0"),
	bold: z.boolean().optional(),
	italic: z.boolean().optional(),
	keep_numbering: z.boolean().optional().describe("insert_after: keep the anchor's list numbering (default false)"),
	table: z.number().int().min(0).optional().describe("0-based table index, as docx_outline numbers them"),
	table_match: z.string().optional().describe("the first table that contains this text"),
	row: z.number().int().min(0).optional().describe("0-based row (0 = the first row)"),
	row_match: z.string().optional().describe("the row that has a cell with this text; without table / table_match it also picks the table"),
	exact: z.boolean().optional().describe("row_match must equal a whole cell (codes: A1 and A10)"),
	col: z.number().int().min(0).optional().describe("set_cell: 0-based column"),
	col_match: z.string().optional().describe("set_cell: the column whose first-row cell contains this text"),
	cells: z.array(z.string()).optional().describe("add_row: the values, left to right"),
	after_row: z.number().int().min(0).optional().describe("add_row: insert after this 0-based row (default: at the end)"),
});
export type OpInput = z.infer<typeof opInput>;

export interface WordOp extends Record<string, unknown> {
	op: OpName;
}

const COLORS: Record<string, string> = { blue: "0070C0", red: "FF0000", "dark red": "C00000", green: "00B050", orange: "FFC000", purple: "7030A0", black: "000000" };

export function hexColor(c: string): string | null {
	const k = c.trim().toLowerCase();
	const h = COLORS[k] ?? k.replace(/^#/, "");
	return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : null;
}

const MAX_FIND = 255;

/** Checks every op and returns the ones Word will get (defaults filled, colours as hex), or one message per bad op. */
export function validateOps(raw: OpInput[]): { ok: true; ops: WordOp[] } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const ops: WordOp[] = [];
	if (!raw.length) return { ok: false, errors: ["nav nevienas darbības (ops ir tukšs)"] };
	raw.forEach((o, i) => {
		const bad = (m: string) => errors.push(`op ${i + 1} (${o.op}): ${m}`);
		const out: WordOp = { op: o.op };
		const need = (k: keyof OpInput, what = k as string) => {
			const v = o[k];
			if (v === undefined || v === "") {
				bad(`trūkst ${what}`);
				return false;
			}
			return true;
		};
		const colour = () => {
			if (o.color === undefined) return;
			const h = hexColor(o.color);
			if (!h) bad(`nezināma krāsa “${o.color}”: ${Object.keys(COLORS).join(", ")} vai hex 0070C0`);
			else out.color = h;
		};
		const anchorOp = () => {
			if (!need("anchor")) return;
			if (o.anchor!.length > MAX_FIND) bad(`anchor ir garāks par ${MAX_FIND} rakstzīmēm (Word to nemeklē)`);
			out.anchor = o.anchor;
			if (o.all) out.all = true;
			else out.occurrence = o.occurrence ?? 1;
		};
		const tableSel = (allowRowMatch: boolean) => {
			if (o.table === undefined && !o.table_match && !(allowRowMatch && o.row_match)) bad(allowRowMatch ? "norādi table, table_match vai row_match" : "norādi table vai table_match");
			if (o.table !== undefined) out.table = o.table;
			if (o.table_match) out.table_match = o.table_match;
		};
		const rowSel = () => {
			if (o.row === undefined && !o.row_match) bad("norādi row vai row_match");
			if (o.row !== undefined) out.row = o.row;
			if (o.row_match) out.row_match = o.row_match;
			if (o.exact) out.exact = true;
		};
		switch (o.op) {
			case "replace":
				if (need("find")) {
					if (o.find!.length > MAX_FIND) bad(`find ir garāks par ${MAX_FIND} rakstzīmēm (Word to nemeklē)`);
					out.find = o.find;
				}
				out.replace = o.replace ?? "";
				out.match_case = o.match_case ?? true;
				out.count = o.count ?? 0;
				out.headers = o.headers ?? true;
				if (o.find !== undefined && o.find === o.replace) bad("find un replace ir vienādi: nekas nemainītos");
				break;
			case "insert_after":
				anchorOp();
				if (o.text === undefined) bad("trūkst text");
				out.text = o.text ?? "";
				if (o.style) out.style = o.style;
				colour();
				if (o.bold !== undefined) out.bold = o.bold;
				if (o.italic !== undefined) out.italic = o.italic;
				if (o.keep_numbering) out.keep_numbering = true;
				break;
			case "append_text":
				anchorOp();
				if (o.text === undefined) bad("trūkst text");
				if (o.text?.includes("\n")) bad("append_text pievieno tekstu tajā pašā rindkopā: jaunai rindkopai izmanto insert_after");
				out.text = o.text ?? "";
				colour();
				if (o.bold !== undefined) out.bold = o.bold;
				if (o.italic !== undefined) out.italic = o.italic;
				break;
			case "set_cell":
				tableSel(true);
				rowSel();
				if (o.col === undefined && !o.col_match) bad("norādi col vai col_match");
				if (o.col !== undefined) out.col = o.col;
				if (o.col_match) out.col_match = o.col_match;
				if (o.text === undefined) bad("trūkst text");
				out.text = o.text ?? "";
				colour();
				break;
			case "add_row":
				tableSel(false);
				if (!o.cells?.length) bad("trūkst cells");
				out.cells = o.cells ?? [];
				if (o.after_row !== undefined) out.after_row = o.after_row;
				break;
			case "delete_row":
				tableSel(true);
				rowSel();
				break;
			case "delete_paragraph":
				anchorOp();
				break;
		}
		ops.push(out);
	});
	return errors.length ? { ok: false, errors } : { ok: true, ops };
}
