// The agent's tools for the whole app (2.6.9): every call the screens make, through the main process's bridge
// (main/agent-bridge.ts), at the level shared/app-calls.ts gives it — read freely, change on its own, or wait for the user —
// and any document page as an image the model reads itself (view_page: OCR by the model, for scans the code reads badly).
// app_calls is the map: every call with its parameters and what it does, generated from the IPC contract.
import { z } from "zod";
import { APP_CATALOG } from "../../shared/app-catalog.generated.js";
import { APP_CALL_LEVEL, type AppCallLevel } from "../../shared/app-calls.js";
import type { ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

/** A tool result the tools server sends as text and an image block (agent/tools/server.ts). */
export interface ImageResult {
	__image: { data: string; mimeType: string };
	text: string;
}

export async function bridge(ctx: ToolCtx, path: string, body: unknown): Promise<Record<string, unknown>> {
	if (!ctx.bridge) throw new Error("Lietotnes tilts nav pieejams (rīki darbojas bez lietotnes loga).");
	const res = await fetch(`${ctx.bridge.url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "x-bridge-token": ctx.bridge.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
	const j = (await res.json()) as Record<string, unknown>;
	if (!res.ok) throw new Error(String(j.error ?? `lietotne atbildēja ${res.status}`));
	return j;
}

const LEVELS = APP_CALL_LEVEL as Record<string, AppCallLevel>;

/** The open project's id goes first when the call takes one and the agent left it out. */
function withProject(ctx: ToolCtx, call: string, args: unknown[]): unknown[] {
	const params = APP_CATALOG[call]?.params ?? [];
	if ((params[0] === "id" || params[0] === "projectId") && args.length === params.length - 1 && ctx.projectId) return [ctx.projectId, ...args];
	return args;
}

const callTool = (name: string, level: Exclude<AppCallLevel, "never">, description: string): ToolDef =>
	tool({
		name,
		level: level === "run" ? "run" : level,
		description,
		input: { call: z.string().describe("the call's name from app_calls, e.g. stages.setDates"), args: z.array(z.unknown()).describe("its arguments in order (the project id first may be left out: the open project)") },
		run: async (ctx, a) => {
			const lv = LEVELS[a.call];
			if (!lv) throw new Error(`Lietotnē nav izsaukuma ${a.call}. Skaties app_calls.`);
			if (lv !== level) throw new Error(lv === "never" ? `${a.call} aģentam nav pieejams.` : `${a.call} ir līmenī «${lv}»: izsauc ar ${lv === "read" ? "app_read" : lv === "run" ? "app_change" : "app_confirm"}.`);
			const r = await bridge(ctx, "/call", { name: a.call, level, args: withProject(ctx, a.call, a.args) });
			return r.result;
		},
	});

export const appTools: ToolDef[] = [
	tool({
		name: "app_calls",
		level: "read",
		description:
			"The map of the whole app: every call its pages and panels use (sources, facts, rooms, deliveries, schedule, versions, coordination, Revit, files, findings, pins, notes, process, expertise, library…) with parameters, what it does and the tool that runs it (app_read = reads, app_change = changes on your own, app_confirm = waits for the user's click). Filter by words. Use it before saying the app cannot do something.",
		input: { find: z.string().optional().describe("words in the call's name or description, e.g. 'rooms', 'stage', 'delivery'") },
		run: (ctx, { find }) => {
			const words = (find ?? "").toLowerCase().split(/\s+/).filter(Boolean);
			const rows = Object.entries(APP_CATALOG)
				.filter(([n]) => LEVELS[n] && LEVELS[n] !== "never")
				.filter(([n, c]) => words.every((w) => `${n} ${c.doc ?? ""}`.toLowerCase().includes(w)))
				.map(([n, c]) => ({ call: n, tool: LEVELS[n] === "read" ? "app_read" : LEVELS[n] === "run" ? "app_change" : "app_confirm", sig: c.sig, ...(c.doc ? { doc: c.doc } : {}) }));
			return rows.length ? { project: ctx.projectId, calls: rows } : `Nekas neatbilst «${find}». Bez find: viss saraksts.`;
		},
	}),
	callTool("app_read", "read", "Run a reading call of the app (app_calls shows them: tool app_read) and get its data, exactly what the page shows."),
	callTool("app_change", "run", "Run a changing call the agent may make on its own (app_calls: tool app_change): what the user does on a page, written as the agent's."),
	callTool("app_confirm", "confirm", "Run a call that waits for the user's click (app_calls: tool app_confirm): deletes, the user's own decisions, sending, copying into 1.4, Revit writes, opening a program."),
	tool({
		name: "view_page",
		level: "read",
		description:
			"See one page of a source (PDF or image) as an image and read it yourself: for scans the code's OCR reads badly (tables of an inventarizācijas lieta, stamps, handwriting, drawings). Page numbers from 1. Read the page as it is; say what you cannot read.",
		input: { sourceId: z.string(), page: z.number().int().min(1).optional(), scale: z.number().min(1).max(3).optional().describe("2 by default; 3 for small print") },
		run: async (ctx, a): Promise<ImageResult> => {
			if (!ctx.projectId) throw new Error("nav projekta.");
			const r = await bridge(ctx, "/page", { projectId: ctx.projectId, sourceId: a.sourceId, page: a.page ?? 1, scale: a.scale ?? 2 });
			return { __image: { data: String(r.image), mimeType: String(r.mimeType) }, text: `Lapa ${r.page}${r.width ? ` (${r.width}×${r.height})` : ""} no ${a.sourceId}.` };
		},
	}),
];
