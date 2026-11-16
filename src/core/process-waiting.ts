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

/** A stage escalated to the user (R44): no gate waits for it, so without this item nothing in the window would show the user that the process stands still. */
export function waitingEscalations(projectsDir: string): Escalated[] {
	return running(projectsDir).flatMap(({ projectId, s }): Escalated[] => (s.escalated && s.escalated === s.stage ? [{ kind: "escalated", projectId, stage: s.stage }] : []));
}
