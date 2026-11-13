// The plan above the chat input (task 9.2): the order of work the agent keeps with update_plan and the user edits too.
// Pure and node-free: the renderer's plan block, the agent tool, the prompt and the tests use the same functions.
// BIM Crew reference: tools/harness-tools.ts (update_plan) and Chat.tsx (the plan block above the input).

export const STEP_STATES = ["todo", "doing", "done", "blocked"] as const;
export type StepState = (typeof STEP_STATES)[number];

export interface PlanStep {
	id: string;
	text: string;
	state: StepState;
}

export const MAX_STEPS = 30;
export const MAX_STEP_TEXT = 200;

export const STATE_MARK: Record<StepState, string> = { todo: "[ ]", doing: "[→]", done: "[x]", blocked: "[!]" };
export const STATE_LABEL: Record<StepState, string> = { todo: "jādara", doing: "darbā", done: "izdarīts", blocked: "iestrēdzis" };

/**
 * A list of steps from the agent or from the user's editor, checked: 0 to 30 steps, each with text, a known state, at most one
 * "doing". `ids` are kept where the same id is given; a step without one gets one from `mint`.
 */
export function checkSteps(input: { text?: unknown; state?: unknown; id?: unknown }[], mint: (i: number) => string): PlanStep[] {
	if (!Array.isArray(input)) throw new Error("Plāns ir saraksts ar soļiem.");
	if (input.length > MAX_STEPS) throw new Error(`Plānā ir ne vairāk kā ${MAX_STEPS} soļi.`);
	const seen = new Set<string>();
	const out = input.map((s, i): PlanStep => {
		const text = typeof s?.text === "string" ? s.text.replace(/\s+/g, " ").trim() : "";
		if (text.length < 2) throw new Error(`Solim ${i + 1} vajag tekstu.`);
		if (text.length > MAX_STEP_TEXT) throw new Error(`Soļa ${i + 1} teksts ir garāks par ${MAX_STEP_TEXT} rakstzīmēm.`);
		const state = s.state ?? "todo";
		if (!(STEP_STATES as readonly unknown[]).includes(state)) throw new Error(`Solim ${i + 1} stāvoklis nav zināms: ${String(state)} (todo, doing, done, blocked).`);
		let id = typeof s.id === "string" && s.id && !seen.has(s.id) ? s.id : mint(i);
		while (seen.has(id)) id = `${id}x`;
		seen.add(id);
		return { id, text, state: state as StepState };
	});
	const doing = out.filter((s) => s.state === "doing").length;
	if (doing > 1) throw new Error(`Darbā drīkst būt tikai viens solis, tagad ir ${doing}.`);
	return out;
}

export interface PlanProgress {
	done: number;
	total: number;
	doing: PlanStep | null;
	/** the folded line: "Plāns · 2/4" */
	line: string;
}
export function planProgress(steps: PlanStep[]): PlanProgress {
	const done = steps.filter((s) => s.state === "done").length;
	return { done, total: steps.length, doing: steps.find((s) => s.state === "doing") ?? null, line: steps.length ? `Plāns · ${done}/${steps.length}` : "Plāns" };
}

/** The plan as the model reads it: one line per step, in order. */
export function planText(steps: PlanStep[], header: string): string {
	if (!steps.length) return `${header}\n(tukšs)`;
	return `${header}\n${steps.map((s, i) => `${i + 1}. ${STATE_MARK[s.state]} ${s.text}`).join("\n")}`;
}

// ---- the user's edits: each returns a new list that still passes checkSteps ----

/** Setting a step "doing" puts another one that was doing back to todo: there is one at a time. */
export function setState(steps: PlanStep[], id: string, state: StepState): PlanStep[] {
	return steps.map((s) => (s.id === id ? { ...s, state } : state === "doing" && s.state === "doing" ? { ...s, state: "todo" as const } : s));
}
/** The checkbox: done ↔ todo; a doing or blocked step becomes done. */
export function tick(steps: PlanStep[], id: string): PlanStep[] {
	const cur = steps.find((s) => s.id === id);
	return cur ? setState(steps, id, cur.state === "done" ? "todo" : "done") : steps;
}
export function editText(steps: PlanStep[], id: string, text: string): PlanStep[] {
	const t = text.replace(/\s+/g, " ").trim().slice(0, MAX_STEP_TEXT);
	return t.length < 2 ? steps : steps.map((s) => (s.id === id ? { ...s, text: t } : s));
}
export function addStep(steps: PlanStep[], text: string, id: string, at?: number): PlanStep[] {
	const t = text.replace(/\s+/g, " ").trim().slice(0, MAX_STEP_TEXT);
	if (t.length < 2 || steps.length >= MAX_STEPS) return steps;
	const next = [...steps];
	next.splice(at === undefined ? next.length : Math.max(0, Math.min(at, next.length)), 0, { id, text: t, state: "todo" });
	return next;
}
export const removeStep = (steps: PlanStep[], id: string): PlanStep[] => steps.filter((s) => s.id !== id);
export function moveStep(steps: PlanStep[], id: string, to: number): PlanStep[] {
	const from = steps.findIndex((s) => s.id === id);
	if (from < 0) return steps;
	const next = [...steps];
	const [s] = next.splice(from, 1);
	next.splice(Math.max(0, Math.min(to, next.length)), 0, s);
	return next;
}
