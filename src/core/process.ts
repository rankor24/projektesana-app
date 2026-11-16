// The process state machine (design: "Process mode"). Pure: `step` takes a state and an event and returns a new state or a Latvian refusal; it never
// mutates its input and never reads the clock (times come from the event). Flow of chapter 5: S1 → H1 → … → S7 → H7 → mācības → done.
import { type Fact, type Profile, type Who, profileOf } from "./model.js";
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

export function initial(docType: DocType, agents: readonly string[]): ProcessState {
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
	gates: s.gates.map((g) => ({ ...g, ...(g.fix ? { fix: [...g.fix] } : {}) })),
});

/** The stage after `from` whose depth is not `izlaiž`; stages passed over are returned so the caller can record them.
 *  S6 and S7 are never passed over whatever the profile says (stage.skip refuses them too): no process ends without H6 and H7. */
function nextStage(depth: Record<Stage, Depth>, from: Stage): { next: Stage | "mācības"; skipped: Stage[] } {
	const skipped: Stage[] = [];
	for (let i = STAGES.indexOf(from) + 1; i < STAGES.length; i++) {
		const st = STAGES[i];
		if (depth[st] !== "izlaiž" || st === "S6" || st === "S7") return { next: st, skipped };
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

// ---- persistence and the profile (task 14.2) ----------------------------------------------------------------------------------

/** What persistence needs of a ProjectStore. Structural on purpose: shared/api.ts imports this file's types, and the renderer's typecheck must not
 *  follow an import into store.ts (node:fs). */
export interface ProcessStore {
	readMeta<T>(name: string, fallback: T): T;
	writeMeta(name: string, value: unknown, e?: { kind: string; by: Who | string; data?: Record<string, unknown> }): void;
	read(c: "facts"): Fact[];
}

/** The per-project file `process.json`; absent until the first switch to process mode. */
export const PROCESS_META = "process";

export const readProcess = (store: ProcessStore): ProcessState | null => store.readMeta<ProcessState | null>(PROCESS_META, null);

/** `what` names the change in the log: "process.mode" or "process.profile". */
export const writeProcess = (store: ProcessStore, s: ProcessState, by: Who, what: "mode" | "profile" = "mode"): void => store.writeMeta(PROCESS_META, s, { kind: `process.${what}`, by });

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The document type from the confirmed (else newest proposed) `procedure` fact; building project when the fact is missing or says something else. */
export function docTypeFromProfile(p: Profile): DocType {
	const v = fold(p.procedure?.value ?? "");
	if (v.includes("paskaidrojuma")) return "paskaidrojuma-raksts";
	if (v.includes("pazinojum")) return "pazinojums";
	return "buvprojekts";
}

const NEED_BPV = "Procesa režīmam vajag aģentu bpv (Iestatījumi → Aģenti).";

/** Switches the mode. The first switch to process builds the state from the profile and every existing agent (the user narrows it with
 *  `changeProfile`); a later switch only flips `mode`, so stage, gates and profile stay. Throws a Latvian refusal. */
export function switchMode(store: ProcessStore, mode: "cowork" | "process", existing: readonly string[], by: Who): ProcessState {
	const cur = readProcess(store);
	if (mode === "process" && !existing.includes("bpv")) throw new Error(NEED_BPV);
	if (!cur && mode === "cowork") throw new Error("Procesa režīms nav ieslēgts: nav ko saglabāt.");
	const next = cur ? { ...cur, mode } : initial(docTypeFromProfile(profileOf(store.read("facts"))), existing);
	writeProcess(store, next, by, "mode");
	return next;
}

export interface ProfilePatch {
	docType?: DocType;
	depth?: Partial<Record<Stage, Depth>>;
	agents?: string[];
	why: string;
}

const DEPTHS: readonly Depth[] = ["pilna", "vienkāršota", "pēc vajadzības", "izlaiž"];
const DOC_TYPES = Object.keys(DEFAULT_DEPTH) as DocType[];

/** Applies a profile change: needs a why, keeps `bpv` among existing agents, never skips S6 or S7. Each real difference is one entry in
 *  `profile.changes`; a new doc type brings its own depth row before the patch's depth is laid over it. Changing the depth of the
 *  escalated stage clears `escalated` (the user has taken the decision). A patch that changes nothing writes nothing. */
export function changeProfile(store: ProcessStore, p: ProfilePatch, existing: readonly string[], by: Who, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur) throw new Error("Procesa režīms nav ieslēgts.");
	const why = (p.why ?? "").trim();
	if (!why) throw new Error("Profila maiņai vajag pamatojumu.");
	if (p.docType !== undefined && !DOC_TYPES.includes(p.docType)) throw new Error(`Nezināms dokumenta veids: ${p.docType}.`);
	if (p.agents) {
		if (!p.agents.includes("bpv")) throw new Error("Profilā jābūt aģentam bpv.");
		const unknown = p.agents.filter((a) => !existing.includes(a));
		if (unknown.length) throw new Error(`Nav tādu aģentu: ${unknown.join(", ")}.`);
	}
	for (const [st, d] of Object.entries(p.depth ?? {})) {
		if (!(STAGES as readonly string[]).includes(st)) throw new Error(`Nezināma stadija: ${st}.`);
		if (!DEPTHS.includes(d as Depth)) throw new Error(`Nezināms dziļums: ${d}.`);
		if ((st === "S6" || st === "S7") && d === "izlaiž") throw new Error("S6 un S7 nevar izlaist.");
	}

	const at = now.toISOString();
	const n: ProcessState = { ...cur, profile: { ...cur.profile, depth: { ...cur.profile.depth }, agents: [...cur.profile.agents], changes: [...cur.profile.changes] } };
	const log = (what: string) => n.profile.changes.push({ at, what, why });
	const depthChanged: Stage[] = [];
	if (p.docType !== undefined && p.docType !== cur.docType) {
		log(`dokumenta veids: ${cur.docType} → ${p.docType}`);
		n.docType = p.docType;
		for (const st of STAGES) {
			if (n.profile.depth[st] !== DEFAULT_DEPTH[p.docType][st]) depthChanged.push(st);
			n.profile.depth[st] = DEFAULT_DEPTH[p.docType][st];
		}
	}
	for (const st of STAGES) {
		const d = p.depth?.[st];
		if (d === undefined || d === n.profile.depth[st]) continue;
		log(`${st} dziļums: ${n.profile.depth[st]} → ${d}`);
		n.profile.depth[st] = d;
		depthChanged.push(st);
	}
	if (p.agents && p.agents.join("|") !== cur.profile.agents.join("|")) {
		log(`aģenti: ${cur.profile.agents.join(", ")} → ${p.agents.join(", ")}`);
		n.profile.agents = [...p.agents];
	}
	if (n.profile.changes.length === cur.profile.changes.length) return cur;
	if (n.escalated && depthChanged.includes(n.escalated)) n.escalated = null;
	writeProcess(store, n, by, "profile");
	return n;
}
