// A thread as a file the user keeps or sends on: JSONL (one entry per line, the same lines the old chat.jsonl held, so any tool
// that read those reads this) or Markdown (for a person; the headings are Latvian, as the app's own text is).
// Pure: it gets the thread and its entries and returns text. Saving it somewhere is the window's job.
import type { ChatEntry } from "../shared/api.js";
import type { Thread } from "../shared/thread-types.js";

export type ThreadExportFormat = "jsonl" | "md";

export interface ThreadExport {
	/** a file name for the text, without a folder: the title, the date, the extension */
	fileName: string;
	mime: string;
	text: string;
}

/** A name that is safe on Windows: no reserved characters, no trailing dot or space, not empty, not too long. */
export function safeFileName(title: string): string {
	const s = title
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[. ]+$/, "")
		.slice(0, 80)
		.trim();
	return s || "saruna";
}

const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");
const stamp = (iso: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso);

function markdown(t: Thread, entries: ChatEntry[]): string {
	const out = [`# ${t.title}`, "", `- Aģents: ${t.agent}`, `- Sākta: ${stamp(t.createdAt)}`, `- Pēdējā darbība: ${stamp(t.lastAt)}`, `- Ziņojumu: ${entries.length}`, ""];
	for (const e of entries) {
		const who = e.kind === "compaction" ? "Saspiestās sarunas kopsavilkums" : e.role === "user" ? "Lietotājs" : t.agent;
		out.push(`## ${who} · ${stamp(e.at)}`, "");
		if (e.attachments?.length) out.push(`Pielikumi: ${e.attachments.map((a) => a.name).join(", ")}`, "");
		out.push(e.text.trimEnd(), "");
	}
	return out.join("\n");
}

export function exportThread(t: Thread, entries: ChatEntry[], format: ThreadExportFormat): ThreadExport {
	const base = `${safeFileName(t.title)} ${day(t.createdAt)}`.trim();
	if (format === "jsonl") return { fileName: `${base}.jsonl`, mime: "application/x-ndjson", text: entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "") };
	return { fileName: `${base}.md`, mime: "text/markdown", text: markdown(t, entries) };
}
