// Compaction of a conversation that lives in an engine's own session (Antigravity): the server holds the messages, so the app cannot cut its context. What it can do
// is what the user asked for: keep the old session where it is, write a summary of the thread's chat lines, and go on in a NEW session that starts from that summary
// and the last lines word for word. Pure helpers over the thread's transcript (no I/O, no model); ThreadRunner makes the one model call and the writes.
//
// Also here: the seed of any conversation that is not in memory (after a restart, a change of model, a new session), and the archive body kept for a compaction of
// the pi engine's in-memory conversation. The transcript only holds what was said (the user's text and the agent's answers); tool calls and results live in the
// agent log (runs folder), so a summary made here is made from what was said, as the rebuild after a restart always was.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatEntry } from "../shared/api.js";

/** How many of the newest lines stay word for word in a rebuilt conversation. */
export const SEED_TAIL = 10;

const real = (e: ChatEntry) => e.kind !== "compaction";
const lineText = (e: ChatEntry) => (e.attachments?.length ? `${e.text}\n[pielikumi: ${e.attachments.map((a) => a.name).join(", ")}]` : e.text);

/**
 * The lines a rebuilt conversation draws on, oldest first: what came after the newest compaction line, and before it the lines that compaction kept word for word
 * (`keep`, set by a compaction of an engine session; a compaction of the pi conversation keeps its recent part in memory only and sets none). The last line is the
 * message the run is answering now.
 */
function linesAfterSummary(all: readonly ChatEntry[]): { ci: number; lines: ChatEntry[] } {
	const ci = all.map((e) => e.kind).lastIndexOf("compaction");
	const kept = ci >= 0 ? Math.max(0, all[ci].keep ?? 0) : 0;
	const before = kept > 0 ? all.slice(0, ci).filter(real).slice(-(kept + 1)) : [];
	return { ci, lines: [...before, ...all.slice(ci + 1).filter(real)] };
}

/** The newest compaction summary in the transcript and the newest lines before the message being answered, for a conversation that is not in memory. */
export function seedFromTranscript(all: readonly ChatEntry[]): { summary: string | null; earlier: { role: string; text: string }[] } {
	const { ci, lines } = linesAfterSummary(all);
	return { summary: ci >= 0 ? all[ci].text : null, earlier: lines.slice(0, -1).slice(-SEED_TAIL).map((e) => ({ role: e.role, text: lineText(e) })) };
}

export interface SessionPlan {
	/** the summary this compaction continues from (the newest compaction line's), null for the first */
	previous: string | null;
	/** the lines that become summary */
	old: ChatEntry[];
	/** the lines that stay word for word: the `keep` of the new compaction line */
	kept: number;
	/** old and kept together: what the archive stores of this stretch */
	covered: ChatEntry[];
}

/** What a compaction made now would summarize and keep: everything since the last compaction except the newest `SEED_TAIL` lines and the message being answered. */
export function planSessionCompaction(all: readonly ChatEntry[]): SessionPlan {
	const { ci, lines } = linesAfterSummary(all);
	const rest = lines.slice(0, -1);
	const kept = Math.min(SEED_TAIL, rest.length);
	return { previous: ci >= 0 ? all[ci].text : null, old: rest.slice(0, rest.length - kept), kept, covered: rest };
}

/** The transcript lines as the messages the summarizer reads (it only looks at role and text). */
export function entriesAsMessages(entries: readonly ChatEntry[]): AgentMessage[] {
	return entries.map((e) => ({ role: e.role, content: [{ type: "text", text: lineText(e) }], timestamp: Date.parse(e.at) || 0 }) as unknown as AgentMessage);
}

// ---- the archive ---------------------------------------------------------------------------------------------------

/** The messages of a pi conversation as they are stored: a screenshot's bytes become a marker (they stay in the run folder), the rest word for word. */
export function archiveBody(messages: readonly AgentMessage[]): string {
	return JSON.stringify(
		messages.map((m) => {
			const msg = m as { content?: unknown };
			if (!Array.isArray(msg.content)) return m;
			return { ...m, content: (msg.content as { type: string }[]).map((b) => (b.type === "image" ? { type: "text", text: "[attēls]" } : b)) };
		}),
	);
}

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
const blocksOf = (c: unknown): Block[] => (Array.isArray(c) ? (c as Block[]) : typeof c === "string" ? [{ type: "text", text: c }] : []);

/** An archive body as plain text for reading: the user's lines, the agent's answers and (pi) its tool calls and the tools' answers, nothing cut. Unreadable bodies are returned as they are. */
export function archiveText(body: string): string {
	let data: unknown;
	try {
		data = JSON.parse(body);
	} catch {
		return body;
	}
	if (!Array.isArray(data)) return body;
	const out: string[] = [];
	for (const m of data as { role?: string; kind?: string; text?: string; at?: string; content?: unknown; attachments?: { name: string }[] }[]) {
		// a transcript line (an engine session's archive)
		if (typeof m.text === "string" && m.content === undefined) {
			out.push(`[${m.role === "user" ? "Lietotājs" : "Aģents"}${m.at ? ` ${m.at}` : ""}]: ${lineText(m as ChatEntry)}`);
			continue;
		}
		const bs = blocksOf(m.content);
		if (m.role === "user") {
			const t = bs.map((b) => (b.type === "image" ? "[attēls]" : (b.text ?? ""))).filter(Boolean).join("\n");
			if (t.trim()) out.push(`[Lietotājs]: ${t}`);
		} else if (m.role === "assistant") {
			const t = bs.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
			if (t.trim()) out.push(`[Aģents]: ${t}`);
			for (const b of bs) if (b.type === "toolCall") out.push(`[Aģenta rīka izsaukums]: ${b.name}(${JSON.stringify(b.arguments ?? {})})`);
		} else if (m.role === "toolResult") {
			const t = bs.map((b) => (b.type === "image" ? "[attēls]" : (b.text ?? ""))).join("\n");
			if (t.trim()) out.push(`[Rīka atbilde]: ${t}`);
		} else if (m.role === "system") out.push(`[Sistēma]: ${bs.map((b) => b.text ?? "").join("")}`);
	}
	return out.join("\n\n");
}
