// What a coding agent has beyond reading and writing text, for the design workstation (2026-11-25: "it should have all tools you have as an agent"):
//   view_image       a picture the model looks at: a photo or scan, a PDF page, a DWG/DXF sheet; optionally ONE PART of it at a higher zoom (region)
//   archive_list / archive_extract   zip, gz, tar, tgz natively; 7z, rar, xz, bz2, cab, iso … through 7-Zip when it is installed
//   convert_file     images (TIFF, BMP, GIF, EMF … → PNG/JPG), PDF pages → PNG, DWG/DXF → PDF/SVG/PNG/DXF/DWG, Word → PDF, Office ↔ Office through LibreOffice, XLSX ↔ CSV
//   write_spreadsheet  an .xlsx with formulas (cost estimates, load tables, room reconciliation); the totals are computed and checked before it is saved
//   cad_describe / cad_objects / pointcloud_info   what is IN a DWG or DXF (layers, blocks, sheets, text, dimensions, areas, lengths) and the header of a LAS/LAZ cloud:
//                     CadCraft's own headless modules (agent/cad-headless.ts), which the app only used to show and compare drawings before
// Reading and viewing are `read`. Converting, extracting and the spreadsheet are `run`: they write only NEW files, into the delivery's staging (spreadsheet) or the app's own
// agent-work folder (the rest), never over a file and never into the office folders; a result is never copied into the office folders by an agent (read-only for agents; the user copies to 1.4_Nodevumi).
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { docxToPdf } from "../../sources/export/word.js";
import { writeXlsx, type Cell } from "../../sources/export/xlsx.js";
import { evaluateWorkbook } from "../../sources/export/xlsx-formula.js";
import { xlsxSheets } from "../../sources/text/xlsx.js";
import { activeDraft, refreshDraft, safeName, stagedPath } from "../../sources/staging.js";
import { uiResult } from "../../shared/ui-instruction.js";
import * as cad from "../cad-headless.js";
import { GDI_IMAGE, NATIVE_IMAGE, OFFICE_EXT, cleanName, convertImage, extractArchive, listArchive, sofficeConvert, uniquePath, workDirOf } from "../media.js";
import { abs } from "./general.js";
import { bridge, type ImageResult } from "./app.js";
import { storeOf, type ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const cadDir = (ctx: ToolCtx): string => {
	if (!ctx.skillsDir) throw new Error("CadCraft mape nav zināma (skillsDir nav iestatīts).");
	return join(dirname(ctx.skillsDir), "cadcraft", "app");
};
const wordScript = (ctx: ToolCtx): string => join(dirname(ctx.skillsDir ?? ""), "office-word.ps1");

const existing = (ctx: ToolCtx, p: string): string => {
	const f = abs(ctx, p);
	if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`Faila nav: ${f}`);
	return f;
};

// ---- drawings: one open drawing per process, so a few questions about the same sheet read it once ------------------------------------------
const CACHE_MAX = 3;
const open = new Map<string, Promise<cad.CadDrawing>>();
function drawing(ctx: ToolCtx, file: string): Promise<cad.CadDrawing> {
	const key = `${file}|${statSync(file).mtimeMs}|${statSync(file).size}`;
	let d = open.get(key);
	if (!d) {
		d = cad.openDrawing(cadDir(ctx), new Uint8Array(readFileSync(file)), basename(file));
		open.set(key, d);
		d.catch(() => open.delete(key));
		while (open.size > CACHE_MAX) open.delete(open.keys().next().value as string);
	}
	return d;
}

const regionShape = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).describe("a part of the picture as fractions 0..1 from its top left corner: {x: 0.5, y: 0, w: 0.5, h: 0.5} is the top right quarter");

const CAD = new Set([".dwg", ".dxf"]);
const plotShape = {
	layout: z.string().optional().describe("a sheet (layout) name from cad_describe; omitted = the model space"),
	area: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).optional().describe("model space only: a window in drawing units; omitted = the whole drawing"),
	paper: z.string().optional().describe("model space: paper size key, default iso-a3"),
};

/** A drawing's sheet as a PDF file in the work folder (for view_image and convert_file). */
async function plotToPdf(ctx: ToolCtx, file: string, a: { layout?: string; area?: { minX: number; minY: number; maxX: number; maxY: number }; paper?: string }, outName?: string): Promise<{ path: string; sheet: unknown }> {
	const d = await drawing(ctx, file);
	const r = await cad.plotPdf(d, { ...(a.layout ? { layout: a.layout } : {}), ...(a.area ? { area: a.area } : {}), ...(a.paper ? { paper: a.paper } : {}) });
	const out = uniquePath(workDirOf(ctx.appDir, ctx.projectId), cleanName(outName ?? `${basename(file, extname(file))}${a.layout ? ` – ${a.layout}` : ""}.pdf`));
	writeFileSync(out, r.bytes);
	return { path: out, sheet: r.sheet };
}

/** The result as the tools server sends images: text and an image block. */
async function show(ctx: ToolCtx, path: string, o: { page?: number; scale?: number; region?: unknown }, label: string): Promise<ImageResult> {
	const r = await bridge(ctx, "/image", { path, page: o.page, scale: o.scale, region: o.region });
	const bits = [label, `${r.width}×${r.height}`, r.page ? `lapa ${r.page}` : "", r.note ? String(r.note) : ""].filter(Boolean);
	return { __image: { data: String(r.image), mimeType: String(r.mimeType) }, text: bits.join(" · ") };
}

export const mediaTools: ToolDef[] = [
	tool({
		name: "view_image",
		level: "read",
		description:
			"Look at a picture yourself: a photo or scan (PNG, JPG, WebP, and GIF, BMP, TIFF, ICO, EMF, WMF, converted for you), a page of a PDF (page), or a DWG / DXF drawing (its model or one sheet: layout, area). Add region to ZOOM into one part (fractions 0..1 from the top left), e.g. a stamp, a room tag or a corner of a big sheet: a part comes out much sharper than the whole page. A relative path is under the open project's folder. Read what you see; say what you cannot read.",
		input: { path: z.string(), page: z.number().int().min(1).optional(), scale: z.number().min(1).max(8).optional().describe("PDF: 2 for a whole page (default), 4 for a region (default)"), region: regionShape.optional(), ...plotShape },
		run: async (ctx, a): Promise<ImageResult> => {
			const f = existing(ctx, a.path);
			const ext = extname(f).toLowerCase();
			if (NATIVE_IMAGE.has(ext) || ext === ".pdf") return show(ctx, f, a, basename(f));
			if (GDI_IMAGE.has(ext)) {
				const png = uniquePath(workDirOf(ctx.appDir, ctx.projectId), cleanName(`${basename(f, ext)}.png`));
				await convertImage(f, png, "png");
				return show(ctx, png, a, `${basename(f)} (pārveidots uz PNG)`);
			}
			if (CAD.has(ext)) {
				const p = await plotToPdf(ctx, f, a);
				return show(ctx, p.path, { page: 1, scale: a.scale, region: a.region }, `${basename(f)}${a.layout ? ` · lapa ${a.layout}` : ""} (zīmējums kā PDF: ${p.path})`);
			}
			throw new Error(`${ext || "Fails bez paplašinājuma"}: view_image rāda attēlus (png, jpg, webp, gif, bmp, tif, ico, emf, wmf), PDF un DWG/DXF. Citus failus: convert_file vai read_file.`);
		},
	}),
	tool({
		name: "archive_list",
		level: "read",
		description: "List what is inside an archive without unpacking it: .zip, .gz, .tar, .tgz (built in); .7z, .rar, .xz, .bz2, .cab, .iso and more when 7-Zip is installed. Up to 500 entries are shown (the total is given).",
		input: { path: z.string() },
		run: async (ctx, a) => {
			const f = existing(ctx, a.path);
			const r = await listArchive(f);
			const shown = r.entries.slice(0, 500);
			return { archive: f, kind: r.kind, entries: r.entries.length, files: r.entries.filter((e) => !e.dir).length, bytes: r.entries.reduce((n, e) => n + e.size, 0), list: shown.map((e) => (e.dir ? `${e.name}` : `${e.name}  ${e.size}`)), ...(r.entries.length > 500 ? { note: `rādīti pirmie 500 no ${r.entries.length}` } : {}) };
		},
	}),
	tool({
		name: "archive_extract",
		level: "run",
		description:
			"Unpack an archive into a NEW folder of the app's agent-work area (never into the project, never over anything): all of it, or only the entries named (archive_list shows the names). Then read the files with read_file, view_image, cad_describe; what should go into the project, the user copies himself (an agent may not write into the office folders). Refuses paths that leave the folder and archives of more than 100 000 files or 4 GB.",
		input: { path: z.string(), entries: z.array(z.string()).optional() },
		run: async (ctx, a) => {
			const f = existing(ctx, a.path);
			const out = uniquePath(workDirOf(ctx.appDir, ctx.projectId), cleanName(basename(f).replace(/\.(tar\.gz|tgz|tar|zip|gz|7z|rar|xz|bz2|cab|iso)$/i, "") || "arhivs"));
			const r = await extractArchive(f, out, a.entries);
			return { ok: true, folder: out, kind: r.kind, files: r.files, bytes: r.bytes, ...(r.skipped.length ? { skipped: r.skipped.slice(0, 20) } : {}), note: "Izpakots jaunā mapē; sākotnējais arhīvs nav mainīts." };
		},
	}),
	tool({
		name: "convert_file",
		level: "run",
		description:
			"Turn a file into another format, as a NEW file in the app's agent-work folder (the original is untouched). Supported: images (png, jpg, gif, bmp, tif, ico, emf, wmf) → png | jpg; pdf → png (pages: '1', '2-4', 'all'; up to 30; scale); dwg | dxf → pdf | svg | png | dxf | dwg (layout, area, paper as in view_image); docx → pdf (Word, else LibreOffice); doc, rtf, odt, xls, ods, ppt, pptx, odp, docx, xlsx → pdf | docx | xlsx | pptx | odt | csv through LibreOffice when installed; xlsx → csv (sheet: name or number); csv → xlsx. Returns the files. Say what is not supported rather than guessing.",
		input: { path: z.string(), to: z.string().describe("target extension: png, jpg, pdf, svg, dxf, dwg, docx, xlsx, pptx, odt, csv"), pages: z.string().optional(), scale: z.number().min(1).max(4).optional(), sheet: z.string().optional(), ...plotShape },
		run: async (ctx, a) => {
			const src = existing(ctx, a.path);
			const ext = extname(src).toLowerCase();
			const to = a.to.toLowerCase().replace(/^\./, "").replace("jpeg", "jpg");
			const dir = workDirOf(ctx.appDir, ctx.projectId);
			const base = cleanName(basename(src, ext));
			const done = (files: string[], note?: string) => ({ ok: true, files, ...(note ? { note } : {}), note2: "Jauns fails agent-work mapē; uz projekta mapi to nokopē lietotājs (aģents projekta mapē neraksta)." });

			if ((GDI_IMAGE.has(ext) || NATIVE_IMAGE.has(ext)) && (to === "png" || to === "jpg")) {
				const out = uniquePath(dir, `${base}.${to}`);
				await convertImage(src, out, to);
				return done([out]);
			}
			if (ext === ".pdf" && to === "png") {
				const m = /^(\d+)(?:-(\d+))?$/.exec((a.pages ?? "1").trim());
				const all = (a.pages ?? "").trim().toLowerCase() === "all";
				if (!m && !all) throw new Error("pages: '1', '2-4' vai 'all'.");
				const first = all ? 1 : Number(m![1]);
				const last = all ? first + 29 : Number(m![2] ?? m![1]);
				if (last < first || last - first >= 30) throw new Error("Vienā reizē līdz 30 lapām.");
				const files: string[] = [];
				for (let p = first; p <= last; p++) {
					let r: Record<string, unknown>;
					try {
						r = await bridge(ctx, "/image", { path: src, page: p, scale: a.scale ?? 2 });
					} catch (e) {
						if (all && files.length) break; // 'all' stops at the last page
						throw e;
					}
					const out = uniquePath(dir, `${base}-${p}.png`);
					writeFileSync(out, Buffer.from(String(r.image), "base64"));
					files.push(out);
				}
				return done(files);
			}
			if (CAD.has(ext)) {
				if (to === "pdf") return done([(await plotToPdf(ctx, src, a, `${base}.pdf`)).path]);
				if (to === "svg") {
					const d = await drawing(ctx, src);
					const r = await cad.plotSvg(d, { ...(a.layout ? { layout: a.layout } : {}), ...(a.area ? { area: a.area } : {}), ...(a.paper ? { paper: a.paper } : {}) });
					const out = uniquePath(dir, `${base}.svg`);
					writeFileSync(out, r.bytes);
					return done([out]);
				}
				if (to === "png") {
					const p = await plotToPdf(ctx, src, a, `${base}.pdf`);
					const r = await bridge(ctx, "/image", { path: p.path, page: 1, scale: a.scale ?? 3 });
					const out = uniquePath(dir, `${base}.png`);
					writeFileSync(out, Buffer.from(String(r.image), "base64"));
					return done([out], `PDF: ${p.path}`);
				}
				if (to === "dxf" || to === "dwg") {
					if (to === ext.slice(1)) throw new Error(`Fails jau ir ${to}.`);
					const d = await drawing(ctx, src);
					const out = uniquePath(dir, `${base}.${to}`);
					writeFileSync(out, await cad.saveAs(d, to));
					return done([out], to === "dwg" ? "DWG (AutoCAD 2000 formāts), ko raksta CadCraft: pārbaudi atverot." : "DXF 2000, ko raksta CadCraft: pārbaudi atverot.");
				}
			}
			if (ext === ".xlsx" && to === "csv") {
				const sheets = xlsxSheets(new Uint8Array(readFileSync(src)));
				const s = a.sheet ? (sheets.find((x) => x.name.toLowerCase() === a.sheet!.toLowerCase()) ?? sheets[Number(a.sheet) - 1]) : sheets[0];
				if (!s) throw new Error(`Lapas nav. Ir: ${sheets.map((x) => x.name).join(", ")}.`);
				const col = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
				const q = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
				const rows = [...s.rows.entries()].sort((x, y) => x[0] - y[0]);
				const width = Math.max(1, ...rows.flatMap(([, c]) => [...c.keys()].map(col)));
				// rows keep their numbers: a blank row stays a blank line, so a line number is the sheet's row number
				const lines: string[] = [];
				for (const [r, cells] of rows) {
					while (lines.length < r - 1) lines.push("");
					lines.push(Array.from({ length: width }, (_, i) => q([...cells.entries()].find(([k]) => col(k) === i + 1)?.[1] ?? "")).join(";"));
				}
				const out = uniquePath(dir, `${base}${sheets.length > 1 ? ` - ${cleanName(s.name)}` : ""}.csv`);
				writeFileSync(out, `﻿${lines.join("\r\n")}\r\n`, "utf8");
				return done([out], "Atdalītājs ir semikols (latviešu Excel).");
			}
			if (ext === ".csv" && to === "xlsx") {
				const text = readFileSync(src, "utf8").replace(/^﻿/, "");
				const delim = (text.split(/\r?\n/, 1)[0] ?? "").split(";").length >= (text.split(/\r?\n/, 1)[0] ?? "").split(",").length ? ";" : ",";
				const rows: Cell[][] = [];
				let row: string[] = [];
				let cell = "";
				let inq = false;
				for (let i = 0; i < text.length; i++) {
					const ch = text[i]!;
					if (inq) {
						if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
						else if (ch === '"') inq = false;
						else cell += ch;
					} else if (ch === '"') inq = true;
					else if (ch === delim) (row.push(cell), (cell = ""));
					else if (ch === "\n" || ch === "\r") {
						if (ch === "\r" && text[i + 1] === "\n") i++;
						row.push(cell);
						rows.push(row.map((c) => (c.trim() !== "" && /^-?\d+([.,]\d+)?$/.test(c.trim()) ? Number(c.trim().replace(",", ".")) : c)));
						row = [];
						cell = "";
					} else cell += ch;
				}
				if (cell !== "" || row.length) (row.push(cell), rows.push(row));
				const out = uniquePath(dir, `${base}.xlsx`);
				writeFileSync(out, writeXlsx([{ name: "Lapa1", rows }]));
				return done([out]);
			}
			if (ext === ".docx" && to === "pdf") {
				const out = uniquePath(dir, `${base}.pdf`);
				const r = await docxToPdf(wordScript(ctx), src, out, ctx.appDir);
				if (r.ok && existsSync(out)) return done([out], "caur Word");
				return done([await sofficeConvert(src, dir, "pdf", ctx.appDir)], `caur LibreOffice (Word: ${r.reason ?? "nav"})`);
			}
			if (OFFICE_EXT.has(ext) && ["pdf", "docx", "xlsx", "pptx", "odt", "csv"].includes(to)) return done([await sofficeConvert(src, dir, to, ctx.appDir)], "caur LibreOffice");
			throw new Error(`Pārveidojums ${ext || "?"} → ${to} nav atbalstīts. Atbalstīts: attēli → png/jpg; pdf → png; dwg/dxf → pdf/svg/png/dxf/dwg; docx → pdf; Office → pdf/docx/xlsx/pptx/odt/csv (LibreOffice); xlsx ↔ csv. Citu formātu vari izmēģināt ar run_command (lietotājs apstiprina).`);
		},
	}),
	tool({
		name: "write_spreadsheet",
		level: "run",
		description:
			"Write a NEW .xlsx workbook with formulas (cost estimates, load tables, room reconciliation, quantity lists) into the delivery's staging (or the agent-work folder when no delivery is open). A text cell that starts with = is a formula: =SUM(D2:D9), =B2*C2, =ROUND(E2*1.21;2), =IF(F2>0;E2/F2;0), other-sheet refs ('Sheet 2'!A1). Supported: SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT ROUND ROUNDUP ROUNDDOWN INT ABS SQRT POWER MOD IF AND OR NOT SUMPRODUCT IFERROR. Every formula is COMPUTED here and the results are returned: check the totals against what you expect. A formula that divides by zero, loops or points at nothing is refused (nothing is saved). The first row of a sheet is a bold header unless header is false. Never overwrites.",
		input: {
			name: z.string().min(1).max(150),
			deliveryId: z.string().optional(),
			sheets: z.array(z.object({ name: z.string().min(1).max(31), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(5000), widths: z.array(z.number()).optional(), header: z.boolean().optional() })).min(1).max(20),
		},
		run: async (ctx, a) => {
			const sheets = a.sheets.map((s) => ({ ...s, rows: s.rows.map((r) => r.map((c): Cell => (typeof c === "string" && c.startsWith("=") && c.length > 1 ? { f: c.slice(1) } : c))) }));
			const names = new Set<string>();
			for (const s of sheets) {
				if (/[\\/?*[\]:]/.test(s.name) || names.has(s.name.toLowerCase())) throw new Error(`Lapas nosaukums «${s.name}»: bez \\ / ? * [ ] : un katrs savādāks.`);
				names.add(s.name.toLowerCase());
			}
			const calc = evaluateWorkbook(sheets.map((s) => ({ name: s.name, rows: s.rows })));
			const real = calc.errors.filter((e) => !/^unsupported/.test(e.reason));
			if (real.length) throw new Error(`Formulas ar kļūdām, nekas nav saglabāts: ${real.slice(0, 8).map((e) => `${e.cell}: ${e.reason}`).join("; ")}.`);
			const bytes = writeXlsx(sheets);
			const file = /\.xlsx$/i.test(a.name) ? a.name : `${a.name}.xlsx`;
			let out: string;
			let staged: { id: string } | null = null;
			const store = ctx.projectId ? storeOf(ctx) : null;
			const d = store ? activeDraft(store, a.deliveryId) : null;
			if (a.deliveryId && !d) throw new Error(`Nodevums ${a.deliveryId} nav atrasts vai nav gatavojams.`);
			if (store && d) {
				if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4: staging vairs nemaina.`);
				out = stagedPath(store, d, file);
				if (existsSync(out)) throw new Error(`Nodevumā jau ir «${basename(out)}». Izvēlies citu nosaukumu.`);
				staged = { id: d.id };
			} else out = uniquePath(workDirOf(ctx.appDir, ctx.projectId), safeName(file));
			writeFileSync(out, bytes);
			if (store && staged) refreshDraft(store, staged.id, "agent");
			const fmt = (v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : String(v));
			const results = [...calc.values.entries()].filter(([k]) => sheets.some((s) => s.rows.some((r, ri) => r.some((c, ci) => typeof c === "object" && c !== null && k === `${s.name}!${colName(ci)}${ri + 1}`)))).slice(0, 60).map(([k, v]) => `${k} = ${fmt(v)}`);
			const text = `Saglabāts ${staged ? "nodevumā" : "agent-work mapē"}: ${basename(out)} (${sheets.length} lapas, ${calc.formulas} formulas${calc.errors.length ? `, ${calc.errors.length} nav aprēķinātas šeit (nepazīstama funkcija), Excel tās aprēķinās atverot` : ""}).`;
			const body = { ok: true, file: out, formulas: calc.formulas, results, unsupported: calc.errors.map((e) => `${e.cell}: ${e.reason}`) };
			return staged ? uiResult(`${text}\n${results.join("\n")}`, { open_panel: { name: "nodevumi", filter: staged.id } }) : body;
		},
	}),
	tool({
		name: "cad_describe",
		level: "read",
		description: "What a DWG or DXF drawing contains, without looking at it: units, extents, object counts by type, layers (with object counts, on/frozen), blocks (with uses), sheets (layouts) with their viewports and scales, text styles. The first thing to ask about a drawing; then cad_objects for the objects themselves and view_image to see it.",
		input: { path: z.string() },
		run: async (ctx, a) => cad.describe(await drawing(ctx, existing(ctx, a.path))),
	}),
	tool({
		name: "cad_objects",
		level: "read",
		description:
			"List or count the objects of a DWG / DXF drawing: filter by type (line, circle, arc, poly, ellipse, text, point, insert (a block reference, with its attributes), hatch, dim, viewport, mleader, spline, face3d, image), layer, block name, text (a word in a text or in an attribute: find a room number, a mark, a note), space (a sheet name; default the model), within (a window in drawing units). Each object has its coordinates and, where it has one, its length and area (in drawing units). countOnly gives the totals by type and layer. id gives one object in full. Paged: offset, limit (up to 300).",
		input: {
			path: z.string(),
			type: z.string().optional(),
			layer: z.string().optional(),
			block: z.string().optional(),
			text: z.string().optional(),
			space: z.string().optional(),
			within: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).optional(),
			offset: z.number().int().min(0).optional(),
			limit: z.number().int().min(1).max(300).optional(),
			countOnly: z.boolean().optional(),
			id: z.number().int().optional(),
		},
		run: async (ctx, a) => {
			const d = await drawing(ctx, existing(ctx, a.path));
			if (a.id !== undefined) {
				const o = await cad.objectFull(d, a.id);
				if (!o) throw new Error(`Objekta ${a.id} nav.`);
				return o;
			}
			const { path: _p, id: _i, ...filter } = a;
			const r = (await cad.objects(d, filter)) as { objects?: Record<string, unknown>[]; total: number };
			// CadCraft's one-line description is a translation key outside its own window: dropped
			for (const o of r.objects ?? []) if (typeof o.description === "string" && /^cmd\./.test(o.description)) delete o.description;
			// a result over ~60 000 characters is cut to the objects that fit, with the way to the rest
			const objs = r.objects;
			if (objs) {
				let keep = objs.length;
				while (keep > 1 && JSON.stringify(objs.slice(0, keep)).length > 60_000) keep = Math.floor(keep * 0.7);
				if (keep < objs.length) return { ...r, objects: objs.slice(0, keep), note: `rādīti ${keep} no ${objs.length}; lieto offset ${(a.offset ?? 0) + keep}` };
			}
			return r;
		},
	}),
	tool({
		name: "pointcloud_info",
		level: "read",
		description: "The header of a LAS / LAZ point cloud: version, point format, number of points, bounds (x, y, z), scale and offset, the software that wrote it. Header only: it costs nothing even for a multi-GB scan. Other cloud formats (E57, PLY, PCD, XYZ) are opened by the viewer, not read here.",
		input: { path: z.string() },
		run: async (ctx, a) => {
			const f = existing(ctx, a.path);
			if (!/\.la[sz]$/i.test(f)) throw new Error(`${basename(f)}: pointcloud_info lasa LAS un LAZ galvenes. Citus mākoņa formātus atver skatītājs.`);
			const fd = openSync(f, "r");
			try {
				const buf = Buffer.alloc(375);
				const n = readSync(fd, buf, 0, 375, 0);
				return { file: f, mb: Math.round(statSync(f).size / 1048576), ...cad.lasHeader(new Uint8Array(buf.subarray(0, n))) };
			} finally {
				closeSync(fd);
			}
		},
	}),
];

function colName(i: number): string {
	let s = "";
	for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
}
