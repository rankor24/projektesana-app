// The agent's task tools (task 8.5): read the project's tasks, propose one, change what one says or when it is due. The
// agent never accepts, finishes or drops a task: a task it adds waits as "proposed" until the user takes it.
import { z } from "zod";
import { taskOrder } from "../../shared/calendar.js";
import { addTask, updateTask } from "../../core/tasks.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "GGGG-MM-DD");

export const todoTools: ToolDef[] = [
	tool({
		name: "list_tasks",
		level: "read",
		description: "The project's tasks (the user's to-do list): proposed ones waiting for the user, open ones by due date, done ones. Not the same as the task templates the app offers.",
		input: { state: z.enum(["proposed", "open", "done"]).optional() },
		run: (ctx, { state }) => {
			const all = taskOrder(storeOf(ctx).read("tasks")).filter((t) => !state || t.state === state);
			return all.length ? all : "no data: uzdevumu nav.";
		},
	}),
	tool({
		name: "create_task",
		level: "propose",
		description: "Propose a task for the project, with a due date when one is known and the finding, pin or delivery it comes from. It waits as 'proposed' until the user accepts it.",
		input: { title: z.string().min(2), due: ISO_DATE.optional(), note: z.string().optional(), findingId: z.string().optional(), pinId: z.string().optional(), deliveryId: z.string().optional() },
		run: (ctx, a) => {
			const t = addTask(storeOf(ctx), { title: a.title, due: a.due, note: a.note, refs: { ...(a.findingId ? { findingId: a.findingId } : {}), ...(a.pinId ? { pinId: a.pinId } : {}), ...(a.deliveryId ? { deliveryId: a.deliveryId } : {}) } }, "agent");
			return { ok: true, task: t.id, note: "Uzdevums piedāvāts; to pieņem lietotājs." };
		},
	}),
	tool({
		name: "update_task",
		level: "propose",
		description: "Change the title, due date or note of a task that is not done. You cannot accept, finish or drop a task: the user does.",
		input: { taskId: z.string(), title: z.string().min(2).optional(), due: ISO_DATE.nullable().optional(), note: z.string().optional() },
		run: (ctx, { taskId, ...patch }) => ({ ok: true, task: updateTask(storeOf(ctx), taskId, patch, "agent").id }),
	}),
];
