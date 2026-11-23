// search_project: one search over everything the project holds in text, the source documents (every page the scan read), the
// earlier conversations (all agents), the Markdown memory (Atmiņa: the agents', departments' and office's entries) and the decision
// and question logs, by the exact words and by meaning together (src/search/search.ts). A question can be put in
// ordinary Latvian ("kāds ir zemes kadastra apzīmējums?") and still finds the page that says it in other words; a code or a number
// is found exactly. Read-only: the tools server opens the project's threads.db without writing and embeds the question here, from
// the model files in <appDir>\models (the app downloads and indexes in the background, see Avoti → Meklēšanas indekss).
import { join } from "node:path";
import { z } from "zod";
import { threadsDir } from "../../core/threads.js";
import { threadsDbFile } from "../../core/threads-db.js";
import { searchDbFile } from "../../search/query.js";
import { tool, type ToolDef } from "./tool.js";

export const searchTools: ToolDef[] = [
	tool({
		name: "search_project",
		level: "read",
		description: "Search this project's sources, conversations, memory (Atmiņa) and decision/question logs by words and meaning, in plain Latvian. kind: sources, conversations, memory, logs or all. Returns passages with citations.",
		input: { query: z.string().min(2), kind: z.enum(["sources", "conversations", "memory", "logs", "all"]).optional(), limit: z.number().int().min(1).max(20).optional() },
		run: async (ctx, a) => {
			const r = await searchDbFile(threadsDbFile(threadsDir(ctx.appDir, ctx.projectsDir, ctx.projectId)), join(ctx.appDir, "models"), { query: a.query, kind: a.kind, limit: a.limit });
			if (r === null) return "no data: šī projekta sarunu datubāze vēl nav izveidota, indekss nav uzbūvēts.";
			if (!r.hits.length) return `no data: nekas neatbilst.${r.note ? ` (${r.note})` : ""}`;
			return { ...(r.note ? { note: r.note } : {}), passages: r.hits.map((h) => ({ citation: h.citation, text: h.text, ...(h.sourceId ? { source: h.sourceId, page: h.page } : h.ref ? { ref: h.ref } : { thread: h.threadId }) })) };
		},
	}),
];
