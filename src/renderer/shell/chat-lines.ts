// The chat lines of a run, built from its events. Pure `apply`, plus a window-wide buffer: every run's streamed lines are kept here
// from its first event, whether or not its conversation is on screen. The dock reads the buffer when it comes back to a run that went
// on while another conversation (or another page) was shown, so the start of the answer is not lost. A run's buffer goes when it ends:
// the saved history has the answer from then on.
import type { ChatAttachmentRef } from "../../shared/api";
import { fmtTokens } from "../../shared/tokens";
import type { RunEvent } from "../../shared/types";
import { on } from "../bridge";
import { tr } from "../i18n";

export type Line =
	| { kind: "user"; text: string; attachments?: ChatAttachmentRef[] }
	| { kind: "assistant"; text: string; thinking?: string }
	/** the run card of one run: its steps come from the activity feed */
	| { kind: "run"; runId: string; queued?: boolean }
	| { kind: "compact"; phase: "start" | "done" | "failed" | "past"; text: string; summary?: string }
	| { kind: "confirm"; id: string; tool: string; batch: string; answered?: boolean; allow?: boolean }
	| { kind: "error"; text: string }
	| { kind: "retry"; text: string };

export function apply(ls: Line[], e: RunEvent): Line[] {
	const last = ls[ls.length - 1];
	switch (e.type) {
		case "text":
			if (last?.kind === "assistant") return [...ls.slice(0, -1), { ...last, text: last.text + e.text }];
			return [...ls, { kind: "assistant", text: e.text }];
		case "thinking":
		case "tool":
		case "tool_result":
			// shown in the run card, from the activity feed
			return ls;
		case "compact": {
			// one line per compaction: "start" opens it, "done" / "failed" replace it
			const line: Line =
				e.phase === "start"
					? { kind: "compact", phase: "start", text: tr("Saruna ir {tokens} tokenu — saspiež vecāko daļu…", { tokens: fmtTokens(e.before) }) }
					: e.phase === "done"
						? { kind: "compact", phase: "done", text: `Saruna saspiesta: ${fmtTokens(e.before)} → ≈${fmtTokens(e.after ?? 0)} tokeni` }
						: { kind: "compact", phase: "failed", text: tr("Saspiešana neizdevās, darbs turpinās bez tās: {message}", { message: e.message ?? "" }) };
			return last?.kind === "compact" && last.phase === "start" ? [...ls.slice(0, -1), line] : [...ls, line];
		}
		case "confirm":
			return [...ls, { kind: "confirm", id: e.id, tool: e.tool, batch: e.batch }];
		case "retry": {
			// one line per run of restarts: the next attempt replaces the previous one
			const line: Line = { kind: "retry", text: tr("Savienojums pārtrūka ({message}). Atkārto {attempt}/{of} pēc {s} s…", { message: e.message, attempt: e.attempt, of: e.of, s: Math.round(e.delayMs / 1000) }) };
			return last?.kind === "retry" ? [...ls.slice(0, -1), line] : [...ls, line];
		}
		case "error":
			return [...ls, { kind: "error", text: e.message }];
		case "done":
			// the streamed text is already shown; a provider that does not stream sends the whole answer here
			if (last?.kind === "assistant" || !e.text) return ls;
			return [...ls, { kind: "assistant", text: e.text }];
		default:
			return ls;
	}
}

const buffers = new Map<string, Line[]>();
let started = false;

/** One subscription for the whole window; safe to call from anywhere, any number of times. */
export function startChatStreams(): void {
	if (started) return;
	started = true;
	on("agent.event", ({ runId, event }) => {
		if (event.type === "done" || event.type === "error") buffers.delete(runId);
		else buffers.set(runId, apply(buffers.get(runId) ?? [], event));
	});
}

/** The chat lines a run has produced so far (its streamed text, compaction and approval lines), empty when none. */
export function streamedLines(runId: string): Line[] {
	return buffers.get(runId) ?? [];
}
