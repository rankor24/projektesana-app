// "Nodot projektu" as agent tools (work plan 7.5). The agent starts a draft (the user confirms), reads its checklist, and
// fills the staging folder: Revit sheets as PDF, the IFC, files the project already has. It has no tool that copies into
// 1.4_Nodevumi and none that marks a delivery sent: those are the user's clicks only (7.6, 4.3).
import { join } from "node:path";
import { z } from "zod";
import { checklistOf, checklistSummary } from "../../checks/checklist.js";
import { revitExport } from "../../revit/exports.js";
import { stageRevitIfc, stageRevitSheets } from "../../revit/stage.js";
import { activeDraft, DRAFT_KINDS, stageFile, startDraft, unstageFile } from "../../sources/staging.js";
import { renamePlan, renameStaged } from "../../sources/staging-rename.js";
import { uiResult } from "../../shared/ui-instruction.js";
import { storeOf, type ToolCtx } from "./context.js";
import { revit } from "./revit-commands.js";
import { tool, type ToolDef } from "./tool.js";

const today = () => new Date().toISOString().slice(0, 10);

/** The draft a tool works on: the one named, else the newest open one; none → say how to start one. */
function draft(ctx: ToolCtx, deliveryId?: string) {
	const store = storeOf(ctx);
	const d = activeDraft(store, deliveryId);
	if (!d) throw new Error("Nav gatavojama nodevuma. Vispirms start_delivery (veids un datums) — lietotājs to apstiprina.");
	return { store, d };
}

/** The model's sheets, or the reason they are not available (the checklist still answers without them). */
async function sheetsOrNote() {
	try {
		return { sheets: await revitExport.listSheets(revit()), note: null as string | null };
	} catch (e) {
		return { sheets: null, note: (e as Error).message.split("\n")[0].slice(0, 160) };
	}
}

export const deliveryTools: ToolDef[] = [
	tool({
		name: "start_delivery",
		level: "confirm",
		description:
			"Start making a delivery (\"Nodot projektu\"): kind SKICE / MBP / BP / DT / STARP and the delivery date (YYYY-MM-DD, the date the office folder is named after). Creates the draft and its empty staging folder in the app's data folder. The user confirms.",
		input: { kind: z.enum(DRAFT_KINDS), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
		run: (ctx, { kind, date }) => {
			const d = startDraft(storeOf(ctx), kind, date, "agent");
			return uiResult(`Sākts nodevums ${d.label} (id ${d.id}); staging: ${d.draft!.stagingDir}. Nākamais: delivery_checklist.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "delivery_checklist",
		level: "read",
		description:
			"The checklist of the delivery being made: each row with group (Lapas, Modelis, Likums, Saskaņojumi), status (trūkst / gatavs / pamatots / pārbaudi / neobligāts), the law citation, the staged files that meet it and what makes it done. Compares staged sheets with the open Revit model when Revit answers. Also lists the staged files.",
		input: { deliveryId: z.string().optional(), withRevit: z.boolean().optional() },
		run: async (ctx, { deliveryId, withRevit }) => {
			const { store, d } = draft(ctx, deliveryId);
			const r = withRevit === false ? { sheets: null, note: "Revit nav prasīts" } : await sheetsOrNote();
			const rows = checklistOf(store, d.id, { today: today(), sheets: r.sheets, revitNote: r.note });
			return {
				delivery: { id: d.id, label: d.label, kind: d.kind, date: d.draft.date, stagingDir: d.draft.stagingDir, copiedTo: d.draft.copiedTo, sent: !!d.sent },
				summary: checklistSummary(rows),
				revit: r.note ?? `modelī ${r.sheets?.length ?? 0} lapas`,
				rows: rows.map((x) => ({ id: x.id, group: x.group, status: x.status, label: x.label, citation: x.citation, files: x.files, detail: x.detail, next: x.action })),
				staged: d.items.map((i) => i.file.split(/[\\/]/).pop()),
			};
		},
	}),
	tool({
		name: "stage_revit_sheets",
		level: "run",
		description:
			"Export sheets of the open Revit model into the delivery's staging folder, one PDF per sheet named <number>_<name> without diacritics. All sheets, or only the listed sheet numbers. Files already staged are kept unless replace is true. Does not change the model.",
		input: { deliveryId: z.string().optional(), numbers: z.array(z.string()).max(500).optional(), replace: z.boolean().optional() },
		run: async (ctx, { deliveryId, numbers, replace }) => {
			const { store, d } = draft(ctx, deliveryId);
			const r = await stageRevitSheets(store, revit(), d.id, { numbers, replace }, "agent");
			return uiResult(`Lapas: eksportētas ${r.exported.length}, atstātas ${r.kept.length}${r.unknown.length ? `, modelī nav: ${r.unknown.join(", ")}` : ""} (no ${r.total}).`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "stage_ifc",
		level: "run",
		description: "Export the open Revit model to IFC into the delivery's staging folder as <BD code>_<daļa>_<YYMMDD>.ifc (daļa default AR). A second IFC needs replace. Does not change the model.",
		input: { deliveryId: z.string().optional(), part: z.string().max(12).optional(), replace: z.boolean().optional() },
		run: async (ctx, { deliveryId, part, replace }) => {
			const { store, d } = draft(ctx, deliveryId);
			const r = await stageRevitIfc(store, revit(), d.id, { part, replace }, "agent");
			return uiResult(`IFC: ${r.file.split(/[\\/]/).pop()}.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "stage_source_file",
		level: "run",
		description:
			"Copy a file the project already has into the delivery's staging folder under a name: a source (sourceId from list_sources) or a file the app exported (path in the project's data folder). Name it <sheet no>_<title>.<ext> per the office rule; diacritics are folded. Never overwrites. Tell the user the name you chose.",
		input: { deliveryId: z.string().optional(), sourceId: z.string().optional(), path: z.string().optional(), name: z.string().min(3).max(150) },
		run: (ctx, { deliveryId, sourceId, path, name }) => {
			const { store, d } = draft(ctx, deliveryId);
			let from = path;
			if (sourceId) {
				const s = store.read("sources").find((x) => x.id === sourceId);
				if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
				if (s.container) throw new Error(`Avots ir ${s.container.path} iekšā (.edoc): to kopē pats lietotājs.`);
				from = join(store.project.root, s.paths[0]);
			}
			if (!from) throw new Error("Norādi sourceId vai path.");
			const r = stageFile(store, d.id, from, name, "agent");
			return uiResult(`Pievienots nodevumam: ${r.file.split(/[\\/]/).pop()}.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "rename_staged",
		level: "run",
		description:
			"Rename the staged files to the office convention (<sheet number>_<title>.ext, no diacritics) or, with mode 'bis', to BIS upload names. Without apply it only returns the plan (old → new, which files need a number from the user, which names collide). With apply it renames what the plan can decide, inside the staging folder only, never over a file; files the plan cannot decide are left and listed. The user can take the rename back.",
		input: { deliveryId: z.string().optional(), mode: z.enum(["office", "bis"]).optional(), revision: z.string().optional(), apply: z.boolean().optional() },
		run: (ctx, a) => {
			const { store, d } = draft(ctx, a.deliveryId);
			const plan = renamePlan(store, d.id, a.mode ?? "office", a.revision);
			const todo = plan.filter((r) => r.status === "rename" && r.to);
			const open = plan.filter((r) => r.status === "input" || r.status === "conflict");
			if (!a.apply) return { plan, toRename: todo.length, needsYou: open.length, note: "Plāns. Lai pārdēvētu: rename_staged ar apply = true." };
			const res = renameStaged(store, d.id, todo.map((r) => ({ file: r.file, to: r.to! })), "agent");
			return uiResult(`Pārdēvēti ${res.applied} faili; nav izlemts ${open.length}${res.errors.length ? `; kļūdas: ${res.errors.join("; ")}` : ""}.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
	tool({
		name: "unstage_file",
		level: "confirm",
		description: "Remove one file from the delivery's staging folder (by its file name). The user confirms.",
		input: { deliveryId: z.string().optional(), name: z.string().min(1) },
		run: (ctx, { deliveryId, name }) => {
			const { store, d } = draft(ctx, deliveryId);
			unstageFile(store, d.id, name, "agent");
			return uiResult(`Izņemts no nodevuma: ${name}.`, { open_panel: { name: "nodevumi", filter: d.id } });
		},
	}),
];
