// What the window shows of the process (task 14.8): the strip of seven stages in the chat and the profile editor's patch. Pure: the state in, plain data out.
import type { ProcessState } from "../core/process.js";
import { type Depth, type DocType, type GateId, type Stage, DEFAULT_DEPTH, GATE_OF, MAX_ITERATIONS, STAGE_CARD, STAGES } from "../core/process-def.js";

export type StripState = "done" | "current" | "skipped" | "todo";

export interface StripStage {
	stage: Stage;
	/** the card's title, for a tooltip */
	title: string;
	state: StripState;
}

export interface StripModel {
	stages: StripStage[];
	/** The stage that is on; null once all seven are through (mācības or done). */
	current: Stage | null;
	/** Returns of the current stage so far, shown as "iterācija n no 3"; null on the first pass. */
	iteration: { n: number; of: number } | null;
	/** The gate that waits for the user now. */
	gate: GateId | null;
	escalated: Stage | null;
}

/** A stage behind the current one is `done` when its gate was approved and `skipped` when none was: the profile said izlaiž, the leader skipped it, or (S6) H5 left nothing to fix.
 *  The current stage wins over both: a client change that sends S4 back to S3 puts S3 on again although its old gate stands approved. */
export function stripModel(s: ProcessState): StripModel {
	const cur = s.stage === "mācības" || s.stage === "done" ? null : s.stage;
	const at = cur ? STAGES.indexOf(cur) : STAGES.length;
	const stages = STAGES.map((stage, i): StripStage => {
		const approved = s.gates.some((g) => g.stage === stage && g.state === "approved");
		const state: StripState = stage === cur ? "current" : i >= at ? "todo" : approved ? "done" : "skipped";
		return { stage, title: STAGE_CARD[stage].title, state };
	});
	const waiting = cur ? [...s.gates].reverse().find((g) => g.stage === cur && g.state === "waiting") : undefined;
	const returns = cur ? s.iteration[cur] : 0;
	return { stages, current: cur, iteration: returns > 0 ? { n: returns, of: MAX_ITERATIONS } : null, gate: waiting?.id ?? null, escalated: s.escalated };
}

/** The stage a gate id closes ("H3" → "S3"); null for anything else. */
export const gateStage = (gate: string): Stage | null => STAGES.find((st) => GATE_OF[st] === gate) ?? null;

/** What the profile editor lets the user pick: S6 and S7 are never skipped. */
export const depthChoices = (stage: Stage): Depth[] => (stage === "S6" || stage === "S7" ? ["pilna", "vienkāršota", "pēc vajadzības"] : ["pilna", "vienkāršota", "pēc vajadzības", "izlaiž"]);

export const DOC_TYPE_LABEL: Record<DocType, string> = { buvprojekts: "Būvprojekts", "paskaidrojuma-raksts": "Paskaidrojuma raksts", pazinojums: "Paziņojums" };

export interface ProfileDraft {
	docType: DocType;
	depth: Record<Stage, Depth>;
	agents: string[];
	why: string;
}

/** The depths a new document type brings, for the editor to show before Saglabāt. */
export const depthOfDocType = (t: DocType): Record<Stage, Depth> => ({ ...DEFAULT_DEPTH[t] });

/** The patch `process.setProfile` gets: only what differs from the state (a document type change brings its own depth row, so cells equal to it are the type's, not extra).
 *  null when nothing differs. `bpv` is kept in the list whatever the draft says. */
export function profilePatch(s: ProcessState, d: ProfileDraft): { docType?: DocType; depth?: Partial<Record<Stage, Depth>>; agents?: string[]; why: string } | null {
	const patch: { docType?: DocType; depth?: Partial<Record<Stage, Depth>>; agents?: string[]; why: string } = { why: d.why.trim() };
	if (d.docType !== s.docType) patch.docType = d.docType;
	const depth: Partial<Record<Stage, Depth>> = {};
	for (const st of STAGES) if (d.depth[st] !== s.profile.depth[st]) depth[st] = d.depth[st];
	if (Object.keys(depth).length) patch.depth = depth;
	const agents = d.agents.includes("bpv") ? d.agents : ["bpv", ...d.agents];
	if (agents.join("|") !== s.profile.agents.join("|")) patch.agents = agents;
	return patch.docType === undefined && patch.depth === undefined && patch.agents === undefined ? null : patch;
}
