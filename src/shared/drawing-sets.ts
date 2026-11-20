// Drawing sets (Versijas → Lapu izmaiņas): the PDF and DWG files of the project folder grouped by drawing, the way the Models
// tab lists IFC. A drawing is its name without the office revision suffix ("DUN8_AR_00001_02.pdf" → "dun8_ar_00001"); its PDFs
// form one version chain and its DWGs another (PDF is compared with PDF, DWG with DWG), and the two chains are checked against
// each other: the latest PDF should be the plot of the latest DWG. Also: which Revit file of the folder is the one open in Revit.
// Pure and node-free: main, the page and the tests use the same functions.
import type { ModelRow } from "./api.js";

/**
 * A document's name without its revision suffix, lower-cased: "DUN8_RA_TI_00001_02" → "dun8_ra_ti_00001". Only office-style
 * suffixes count (_01, _v2, -rev3, " (1)"); a sheet number like "AR-3" stays whole, so the sheets of one set never chain.
 */
export function seriesKey(title: string): string {
	const t = title.trim();
	const base = t.replace(/(?:_\d{2}|[ _-](?:v|ver|rev)\.?\s?\d{1,3}|\s?\(\d{1,2}\))$/i, "");
	return (base.length >= 3 ? base : t).toLowerCase();
}

/** The revision number in a name's suffix ("…_02" → 2, "…_v3" → 3); no suffix = 0 (the first issue). */
export function revOf(title: string): number {
	const m = /(?:_(\d{2})|[ _-](?:v|ver|rev)\.?\s?(\d{1,3})|\s?\((\d{1,2})\))$/i.exec(title.trim());
	return m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const extOf = (name: string) => /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

export type DrawingFile = ModelRow & { rev: number };

/** How the PDF chain and the DWG chain of one drawing agree. A name-and-date check: the drawings' content is not compared here. */
export type PdfDwgState = "sakrīt" | "tikai PDF" | "tikai DWG" | "versijas nesakrīt" | "DWG jaunāks";

export interface DrawingSet {
	key: string;
	/** the newest file's name without extension and suffix, as written */
	title: string;
	section: string | null;
	/** oldest first: by revision suffix, then by date */
	pdf: DrawingFile[];
	dwg: DrawingFile[];
	state: PdfDwgState;
	/** why the state is what it is, in words */
	why: string;
}

const byIssue = (a: DrawingFile, b: DrawingFile) => a.rev - b.rev || a.mtime.localeCompare(b.mtime) || a.name.localeCompare(b.name);
const revText = (f: DrawingFile) => (f.rev ? `_${String(f.rev).padStart(2, "0")}` : "bez sufiksa");
/** a DWG saved this long after its PDF was plotted counts as changed after the plot */
const PLOT_SLACK_MS = 60 * 60 * 1000;

export function pdfDwgState(pdf: DrawingFile[], dwg: DrawingFile[]): { state: PdfDwgState; why: string } {
	const p = pdf[pdf.length - 1];
	const d = dwg[dwg.length - 1];
	if (!d) return { state: "tikai PDF", why: "DWG ar šo nosaukumu projekta mapē nav." };
	if (!p) return { state: "tikai DWG", why: "PDF ar šo nosaukumu projekta mapē nav." };
	if (p.rev !== d.rev) return { state: "versijas nesakrīt", why: `jaunākais PDF ${revText(p)}, jaunākais DWG ${revText(d)}` };
	if (Date.parse(d.mtime) - Date.parse(p.mtime) > PLOT_SLACK_MS) return { state: "DWG jaunāks", why: `DWG saglabāts ${d.mtime.slice(0, 10)}, PDF izdrukāts ${p.mtime.slice(0, 10)}: PDF var nebūt izdrukāts no pēdējā DWG.` };
	return { state: "sakrīt", why: `abi ${revText(p)}` };
}

/** PDF and DWG files grouped by drawing; sets with something to compare or check come first, then by section and name. */
export function drawingSets(files: ModelRow[]): DrawingSet[] {
	const groups = new Map<string, { pdf: DrawingFile[]; dwg: DrawingFile[] }>();
	for (const f of files) {
		const ext = extOf(f.name);
		if (ext !== "pdf" && ext !== "dwg") continue;
		const key = seriesKey(stem(f.name));
		const g = groups.get(key) ?? { pdf: [], dwg: [] };
		g[ext].push({ ...f, rev: revOf(stem(f.name)) });
		groups.set(key, g);
	}
	const out: DrawingSet[] = [];
	for (const [key, g] of groups) {
		g.pdf.sort(byIssue);
		g.dwg.sort(byIssue);
		const newest = [...g.pdf, ...g.dwg].sort((a, b) => b.mtime.localeCompare(a.mtime))[0]!;
		const title = stem(newest.name).replace(/(?:_\d{2}|[ _-](?:v|ver|rev)\.?\s?\d{1,3}|\s?\(\d{1,2}\))$/i, "") || stem(newest.name);
		out.push({ key, title, section: newest.section, pdf: g.pdf, dwg: g.dwg, ...pdfDwgState(g.pdf, g.dwg) });
	}
	const weight = (s: DrawingSet) => (s.pdf.length > 1 || s.dwg.length > 1 ? 0 : 1);
	return out.sort((a, b) => weight(a) - weight(b) || (a.section ?? "").localeCompare(b.section ?? "", "lv", { numeric: true }) || a.title.localeCompare(b.title, "lv"));
}

/** The pair a version chain opens in the compare: the one before the newest against the newest; null with one file. */
export function lastPair(chain: DrawingFile[]): [DrawingFile, DrawingFile] | null {
	return chain.length > 1 ? [chain[chain.length - 2]!, chain[chain.length - 1]!] : null;
}

/** Revit's automatic backups ("Model.0003.rvt"): kept by Revit next to the model, not models of their own. */
export const isRevitBackup = (name: string) => /\.\d{4}\.rvt$/i.test(name);

const normPath = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
const normName = (n: string) => stem(n.split(/[\\/]/).pop() ?? n).toLowerCase();

/**
 * Which listed Revit file is the document open in Revit: "path" when Revit's path is that file, "name" when only the name
 * matches (a local copy of a central model, or the folder seen through another drive letter). Null when none matches.
 */
export function openRevitMatch(rows: { rel: string; name: string }[], root: string, doc: { title: string; path: string } | null): { rel: string; by: "path" | "name" } | null {
	if (!doc) return null;
	if (doc.path) {
		const want = normPath(doc.path);
		const hit = rows.find((r) => normPath(/^[a-z]:|^\\\\/i.test(r.rel) ? r.rel : `${root}\\${r.rel}`) === want);
		if (hit) return { rel: hit.rel, by: "path" };
	}
	const title = normName(doc.path || doc.title);
	const hit = rows.find((r) => normName(r.name) === title) ?? rows.find((r) => title.startsWith(`${normName(r.name)}_`));
	return hit ? { rel: hit.rel, by: "name" } : null;
}
