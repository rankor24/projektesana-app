// search_conversations: full-text search over this project's earlier conversations (all agents, all threads), so an agent can
// find what was said, decided or asked before without the user pasting it again. Read-only: it opens the project's threads.db
// beside the app, which has it open for writing (the tools server is another process).
import { z } from "zod";
import { threadsDir } from "../../core/threads.js";
import { searchFile, threadsDbFile } from "../../core/threads-db.js";
import { tool, type ToolDef } from "./tool.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const conversationTools: ToolDef[] = [
	tool({
		name: "search_conversations",
		level: "read",
		description: "Search this project's earlier conversations (all agents). Words match without diacritics and by their beginning. Returns thread, agent, date and a short snippet.",
		input: { query: z.string().min(2), agent: z.string().optional(), thread: z.string().optional(), from: day.optional(), to: day.optional(), limit: z.number().int().min(1).max(20).optional() },
		run: (ctx, a) => {
			const hits = searchFile(threadsDbFile(threadsDir(ctx.appDir, ctx.projectsDir, ctx.projectId)), { query: a.query, agent: a.agent, threadId: a.thread, from: a.from, to: a.to, limit: a.limit });
			if (hits === null) return "no data: šī projekta sarunas vēl nav datubāzē.";
			return hits.length ? hits.map((h) => ({ thread: h.threadId, title: h.title, agent: h.agent, at: h.at, role: h.role, snippet: h.snippet })) : "no data: nekas neatbilst.";
		},
	}),
];
