// Tasks (task 8.5): the user's to-do list for a project, which the agent may add to as a proposal. The rules are the pins'
// rules: the agent proposes and edits, only the user accepts, finishes or drops.
import { newId, type ChecklistItem, type Task, type TaskPriority, type Who } from "./model.js";
import type { ProjectStore } from "./store.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface TaskInput {
	title: string;
	due?: string | null;
	/** the first day of a task that lasts */
	start?: string | null;
	priority?: TaskPriority;
	assignee?: string | null;
	checklist?: { id?: string; text: string; done?: boolean }[];
	refs?: Task["refs"];
	note?: string;
}

const PRIORITIES: readonly TaskPriority[] = ["low", "normal", "high"];
const MAX_CHECKLIST = 40;

function checkPriority(p: unknown): TaskPriority {
	if (!PRIORITIES.includes(p as TaskPriority)) throw new Error("Prioritāte: zema, parasta vai augsta.");
	return p as TaskPriority;
}
function checkChecklist(list: NonNullable<TaskInput["checklist"]>): ChecklistItem[] {
	if (list.length > MAX_CHECKLIST) throw new Error(`Kontrolsarakstā var būt līdz ${MAX_CHECKLIST} punktiem.`);
	return list
		.map((i) => ({ id: i.id || newId("c"), text: String(i.text ?? "").trim().slice(0, 200), done: i.done === true }))
		.filter((i) => i.text.length > 0);
}
/** A task that lasts has its first day not after its last. */
function checkSpan(start: string | null | undefined, due: string | null | undefined) {
	if (start && due && start > due) throw new Error("Sākuma datums ir pēc termiņa.");
}

function checkDue(due: string | null | undefined): string | null {
	if (due === undefined || due === null || due === "") return null;
	if (!ISO.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due) throw new Error("Datums formā GGGG-MM-DD.");
	return due;
}

export function addTask(store: ProjectStore, input: TaskInput, by: Who): Task {
	const title = input.title.trim();
	if (title.length < 2) throw new Error("Uzdevumam vajag nosaukumu.");
	const start = checkDue(input.start);
	// a start with no end is a one-day task on that day
	const due = checkDue(input.due) ?? start;
	checkSpan(start, due);
	const checklist = input.checklist ? checkChecklist(input.checklist) : [];
	const assignee = input.assignee?.trim();
	const task: Task = {
		id: newId("t"),
		title,
		due,
		...(start && start !== due ? { start } : {}),
		...(input.priority ? { priority: checkPriority(input.priority) } : {}),
		...(assignee ? { assignee: assignee.slice(0, 80) } : {}),
		...(checklist.length ? { checklist } : {}),
		state: by === "agent" ? "proposed" : "open",
		refs: input.refs ?? {},
		...(input.note?.trim() ? { note: input.note.trim() } : {}),
		by,
		at: new Date().toISOString(),
	};
	store.update("tasks", (all) => [...all, task], { kind: "task.added", by, data: { id: task.id, state: task.state } });
	return task;
}

export interface TaskPatch {
	title?: string;
	due?: string | null;
	/** null: a one-day task again */
	start?: string | null;
	priority?: TaskPriority;
	/** null: nobody */
	assignee?: string | null;
	checklist?: { id?: string; text: string; done?: boolean }[];
	note?: string;
	state?: Task["state"];
}

/** The agent may change what a task says and when it is due (it never leaves `proposed` or finishes one); the user may do all. */
export function updateTask(store: ProjectStore, id: string, patch: TaskPatch, by: Who, now = new Date().toISOString()): Task {
	const cur = store.read("tasks").find((t) => t.id === id);
	if (!cur) throw new Error(`Uzdevums ${id} nav atrasts.`);
	if (by === "agent" && patch.state !== undefined) throw new Error("Uzdevuma stāvokli maina tikai lietotājs: aģents piedāvā, lietotājs pieņem un pabeidz.");
	if (by === "agent" && cur.state === "done") throw new Error("Pabeigtu uzdevumu aģents nemaina.");
	const next: Task = { ...cur };
	if (patch.title !== undefined) {
		if (patch.title.trim().length < 2) throw new Error("Uzdevumam vajag nosaukumu.");
		next.title = patch.title.trim();
	}
	if (patch.due !== undefined) next.due = checkDue(patch.due);
	if (patch.start !== undefined) {
		const start = checkDue(patch.start);
		if (start) next.start = start;
		else delete next.start;
	}
	// a start with no end is a one-day task on that day; a start that is the end is not kept
	if (next.start && !next.due) next.due = next.start;
	if (next.start && next.start === next.due) delete next.start;
	checkSpan(next.start, next.due);
	if (patch.priority !== undefined) next.priority = checkPriority(patch.priority);
	if (patch.assignee !== undefined) {
		const a = patch.assignee?.trim();
		if (a) next.assignee = a.slice(0, 80);
		else delete next.assignee;
	}
	if (patch.checklist !== undefined) {
		const list = checkChecklist(patch.checklist);
		if (list.length) next.checklist = list;
		else delete next.checklist;
	}
	if (patch.note !== undefined) next.note = patch.note.trim() || undefined;
	if (patch.state !== undefined && patch.state !== cur.state) {
		next.state = patch.state;
		if (patch.state === "done") next.doneAt = now;
		else delete next.doneAt;
	}
	store.update("tasks", (all) => all.map((t) => (t.id === id ? next : t)), { kind: "task.updated", by, data: { id, state: next.state } });
	return next;
}

/** Dropping a task is the user's. A proposed one the user does not want goes the same way. */
export function removeTask(store: ProjectStore, id: string, by: Who): void {
	if (by !== "user") throw new Error("Uzdevumu noņem tikai lietotājs.");
	if (!store.read("tasks").some((t) => t.id === id)) throw new Error(`Uzdevums ${id} nav atrasts.`);
	store.update("tasks", (all) => all.filter((t) => t.id !== id), { kind: "task.removed", by, data: { id } });
}
