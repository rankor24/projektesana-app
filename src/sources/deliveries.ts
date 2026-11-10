// Deliveries (task 4.1): read from 01_Projektesana\1.4_Nodevumi\<KIND>\<YYMMDD>\… (the office standard: only what was
// submitted, dated the day of submission, files "<sheet no>_<title>"). Each date folder is one delivery; a kind folder
// with files and no date folder is one delivery without a date (the filenames check flags it).
// Planned dates come from the BIP grafiks (a table row naming the kind and a date) or are typed by the user.
import { readdir } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { dateInName, dateOfFolder, deliveryKindOf, stageOfDelivery } from "../core/stages.js";
import type { Delivery, DeliveryItem, DeliveryKind } from "../core/model.js";
import { isJunk } from "./roles.js";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function findDeliveriesDir(root: string): Promise<string | null> {
	try {
		const top = (await readdir(root, { withFileTypes: true })).find((d) => d.isDirectory() && /^01[\s_.-]*projekt/.test(norm(d.name)));
		if (!top) return null;
		const inner = (await readdir(join(root, top.name), { withFileTypes: true })).find((d) => d.isDirectory() && /^1\.4(?![.\d])/.test(d.name.trim()));
		return inner ? join(root, top.name, inner.name) : null;
	} catch {
		return null;
	}
}

const SHEET = /^([A-Z]{1,5}[A-Z0-9]{0,3}[-_ ]?\d+(?:[.\-]\d+)*[a-z]?)[_ ]+(.+)$/i;

export function itemOf(rel: string): DeliveryItem {
	const name = basename(rel, extname(rel));
	const m = SHEET.exec(name);
	return { sheetNo: m ? m[1] : null, title: (m ? m[2] : name).replace(/_/g, " ").trim(), file: rel, sha: null };
}

async function filesUnder(p: string, root: string, depth = 0): Promise<string[]> {
	if (depth > 6) return [];
	const out: string[] = [];
	for (const d of await readdir(p, { withFileTypes: true })) {
		const full = join(p, d.name);
		if (d.isDirectory() && !/^arh[iī]v/i.test(norm(d.name))) out.push(...(await filesUnder(full, root, depth + 1)));
		else if (d.isFile() && !isJunk(d.name)) out.push(relative(root, full));
	}
	return out.sort((a, b) => a.localeCompare(b, "lv", { numeric: true }));
}

export async function readDeliveries(root: string): Promise<Omit<Delivery, "stage">[]> {
	const dir = await findDeliveriesDir(root);
	if (!dir) return [];
	const out: Omit<Delivery, "stage">[] = [];
	const id = (...p: string[]) => `d_${p.join("_")}`.replace(/[^\p{L}\d_.-]+/gu, "_");
	const top = await readdir(dir, { withFileTypes: true });
	const rootFiles = top.filter((e) => e.isFile() && !isJunk(e.name));
	if (rootFiles.length) out.push({ id: id("1.4"), kind: "custom", label: "1.4 (faili bez mapes)", plannedDate: null, submittedDate: null, folder: relative(root, dir), items: rootFiles.map((e) => itemOf(relative(root, join(dir, e.name)))), checksRun: [] });
	for (const k of top) {
		if (!k.isDirectory() || /^arh[iī]v/i.test(norm(k.name))) continue;
		const kind = deliveryKindOf(k.name);
		const kindDir = join(dir, k.name);
		// the date in the kind folder's own name ("1.4.3_BP_260109"): the folder is one delivery
		const own = dateInName(k.name);
		if (own) {
			const items = (await filesUnder(kindDir, root)).map(itemOf);
			out.push({ id: id(kind, k.name), kind, label: k.name, plannedDate: null, submittedDate: own, folder: relative(root, kindDir), items, checksRun: [] });
			continue;
		}
		const entries = await readdir(kindDir, { withFileTypes: true });
		const dated = entries.filter((e) => e.isDirectory() && (dateOfFolder(e.name) ?? dateInName(e.name)) !== null);
		for (const e of dated) {
			const folder = join(kindDir, e.name);
			out.push({ id: id(kind, k.name, e.name), kind, label: `${k.name} ${e.name}`, plannedDate: null, submittedDate: (dateOfFolder(e.name) ?? dateInName(e.name))!, folder: relative(root, folder), items: (await filesUnder(folder, root)).map(itemOf), checksRun: [] });
		}
		// files or undated folders (sections like 01_VD, 02_SA) straight in the kind folder: one delivery without a date.
		// The folder template's empty "datums" placeholder is not a delivery.
		const loose = entries.filter((e) => (e.isFile() && !isJunk(e.name)) || (e.isDirectory() && !dated.includes(e) && !/^arh[iī]v/i.test(norm(e.name)) && norm(e.name) !== "datums"));
		if (loose.length) {
			const files: string[] = [];
			for (const e of loose) files.push(...(e.isFile() ? [relative(root, join(kindDir, e.name))] : await filesUnder(join(kindDir, e.name), root)));
			if (files.length) out.push({ id: `d_${kind}_${k.name}_bez_datuma`.replace(/[^\p{L}\d_.-]+/gu, "_"), kind, label: `${k.name} (bez datuma)`, plannedDate: null, submittedDate: null, folder: relative(root, kindDir), items: files.map(itemOf), checksRun: [] });
		}
	}
	return out;
}

/** Stage of each delivery, interim ones placed by their neighbours in time. */
export function withStages(list: Omit<Delivery, "stage">[]): Delivery[] {
	const sorted = [...list].sort((a, b) => (a.submittedDate ?? a.plannedDate ?? "9999").localeCompare(b.submittedDate ?? b.plannedDate ?? "9999"));
	return sorted.map((d, i) => {
		const before = sorted.slice(0, i).reverse().find((x) => x.kind !== "STARP" && x.kind !== "custom")?.kind;
		const after = sorted.slice(i + 1).find((x) => x.kind !== "STARP" && x.kind !== "custom")?.kind;
		return { ...d, stage: stageOfDelivery(d.kind, { before, after }) };
	});
}

/** BIP / grafiks rows that name a delivery kind and a date: "MBP iesniegšana … 01.02.2027". */
export function plannedFromSchedule(pages: string[]): { kind: DeliveryKind; date: string; quote: string; page: number }[] {
	const out: { kind: DeliveryKind; date: string; quote: string; page: number }[] = [];
	pages.forEach((p, i) => {
		for (const raw of p.split("\n")) {
			const line = raw.replace(/\s+/g, " ").trim();
			const k = /(skiču\s+projekt\p{L}*|skice|\bMBP\b|minimāl\p{L}*\s+sastāv|\bBP\b|būvprojekt\p{L}*|\bDT\b|darba\s+rasēj\p{L}*|starpnodevum\p{L}*)/iu.exec(line);
			const d = /(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})/.exec(line);
			if (!k || !d) continue;
			const iso = d[1] ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : `${d[4]}-${d[5]}-${d[6]}`;
			if (Number.isNaN(Date.parse(iso))) continue;
			const w = norm(k[1]);
			const kind: DeliveryKind = /skic/.test(w) ? "SKICE" : /mbp|minimal/.test(w) ? "MBP" : /starp/.test(w) ? "STARP" : /\bdt\b|darba/.test(w) ? "DT" : "BP";
			out.push({ kind, date: iso, quote: line, page: i + 1 });
		}
	});
	return out;
}

const sameFolder = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.replace(/[\\/]+/g, "/").toLowerCase() === b.replace(/[\\/]+/g, "/").toLowerCase();

/** Fresh read merged with what is stored: the user's planned dates, check runs and "sent" stay; planned-only rows stay until a
 *  real delivery of that kind exists, which then takes over the planned date. Drafts (7.1) stay as they are; a draft the user
 *  copied into 1.4 gives its id, checks, "sent" and draft record to the real folder's delivery, and its own row goes. */
export function mergeDeliveries(prev: Delivery[], read: Omit<Delivery, "stage">[], planned: { kind: DeliveryKind; date: string }[]): Delivery[] {
	const byId = new Map(prev.map((d) => [d.id, d]));
	const drafts = prev.filter((d) => d.draft);
	const real = read.map((d) => {
		const from = drafts.find((x) => sameFolder(x.draft!.copiedTo, d.folder));
		const p = from ?? byId.get(d.id);
		return { ...d, id: from ? from.id : d.id, ...(from ? { label: d.label, draft: from.draft } : {}), plannedDate: p?.plannedDate ?? null, plannedFrom: p?.plannedFrom, checksRun: p?.checksRun ?? [], sent: p?.sent };
	});
	const joined = new Set(real.filter((r) => r.draft).map((r) => r.id));
	const openDrafts = drafts.filter((x) => !joined.has(x.id));
	const plannedRows: Omit<Delivery, "stage">[] = [];
	for (const pl of planned) {
		if (openDrafts.some((x) => x.kind === pl.kind)) continue;
		const realOfKind = real.filter((r) => r.kind === pl.kind);
		const target = realOfKind.find((r) => !r.plannedDate);
		if (target) {
			target.plannedDate = pl.date;
			target.plannedFrom = "bip";
			continue;
		}
		// a real delivery of this kind already carries a planned date (the user's or the grafiks'): nothing more to add
		if (realOfKind.length) continue;
		const id = `plan_${pl.kind}_${pl.date}`;
		const p = byId.get(id);
		plannedRows.push({ id, kind: pl.kind, label: `${pl.kind} (plānots)`, plannedDate: p?.plannedDate ?? pl.date, plannedFrom: p?.plannedFrom ?? "bip", submittedDate: null, folder: null, items: [], checksRun: p?.checksRun ?? [] });
	}
	// planned rows the user typed themself stay
	for (const p of prev) if (p.id.startsWith("plan_") && p.plannedFrom === "user" && !plannedRows.some((x) => x.id === p.id) && !openDrafts.some((x) => x.kind === p.kind)) plannedRows.push(p);
	return withStages([...real, ...openDrafts, ...plannedRows]);
}
