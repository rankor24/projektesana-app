// The gates that wait for the user (task 14.3): one item of "Gaida tevi" per project whose process has a waiting gate. Reads each project's
// process.json straight from the data folder, like waitingQuestions does for notes, so the tools server's writes show without any message between processes.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { WaitingItem } from "../shared/thread-types.js";
import type { ProcessState } from "./process.js";
import type { Stage } from "./process-def.js";

type Gate = Extract<WaitingItem, { kind: "gate" }>;
type Escalated = Extract<WaitingItem, { kind: "escalated" }>;

/** The process.json of every project in process mode that is still running its stages. A project whose file cannot be read is left out. */
function running(projectsDir: string): { projectId: string; s: ProcessState & { stage: Stage } }[] {
	const out: { projectId: string; s: ProcessState & { stage: Stage } }[] = [];
	let dirs: string[] = [];
	try {
		dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(projectsDir, e.name, "process.json"))).map((e) => e.name);
	} catch {
		return out;
	}
	for (const projectId of dirs) {
		try {
			const s = JSON.parse(readFileSync(join(projectsDir, projectId, "process.json"), "utf8")) as ProcessState;
			if (s.mode !== "process" || s.stage === "mācības" || s.stage === "done") continue;
			out.push({ projectId, s: s as ProcessState & { stage: Stage } });
		} catch {
			// a torn or unreadable file: skipped
		}
	}
	return out;
}

/** Only a project in process mode: in co-work a waiting gate cannot be decided (the step refuses), so it is not offered. */
export function waitingGates(projectsDir: string): Gate[] {
	const out: Gate[] = [];
	for (const { projectId, s } of running(projectsDir)) {
		const g = [...s.gates].reverse().find((x) => x.stage === s.stage && x.state === "waiting");
		if (g) out.push({ kind: "gate", gate: g.id, projectId, noteId: g.noteId });
	}
	return out;
}

type EksStart = Extract<WaitingItem, { kind: "start-eks" }>;

/** When eks last began a run (R48): the newest `lastAt` of its threads that have run. A run's start sets both `runs` and `lastAt`; a thread only opened has
 *  `runs: 0`, so opening an empty eks conversation does not count as the expert having started. */
export const eksLastRun = (threads: readonly { runs: number; lastAt: string }[]): string | null =>
	threads.filter((t) => t.runs > 0).map((t) => t.lastAt).sort().at(-1) ?? null;

/** When S5 began: the newest approval of H4 or the newest "S4 izlaista" of the profile (a skip, or a profile that passes S4 over). Later gate decisions or profile changes inside S5 do not move it,
 *  or the card would come back after eks had worked. Without either (a state written by hand) the newest decision or profile change of any kind. */
function stageStart(s: ProcessState): string {
	const starts = [...s.gates.filter((g) => g.stage === "S4" && g.state === "approved").map((g) => g.decidedAt ?? g.at), ...s.profile.changes.filter((c) => c.what === "S4 izlaista").map((c) => c.at)];
	if (starts.length) return starts.sort().at(-1)!;
	return [...s.gates.map((g) => g.decidedAt ?? g.at), ...s.profile.changes.map((c) => c.at)].sort().at(-1) ?? "";
}

/** S5 is on, no gate waits, and the expert has not run since the stage began (R48): eks leads S5 and only the user opens its thread, so nothing else would tell the user it is their move.
 *  `eksLastAt` is when the project's newest eks thread last worked (null: it has none): a run of eks in S5 sets it past `stageStart`. */
export function waitingEksStarts(projectsDir: string, eksLastAt: (projectId: string) => string | null): EksStart[] {
	const out: EksStart[] = [];
	for (const { projectId, s } of running(projectsDir)) {
		if (s.stage !== "S5" || s.escalated || s.gates.some((g) => g.state === "waiting")) continue;
		const since = stageStart(s);
		const last = eksLastAt(projectId);
		if (last === null || last <= since) out.push({ kind: "start-eks", projectId });
	}
	return out;
}

/** A stage escalated to the user (R44): no gate waits for it, so without this item nothing in the window would show the user that the process stands still. */
export function waitingEscalations(projectsDir: string): Escalated[] {
	return running(projectsDir).flatMap(({ projectId, s }): Escalated[] => (s.escalated && s.escalated === s.stage ? [{ kind: "escalated", projectId, stage: s.stage }] : []));
}
