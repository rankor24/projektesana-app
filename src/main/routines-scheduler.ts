// Routines in the main process: the scheduler that starts an agent's run at the time, and the calls the Rutīnas tab makes (list, preview,
// save, pause, delete, run now, the days for the calendar). One class, so the timer and the page use the same code and the same files.
//
// Ported in idea from OpenMausBot (Apache-2.0): server/routines.ts (the scheduler pass), server/routine-catch-up.ts, server/routine-recovery.ts
// and docs/routine-schedules.md ("Dates, clock changes and downtime"), reduced to what a design office needs:
//   - it works only while the app runs; at start-up a routine that came due while the app was closed runs ONCE if its newest occurrence is no
//     more than 12 hours old, and says so ("novēlots"); older ones are counted on one "missed" row;
//   - an occurrence starts once: the routine's cursor is saved before the start (core/routines.ts planDue);
//   - a start that is refused (the agent is busy, no sign-in) is tried again each minute for an hour, then closed as failed;
//   - each run is a thread of its own with the agent ("Rutīna · name · time"), so the run card, the queue and Gaida tevi work as for any run;
//   - the run's end is noticed by the thread leaving the queue; its last answer is the result (a line in the routine's log and, in mode
//     task-result, the note of the task the routine made for that day).
// Not taken: overlap policies, run limits, backup-AI retries (the coordinator's own failover already covers a limit), the ledger file.
import { existsSync } from "node:fs";
import { wallText, DEFAULT_TZ } from "../core/cron.js";
import { addRun, editRoutine, newRoutine, newRun, occurrencesIn, planDue, readRoutines, readTiming, RETRY_MAX, RETRY_MS, routinesFile, setPaused, todayIn, toRow, updateRoutines, type Routine, type RoutineScope } from "../core/routines.js";
import { addTask, updateTask } from "../core/tasks.js";
import type { ProjectStore } from "../core/store.js";
import type { AgentSpec } from "../shared/agent-types.js";
import type { ChatEntry } from "../shared/api.js";
import type { RoutineInput, RoutineOccurrence, RoutinePreview, RoutineRow, RoutineRunRow } from "../shared/routine-types.js";
import { LEAD_ID, type QueueView, type Thread } from "../shared/thread-types.js";

/** What the service needs of the rest of the app (the session, the project list, the agents); tests give it fakes. */
export interface RoutineDeps {
	appDir: string;
	projectsDir: string;
	projectIds: () => string[];
	agents: () => readonly Pick<AgentSpec, "id">[];
	session: {
		openThread(projectId: string | null, agent: string, title?: string): Thread;
		sendToThread(threadId: string, projectId: string | null, text: string, focus: never[]): Promise<{ runId: string | null; queued: boolean }>;
		queueView(): QueueView;
		threadHistory(threadId: string, projectId: string | null): ChatEntry[];
	};
	store: (projectId: string) => ProjectStore;
	changed: (projectId: string | null, what: string[]) => void;
	log?: (line: string) => void;
	now?: () => number;
}

/** How often the scheduler looks. A routine's finest step is a minute, so half a minute never misses one. */
export const TICK_MS = 30_000;

const oneLine = (t: string, max: number) => {
	const s = t.replace(/\s+/g, " ").trim();
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export class RoutineService {
	private timer: ReturnType<typeof setInterval> | null = null;
	private busy = false;
	/** runs being started in this process: a second tick does not start the same row */
	private starting = new Set<string>();

	constructor(private d: RoutineDeps) {}

	private now = () => this.d.now?.() ?? Date.now();
	private scope = (projectId: string | null): RoutineScope => ({ appDir: this.d.appDir, projectsDir: this.d.projectsDir, projectId });
	private file = (projectId: string | null) => routinesFile(this.scope(projectId));
	private known = (): string[] => [LEAD_ID, ...this.d.agents().map((a) => a.id)];

	// ---- the calls of the page ----------------------------------------------------------------------------------------------------------

	list(projectId: string | null): RoutineRow[] {
		return readRoutines(this.file(projectId)).map((r) => toRow(r, projectId, this.now()));
	}

	preview(when: string, tz?: string): RoutinePreview {
		const zone = tz?.trim() || DEFAULT_TZ;
		try {
			const t = readTiming(when, zone);
			return { ok: true, cron: t.cron, text: t.text, next: t.next.map((n) => wallText(n, t.tz)), tz: t.tz };
		} catch (e) {
			return { ok: false, error: (e as Error).message, tz: zone };
		}
	}

	save(projectId: string | null, input: RoutineInput): RoutineRow {
		const file = this.file(projectId);
		if (projectId && !existsSync(this.d.projectsDir)) throw new Error("Projektu mape nav pieejama.");
		const draft = { name: input.name, agent: input.agent, instruction: input.instruction, when: input.when, tz: input.tz, taskMode: projectId ? input.taskMode : "none" } as const;
		let saved: Routine;
		if (input.id) {
			saved = updateRoutines(file, (list) => {
				const at = list.findIndex((r) => r.id === input.id);
				if (at < 0) throw new Error(`Rutīna ${input.id} nav atrasta.`);
				list[at] = editRoutine(list[at], draft, this.known(), this.now());
				return list[at];
			});
		} else {
			saved = updateRoutines(file, (list) => {
				if (list.length >= 60) throw new Error("Rutīnu ir par daudz (60): izdzēs kādu.");
				const r = newRoutine(draft, "user", this.known(), this.now());
				list.push(r);
				return r;
			});
		}
		this.d.changed(projectId, ["routines"]);
		return toRow(saved, projectId, this.now());
	}

	setPaused(projectId: string | null, id: string, paused: boolean): RoutineRow {
		const r = updateRoutines(this.file(projectId), (list) => {
			const at = list.findIndex((x) => x.id === id);
			if (at < 0) throw new Error(`Rutīna ${id} nav atrasta.`);
			list[at] = setPaused(list[at], paused, this.now());
			return list[at];
		});
		this.d.changed(projectId, ["routines"]);
		return toRow(r, projectId, this.now());
	}

	remove(projectId: string | null, id: string): void {
		updateRoutines(this.file(projectId), (list) => {
			const at = list.findIndex((x) => x.id === id);
			if (at < 0) throw new Error(`Rutīna ${id} nav atrasta.`);
			list.splice(at, 1);
		});
		this.d.changed(projectId, ["routines"]);
	}

	/** The days from `from` to `to` on which a project's routines (and the whole app's) run. */
	occurrences(projectId: string | null, from: string, to: string): RoutineOccurrence[] {
		const ids: (string | null)[] = projectId ? [projectId, null] : [null];
		return ids.flatMap((id) => readRoutines(this.file(id)).flatMap((r) => occurrencesIn(r, id, from, to))).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
	}

	/** Starts the routine's agent now, as a run of its own. The routine's schedule is not touched. A start that is refused is an error for the user, not a retry. */
	async runNow(projectId: string | null, id: string): Promise<{ thread: string }> {
		const file = this.file(projectId);
		const r = readRoutines(file).find((x) => x.id === id);
		if (!r) throw new Error(`Rutīna ${id} nav atrasta.`);
		const row = newRun(this.now(), { note: "palaists ar roku" });
		updateRoutines(file, (list) => void addRun(list.find((x) => x.id === id)!, row));
		const err = await this.startRow(projectId, id, row.id);
		if (err) {
			this.patchRun(file, id, row.id, (x) => {
				x.state = "failed";
				x.note = err;
			});
			this.d.changed(projectId, ["routines"]);
			throw new Error(err);
		}
		return { thread: readRoutines(file).find((x) => x.id === id)?.runs.find((x) => x.id === row.id)?.thread ?? "" };
	}

	// ---- the scheduler ---------------------------------------------------------------------------------------------------------------------

	/** Starts the timer. The first look is a few seconds after the app opens, once the window is up. */
	start(firstAfterMs = 4000): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		setTimeout(() => void this.tick(), firstAfterMs);
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	/** One look at every routine of every project and of the app: finish what ran, retry what could not start, start what is due. */
	async tick(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			for (const projectId of [null, ...this.d.projectIds()]) {
				const file = this.file(projectId);
				if (!existsSync(file)) continue;
				let changed = false;
				for (const r0 of readRoutines(file)) {
					try {
						changed = (await this.pass(projectId, file, r0.id)) || changed;
					} catch (e) {
						this.d.log?.(`routines: ${r0.name}: ${(e as Error).message}`);
					}
				}
				if (changed) this.d.changed(projectId, ["routines"]);
			}
		} finally {
			this.busy = false;
		}
	}

	/** The three steps for one routine; true when its file changed. */
	private async pass(projectId: string | null, file: string, id: string): Promise<boolean> {
		let changed = this.finish(projectId, file, id);
		const now = this.now();
		// the occurrences that came due: the cursor and the row go into the file BEFORE anything starts
		const fresh: string[] = [];
		updateRoutines(file, (list) => {
			const r = list.find((x) => x.id === id);
			const plan = r ? planDue(r, now) : null;
			if (!r || !plan) return;
			r.cursor = new Date(plan.cursor).toISOString();
			if (plan.missed > 0) addRun(r, newRun(plan.cursor, { state: "missed", count: plan.missed, note: `${plan.missed === 1 ? "Izlaista 1 reize" : `Izlaistas ${plan.missed} reizes`}: ${plan.why ?? "lietotne nebija atvērta"}` }));
			if (plan.fire) {
				const row = newRun(plan.fire.at, { ...(plan.fire.late ? { late: true, note: "novēlots: lietotne tajā laikā nebija atvērta" } : {}) });
				addRun(r, row);
				fresh.push(row.id);
			}
			changed = true;
		});
		// what is waiting to start: the new rows, and those whose retry time has come
		const r = readRoutines(file).find((x) => x.id === id);
		const waiting = (r?.runs ?? []).filter((x) => x.state === "pending" && (fresh.includes(x.id) || !x.retryAt || Date.parse(x.retryAt) <= now)).map((x) => x.id);
		for (const rowId of waiting) {
			const err = await this.startRow(projectId, id, rowId);
			changed = true;
			if (!err) continue;
			this.patchRun(file, id, rowId, (x) => {
				x.tries = (x.tries ?? 0) + 1;
				if (x.tries >= RETRY_MAX) {
					x.state = "failed";
					x.note = `Neizdevās sākt stundas laikā: ${err}`;
					delete x.retryAt;
				} else {
					x.note = `gaida: ${err}`;
					x.retryAt = new Date(this.now() + RETRY_MS).toISOString();
				}
			});
		}
		return changed;
	}

	/** Starts one pending row: the task of the day (when the routine makes one), the thread and the message. Returns an error sentence, or "" when it started. */
	private async startRow(projectId: string | null, id: string, rowId: string): Promise<string> {
		if (this.starting.has(rowId)) return "";
		this.starting.add(rowId);
		const file = this.file(projectId);
		try {
			const r = readRoutines(file).find((x) => x.id === id);
			const row = r?.runs.find((x) => x.id === rowId);
			if (!r || !row) return "rutīna vai rinda nav atrasta";
			if (r.agent !== LEAD_ID && !this.d.agents().some((a) => a.id === r.agent)) return `aģents ${r.agent} vairs nav`;
			let taskId = row.taskId;
			if (!taskId && projectId && r.taskMode !== "none") {
				const t = addTask(this.d.store(projectId), { title: `Rutīna: ${r.name}`, due: todayIn(r.tz, this.now()), note: r.instruction.slice(0, 500) }, "app");
				taskId = t.id;
				this.patchRun(file, id, rowId, (x) => void (x.taskId = t.id));
				this.d.changed(projectId, ["tasks"]);
			}
			let threadId = row.thread;
			if (!threadId) {
				const title = `Rutīna · ${r.name} · ${wallText(Date.parse(row.scheduledFor), r.tz)}`.slice(0, 80);
				threadId = this.d.session.openThread(projectId, r.agent, title).id;
				this.patchRun(file, id, rowId, (x) => void (x.thread = threadId));
			}
			await this.d.session.sendToThread(threadId, projectId, this.promptOf(r, row), []);
			this.patchRun(file, id, rowId, (x) => {
				x.state = "running";
				x.startedAt = new Date(this.now()).toISOString();
				delete x.retryAt;
				if (x.note?.startsWith("gaida")) delete x.note;
			});
			return "";
		} catch (e) {
			return (e as Error).message;
		} finally {
			this.starting.delete(rowId);
		}
	}

	/** What the agent is told. A late start says why; a routine that makes a task says the answer goes into it. */
	private promptOf(r: Routine, row: RoutineRunRow): string {
		const when = wallText(Date.parse(row.scheduledFor), r.tz);
		return [
			`Rutīna «${r.name}», plānotais laiks ${when}.${row.late ? " Palaists novēloti: lietotne plānotajā laikā nebija atvērta." : ""}`,
			r.instruction,
			r.taskMode === "task-result" ? "Beigās atbildi ar īsu rezultātu: tas tiks ierakstīts šīs dienas uzdevuma piezīmē." : "",
		]
			.filter(Boolean)
			.join("\n\n");
	}

	/** Running rows whose thread has left the queue are over: the last answer is the result. Returns true when something changed. */
	private finish(projectId: string | null, file: string, id: string): boolean {
		const running = readRoutines(file).find((x) => x.id === id)?.runs.filter((x) => x.state === "running" && x.thread) ?? [];
		if (!running.length) return false;
		const q = this.d.session.queueView();
		const live = new Set([...q.running.map((x) => x.threadId), ...q.queued.map((x) => x.threadId)]);
		let changed = false;
		for (const row of running) {
			if (live.has(row.thread!)) continue;
			// a run that has only just been handed over is not in the table for a moment
			if (this.now() - Date.parse(row.startedAt ?? row.scheduledFor) < 10_000) continue;
			let answer = "";
			try {
				const sinceMs = Date.parse(row.startedAt ?? row.scheduledFor) - 1000;
				answer = [...this.d.session.threadHistory(row.thread!, projectId)].reverse().find((e) => e.role === "assistant" && !e.kind && Date.parse(e.at) >= sinceMs)?.text ?? "";
			} catch {
				// a thread that cannot be read: the run is closed without an answer
			}
			const r = readRoutines(file).find((x) => x.id === id)!;
			if (answer && projectId && r.taskMode === "task-result" && row.taskId) {
				try {
					updateTask(this.d.store(projectId), row.taskId, { note: `${r.instruction.slice(0, 200)}\n\n${answer.slice(0, 6000)}` }, "app");
					this.d.changed(projectId, ["tasks"]);
				} catch (e) {
					this.d.log?.(`routines: task note: ${(e as Error).message}`);
				}
			}
			this.patchRun(file, id, row.id, (x) => {
				x.state = answer ? "ran" : "failed";
				x.note = answer ? oneLine(answer, 160) : "aģents neatbildēja (skaties sarunu)";
			});
			changed = true;
		}
		return changed;
	}

	private patchRun(file: string, id: string, rowId: string, fn: (x: RoutineRunRow) => void): void {
		updateRoutines(file, (list) => {
			const row = list.find((r) => r.id === id)?.runs.find((x) => x.id === rowId);
			if (row) fn(row);
		});
	}
}
