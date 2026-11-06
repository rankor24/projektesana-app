// The agent's read tools for sources and law, extraction candidates, facts as proposals, and the project memory (Atmiņa).
import { join } from "node:path";
import { z } from "zod";
import { proposeFact } from "../../core/facts.js";
import { newId, profileOf, type NoteType } from "../../core/model.js";
import { Library } from "../../rules/library.js";
import { EXTRACTION_PROMPT, extractFor } from "../../sources/extract/index.js";
import { norm } from "../../sources/extract/common.js";
import { storeOf, type ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const MAX_READ = 60_000;

/** "1-3,5" → [1,2,3,5]; empty → all. */
export function pageList(spec: string | undefined, n: number): number[] {
	if (!spec?.trim()) return Array.from({ length: n }, (_, i) => i + 1);
	const out = new Set<number>();
	for (const part of spec.split(",")) {
		const [a, b] = part.split("-").map((x) => Number(x.trim()));
		if (!Number.isInteger(a)) throw new Error(`Nederīgs lapu saraksts: ${spec}`);
		for (let p = a; p <= (Number.isInteger(b) ? b : a); p++) if (p >= 1 && p <= n) out.add(p);
	}
	return [...out].sort((x, y) => x - y);
}

function textOf(ctx: ToolCtx, sourceId: string) {
	const store = storeOf(ctx);
	const s = store.read("sources").find((x) => x.id === sourceId);
	if (!s) throw new Error(`Avots ${sourceId} nav atrasts. Izmanto list_sources.`);
	const v = s.versions[s.versions.length - 1];
	const t = v?.sha256 ? store.readText(v.sha256) : null;
	return { store, s, v, t };
}

export const sourceTools: ToolDef[] = [
	tool({
		name: "list_sources",
		level: "read",
		description: "All input documents of the project (from 01_Projektesana\\1.1_Izejas dati): id, title, office folder, role, text state, pages, signers. Photo surveys are one row each.",
		input: { role: z.string().optional().describe("only this role, e.g. PU, Tehniskie noteikumi") },
		run: (ctx, { role }) => {
			const rows = storeOf(ctx)
				.read("sources")
				.filter((s) => !role || s.role === role)
				.map((s) => {
					const v = s.versions[s.versions.length - 1];
					return {
						id: s.id,
						title: s.title,
						folder: s.folderKey,
						role: s.role,
						kind: s.kind,
						text: v?.textState,
						pages: v?.pages,
						...(s.paths.length > 1 ? { places: s.paths.length } : {}),
						...(s.signers.length ? { signers: s.signers.map((x) => `${x.name} ${x.at ?? ""}`.trim()) } : {}),
						...(s.container ? { inside: s.container.path } : {}),
						...(s.survey ? { survey: s.survey } : {}),
					};
				});
			return rows.length ? rows : "no data: projekts vēl nav nolasīts (run scan).";
		},
	}),
	tool({
		name: "read_source",
		level: "read",
		description: "Read the text of one source, page by page, with page markers. Quote from this text only.",
		input: { id: z.string(), pages: z.string().optional().describe('e.g. "1-3,7"; empty = all') },
		run: (ctx, { id, pages }) => {
			const { s, v, t } = textOf(ctx, id);
			if (!t) return `no data: ${s.title} — teksts nav nolasīts (${v?.textState ?? "nav versijas"}${v?.textReason ? `: ${v.textReason}` : ""}).`;
			let out = `${s.title} [${s.id}] — ${t.state}${t.reason ? ` (${t.reason})` : ""}\n`;
			for (const p of pageList(pages, t.pages.length)) {
				const chunk = `\n--- lpp. ${p} ---\n${t.pages[p - 1]}\n`;
				if (out.length + chunk.length > MAX_READ) {
					out += `\n[… apgriezts pie ${MAX_READ} zīmēm; lasi tālāk ar pages="${p}-${t.pages.length}"]`;
					break;
				}
				out += chunk;
			}
			return out;
		},
	}),
	tool({
		name: "search_sources",
		level: "read",
		description: "Find lines in the project's documents that contain all the words (case-insensitive). Returns source id, title, page and the line.",
		input: { q: z.string(), limit: z.number().int().min(1).max(200).optional() },
		run: (ctx, { q, limit }) => {
			const words = q.toLocaleLowerCase("lv").split(/\s+/).filter((w) => w.length > 1);
			if (!words.length) throw new Error("Tukšs meklējums.");
			const store = storeOf(ctx);
			const out: { sourceId: string; title: string; page: number; line: string }[] = [];
			for (const s of store.read("sources")) {
				const v = s.versions[s.versions.length - 1];
				const t = v?.sha256 ? store.readText(v.sha256) : null;
				if (!t) continue;
				t.pages.forEach((p, i) => {
					for (const line of p.split("\n")) {
						const low = line.toLocaleLowerCase("lv");
						if (words.every((w) => low.includes(w)) && out.length < (limit ?? 40)) out.push({ sourceId: s.id, title: s.title, page: i + 1, line: norm(line).slice(0, 400) });
					}
				});
			}
			return out.length ? out : `no data: neviena rinda ar "${q}".`;
		},
	}),
	tool({
		name: "search_law",
		level: "read",
		description: "Search the law library (likumi.lv acts shipped with the app: Būvniecības likums, MK 500, MK 529, LBN 202-18, LBN 200-21, holidays act; plus what Boris added). Returns verbatim paragraphs with URL and read date. Cite them; never paraphrase as law.",
		input: { q: z.string(), limit: z.number().int().min(1).max(60).optional() },
		run: (ctx, { q, limit }) => {
			const hits = new Library(join(ctx.appDir, "library"), join(ctx.dataDir, "law-snapshots")).search(q, { limit: limit ?? 20 });
			return hits.length ? hits : `no data: bibliotēkā nav rindkopas ar "${q}".`;
		},
	}),
	tool({
		name: "get_profile",
		level: "read",
		description: "The project profile: one value per key (work type, group, procedure, stages, sections, address, cadastral number, …), each with its source and state (proposed / confirmed).",
		input: {},
		run: (ctx) => {
			const p = profileOf(storeOf(ctx).read("facts"));
			return Object.keys(p).length ? p : "no data: profils vēl tukšs.";
		},
	}),
	tool({
		name: "extract_candidates",
		level: "read",
		description: "Values the code found in a source for its role (PU, property documents, topo, TAA, TN), each with page and verbatim quote. Check them in the text, then propose the right ones with set_fact.",
		input: { id: z.string() },
		run: (ctx, { id }) => {
			const { s, t } = textOf(ctx, id);
			if (!t) return `no data: ${s.title} teksts nav nolasīts.`;
			const c = extractFor(s.role, t.pages);
			return { role: s.role, lookFor: EXTRACTION_PROMPT[s.role] ?? "Šai lomai nav koda ekstraktora; lasi tekstu.", candidates: c };
		},
	}),
	tool({
		name: "set_fact",
		level: "propose",
		description:
			"Propose a fact with its source: the source id, the page and a verbatim quote from that page (read_source). The code checks the quote; a quote not on that page is refused. Boris confirms. Keys: profile.workType|group|procedure|stagesInContract|sections|funding|use|totalAreaM2|floorsAbove|floorsBelow|address|cadastralNo, bim.bipPresent, bim.lodByStage, or a dotted key of your own (topo.approvedOn, tn.number, …).",
		input: { key: z.string(), value: z.string(), sourceId: z.string(), page: z.number().int().min(1), quote: z.string() },
		run: (ctx, a) => {
			const f = proposeFact(storeOf(ctx), { key: a.key, value: a.value, source: { sourceId: a.sourceId, page: a.page, quote: a.quote }, by: "agent" });
			return { ok: true, fact: f.id, state: f.state, note: "Priekšlikums. Boris to apstiprina panelī Projekts." };
		},
	}),
	tool({
		name: "read_notes",
		level: "read",
		description: "The project memory (Atmiņa): decisions, answers, learnings and open questions written earlier, newest first.",
		input: { type: z.enum(["decision", "answer", "learning", "question"]).optional() },
		run: (ctx, { type }) => {
			const n = storeOf(ctx).notes(type as NoteType | undefined);
			return n.length ? n : "no data: atmiņā nav ierakstu.";
		},
	}),
	tool({
		name: "write_note",
		level: "propose",
		description: "Write to the project memory: a decision Boris made, an answer to a question, a learning, or a question for Boris. Short markdown; refs = ids it is about.",
		input: { type: z.enum(["decision", "answer", "learning", "question"]), title: z.string().min(3), body: z.string(), refs: z.array(z.string()).optional() },
		run: (ctx, a) => {
			const note = { id: newId("n"), type: a.type, title: a.title, body: a.body, refs: a.refs ?? [], by: "agent" as const, at: new Date().toISOString() };
			storeOf(ctx).writeNote(note);
			return { ok: true, note: note.id };
		},
	}),
];
