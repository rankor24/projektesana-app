// Ekspertīze as agent tools (work plan 8.14). The agent reads a review into remarks (code does the layouts it knows), adds the remarks
// free text hides — each with a page and a verbatim quote that the code checks — and hands over the fix list of a daļa. It cannot close
// a remark: done / not applicable is the user's click, like confirming a fact.
import { z } from "zod";
import { runChecks } from "../../checks/run.js";
import { addRemark, fixList, importReview, readRemarks, summarize } from "../../core/expertise.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const refresh = (ctx: Parameters<typeof storeOf>[0]) => runChecks(storeOf(ctx), "manual", { dataDir: ctx.dataDir, today: new Date().toISOString().slice(0, 10), only: ["expert"] });

export const expertTools: ToolDef[] = [
	tool({
		name: "expert_import",
		level: "run",
		description:
			"Read one source as an expert review (ekspertīzes atzinums) into remarks: markdown checklists, numbered remarks under a daļa heading, Check | Result | Comment tables. Each keeps page and verbatim words; re-reading adds only new ones. Then read_source for free-text remarks the code missed and add them with expert_add. Remarks become findings the user closes.",
		input: { sourceId: z.string() },
		run: async (ctx, { sourceId }) => {
			const r = importReview(storeOf(ctx), sourceId, "agent");
			await refresh(ctx);
			const all = readRemarks(storeOf(ctx)).filter((x) => x.sourceId === sourceId);
			return { ...r, now: summarize(all), note: r.found === 0 ? "Kods neatrada nevienu piezīmi šajā izkārtojumā: izlasi avotu (read_source) un pievieno piezīmes ar expert_add." : "Pārbaudi ar expert_remarks; trūkstošās pievieno ar expert_add." };
		},
	}),
	tool({
		name: "expert_add",
		level: "propose",
		description:
			"Add a remark you read in a review: sourceId, page, verbatim quote (refused if not on that page), daļa mark only if the text says (AR, BK, AVK, UK, EL, ESS, GP …), the review's number, critical if the review says so, responsible only if the document names one. Never invent daļa or person.",
		input: { sourceId: z.string(), page: z.number().int().min(1), quote: z.string().min(8), daļa: z.string().optional(), code: z.string().optional(), section: z.string().optional(), critical: z.boolean().optional(), responsible: z.string().optional() },
		run: async (ctx, a) => {
			const r = addRemark(storeOf(ctx), a, "agent");
			await refresh(ctx);
			return { ok: true, id: r.id, state: r.state, note: "Atvērta piezīme. Lietotājs to aizver pats (Prasības → Ekspertīze)." };
		},
	}),
	tool({
		name: "expert_remarks",
		level: "read",
		description: "Remarks of the project's expert reviews (id, daļa, page, quote, critical, responsible, state) with counts per daļa and person. Filter by daļa ('nenoteikta' = none), state, sourceId.",
		input: { daļa: z.string().optional().describe("e.g. AR; 'nenoteikta' for the ones with no daļa"), state: z.enum(["open", "done", "na"]).optional(), sourceId: z.string().optional() },
		run: (ctx, a) => {
			const all = readRemarks(storeOf(ctx));
			if (!all.length) return "no data: ekspertīzes piezīmju nav (expert_import).";
			const rows = all.filter((r) => (!a.daļa || (r.daļa ?? "nenoteikta") === a.daļa.toUpperCase() || (r.daļa ?? "nenoteikta") === a.daļa) && (!a.state || r.state === a.state) && (!a.sourceId || r.sourceId === a.sourceId));
			return { summary: summarize(all), remarks: rows.map((r) => ({ id: r.id, daļa: r.daļa, code: r.code, page: r.page, quote: r.quote, critical: r.critical, responsible: r.responsible, state: r.state, note: r.note })) };
		},
	}),
	tool({
		name: "expert_fix_list",
		level: "read",
		description: "Fix list of one daļa as markdown: open remarks, critical first, with page, words, responsible, checkbox. daļa 'nenoteikta' = remarks with no daļa. Can go into a document via write_document.",
		input: { daļa: z.string() },
		run: (ctx, { daļa }) => {
			const store = storeOf(ctx);
			const titles = new Map(store.read("sources").map((s) => [s.id, s.title] as const));
			return fixList(readRemarks(store), /^nenoteikta$/i.test(daļa) ? null : daļa.toUpperCase(), { project: store.project.name, titleOf: (id) => titles.get(id) ?? id });
		},
	}),
];
