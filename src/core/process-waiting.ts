// The gates that wait for the user (task 14.3): one item of "Gaida tevi" per project whose process has a waiting gate. Reads each project's
// process.json straight from the data folder, like waitingQuestions does for notes, so the tools server's writes show without any message between processes.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { WaitingItem } from "../shared/thread-types.js";
import type { ProcessState } from "./process.js";

/** Only a project in process mode: in co-work a waiting gate cannot be decided (the step refuses), so it is not offered. A project whose file cannot be read is left out. */
export function waitingGates(projectsDir: string): Extract<WaitingItem, { kind: "gate" }>[] {
	const out: Extract<WaitingItem, { kind: "gate" }>[] = [];
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
			const g = [...s.gates].reverse().find((x) => x.stage === s.stage && x.state === "waiting");
			if (g) out.push({ kind: "gate", gate: g.id, projectId, noteId: g.noteId });
		} catch {
			// a torn or unreadable file: skipped
		}
	}
	return out;
}
