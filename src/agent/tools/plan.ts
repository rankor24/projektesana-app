// The agent's plan tool (task 9.2): keep the order of work visible above the user's input. Level read: it changes no project
// data, only the plan the user sees and may edit; his version always wins (core/plan.ts).
import { z } from "zod";
import { agentSetPlan } from "../../core/plan.js";
import { planProgress, STEP_STATES } from "../../shared/plan.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

export const planTools: ToolDef[] = [
	tool({
		name: "update_plan",
		level: "read",
		description: "Show the user your plan for multi-step work: send the WHOLE list each time (it replaces the last one), each step todo, doing, done or blocked, at most one doing. The user may edit it; his version wins.",
		input: { steps: z.array(z.object({ text: z.string(), state: z.enum(STEP_STATES) })).max(30) },
		run: (ctx, { steps }) => {
			const doc = agentSetPlan(storeOf(ctx), steps);
			return { ok: true, progress: planProgress(doc.steps).line };
		},
	}),
];
