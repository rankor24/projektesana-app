// Word documents as agent tools (work plan 8.13). The agent reads a document's outline, edits one in the delivery's staging folder
// with a list of ops (through Word, all or nothing), or writes a new one from markdown (a paskaidrojuma raksts, a letter), and can
// have the PDF made. Everything is written into the draft's staging folder only: the office folder is the user's click (7.6), the
// original of a source is never touched, and an edit in place takes a copy first so the 8.7 undo can bring the file back.
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { checkpointBeforeWrite } from "../../core/checkpoints.js";
import { checkRead } from "../../core/guard.js";
import { applyDocxOps, docxOutline, docxToPdf, outlineText } from "../../sources/export/word.js";
import { opInput } from "../../sources/export/word-ops.js";
import { markdownToDocx } from "../../sources/export/docx-md.js";
import { refreshDraft, safeName, stagedPath } from "../../sources/staging.js";
import { uiResult } from "../../shared/ui-instruction.js";
import { writeFileSync } from "node:fs";
import type { ToolCtx } from "./context.js";
import { storeOf } from "./context.js";
import { draft } from "./deliveries.js";
import { tool, type ToolDef } from "./tool.js";

const wordScript = (ctx: ToolCtx) => {
	if (!ctx.skillsDir) throw new Error("Word palīga mape nav zināma (skillsDir nav iestatīts).");
	return join(dirname(ctx.skillsDir), "office-word.ps1");
};

const withDocx = (name: string) => safeName(/\.docx$/i.test(name) ? name : `${name}.docx`);

/** The file a read tool means: a staged file of the open draft, a source of the project, or a path inside the project. */
function readable(ctx: ToolCtx, a: { staged?: string; sourceId?: string; path?: string; deliveryId?: string }): string {
	const store = storeOf(ctx);
	let p: string | undefined;
	if (a.staged) p = stagedPath(store, draft(ctx, a.deliveryId).d, a.staged);
	else if (a.sourceId) {
		const s = store.read("sources").find((x) => x.id === a.sourceId);
		if (!s) throw new Error(`Avots ${a.sourceId} nav atrasts.`);
		if (s.container) throw new Error(`Avots ir ${s.container.path} iekšā (.edoc): to atver pats lietotājs.`);
		p = join(store.project.root, s.paths[0]);
	} else if (a.path) {
		const r = checkRead(store.guard, a.path);
		if (!r.ok) throw new Error(r.reason);
		p = r.path;
	}
	if (!p) throw new Error("Norādi staged (fails nodevumā), sourceId vai path.");
	if (!existsSync(p) || !statSync(p).isFile()) throw new Error(`Fails nav atrasts: ${p}`);
	if (extname(p).toLowerCase() !== ".docx") throw new Error(`Tas nav .docx: ${basename(p)}. Vecus .doc nolasa read_source; labošanai tos vispirms jāsaglabā kā .docx.`);
	return p;
}

export const documentTools: ToolDef[] = [
	tool({
		name: "docx_outline",
		level: "read",
		description:
			"The structure of a .docx: paragraphs in order with their style and heading level, and each table with its index, size, header row and first column. The numbers (table index) are the ones docx_apply uses. With find: only the paragraphs and tables that contain that text (and which table rows). Name the file by staged (a file in the delivery's staging folder), sourceId, or a path inside the project. Does not need Word.",
		input: { staged: z.string().optional(), sourceId: z.string().optional(), path: z.string().optional(), deliveryId: z.string().optional(), find: z.string().optional(), max: z.number().int().min(1).max(500).optional() },
		run: (ctx, a) => {
			const p = readable(ctx, a);
			return outlineText(docxOutline(new Uint8Array(readFileSync(p)), { find: a.find, max: a.max }), basename(p));
		},
	}),
	tool({
		name: "docx_apply",
		level: "run",
		description:
			"Edit a .docx through Word, keeping its formatting, as one batch that is all or nothing: if any op matches nothing, nothing is saved and the answer says which op failed. Ops (docx_outline gives the indexes): replace (find → replace), insert_after (a new paragraph after the one with the anchor; style, colour, bold), append_text (text at the end of the anchor's paragraph), set_cell, add_row, delete_row, delete_paragraph. The result is written into the delivery's staging folder: give out (a new name, .docx) to keep the original as it is, or leave it out to edit the staged file itself (a copy is kept; the user can undo). A source (sourceId) is never changed: out is required. dryRun checks every op and saves nothing. Needs Word on this PC. Use docx_outline first, and tell the user what you changed.",
		input: {
			staged: z.string().optional().describe("a file in the delivery's staging folder"),
			sourceId: z.string().optional().describe("a source of the project (copied, never changed)"),
			out: z.string().optional().describe("name of the result in staging (new file, never over an existing one)"),
			deliveryId: z.string().optional(),
			ops: z.array(opInput).min(1).max(60),
			dryRun: z.boolean().optional(),
		},
		run: async (ctx, a) => {
			const store = storeOf(ctx);
			const { d } = draft(ctx, a.deliveryId);
			if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4: staging vairs nemaina.`);
			const src = readable(ctx, a);
			const inPlace = !!a.staged && (!a.out || withDocx(a.out) === basename(src));
			if (!a.staged && !a.out) throw new Error("Avotu nelabo uz vietas: norādi out (jauno nosaukumu nodevumā).");
			const out = inPlace ? src : stagedPath(store, d, withDocx(a.out!));
			if (!inPlace && existsSync(out)) throw new Error(`Nodevumā jau ir «${basename(out)}». Izvēlies citu out vai izņem veco.`);
			const script = wordScript(ctx);
			const workDir = join(store.dir, "tmp-word");
			if (a.dryRun) {
				const r = await applyDocxOps(script, src, `${src}.dry`, a.ops, { dryRun: true, workDir });
				return r.ok ? `Pārbaude: visas ${r.done?.length ?? 0} darbības atrod savu vietu; nekas nav saglabāts.` : failText(r);
			}
			// an edit in place is made to a side file and swapped in only when every op worked: a failed batch leaves the file and the
			// undo list as they were, and the copy the undo goes back to is taken at the moment of the swap
			const side = inPlace ? join(dirname(src), `~edit_${basename(src)}`) : out;
			if (inPlace) rmSync(side, { force: true });
			const r = await applyDocxOps(script, src, side, a.ops, { workDir });
			if (!r.ok) throw new Error(failText(r));
			if (inPlace) {
				checkpointBeforeWrite(store, src);
				renameSync(side, src);
			}
			refreshDraft(store, d.id, "agent");
			const n = (r.done ?? []).map((x) => `${x.op}. ${x.kind}: ${x.matched}`).join("; ");
			return uiResult(`${inPlace ? "Labots" : "Saglabāts"} nodevumā: ${basename(out)} (${n}).${inPlace ? " Iepriekšējā versija ir saglabāta; lietotājs var atsaukt." : ""}`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "write_document",
		level: "run",
		description:
			"Write a new Word document from markdown into the delivery's staging folder (a paskaidrojuma raksts, a letter, a cover note): # headings, paragraphs, - lists, 1. lists, | tables |, **bold**, *italic*. A4, Calibri, Latvian. Never overwrites a file. With pdf = true the PDF is made too (needs Word; the .docx is kept if Word is missing). Write the text in Latvian for the office's documents and only from facts the project has confirmed; say what you could not fill in instead of inventing it.",
		input: { deliveryId: z.string().optional(), name: z.string().min(1).max(150), markdown: z.string().min(1).max(200_000), title: z.string().optional(), pdf: z.boolean().optional() },
		run: async (ctx, a) => {
			const store = storeOf(ctx);
			const { d } = draft(ctx, a.deliveryId);
			if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4: staging vairs nemaina.`);
			const out = stagedPath(store, d, withDocx(a.name));
			const pdf = out.replace(/\.docx$/i, ".pdf");
			if (existsSync(out)) throw new Error(`Nodevumā jau ir «${basename(out)}». Izvēlies citu nosaukumu vai labo to ar docx_apply.`);
			if (a.pdf && existsSync(pdf)) throw new Error(`Nodevumā jau ir «${basename(pdf)}».`);
			writeFileSync(out, markdownToDocx(a.markdown, { title: a.title ?? basename(out, ".docx") }));
			let note = "";
			if (a.pdf) {
				const r = await docxToPdf(wordScript(ctx), out, pdf);
				note = r.ok ? ` un ${basename(pdf)}` : ` (PDF nav izveidots: ${r.reason})`;
				if (!r.ok) rmSync(pdf, { force: true });
			}
			refreshDraft(store, d.id, "agent");
			return uiResult(`Izveidots nodevumā: ${basename(out)}${note}.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
];

function failText(r: { reason?: string; op?: number; kind?: string }): string {
	return r.op ? `Darbība ${r.op} (${r.kind}) neizdevās: ${r.reason}. Nekas nav saglabāts.` : `Word: ${r.reason}`;
}
