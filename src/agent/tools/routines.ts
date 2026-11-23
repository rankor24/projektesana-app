// Routines as agent tools (core/routines.ts): list them, make one, pause or delete one the agent made. The model turns the user's words
// ("every Monday at 9", "katras nedēļas pirmdienā") into a five-field cron expression and passes it as `when`; the app checks it with its own
// reader (core/cron.ts, no network) and answers with the sentence and the next three runs, so the model can see whether it understood.
// A routine an agent makes is only a proposal: it does not run until the user starts it in Grafiks → Rutīnas (an unattended run costs the
// user's money, so an agent cannot start one on its own). Pausing is allowed for any routine; deleting only for one the agent made itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LEAD_ID } from "../../shared/thread-types.js";
import { newRoutine, readRoutines, routinesFile, setPaused, toRow, updateRoutines, type RoutineScope } from "../../core/routines.js";
import type { ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const me = (ctx: ToolCtx): string => ctx.agent || LEAD_ID;
const scopeOf = (ctx: ToolCtx, app = false): RoutineScope => ({ appDir: ctx.appDir, projectsDir: ctx.projectsDir, projectId: app ? null : ctx.projectId });

/** Ids of the agents that exist (agents.json) and the main agent. */
function known(ctx: ToolCtx): string[] {
	try {
		const j = JSON.parse(readFileSync(join(ctx.appDir, "agents.json"), "utf8")) as { id?: unknown }[];
		return [LEAD_ID, ...(Array.isArray(j) ? j.map((a) => a.id).filter((x): x is string => typeof x === "string") : [])];
	} catch {
		return [LEAD_ID];
	}
}

export const routineTools: ToolDef[] = [
	tool({
		name: "routine_list",
		level: "read",
		description: "The routines (agent + instruction + schedule) of this project and of the whole app, with the next runs and the last results.",
		input: {},
		run: (ctx) => {
			const rows = [
				...(ctx.projectId ? readRoutines(routinesFile(scopeOf(ctx))).map((r) => toRow(r, ctx.projectId)) : []),
				...readRoutines(routinesFile(scopeOf(ctx, true))).map((r) => toRow(r, null)),
			].map((r) => ({ ...r, runs: r.runs.slice(0, 3) }));
			return rows.length ? rows : "no data: rutīnu nav.";
		},
	}),
	tool({
		name: "routine_create",
		level: "propose",
		description:
			"Propose a routine (an agent runs an instruction on a schedule). when = 5-field cron from the user's words: '0 9 * * 1' Mondays 9:00, '0 9 1 * *' 1st of month, L last day, MON#2 second Monday. The user starts it; the next 3 runs come back. taskMode task = a task per run, task-result = and the answer in its note.",
		input: {
			name: z.string(),
			agent: z.string(),
			instruction: z.string(),
			when: z.string(),
			taskMode: z.enum(["none", "task", "task-result"]).optional(),
			wholeApp: z.boolean().optional(),
		},
		run: (ctx, a) => {
			const scope = scopeOf(ctx, a.wholeApp === true);
			const taskMode = scope.projectId ? a.taskMode : "none";
			const r = newRoutine({ name: a.name, agent: a.agent, instruction: a.instruction, when: a.when, taskMode }, me(ctx), known(ctx));
			updateRoutines(routinesFile(scope), (list) => {
				list.push(r);
			});
			const row = toRow({ ...r, proposed: false }, scope.projectId);
			return { ok: true, routine: r.id, schedule: row.text, cron: r.cron, nextRuns: row.next, note: "Rutīna gaida lietotāju: viņš to sāk Grafiks → Rutīnas." };
		},
	}),
	tool({
		name: "routine_change",
		level: "propose",
		description: "Pause a routine, or delete one you made yourself.",
		input: { id: z.string(), action: z.enum(["pause", "delete"]) },
		run: (ctx, { id, action }) => {
			for (const scope of [scopeOf(ctx), scopeOf(ctx, true)]) {
				const file = routinesFile(scope);
				const list = readRoutines(file);
				const at = list.findIndex((r) => r.id === id);
				if (at < 0) continue;
				if (action === "delete") {
					if (list[at].createdBy !== me(ctx)) throw new Error("Rutīnu, ko izveidoja lietotājs vai cits aģents, dzēš tikai lietotājs. Vari to apturēt (pause).");
					updateRoutines(file, (l) => void l.splice(l.findIndex((r) => r.id === id), 1));
					return { ok: true, note: "Rutīna izdzēsta." };
				}
				updateRoutines(file, (l) => void (l[l.findIndex((r) => r.id === id)] = setPaused(l.find((r) => r.id === id)!, true)));
				return { ok: true, note: "Rutīna apturēta; lietotājs to var atsākt." };
			}
			throw new Error(`Rutīna ${id} nav atrasta.`);
		},
	}),
];
