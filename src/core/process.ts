// The process state machine (design: "Process mode"). Pure: `step` takes a state and an event and returns a new state or a Latvian refusal; it never
// mutates its input and never reads the clock (times come from the event). Flow of chapter 5: S1 → H1 → … → S7 → H7 → mācības → done.
import type { Message } from "../shared/message-types.js";
import { type Fact, type Note, type NoteType, type Profile, type Who, newId, profileOf } from "./model.js";
import { type Depth, type DocType, type GateId, DEFAULT_DEPTH, GATE_OF, LEADER, MAX_ITERATIONS, STAGES, type Stage } from "./process-def.js";

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
	| { type: "stage.skip"; why: string; at: string; /** who asks: an agent cannot skip a stage the process has escalated to the user (R36) */ by: Who }
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
			// escalation is cleared by the user only: skipping the stage would clear it
			if (e.by === "agent" && s.escalated === stage) return fail(`Stadija ${stage} gaida cilvēka lēmumu.`);
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

/** `what` names the change in the log: "process.mode", "process.profile", "process.gate" (a request or the user's decision), "process.skip" or "process.review". */
export function writeProcess(store: ProcessStore, s: ProcessState, by: Who, what: "mode" | "profile" | "gate" | "skip" | "review" = "mode", expect?: { was: ProcessState | null }): void {
	if (expect) checkUnchanged(store, expect.was);
	store.writeMeta(PROCESS_META, s, { kind: `process.${what}`, by });
}

export const CHANGED = "Procesa stāvoklis mainījās; mēģini vēlreiz.";

/** The tools server and the main process each read, change and write process.json. A write that carries what its caller read compares it with the file
 *  just before writing and refuses when it moved (R36), so one side's change is not silently lost. A small window between the compare and the write remains. */
export function checkUnchanged(store: ProcessStore, was: ProcessState | null): void {
	if (JSON.stringify(readProcess(store)) !== JSON.stringify(was)) throw new Error(CHANGED);
}

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
	// the mode comes over IPC: check it at runtime
	if (mode !== "cowork" && mode !== "process") throw new Error(`Nezināms režīms: ${String(mode)}.`);
	const cur = readProcess(store);
	// already there: nothing to write, log or announce
	if (cur?.mode === mode) return cur;
	if (mode === "process" && !existing.includes("bpv")) throw new Error(NEED_BPV);
	if (!cur && mode === "cowork") throw new Error("Procesa režīms nav ieslēgts: nav ko saglabāt.");
	const next = cur ? { ...cur, mode } : initial(docTypeFromProfile(profileOf(store.read("facts"))), existing);
	writeProcess(store, next, by, "mode", { was: cur });
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
 *  `profile.changes`; a new doc type brings its own depth row (each cell that moves is logged) before the patch's depth is laid over it. Changing the depth of the
 *  escalated stage clears `escalated` only when the user makes the change; an agent's change that would move it is refused (R36). A patch that changes nothing writes nothing. */
export function changeProfile(store: ProcessStore, p: ProfilePatch, existing: readonly string[], by: Who, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur) throw new Error("Procesa režīms nav ieslēgts.");
	const why = (p.why ?? "").trim();
	if (!why) throw new Error("Profila maiņai vajag pamatojumu.");
	if (p.docType !== undefined && !DOC_TYPES.includes(p.docType)) throw new Error(`Nezināms dokumenta veids: ${p.docType}.`);
	if (p.agents !== undefined) {
		if (!Array.isArray(p.agents) || p.agents.some((a) => typeof a !== "string")) throw new Error("Aģentu saraksts: teksta identifikatori.");
		if (new Set(p.agents).size !== p.agents.length) throw new Error("Aģentu sarakstā ir atkārtojumi.");
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
		// the reset overwrites earlier per-stage choices, so each cell that moves gets its own entry
		for (const st of STAGES) {
			const to = DEFAULT_DEPTH[p.docType][st];
			if (n.profile.depth[st] === to) continue;
			log(`${st} dziļums: ${n.profile.depth[st]} → ${to} (jauns dokumenta veids)`);
			n.profile.depth[st] = to;
			depthChanged.push(st);
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
	if (n.escalated && depthChanged.includes(n.escalated)) {
		// escalation is cleared by the user only (R36); the user's own change clears it
		if (by === "agent") throw new Error(`Stadija ${n.escalated} gaida cilvēka lēmumu.`);
		n.escalated = null;
	}
	writeProcess(store, n, by, "profile", { was: cur });
	return n;
}

// ---- gates (task 14.3) --------------------------------------------------------------------------------------------------------

/** What the leader hands over with a gate request: the lines of the template of process chapter 13. */
export interface GateArgs {
	result: string[];
	files: string[];
	deviations: string;
	questions: string[];
	risks: string;
	decisions: string[];
	next: string;
}

const items = (xs: readonly string[]): string => {
	const v = xs.map((x) => x.trim()).filter(Boolean);
	return v.length ? v.join("; ") : "nav";
};

/** The gate summary of chapter 13, for the gate the stage is about to ask for. "Atkāpes no profila" is the leader's own words and then every profile
 *  change made since the previous gate was requested (the earlier ones were in that gate's summary). */
export function gateSummary(s: ProcessState, project: string, a: GateArgs): string {
	const stage = s.stage;
	if (stage === "mācības" || stage === "done") throw new Error("Šajā stadijā gate nav.");
	const prev = s.gates.at(-1);
	const changes = s.profile.changes.filter((c) => !prev || c.at > prev.at).map((c) => `${c.what} (${c.why})`);
	return [
		`GATE ${GATE_OF[stage]} | Projekts: ${project} | Stadija: ${stage} | Iterācija: ${s.iteration[stage] + 1}`,
		"",
		`Rezultāts: ${items(a.result)}`,
		`Faili: ${items(a.files)}`,
		`Atkāpes no profila: ${items([a.deviations, ...changes])}`,
		`Atvērtie jautājumi cilvēkam: ${items(a.questions)}`,
		`Riski un pieņēmumi: ${items([a.risks])}`,
		`Lēmumi, kas vajadzīgi no cilvēka: ${items(a.decisions)}`,
		`Nākamā stadija: ${items([a.next])}`,
		"",
		"Lūdzu atļauju turpināt.",
	].join("\n");
}

/** What the gate helpers need of a project: its process file and its notes. Structural, like `ProcessStore`. */
export interface GateStore extends ProcessStore {
	notes(): Note[];
	writeNote(n: Note): void;
}

/** The leader's request: the process decides first, the note is written only for a request it accepts, then the state keeps the note's id. */
export function requestGate(store: GateStore, project: string, agent: string, a: GateArgs, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur || cur.mode !== "process") throw new Error("Procesa režīms nav ieslēgts.");
	// the leader is read from the same state the request is applied to
	if ((STAGES as readonly string[]).includes(cur.stage) && agent !== LEADER[cur.stage as Stage]) throw new Error(`Gate pieprasa tikai stadijas vadītājs (${LEADER[cur.stage as Stage]}).`);
	const noteId = newId("n");
	const at = now.toISOString();
	const r = step(cur, { type: "gate.request", noteId, at });
	if (!r.ok) throw new Error(r.error);
	// step accepted, so the stage is a real one
	const stage = cur.stage as Stage;
	// no note for a request whose state has moved on since it was read
	checkUnchanged(store, cur);
	store.writeNote({ id: noteId, type: "gate", title: `GATE ${GATE_OF[stage]} · ${stage}`, body: gateSummary(cur, project, a), refs: [], by: "agent", at, agent });
	writeProcess(store, r.state, "agent", "gate", { was: cur });
	return r.state;
}

/** The user's decision on the waiting gate: `gate.approve` or `gate.return` (a comment is required). The decision line is added to the gate note as a new
 *  version of it; the earlier one stays in the project's versions. Only the user's IPC handler calls this: no tool does. */
export function decideGate(store: GateStore, d: { approve: boolean; comment?: string; fix?: string[] }, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur) throw new Error("Procesa režīms nav ieslēgts.");
	// the decision comes over IPC: check it at runtime
	if (typeof d?.approve !== "boolean") throw new Error("Lēmums: apstiprināt vai atgriezt.");
	const comment = (d.comment ?? "").trim();
	if (!d.approve && !comment) throw new Error("Atgriešanai vajag komentāru.");
	const fix = Array.isArray(d.fix) ? d.fix.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
	const at = now.toISOString();
	const waiting = cur.stage === "mācības" || cur.stage === "done" ? undefined : [...cur.gates].reverse().find((g) => g.stage === cur.stage && g.state === "waiting");
	const r = step(cur, d.approve ? { type: "gate.approve", at, ...(comment ? { comment } : {}), fix } : { type: "gate.return", at, comment });
	if (!r.ok) throw new Error(r.error);
	writeProcess(store, r.state, "user", "gate", { was: cur });
	const note = waiting?.noteId ? store.notes().find((n) => n.id === waiting.noteId) : undefined;
	if (note) {
		const line = d.approve ? `apstiprināts.${comment ? ` Komentārs: ${comment}` : ""}${fix.length ? ` Labot: ${fix.join(", ")}.` : ""}` : `atgriezts. Komentārs: ${comment}`;
		store.writeNote({ ...note, body: `${note.body}\n\nLēmums ${at.slice(0, 10)}: ${line}` });
	}
	return r.state;
}

/** The leader skips the current stage (the tool of `bpv`). `by` "agent" cannot skip a stage escalated to the user. */
export function skipStage(store: ProcessStore, why: string, by: Who, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur || cur.mode !== "process") throw new Error("Procesa režīms nav ieslēgts.");
	const r = step(cur, { type: "stage.skip", why, at: now.toISOString(), by });
	if (!r.ok) throw new Error(r.error);
	writeProcess(store, r.state, by, "skip", { was: cur });
	return r.state;
}

/** The ekspertīze re-check of S6 is recorded (the tool of `eks`). */
export function recordReview(store: ProcessStore, by: Who, now = new Date()): ProcessState {
	const cur = readProcess(store);
	if (!cur || cur.mode !== "process") throw new Error("Procesa režīms nav ieslēgts.");
	const r = step(cur, { type: "review.done", at: now.toISOString() });
	if (!r.ok) throw new Error(r.error);
	writeProcess(store, r.state, by, "review", { was: cur });
	return r.state;
}

// ---- the status page and the registers (task 14.5) ----------------------------------------------------------------------------

const byTime = (a: Note, b: Note) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);

/** The notes of one type, oldest first: the order that numbers them. */
const inTime = (notes: readonly Note[], type: NoteType): Note[] => notes.filter((n) => n.type === type).sort(byTime);

/** `L-<n>` for decisions and `J-<n>` for questions: n counts the notes of that type by time, from 1. A cancellation is a decision note and is numbered like one. */
const idOf = (prefix: string, n: number) => `${prefix}-${n}`;

const day = (n: Note) => n.at.slice(0, 10);

/** One decision as the block of process 7.4. The parties come from the note's `agent` and `to` (the two sides of the topic), the sections it touches are those
 *  parties' own, and "BPV pārskatīts" is whether the user has seen it. */
function decisionEntry(n: Note, nr: number): string {
	const parties = [n.agent, n.to].filter((x): x is string => !!x);
	return [
		`${idOf("L", nr)} | ${day(n)} | ${n.stage || "-"} | Puses: ${[...parties].sort().join(", ") || "-"}`,
		`Temats: ${n.title}`,
		`Lēmums: ${n.body}`,
		`Ietekme: ${parties.map((x) => x.toUpperCase()).join(", ") || "-"}`,
		`BPV pārskatīts: ${n.reviewed ? "jā" : "nē"}`,
	].join("\n");
}

/** One question as the block of process 7.5. The answer is the title of the answer note that refers to the question. */
function questionEntry(n: Note, nr: number, notes: readonly Note[]): string {
	const answer = notes.filter((a) => a.type === "answer" && a.refs.includes(n.id)).sort(byTime).at(-1);
	return [
		`${idOf("J", nr)} | ${day(n)} | ${n.stage || "-"} | No: ${n.agent || "-"} | Kam: ${n.to || "-"}`,
		`Jautājums: ${n.title}`,
		"Ietekme, ja neatbild: nav",
		`Atbilde: ${answer?.title ?? "-"}`,
		`Statuss: ${n.status === "closed" ? "slēgts" : "atvērts"}`,
	].join("\n");
}

/** Every decision note of the project as an L- block, oldest first (cancellations included). */
export const decisionLog = (notes: readonly Note[]): string[] => inTime(notes, "decision").map((n, i) => decisionEntry(n, i + 1));

/** Every question note of the project as a J- block, oldest first. */
export const questionLog = (notes: readonly Note[]): string[] => inTime(notes, "question").map((n, i) => questionEntry(n, i + 1, notes));

/** Risks and changes have no block in the process document; the same head line and a title and description keep them readable beside the others. */
export function noteLog(notes: readonly Note[], type: "risk" | "change"): string[] {
	const [prefix, label] = type === "risk" ? ["R", "Risks"] : ["I", "Izmaiņa"];
	return inTime(notes, type).map((n, i) => [`${idOf(prefix, i + 1)} | ${day(n)} | ${n.stage || "-"} | No: ${n.agent || "-"}`, `${label}: ${n.title}`, `Apraksts: ${n.body}`].join("\n"));
}

/** Whole lines of `lines` that fit in `budget` characters (a newline between lines counts). */
function fit(lines: readonly string[], budget: number): string[] {
	const out: string[] = [];
	let used = 0;
	for (const l of lines) {
		const cost = l.length + 1;
		if (used + cost > budget) break;
		out.push(l);
		used += cost;
	}
	return out;
}

/** The project's status page, the short text every agent of the process carries (and the file projekta_statuss.md): the stage and its iteration, the gate that waits,
 *  the open questions and the open tasks, newest first. Cut at whole lines to stay under `maxChars`; each of the two lists keeps room for the other, so 200 questions
 *  do not push the tasks out. The text has no time in it (`now` is the caller's, kept in the signature for it): it must not change between two runs that saw the same work. */
export function statusText(s: ProcessState, i: { notes: readonly Note[]; open: readonly Message[]; now: string }, maxChars = 3000): string {
	const head = [s.stage === "mācības" || s.stage === "done" ? `Stadija ${s.stage}` : `Stadija ${s.stage} (iterācija ${s.iteration[s.stage] + 1} no ${MAX_ITERATIONS})`];
	const gate = [...s.gates].reverse().find((g) => g.state === "waiting");
	if (gate) head.push(`Gaida gate ${gate.id}: lēmums cilvēkam.`);

	const numbered = new Map(inTime(i.notes, "question").map((n, k) => [n.id, k + 1]));
	const questions = [...i.notes]
		.filter((n) => n.type === "question" && n.status !== "closed")
		.sort((a, b) => byTime(b, a))
		.map((n) => `- ${idOf("J", numbered.get(n.id) ?? 0)} ${n.to || "-"}: ${n.title}`);
	const tasks = [...i.open].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).map((m) => `- ${m.id} → ${m.to}: ${m.task?.goal ?? m.text.split("\n")[0]}`);

	// each line costs its length and a newline, so a total cost within maxChars leaves the text one character short of it. The headings are always there;
	// each list takes what it needs of what is left, but never more than the half the other one leaves it
	const cost = (xs: readonly string[]) => xs.reduce((n, l) => n + l.length + 1, 0);
	const qHead = questions.length ? "Atvērtie jautājumi:" : "Atvērtie jautājumi: nav";
	const tHead = tasks.length ? "Atvērtie uzdevumi:" : "Atvērtie uzdevumi: nav";
	const left = maxChars - cost(head) - cost([qHead, tHead]);
	const tasksShare = Math.min(cost(tasks), Math.floor(left / 2));
	const questionsShare = Math.min(cost(questions), left - tasksShare);
	return [...head, qHead, ...fit(questions, questionsShare), tHead, ...fit(tasks, left - questionsShare)].join("\n");
}
