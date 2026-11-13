// Word documents (task 8.13): an outline read in Node (no Word needed), and edits and PDF export through the installed Word
// (resources/office-word.ps1, one COM helper like office-text.ps1). Jobs run one at a time: sub-agents (8.15) may ask for several.
// When Word is absent the answer says so; the markdown writer (docx-md.ts) and the outline do not need it.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { officeHas } from "../text/office-com.js";
import { unxml } from "../text/xml.js";
import { validateOps, type OpInput } from "./word-ops.js";

// ---- outline ------------------------------------------------------------------------------------------------------------------

interface Node {
	name: string;
	attrs: Record<string, string>;
	kids: Node[];
	text: string;
}

/** A small XML reader for word/document.xml and styles.xml: elements, attributes and the text of w:t (and tabs / breaks). */
function parseXml(xml: string): Node {
	const root: Node = { name: "#root", attrs: {}, kids: [], text: "" };
	const stack = [root];
	const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
	for (let m = re.exec(xml); m; m = re.exec(xml)) {
		const top = stack[stack.length - 1];
		if (m[5] !== undefined) {
			top.text += m[5];
			continue;
		}
		if (m[1]) {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const attrs: Record<string, string> = {};
		for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = unxml(a[2]);
		const n: Node = { name: m[2], attrs, kids: [], text: "" };
		top.kids.push(n);
		if (!m[4]) stack.push(n);
	}
	return root;
}

const find = (n: Node, name: string): Node | undefined => n.kids.find((k) => k.name === name);
const walk = (n: Node, f: (x: Node) => void) => {
	f(n);
	for (const k of n.kids) walk(k, f);
};

/** The visible text of a paragraph or cell node (tabs and breaks as a tab / space, paragraphs of a cell joined with a space). */
function textOf(n: Node): string {
	if (n.name === "w:p") {
		let s = "";
		const addRuns = (x: Node) => {
			for (const k of x.kids) {
				if (k.name === "w:t") s += unxml(k.text);
				else if (k.name === "w:tab") s += "\t";
				else if (k.name === "w:br" || k.name === "w:cr") s += " ";
				else if (k.name !== "w:pPr" && k.name !== "w:rPr" && k.name !== "w:tbl") addRuns(k);
			}
		};
		addRuns(n);
		return s;
	}
	return n.kids.map(textOf).filter((t) => t !== "").join(n.name === "w:tc" ? " " : "");
}

export interface OutlineItem {
	/** position in body order (paragraphs and tables together) */
	i: number;
	kind: "p" | "table";
	text?: string;
	style?: string;
	/** heading level (Heading 1 / Virsraksts 1 → 1) */
	level?: number;
	/** tables: the 0-based index the ops use */
	table?: number;
	rows?: number;
	cols?: number;
	header?: string[];
	firstCol?: string[];
	/** with `find`: the rows that contain it */
	matchingRows?: number[];
}

export interface Outline {
	items: OutlineItem[];
	tables: number;
	paragraphs: number;
	truncated: boolean;
}

export function docxOutline(buf: Uint8Array, opts: { find?: string; max?: number } = {}): Outline {
	const files = unzipSync(buf, { filter: (f) => f.name === "word/document.xml" || f.name === "word/styles.xml" });
	const docXml = files["word/document.xml"];
	if (!docXml) throw new Error("DOCX bez word/document.xml.");
	const styleName = new Map<string, string>();
	if (files["word/styles.xml"]) {
		walk(parseXml(strFromU8(files["word/styles.xml"])), (n) => {
			if (n.name === "w:style" && n.attrs["w:styleId"]) styleName.set(n.attrs["w:styleId"], find(n, "w:name")?.attrs["w:val"] ?? n.attrs["w:styleId"]);
		});
	}
	const body = find(find(parseXml(strFromU8(docXml)), "w:document") ?? { kids: [] } as unknown as Node, "w:body");
	if (!body) throw new Error("DOCX bez teksta daļas.");
	const max = opts.max ?? 200;
	const key = opts.find;
	const items: OutlineItem[] = [];
	let tables = 0;
	let paragraphs = 0;
	let truncated = false;
	let i = 0;
	for (const n of body.kids) {
		if (n.name !== "w:p" && n.name !== "w:tbl") continue;
		const at = i++;
		if (n.name === "w:p") {
			paragraphs++;
			const text = textOf(n).trim();
			if (!text) continue;
			if (key && !text.includes(key)) continue;
			const ppr = find(n, "w:pPr");
			const id = find(ppr ?? ({ kids: [] } as unknown as Node), "w:pStyle")?.attrs["w:val"];
			const style = id ? (styleName.get(id) ?? id) : "Normal";
			const hm = /^(?:heading|virsraksts)\s*(\d)$/i.exec(style) ?? (/^(?:title|nosaukums)$/i.test(style) ? [style, "0"] : null);
			const ol = find(ppr ?? ({ kids: [] } as unknown as Node), "w:outlineLvl")?.attrs["w:val"];
			const level = hm ? Number(hm[1]) : ol !== undefined && ol !== "9" ? Number(ol) + 1 : undefined;
			if (items.length >= max) {
				truncated = true;
				continue;
			}
			items.push({ i: at, kind: "p", text: text.length > 240 ? `${text.slice(0, 237)}…` : text, style, ...(level !== undefined ? { level } : {}) });
			continue;
		}
		const idx = tables++;
		const rows = n.kids.filter((k) => k.name === "w:tr").map((tr) => tr.kids.filter((k) => k.name === "w:tc").map((tc) => textOf(tc).trim()));
		const matching = key ? rows.flatMap((r, ri) => (r.some((c) => c.includes(key)) ? [ri] : [])) : [];
		if (key && !matching.length) continue;
		if (items.length >= max) {
			truncated = true;
			continue;
		}
		items.push({
			i: at,
			kind: "table",
			table: idx,
			rows: rows.length,
			cols: Math.max(0, ...rows.map((r) => r.length)),
			header: (rows[0] ?? []).map((c) => c.slice(0, 40)),
			firstCol: rows.slice(0, 12).map((r) => (r[0] ?? "").slice(0, 30)),
			...(key ? { matchingRows: matching } : {}),
		});
	}
	return { items, tables, paragraphs, truncated };
}

/** The outline as the lines the agent reads. */
export function outlineText(o: Outline, name: string): string {
	const lines = o.items.map((it) => {
		if (it.kind === "table") return `[${it.i}] TABULA ${it.table} (${it.rows}×${it.cols}) galvene: ${it.header?.join(" | ")}; pirmā kolonna: ${it.firstCol?.join(", ")}${it.matchingRows?.length ? `; rindas ar atrasto: ${it.matchingRows.join(", ")}` : ""}`;
		return `[${it.i}] ${it.level !== undefined ? `H${it.level}` : it.style && it.style !== "Normal" ? it.style : "p"}: ${it.text}`;
	});
	return `${name}: ${o.paragraphs} rindkopas, ${o.tables} tabulas${o.truncated ? " (saraksts saīsināts: izmanto find)" : ""}\n${lines.join("\n")}`;
}

// ---- Word ---------------------------------------------------------------------------------------------------------------------

export interface WordResult {
	ok: boolean;
	saved?: boolean;
	reason?: string;
	/** apply: the op that failed (1-based) */
	op?: number;
	kind?: string;
	done?: { op: number; kind: string; matched: number }[];
	out?: string;
}

let queue: Promise<unknown> = Promise.resolve();

function runScript(script: string, args: string[], timeoutMs: number): Promise<WordResult> {
	return new Promise((resolve) => {
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
			if (err && !stdout) return resolve({ ok: false, reason: `Word palīgs: ${err.message} ${stderr}`.trim() });
			const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith("{"));
			if (!line) return resolve({ ok: false, reason: `Word palīgs neatbildēja: ${stdout.slice(0, 300) || "(tukšs)"}` });
			try {
				resolve(JSON.parse(line) as WordResult);
			} catch {
				resolve({ ok: false, reason: `Word palīgs atbildēja ne JSON: ${line.slice(0, 300)}` });
			}
		});
	});
}

async function word(script: string, args: string[], timeoutMs = 180_000): Promise<WordResult> {
	if (!existsSync(script)) return { ok: false, reason: `Word palīgs nav atrasts: ${script}` };
	if (!(await officeHas("doc"))) return { ok: false, reason: "Word.Application nav instalēts: Word dokumentu labošanai un PDF eksportam vajag Microsoft Word." };
	const job = queue.then(() => runScript(script, args, timeoutMs));
	queue = job.catch(() => undefined);
	return job;
}

/** Edits a .docx with the ops, all or nothing. `out` equal to `src` edits in place (the caller has made a copy to go back to). */
export async function applyDocxOps(script: string, src: string, out: string, ops: OpInput[], opts: { dryRun?: boolean; workDir: string }): Promise<WordResult> {
	const v = validateOps(ops);
	if (!v.ok) return { ok: false, reason: v.errors.join("; ") };
	mkdirSync(opts.workDir, { recursive: true });
	const file = join(opts.workDir, `ops-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
	writeFileSync(file, JSON.stringify(v.ops), "utf8");
	mkdirSync(dirname(out), { recursive: true });
	try {
		return await word(script, ["-Mode", "apply", "-Path", src, "-Out", out, "-OpsFile", file, ...(opts.dryRun ? ["-DryRun"] : [])]);
	} finally {
		rmSync(file, { force: true });
	}
}

/** A PDF of a .docx. */
export function docxToPdf(script: string, src: string, out: string): Promise<WordResult> {
	return word(script, ["-Mode", "pdf", "-Path", src, "-Out", out]);
}

/** Convenience: a copy of a file (so the original of an edit stays as it was). */
export function copyTo(src: string, dst: string): void {
	mkdirSync(dirname(dst), { recursive: true });
	copyFileSync(src, dst);
}

export const readDocx = (p: string) => new Uint8Array(readFileSync(p));
