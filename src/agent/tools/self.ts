// An agent improving itself, and telling Boris about the app's own faults.
//   edit_own_role     its role text (agents\<id>.md), appended to or rewritten; the old text is kept and the change is undoable in Atmiņa
//   draft_skill       a new skill as a DRAFT in the office library; it becomes active only when the user marks it tested on the Prasmes page
//   report_app_issue  a problem with the app itself (a missing tool, a wrong reading, a crash) goes to <app data>\app-issues.jsonl, not into
//                     the project's notes; Atmiņa lists it with status and copy-to-clipboard
// Every change is logged with its text before and after (agent/self-journal.ts). `report_app_issue` is a read-level tool: it changes no
// project data and no agent, only the app's own problem list, so every agent has it at once and the process stages do not block it.
import { z } from "zod";
import { reportIssue } from "../app-issues.js";
import { savedSpec } from "../memory-md.js";
import { changeOwnRole, draftSkill } from "../self-changes.js";
import { LEAD_ID } from "../../shared/thread-types.js";
import type { ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const me = (ctx: ToolCtx): string => ctx.agent || LEAD_ID;

export const selfTools: ToolDef[] = [
	tool({
		name: "edit_own_role",
		level: "run",
		description: "Add a lasting lesson to your own role text (append; replace may not shorten it by half). Logged, undoable.",
		input: { mode: z.enum(["append", "replace"]), text: z.string(), reason: z.string().min(5) },
		run: (ctx, a) => {
			const spec = ctx.agent && ctx.agent !== LEAD_ID ? savedSpec(ctx.appDir, ctx.agent) : undefined;
			if (!spec) throw new Error("Galvenā aģenta un Iestatījumos neglabātu aģentu lomu šeit nemaina. Jautā lietotājam.");
			const c = changeOwnRole(ctx.appDir, spec, a.mode, a.text, a.reason);
			return { ok: true, change: c.id, note: "Loma mainīta no nākamā gājiena; izmaiņa ir Atmiņā un atsaucama." };
		},
	}),
	tool({
		name: "draft_skill",
		level: "run",
		description: "Write a skill as a draft in the office library; inactive until the user marks it tested. Only your own draft can be rewritten.",
		input: { name: z.string(), description: z.string(), body: z.string(), reason: z.string().min(5) },
		run: (ctx, a) => {
			const c = draftSkill(ctx.appDir, ctx.skillsDir ?? "", me(ctx), { name: a.name, description: a.description, body: a.body }, a.reason);
			return { ok: true, change: c.id, note: "Melnraksts ir bibliotēkā; tas nav aktīvs, kamēr lietotājs to neatzīmē kā pārbaudītu (Prasmes)." };
		},
	}),
	tool({
		name: "report_app_issue",
		level: "read",
		description: "Report a fault of the app itself (missing tool, wrong reading, crash), not a project matter.",
		input: { title: z.string(), details: z.string(), where: z.string() },
		run: (ctx, a) => {
			const r = reportIssue(ctx.appDir, { agent: me(ctx), title: a.title, details: a.details, where: a.where });
			return { ok: true, issue: r.issue.id, note: r.duplicate ? "Tāda problēma jau ir sarakstā (atvērta)." : "Problēma ierakstīta lietotnes problēmu sarakstā (Atmiņa); to izlabos lietotnes autors." };
		},
	}),
];
