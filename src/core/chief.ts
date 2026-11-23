// BPV as Chief of Staff: who may hand out work, where it lands, and how it is counted. Pure; the tools (agent/chief.ts) and the send rules (messages.ts) read it.
//
// Ported from OpenMausBot (Apache-2.0):
//   server/chief-level.ts      `chiefLevel(bot)`: who holds a Chief's powers (assign work, retry a stuck thread). Here: BPV, and the lead of a department over that department.
//   server/chief-of-staff.ts   the Chief's rules: it hands work out with `coordinate_bots` into "the conversation's one work thread with each teammate" (a standing thread, reused),
//                              reads each result back, and a refusal means nothing was sent. Here the standing thread is per agent per STAGE, and the work travels in the
//                              process's fixed UZDEVUMS / ATBILDE format (docs/BD process §7.1, §7.2).
//   docs/approval-levels.md    "A thread a bot opens from a conversation takes that conversation's level ... nothing a bot opens runs above what the person chose": the Chief's
//                              ceiling flows down to the work it hands out and is never raised on the way. The levels of this app are the tool ceilings of agent/tools/levels.ts
//                              (an agent's `maxLevel`: run or confirm), so what flows down is that ceiling; `minLevel` is the whole rule.
//   server/host/rework-cap.ts  rework to one teammate is counted per request and stops at a limit whatever the models say: here the stage's task iteration, 3 (process §1.5, §8).
// Departments: BPV is in charge of every department but Kvalitāte (`bpvManages`); a department's `lead` (shared/departments.ts) is in charge of that department only.
import { BPV_ID, KVALITATE_ID, bpvManages, departmentOf, type Department, type ReachSpec } from "../shared/departments.js";
import type { Message } from "../shared/message-types.js";
import { EKS } from "./process-def.js";

type Spec = Pick<ReachSpec, "id" | "department">;

/** The department this agent leads (by `Department.lead`), if any. */
export function departmentLedBy(agentId: string, departments: readonly Department[]): Department | undefined {
	return departments.find((d) => d.lead === agentId);
}

export type Assign = { ok: true; as: "bpv" | "lead" } | { ok: false; reason: string };

/** May `from` hand out a task to `to`? BPV: to any agent of a department it is in charge of. A department lead: to the agents of its own department. Nobody: to the
 *  expert (eks, Kvalitāte) or to itself. `specs` are the agents that exist; an unknown id is refused with its name. */
export function mayAssign(from: string, to: string, specs: readonly Spec[], departments: readonly Department[]): Assign {
	if (from === to) return { ok: false, reason: "Uzdevumu sev nedod." };
	const target = specs.find((s) => s.id === to);
	if (!target) return { ok: false, reason: `Nezināms aģents «${to}».` };
	if (to === EKS || !bpvManages(target)) return { ok: false, reason: `Aģents «${to}» ir Kvalitātes nodaļā: tas ziņo cilvēkam, un uzdevumus tam nedod.` };
	if (from === BPV_ID) return specs.some((s) => s.id === BPV_ID) ? { ok: true, as: "bpv" } : { ok: false, reason: "BPV aģenta nav." };
	const led = departmentLedBy(from, departments);
	if (led && departmentOf(target) === led.id) return { ok: true, as: "lead" };
	return { ok: false, reason: led ? `Nodaļas «${led.name}» vadītājs nodod uzdevumus tikai savas nodaļas aģentiem; «${to}» ir citur. To dara BPV.` : "Uzdevumus dod BPV un nodaļas vadītājs." };
}

/** Does this agent hold a Chief's tools (assign a task, escalate)? BPV, or the lead of a department. */
export function holdsChiefTools(agentId: string, specs: readonly Spec[], departments: readonly Department[]): boolean {
	if (!specs.some((s) => s.id === agentId)) return false;
	return agentId === BPV_ID || !!departmentLedBy(agentId, departments);
}

/** Is `from` a department lead handing a task to a member of its own department (the one case where a task is not BPV's, in process mode)? */
export function leadAssigns(from: string, to: string, specs: readonly Spec[], departments: readonly Department[]): boolean {
	const a = mayAssign(from, to, specs, departments);
	return a.ok && a.as === "lead";
}

export type Level = "run" | "confirm";

/** The lower of two tool ceilings: work handed on is never raised above what the conversation that handed it out was allowed (chief-level.ts / approval-levels.md). An absent one does not limit. */
export function minLevel(a: Level | undefined, b: Level | undefined): Level | undefined {
	if (!a) return b;
	if (!b) return a;
	return a === "run" || b === "run" ? "run" : "confirm";
}

/** The ceiling that comes down with the messages a run reads: the lowest of theirs. */
export function levelOfMessages(ids: readonly string[], ms: readonly Pick<Message, "id" | "level">[]): Level | undefined {
	return ms.filter((m) => ids.includes(m.id)).reduce<Level | undefined>((cap, m) => minLevel(cap, m.level), undefined);
}

// ---- the standing task thread -------------------------------------------------------------------------------------------------

/** The title a standing task thread carries: the stage, the agent and the id of the task it holds now ("S4 · AR · U-7"). The prefix up to the id names the thread. */
export const threadPrefix = (stage: string, agentId: string): string => `${stage || "–"} · ${agentId.toUpperCase()} · `;
export const taskThreadTitle = (stage: string, agentId: string, taskId: string): string => `${threadPrefix(stage, agentId)}${taskId}`;

/** The standing thread of this agent for this stage among `threads` (the agent's, not closed): the newest whose title starts with the prefix. */
export function standingThread<T extends { id: string; agent: string; title: string; state: string }>(threads: readonly T[], stage: string, agentId: string): T | undefined {
	const prefix = threadPrefix(stage, agentId);
	return threads.find((t) => t.agent === agentId && t.state !== "closed" && t.title.startsWith(prefix));
}

/** The next task id: U-1, U-2 … over the task ids the mailbox holds (an id another tool made is skipped, never reused). */
export function nextTaskId(ms: readonly Pick<Message, "task">[]): string {
	const taken = new Set(ms.flatMap((m) => (m.task ? [m.task.id] : [])));
	let n = ms.filter((m) => m.task).length + 1;
	while (taken.has(`U-${n}`)) n++;
	return `U-${n}`;
}

/** The iteration the next task of this stage to this agent carries: 1 for new work, the highest so far + 1 for a rework of it (`rework`). The tasks counted are those handed into
 *  the standing thread for this stage, so a new stage starts again at 1 (a different thread). */
export function nextIteration(ms: readonly Pick<Message, "task" | "toThread" | "kind">[], threadId: string, stage: string, rework: boolean): number {
	if (!rework) return 1;
	const seen = ms.filter((m) => m.kind === "task" && m.toThread === threadId && m.task && (m.task.stage ?? "") === stage).map((m) => m.task!.iteration);
	return seen.length ? Math.max(...seen) + 1 : 1;
}

/** The open tasks (no answer yet) in a thread, newest last: what `report_answer` answers. */
export function openTaskIn(ms: readonly Message[], threadId: string, answered: (m: Message, all: readonly Message[]) => boolean): Message | undefined {
	return [...ms].reverse().find((m) => m.kind === "task" && m.toThread === threadId && m.state !== "failed" && m.state !== "stopped" && !answered(m, ms));
}

/** The first words of a goal, for a topic title. */
export const topicTitle = (taskId: string, goal: string): string => `${taskId}: ${goal.replace(/\s+/g, " ").trim().slice(0, 60)}`;

/** Quality of a stage name: S1…S7, or empty. */
export const STAGE_RE = /^S[1-7]$/;

export { BPV_ID, KVALITATE_ID };
