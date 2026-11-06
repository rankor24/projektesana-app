// Pins as tasks (task 6.4): the agent lists the open pins, adds pins and comments, and marks a pin resolved with what it
// changed. Only Boris closes a pin.
import { z } from "zod";
import { addPin, commentPin, pinsAsTasks, resolvePin } from "../../core/pins.js";
import type { Pin } from "../../core/model.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

/** The pins block at the top of every prompt: open ones first (oldest first), then those waiting for Boris. */
export function pinsText(pins: Pin[]): string {
	const tasks = pinsAsTasks(pins);
	if (!tasks.length) return "";
	const where = (p: Pin) => ("elementGuid" in p.target ? `elements ${p.target.elementGuid}` : `${p.target.sourceId ?? p.target.sheet ?? "lapa"}${p.target.page ? `, lpp. ${p.target.page}` : ""}`);
	const lines = tasks.map((p, i) => `${i + 1}. [${p.id}] ${p.state === "open" ? "ATVĒRTA" : "gaida Borisu"} — ${p.text} (${where(p)})${p.comments.length ? ` · pēdējais: ${p.comments[p.comments.length - 1].text}` : ""}`);
	return `Borisa piezīmes (uzdevumi; atvērtās vispirms):\n${lines.join("\n")}`;
}

export const pinTools: ToolDef[] = [
	tool({
		name: "list_pins",
		level: "read",
		description: "Boris's pins (notes on a page or a model element): your task list. Open ones first.",
		input: {},
		run: (ctx) => {
			const p = pinsAsTasks(storeOf(ctx).read("pins"));
			return p.length ? p : "no data: atvērtu piezīmju nav.";
		},
	}),
	tool({
		name: "add_pin",
		level: "annotate",
		description: "Put a pin on a source page (page fractions 0–1 from top-left) or on a model element (GlobalId), to point Boris at something.",
		input: { text: z.string().min(3), sourceId: z.string().optional(), page: z.number().int().min(1).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), elementGuid: z.string().optional() },
		run: (ctx, a) => {
			const target = a.elementGuid ? { elementGuid: a.elementGuid } : { sourceId: a.sourceId, page: a.page, x: a.x ?? 0.5, y: a.y ?? 0.5 };
			return { ok: true, pin: addPin(storeOf(ctx), target, a.text, "agent").id };
		},
	}),
	tool({
		name: "add_comment",
		level: "annotate",
		description: "Comment on a pin (a question, or what you found).",
		input: { pinId: z.string(), text: z.string().min(2) },
		run: (ctx, { pinId, text }) => (commentPin(storeOf(ctx), pinId, text, "agent"), { ok: true }),
	}),
	tool({
		name: "resolve_pin",
		level: "propose",
		description: "Mark a pin addressed, with what you changed. Boris checks and closes it, or reopens it.",
		input: { pinId: z.string(), note: z.string().min(3) },
		run: (ctx, { pinId, note }) => (resolvePin(storeOf(ctx), pinId, note), { ok: true, note: "Piezīme atzīmēta kā atrisināta; to aizver Boris." }),
	}),
];
