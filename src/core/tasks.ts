// Tasks (task 8.5): the user's to-do list for a project, which the agent may add to as a proposal. The rules are the pins'
// rules: the agent proposes and edits, only the user accepts, finishes or drops.
import { newId, type Task, type Who } from "./model.js";
import type { ProjectStore } from "./store.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface TaskInput {
	title: string;
	due?: string | null;
	refs?: Task["refs"];
	note?: string;
}

function checkDue(due: string | null | undefined): string | null {
	if (due === undefined || due === null || due === "") return null;
	if (!ISO.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due) throw new Error("Datums formā GGGG-MM-DD.");
	return due;
}

export function addTask(store: ProjectStore, input: TaskInput, by: Who): Task {
	const title = input.title.trim();
	if (title.length < 2) throw new Error("Uzdevumam vajag nosaukumu.");
	const task: Task = { id: newId("t"), title, due: checkDue(input.due), state: by === "agent" ? "proposed" : "open", refs: input.refs ?? {}, ...(input.note?.trim() ? { note: input.note.trim() } : {}), by, at: new Date().toISOString() };
	store.update("tasks", (all) => [...all, task], { kind: "task.added", by, data: { id: task.id, state: task.state } });
	return task;
}

export interface TaskPatch {
	title?: string;
	due?: string | null;
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
