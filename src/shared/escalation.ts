// The escalation question BPV puts to the user (docs/BD process §8): the problem, up to three options, BPV's recommendation, and what it changes in cost and time.
// It travels as the body of a question note in Atmiņa, so the same text shows in the Gaida tevi card, in the notes list and in the agent's own read of it;
// `parseEscalation` lets the card draw the options as buttons. Pure, shared by the tool that writes it and the window that reads it.
//
// The rules of when to escalate are the process document's §8 (cost, deadline, regulation risk, unresolved after 3 iterations); the shape of "options with a
// recommendation" follows how OpenMausBot puts a decision to the person (docs/approval-levels.md, "Actual questions ... still need your input").

export const ESCALATION_HEAD = "ESKALĀCIJA";
export const ESCALATION_REASONS = ["izmaksas", "termiņš", "normatīvi", "neatrisināts"] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];
/** The process allows at most three options (§8). */
export const ESCALATION_MAX_OPTIONS = 3;

export interface Escalation {
	reason: EscalationReason;
	problem: string;
	options: string[];
	/** 1-based: the option BPV recommends */
	recommend: number;
	impact: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** A checked escalation, or the refusal's words. */
export function checkEscalation(e: { reason: string; problem: string; options: string[]; recommend: number; impact?: string }): { ok: true; value: Escalation } | { ok: false; error: string } {
	const reason = ESCALATION_REASONS.find((r) => r === e.reason);
	if (!reason) return { ok: false, error: `Iemesls: ${ESCALATION_REASONS.join(", ")}.` };
	const problem = one(e.problem);
	if (!problem) return { ok: false, error: "Jānorāda problēma." };
	const options = e.options.map(one).filter(Boolean);
	if (options.length < 1 || options.length > ESCALATION_MAX_OPTIONS) return { ok: false, error: `Variantu jābūt 1–${ESCALATION_MAX_OPTIONS}.` };
	if (!Number.isInteger(e.recommend) || e.recommend < 1 || e.recommend > options.length) return { ok: false, error: `Rekomendācija ir varianta numurs 1–${options.length}.` };
	return { ok: true, value: { reason, problem, options, recommend: e.recommend, impact: one(e.impact ?? "") || "nav norādīta" } };
}

export function renderEscalation(e: Escalation): string {
	return [`${ESCALATION_HEAD} | Iemesls: ${e.reason}`, `Problēma: ${e.problem}`, "Varianti:", ...e.options.map((o, i) => `${i + 1}. ${o}`), `BPV rekomendācija: ${e.recommend}`, `Ietekme (izmaksas, termiņš): ${e.impact}`].join("\n");
}

/** The escalation a note body holds, or null when it is any other text. */
export function parseEscalation(body: string): Escalation | null {
	const lines = body.replace(/\r\n/g, "\n").split("\n");
	const head = /^ESKALĀCIJA \| Iemesls: (.+)$/.exec(lines[0] ?? "");
	if (!head) return null;
	const reason = ESCALATION_REASONS.find((r) => r === head[1].trim());
	const problem = /^Problēma: (.*)$/.exec(lines[1] ?? "")?.[1];
	if (!reason || problem === undefined) return null;
	const options: string[] = [];
	let at = 3;
	for (; at < lines.length; at++) {
		const m = /^(\d+)\. (.*)$/.exec(lines[at]);
		if (!m || Number(m[1]) !== options.length + 1) break;
		options.push(m[2]);
	}
	const recommend = Number(/^BPV rekomendācija: (\d+)$/.exec(lines[at] ?? "")?.[1]);
	const impact = /^Ietekme \(izmaksas, termiņš\): (.*)$/.exec(lines[at + 1] ?? "")?.[1] ?? "";
	if (!options.length || !Number.isInteger(recommend) || recommend < 1 || recommend > options.length) return null;
	return { reason, problem, options, recommend, impact };
}
