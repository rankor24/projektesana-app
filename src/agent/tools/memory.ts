// The agent's Markdown memory as tools (agent/memory-md.ts): read its own, its department's or the office's file, write its own, write its
// department's when it is the department's lead (BPV when none is set), and write the office's, which waits for the user's click (level
// confirm). The writer rule is enforced in memory-md (`writeRefusal`), not here, so the settings page and these tools cannot disagree.
import { z } from "zod";
import { LEAD_ID } from "../../shared/thread-types.js";
import { addEntry, departmentOfAgent, findEntries, forgetEntry, keeperOf, readMemory, writeMemory, type MemoryRef } from "../memory-md.js";
import type { ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const me = (ctx: ToolCtx): string => ctx.agent || LEAD_ID;

/** The file a scope names for this agent. */
function refOf(ctx: ToolCtx, scope: "own" | "department" | "office"): MemoryRef {
	if (scope === "office") return { kind: "office", id: "office" };
	if (scope === "own") return { kind: "agent", id: me(ctx) };
	const dept = departmentOfAgent(ctx.appDir, me(ctx));
	if (!dept) throw new Error("Tu neesi nevienā nodaļā: nodaļas atmiņas nav.");
	return { kind: "department", id: dept };
}

const READ_MAX = 20_000;

const WRITE_INPUT = {
	action: z.enum(["add", "forget", "rewrite"]),
	text: z.string().optional(),
	find: z.string().optional(),
	until: z.string().optional(),
};

function write(ctx: ToolCtx, ref: MemoryRef, a: { action: "add" | "forget" | "rewrite"; text?: string; find?: string; until?: string }): unknown {
	const o = { by: "agent" as const, agent: me(ctx) };
	if (a.action === "add") {
		if (!a.text) throw new Error("add: vajag text.");
		return { ok: true, ...addEntry(ctx.appDir, ref, a.text, { ...o, until: a.until }), note: "Ieraksts pievienots; lietotājs to redz Atmiņā un var atsaukt." };
	}
	if (a.action === "forget") {
		if (!a.find) throw new Error("forget: vajag find.");
		return { ok: true, ...forgetEntry(ctx.appDir, ref, a.find, o), note: "Ieraksts pārsvītrots (nekas netiek dzēsts)." };
	}
	if (!a.text) throw new Error("rewrite: vajag text.");
	return { ok: true, ...writeMemory(ctx.appDir, ref, a.text, o), note: "Fails pārrakstīts; iepriekšējais teksts saglabāts un atsaucams." };
}

export const memoryTools: ToolDef[] = [
	tool({
		name: "memory_read",
		level: "read",
		description: "Read your own, department or office memory; with find, only entries that contain all its words.",
		input: { scope: z.enum(["own", "department", "office"]), find: z.string().optional() },
		run: (ctx, { scope, find }) => {
			const ref = refOf(ctx, scope);
			if (find?.trim()) {
				const hits = findEntries(ctx.appDir, ref, find);
				return hits.length ? hits.join("\n") : `Nekas neatbilst «${find}».`;
			}
			const t = readMemory(ctx.appDir, ref);
			if (!t.trim()) return `no data: ${scope} atmiņa ir tukša (rakstītājs: ${keeperOf(ctx.appDir, ref)}).`;
			return t.length > READ_MAX ? `${t.slice(0, READ_MAX)}\n[… apgriezts; lieto find]` : t;
		},
	}),
	tool({
		name: "memory_write",
		level: "run",
		description: "Write your own memory, or your department's if you lead it. add = dated entry (text, optional until GGGG-MM-DD); forget = strike the entry containing find; rewrite = whole file (text). No secrets.",
		input: { scope: z.enum(["own", "department"]), ...WRITE_INPUT },
		run: (ctx, a) => write(ctx, refOf(ctx, a.scope), a),
	}),
	tool({
		name: "memory_write_office",
		level: "confirm",
		description: "Office memory (BPV only; the user confirms). Same input as memory_write.",
		input: WRITE_INPUT,
		run: (ctx, a) => write(ctx, refOf(ctx, "office"), a),
	}),
];
