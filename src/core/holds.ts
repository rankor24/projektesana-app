// Pause: one agent, a whole department, or everything (a full stop) takes no new work until the user resumes it.
//
// Ported from OpenMausBot (Apache-2.0): server/host/bot-holds.ts (the state: bots, departments, `all`; a bot is held when it is named, its department is,
// or all are; resuming `all` leaves what was paused by itself paused; `newlyHeld` = the bots that became held by this change, so their running work can be
// stopped) and docs/pausing-bots.md (what a pause does and refuses). Adapted to this app:
//   - the department is an id (shared/departments.ts), so a rename keeps the pause with no code of its own (OpenMausBot names sections by their text and has to
//     carry a pause across a rename);
//   - the state lives in <app data>\paused.json, written atomically; a file that cannot be read is no pause (nothing is held by a damaged file);
//   - the words a refusal carries are Latvian, and say how to resume, like OpenMausBot's `text` / `handoff` lines.
// The coordinator asks `reasonOf` before it starts anything; the mail and delegate tools ask `handoffText` so another agent is told not to route around a pause.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { departmentOf, type ReachSpec } from "../shared/departments.js";
import { NOTHING_HELD, type HeldView, type PauseTarget } from "../shared/thread-types.js";

export type HeldBy = "all" | "agent" | "department";

/** Why this agent takes no new work: everything is paused (a full stop), it is paused itself, or its department is. Null = it may work. `agent` is looked up in `specs` for its department. */
export function heldBy(state: HeldView, agentId: string, specs: readonly Pick<ReachSpec, "id" | "department">[]): HeldBy | null {
	if (state.all) return "all";
	if (state.agents.includes(agentId)) return "agent";
	const spec = specs.find((s) => s.id === agentId);
	const dept = spec ? departmentOf(spec) : undefined;
	return dept && state.departments.includes(dept) ? "department" : null;
}

/** The agents held now, of the ones in `ids` (the lead is among them when `all` is on). */
export const heldAgents = (state: HeldView, ids: readonly string[], specs: readonly Pick<ReachSpec, "id" | "department">[]): string[] => ids.filter((id) => heldBy(state, id, specs) !== null);

/** The state after a switch. Resuming everything leaves an agent or department paused by itself paused (OpenMausBot: "resuming every bot leaves a bot or department that was paused by itself paused"). */
export function applyPause(state: HeldView, target: PauseTarget, paused: boolean): HeldView {
	if (target.kind === "all") return { ...state, all: paused };
	const list = target.kind === "agent" ? state.agents : state.departments;
	const next = paused ? [...new Set([...list, target.id])] : list.filter((x) => x !== target.id);
	return target.kind === "agent" ? { ...state, agents: next } : { ...state, departments: next };
}

/** The line a message to a paused agent is refused with (the user sees it): who is paused and how to resume. */
export function refusalText(by: HeldBy, agentName: string, departmentName?: string): string {
	if (by === "all") return `Viss ir apturēts (pilna apturēšana), tāpēc «${agentName}» nesāk jaunu darbu. Atsāc visu sarunu paneļa augšdaļā.`;
	if (by === "department") return `Nodaļa${departmentName ? ` «${departmentName}»` : ""} ir apturēta, tāpēc «${agentName}» nesāk jaunu darbu. Atsāc nodaļu tās ⋯ izvēlnē sarunu panelī.`;
	return `Aģents «${agentName}» ir apturēts un nesāk jaunu darbu. Atsāc to tā ⋯ izvēlnē sarunu panelī.`;
}

/** What another agent that tried to hand a paused agent work is told: nothing was sent, tell the user, do not retry and do not route around it (OpenMausBot `handoff`). */
export function handoffText(by: HeldBy, agentName: string): string {
	const why = by === "all" ? "viss ir apturēts (pilna apturēšana)" : by === "department" ? "tā nodaļa ir apturēta" : "lietotājs to ir apturējis";
	return `«${agentName}» ir apturēts: ${why}, tāpēc nekas netika nodots. Pasaki lietotājam vienā rindā, ka to var atsākt sarunu panelī. Nemēģini vēlreiz un nenodod šo darbu citam aģentam, lai apietu apturēšanu.`;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200))] : []);

/** The state a file holds; anything that is not a state is nothing paused. */
export function readHeld(file: string): HeldView {
	try {
		if (!existsSync(file)) return { ...NOTHING_HELD, agents: [], departments: [] };
		const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<HeldView>;
		return { agents: list(raw.agents), departments: list(raw.departments), all: raw.all === true };
	} catch {
		return { agents: [], departments: [], all: false };
	}
}

/** Temp file + rename, as the queue is written: a crash leaves the old state or the new one. */
export function writeHeld(file: string, s: HeldView): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify({ v: 1, ...s }, null, 1));
	renameSync(tmp, file);
}

/** The pause state of the app: in memory, saved on every change. Without a file (tests) it is memory only. */
export class Holds {
	private s: HeldView;

	constructor(private readonly file?: string) {
		this.s = file ? readHeld(file) : { agents: [], departments: [], all: false };
	}

	view(): HeldView {
		return { agents: [...this.s.agents], departments: [...this.s.departments], all: this.s.all };
	}

	/** Pauses or resumes; the ids (of `ids`) that became held by it, so their running work can be stopped. */
	set(target: PauseTarget, paused: boolean, ids: readonly string[], specs: readonly Pick<ReachSpec, "id" | "department">[]): { newlyHeld: string[] } {
		const before = new Set(heldAgents(this.s, ids, specs));
		this.s = applyPause(this.s, target, paused);
		if (this.file) {
			try {
				writeHeld(this.file, this.s);
			} catch {
				// a locked file: the pause still holds for this run of the app
			}
		}
		return { newlyHeld: heldAgents(this.s, ids, specs).filter((id) => !before.has(id)) };
	}

	reason(agentId: string, specs: readonly Pick<ReachSpec, "id" | "department">[]): HeldBy | null {
		return heldBy(this.s, agentId, specs);
	}

	/** An agent or a department that no longer exists stops being remembered (the lists only). */
	forget(kind: "agent" | "department", id: string): void {
		const key = kind === "agent" ? "agents" : "departments";
		if (!this.s[key].includes(id)) return;
		this.s = { ...this.s, [key]: this.s[key].filter((x) => x !== id) };
		if (this.file) {
			try {
				writeHeld(this.file, this.s);
			} catch {
				// as above
			}
		}
	}
}
