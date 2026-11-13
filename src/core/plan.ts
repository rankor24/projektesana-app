// The plan (task 9.2): one document per project, the order of work the agent keeps and the user edits. The rules are the
// pins' and tasks' rules turned around: the agent writes the whole list, the user may change it any time, and the user's
// version wins. A user edit marks the plan `pending`; the next prompt carries it (and clears the mark), and an agent
// update_plan that arrives while the mark is set is refused with the user's list, so the agent can never write over an edit
// it has not seen.
import { newId, type PlanDoc } from "./model.js";
import type { ProjectStore } from "./store.js";
import { checkSteps, planProgress, planText, type PlanStep } from "../shared/plan.js";

export type { PlanDoc };

const EMPTY: PlanDoc = { steps: [], by: "app", at: "", pending: false };
const mint = () => newId("p");

export function getPlan(store: ProjectStore): PlanDoc {
	const d = store.read("plan")[0];
	return d && Array.isArray(d.steps) ? d : { ...EMPTY };
}

/** The agent's update_plan: the whole list replaces the old one; a step with the text of an old step keeps its id. */
export function agentSetPlan(store: ProjectStore, input: { text: string; state: string }[], now = new Date().toISOString()): PlanDoc {
	const cur = getPlan(store);
	if (cur.pending) {
		// the agent now sees the user's version: it is the plan in force
		store.write("plan", [{ ...cur, pending: false }], { kind: "plan.seen", by: "agent", data: { steps: cur.steps.length } });
		throw new Error(`Lietotājs ir mainījis plānu, un viņa saraksts ir spēkā:\n${planText(cur.steps, "Plāns:")}\nPielāgo savu darbu tam un, ja vajag, sūti update_plan vēlreiz no šī saraksta.`);
	}
	const byText = new Map(cur.steps.map((s) => [s.text, s.id]));
	const steps = checkSteps(
		input.map((s) => ({ ...s, id: byText.get(String(s.text).replace(/\s+/g, " ").trim()) })),
		mint,
	);
	const doc: PlanDoc = { steps, by: "agent", at: now, pending: false };
	store.write("plan", [doc], { kind: "plan.agent", by: "agent", data: { steps: steps.length, ...planCount(steps) } });
	return doc;
}

/** The user's editor sends the whole list. It is the plan in force and the next prompt carries it. */
export function userSetPlan(store: ProjectStore, input: { id?: string; text: string; state: string }[], now = new Date().toISOString()): PlanDoc {
	const steps = checkSteps(input, mint);
	const doc: PlanDoc = { steps, by: "user", at: now, pending: true };
	store.write("plan", [doc], { kind: "plan.user", by: "user", data: { steps: steps.length, ...planCount(steps) } });
	return doc;
}

const planCount = (steps: PlanStep[]) => ({ done: planProgress(steps).done });

/** The plan lines the next prompt carries, when the user changed it since the last one (the mark is cleared); else "". */
export function takePendingPlanText(store: ProjectStore): string {
	const cur = getPlan(store);
	if (!cur.pending) return "";
	store.write("plan", [{ ...cur, pending: false }], { kind: "plan.sent", by: "app", data: { steps: cur.steps.length } });
	return planText(cur.steps, "Lietotājs ir mainījis plānu; šis saraksts ir spēkā (turpini no tā):");
}

/** What the pending plan would add to the next prompt, without taking it: for the context meter. */
export function peekPendingPlanText(store: ProjectStore): string {
	const cur = getPlan(store);
	return cur.pending ? planText(cur.steps, "Lietotājs ir mainījis plānu; šis saraksts ir spēkā (turpini no tā):") : "";
}
