// Per-project work items that the dashboard and the technical-rules panels show: tasks, and technical-rules requests.
// Stored in .bv; every change is logged. Nothing here is sample data: an empty list is `no data`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLog } from "../../kernel/log.js";
import { technicalRulesDeadline } from "../rules/engine.js";

// ---- tasks ---------------------------------------------------------------------

export interface Task {
	id: string;
	title: string;
	/** YYYY-MM-DD or null */
	due: string | null;
	done: boolean;
	createdAt: string;
}

const tasksFile = (root: string) => join(root, ".bv", "tasks.json");

export function loadTasks(root: string): Task[] {
	return existsSync(tasksFile(root)) ? (JSON.parse(readFileSync(tasksFile(root), "utf8")) as Task[]) : [];
}

export function addTask(root: string, title: string, due: string | null, now = new Date()): Task {
	if (!title.trim()) throw new Error("Uzdevuma nosaukums ir tukšs.");
	if (due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Termiņš jānorāda formātā GGGG-MM-DD.");
	const all = loadTasks(root);
	const t: Task = { id: `t${all.length + 1}`, title: title.trim(), due, done: false, createdAt: now.toISOString() };
	writeFileSync(tasksFile(root), JSON.stringify([...all, t], null, 1), "utf8");
	appendLog(root, { kind: "task.added", by: "boris", data: { id: t.id, title: t.title, due } }, now);
	return t;
}

export function setTaskDone(root: string, id: string, done: boolean): Task {
	const all = loadTasks(root);
	const t = all.find((x) => x.id === id);
	if (!t) throw new Error(`Nav uzdevuma ${id}`);
	t.done = done;
	writeFileSync(tasksFile(root), JSON.stringify(all, null, 1), "utf8");
	appendLog(root, { kind: done ? "task.done" : "task.reopened", by: "boris", data: { id } });
	return t;
}

// ---- technical rules requests (panels 5–6) -------------------------------------

export type TrStatus = "pieprasīts" | "saņemts" | "nav pieprasīts";
export type TrIssuer = "state_municipal" | "network_owner";

export interface TrRequest {
	id: string;
	/** who issues it: Rīgas dome, Latvijas Gāze, Sadales tīkls, ... */
	who: string;
	issuer: TrIssuer;
	status: TrStatus;
	requestedOn: string | null;
	receivedOn: string | null;
	/** project-relative path of the received file */
	file: string | null;
	note: string;
	/** present when the agent found the request in a project file; Boris confirms or removes it */
	found?: { by: string; file: string; quote: string; confirmed: boolean };
}

const trFile = (root: string) => join(root, ".bv", "technical-rules.json");

export function loadTr(root: string): TrRequest[] {
	return existsSync(trFile(root)) ? (JSON.parse(readFileSync(trFile(root), "utf8")) as TrRequest[]) : [];
}

const isDate = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s);

export function addTr(root: string, r: Omit<TrRequest, "id">, by = "boris"): TrRequest {
	if (!r.who.trim()) throw new Error("Norādi, no kā tehniskie noteikumi tiek prasīti.");
	if (!isDate(r.requestedOn) || !isDate(r.receivedOn)) throw new Error("Datumi jānorāda formātā GGGG-MM-DD.");
	if (r.status === "pieprasīts" && !r.requestedOn) throw new Error("Statusam „pieprasīts” vajag pieprasīšanas datumu.");
	if (r.status === "saņemts" && !r.receivedOn) throw new Error("Statusam „saņemts” vajag saņemšanas datumu.");
	const all = loadTr(root);
	const next = Math.max(0, ...all.map((t) => Number(t.id.slice(2)) || 0)) + 1;
	const x: TrRequest = { ...r, id: `tr${next}` };
	writeFileSync(trFile(root), JSON.stringify([...all, x], null, 1), "utf8");
	appendLog(root, { kind: "tr.added", by, data: x as unknown as Record<string, unknown> });
	return x;
}

/** Boris looked at a request the agent found in a file and says it is right. */
export function confirmTr(root: string, id: string): TrRequest {
	const all = loadTr(root);
	const x = all.find((r) => r.id === id);
	if (!x) throw new Error(`Nav pieprasījuma ${id}`);
	if (x.found) x.found.confirmed = true;
	writeFileSync(trFile(root), JSON.stringify(all, null, 1), "utf8");
	appendLog(root, { kind: "tr.confirmed", by: "boris", data: { id } });
	return x;
}

/** Removes a request from the list (the log keeps it). Used when the agent found something that is not one. */
export function removeTr(root: string, id: string): boolean {
	const all = loadTr(root);
	const x = all.find((r) => r.id === id);
	if (!x) throw new Error(`Nav pieprasījuma ${id}`);
	writeFileSync(trFile(root), JSON.stringify(all.filter((r) => r.id !== id), null, 1), "utf8");
	appendLog(root, { kind: "tr.removed", by: "boris", data: x as unknown as Record<string, unknown> });
	return true;
}

export function updateTr(root: string, id: string, patch: Partial<Omit<TrRequest, "id">>): TrRequest {
	const all = loadTr(root);
	const x = all.find((r) => r.id === id);
	if (!x) throw new Error(`Nav pieprasījuma ${id}`);
	Object.assign(x, patch);
	if (!isDate(x.requestedOn) || !isDate(x.receivedOn)) throw new Error("Datumi jānorāda formātā GGGG-MM-DD.");
	writeFileSync(trFile(root), JSON.stringify(all, null, 1), "utf8");
	appendLog(root, { kind: "tr.updated", by: "boris", data: { id, patch } });
	return x;
}

/** Legal deadline of a request (MK 500 27.1/27.2); null until a request date exists. */
export function trDeadline(r: TrRequest) {
	return r.requestedOn ? technicalRulesDeadline(r.requestedOn, r.issuer) : null;
}

// ---- calendar: only real dates -------------------------------------------------

export interface CalendarEntry {
	date: string;
	kind: "task" | "tr-deadline";
	title: string;
}

export function calendar(root: string): CalendarEntry[] {
	const out: CalendarEntry[] = [];
	for (const t of loadTasks(root)) if (t.due && !t.done) out.push({ date: t.due, kind: "task", title: t.title });
	for (const r of loadTr(root)) {
		const d = r.status === "pieprasīts" ? trDeadline(r) : null;
		if (d) out.push({ date: d.due, kind: "tr-deadline", title: `Tehniskie noteikumi: ${r.who} (likuma termiņš, 11 darbdienas)` });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date));
}
