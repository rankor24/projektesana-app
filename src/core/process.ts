// The process state machine (design: "Process mode"). Pure: `step` takes a state and an event and returns a new state or a Latvian refusal; it never
// mutates its input and never reads the clock (times come from the event). Flow of chapter 5: S1 → H1 → … → S7 → H7 → mācības → done.
import { type Depth, type DocType, type GateId, DEFAULT_DEPTH, GATE_OF, MAX_ITERATIONS, STAGES, type Stage } from "./process-def.js";

export interface GateRecord {
	id: GateId;
	stage: Stage;
	/** The pass of the stage this gate closes: 1 for the first, 2 after one return. */
	iteration: number;
	state: "waiting" | "approved" | "returned";
	noteId: string;
	at: string;
	decidedAt?: string;
	comment?: string;
	fix?: string[];
}

export interface ProcessState {
	mode: "cowork" | "process";
	docType: DocType;
	profile: { depth: Record<Stage, Depth>; agents: string[]; changes: { at: string; what: string; why: string }[] };
	stage: Stage | "mācības" | "done";
	/** Returns so far per stage (0 on the first pass). The fourth return passes MAX_ITERATIONS and escalates. */
	iteration: Record<Stage, number>;
	gates: GateRecord[];
	/** S6: the ekspertīze re-check is recorded; the gate cannot be requested without it. */
	reviewed: boolean;
	escalated: Stage | null;
}

export type ProcessEvent =
	| { type: "gate.request"; noteId: string; at: string }
	| { type: "gate.approve"; at: string; comment?: string; fix?: string[] } // fix: remark ids to fix, H5 only
	| { type: "gate.return"; at: string; comment: string }
	| { type: "stage.skip"; why: string; at: string }
	| { type: "review.done"; at: string } // S6: the ekspertīze re-check is recorded
	| { type: "change"; basic: boolean; at: string }
	| { type: "learned"; at: string };

export type StepResult = { ok: true; state: ProcessState } | { ok: false; error: string };

const zero = (): Record<Stage, number> => ({ S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, S6: 0, S7: 0 });

export function initial(docType: DocType, agents: string[]): ProcessState {
	return {
		mode: "process",
		docType,
		profile: { depth: { ...DEFAULT_DEPTH[docType] }, agents: [...agents], changes: [] },
		stage: "S1",
		iteration: zero(),
		gates: [],
		reviewed: false,
		escalated: null,
	};
}

const fail = (error: string): StepResult => ({ ok: false, error });
const clone = (s: ProcessState): ProcessState => ({
	...s,
	profile: { ...s.profile, depth: { ...s.profile.depth }, agents: [...s.profile.agents], changes: s.profile.changes.map((c) => ({ ...c })) },
	iteration: { ...s.iteration },
	gates: s.gates.map((g) => ({ ...g, fix: g.fix ? [...g.fix] : undefined })),
});

/** The stage after `from` whose depth is not `izlaiž`; stages passed over are returned so the caller can record them. */
function nextStage(depth: Record<Stage, Depth>, from: Stage): { next: Stage | "mācības"; skipped: Stage[] } {
	const skipped: Stage[] = [];
	for (let i = STAGES.indexOf(from) + 1; i < STAGES.length; i++) {
		const st = STAGES[i];
		if (depth[st] !== "izlaiž") return { next: st, skipped };
		skipped.push(st);
	}
	return { next: "mācības", skipped };
}

function moveOn(n: ProcessState, to: Stage | "mācības", skipped: Stage[], at: string): void {
	for (const st of skipped) n.profile.changes.push({ at, what: `${st} izlaista`, why: "izlaists pēc profila" });
	n.stage = to;
	n.reviewed = false;
}

/** The newest gate of the stage, if it still waits. */
const waitingGate = (s: ProcessState, stage: Stage): GateRecord | undefined => [...s.gates].reverse().find((g) => g.stage === stage && g.state === "waiting");

export function step(s: ProcessState, e: ProcessEvent): StepResult {
	if (s.mode !== "process") return fail("Procesa režīms nav ieslēgts.");
	if (s.stage === "done") return fail("Process ir pabeigts.");
	const n = clone(s);

	if (e.type === "learned") {
		if (s.stage !== "mācības") return fail("Mācības sākas pēc H7 apstiprināšanas.");
		n.stage = "done";
		return { ok: true, state: n };
	}
	if (s.stage === "mācības") return fail("Visas stadijas ir pabeigtas; atliek mācības.");
	const stage = s.stage;
	const waiting = waitingGate(n, stage);

	switch (e.type) {
		case "gate.request": {
			if (s.escalated === stage) return fail(`Stadija ${stage} eskalēta cilvēkam: pārsniegts iterāciju limits.`);
			if (waiting) return fail("Gate jau gaida lēmumu.");
			if (stage === "S6" && !s.reviewed) return fail("S6 gate prasa ekspertīzes atkārtotu pārbaudi (review.done).");
			n.gates.push({ id: GATE_OF[stage], stage, iteration: s.iteration[stage] + 1, state: "waiting", noteId: e.noteId, at: e.at });
			return { ok: true, state: n };
		}
		case "gate.approve": {
			// an escalated stage has no waiting gate: the user's approval is the decision
			if (!waiting && s.escalated !== stage) return fail("Šajā stadijā nav gaidoša gate.");
			const fix = stage === "S5" ? (e.fix ?? []).filter((x) => x) : [];
			if (waiting) {
				waiting.state = "approved";
				waiting.decidedAt = e.at;
				if (e.comment) waiting.comment = e.comment;
				if (stage === "S5") waiting.fix = fix;
			} else {
				n.gates.push({ id: GATE_OF[stage], stage, iteration: s.iteration[stage] + 1, state: "approved", noteId: "", at: e.at, decidedAt: e.at, ...(e.comment ? { comment: e.comment } : {}) });
			}
			n.escalated = null;
			if (stage === "S5") moveOn(n, fix.length ? "S6" : "S7", [], e.at);
			else if (stage === "S6") moveOn(n, "S7", [], e.at);
			else {
				const { next, skipped } = nextStage(n.profile.depth, stage);
				moveOn(n, stage === "S7" ? "mācības" : next, stage === "S7" ? [] : skipped, e.at);
			}
			return { ok: true, state: n };
		}
		case "gate.return": {
			if (!waiting) return fail("Šajā stadijā nav gaidoša gate.");
			if (!e.comment.trim()) return fail("Atgriežot gate, jānorāda komentārs.");
			waiting.state = "returned";
			waiting.decidedAt = e.at;
			waiting.comment = e.comment;
			n.iteration[stage] = s.iteration[stage] + 1;
			n.reviewed = false;
			if (n.iteration[stage] > MAX_ITERATIONS) n.escalated = stage;
			return { ok: true, state: n };
		}
		case "stage.skip": {
			if (stage === "S6" || stage === "S7") return fail(`${stage} nedrīkst izlaist.`);
			if (waiting) return fail("Gate jau gaida lēmumu.");
			if (!e.why.trim()) return fail("Stadijas izlaišanai jānorāda pamatojums.");
			n.profile.changes.push({ at: e.at, what: `${stage} izlaista`, why: e.why });
			const { next, skipped } = nextStage(n.profile.depth, stage);
			moveOn(n, next, skipped, e.at);
			if (n.escalated === stage) n.escalated = null;
			return { ok: true, state: n };
		}
		case "review.done": {
			if (stage !== "S6") return fail("Atkārtota pārbaude attiecas tikai uz S6.");
			n.reviewed = true;
			return { ok: true, state: n };
		}
		case "change": {
			if (e.basic && stage === "S4") {
				// a gate asked for the old solution would be answered for work that no longer stands
				if (waiting) {
					waiting.state = "returned";
					waiting.decidedAt = e.at;
					waiting.comment = "Pasūtītāja izmaiņa: mainās pamata risinājums.";
				}
				n.stage = "S3";
				n.reviewed = false;
			}
			return { ok: true, state: n };
		}
	}
}

/** After S6: more than 10% of the documents changed means a full re-check, otherwise the changed ones and those linked to them. */
export function reviewScope(changed: readonly string[], all: readonly string[]): { mode: "full" | "partial"; share: number } {
	const share = new Set(changed).size / Math.max(new Set(all).size, 1);
	return { mode: share > 0.1 ? "full" : "partial", share };
}
