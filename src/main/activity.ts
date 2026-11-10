// Turns the agent's RunEvents and the folder scan's progress into Activity lines (shared/activity.ts), keeps the newest
// of them so a window that opens or reloads mid-run can catch up, and sends each line as it is made.
// Adapted from konkurss-app src/main/activity.ts (withActivity): the growing thinking/answer block that is sent at most
// once a second, and one step id per tool call so the call's line changes from running to finished in place. Here it
// wraps the session's event sink instead of an engine (projektesana has one engine), and it adds what a projektesana run
// does to the project: the sources it touched and the facts, requirements, pins, notes and Revit batches it wrote.
// No Electron imports: the sink, the project's sources and the tool levels are injected.
import { randomUUID } from "node:crypto";
import type { ScanProgress } from "../shared/api.js";
import type { RunEvent } from "../shared/types.js";
import {
	addActivity,
	answerLine,
	baseName,
	factOf,
	field,
	oneLine,
	sourceIdOf,
	taskTitle,
	thinkingLine,
	toolLine,
	type ActKind,
	type Activity,
	type Changes,
	type FactRef,
	type RunSummary,
} from "../shared/activity.js";

export interface SourceRow {
	id: string;
	title: string;
	role: string;
}

export interface ActivityDeps {
	send(a: Activity): void;
	/** the project's sources (store "sources"); may throw when the project cannot be read */
	sources(projectId: string): SourceRow[];
	/** the approval level of a tool (agent/tools/levels.ts); a successful "confirm" tool is a change to the Revit model */
	levelOf(tool: string): string;
	/** task templates of the dock, so a run started from one is titled with its label */
	templates: readonly { label: string; text: string }[];
	now?: () => number;
	/** lines kept for a window that subscribes late */
	max?: number;
}

interface Block {
	kind: "thinking" | "answer";
	step: string;
	text: string;
	sent: number;
	lastSent: number;
}

interface Call {
	step: string;
	name: string;
	kind: ActKind;
	text: string;
	input?: string;
	sourceId: string | null;
	page?: number;
	fact?: FactRef;
	done: boolean;
}

interface Run {
	id: string;
	project: string | null;
	calls: Map<string, Call>;
	anonymous: number;
	block: Block | null;
	summary: RunSummary;
	titles: Map<string, SourceRow> | null;
	/** sources a call read successfully: they stay read whatever a later call on them does */
	readOk: Set<string>;
	ended: boolean;
}

interface Scan {
	run: string;
	phase: ScanProgress["phase"];
	lastSent: number;
}

const SCAN_PHASE: Record<"walk" | "hash" | "text", string> = { walk: "Apskata mapes", hash: "Pārbauda, kas mainījies", text: "Nolasa tekstu" };
/** a scan reports every file; the strip needs a few lines a second, not hundreds */
const SCAN_EVERY_MS = 300;
const KEEP_RUNS = 40;

const noChanges = (): Changes => ({ facts: 0, requirements: 0, pins: 0, notes: 0, revit: 0 });

/** Which counter a successful call of this tool adds to. */
function changeOf(tool: string, level: string): keyof Changes | null {
	switch (baseName(tool)) {
		case "set_fact":
			return "facts";
		case "add_requirement":
		case "propose_justification":
			return "requirements";
		case "add_pin":
		case "add_comment":
		case "resolve_pin":
			return "pins";
		case "write_note":
			return "notes";
	}
	return level === "confirm" ? "revit" : null;
}

export class ActivityLog {
	private lines: Activity[] = [];
	private runs = new Map<string, Run>();
	private scans = new Map<string, Scan>();
	/** what the next run is about: set by agent.send before the session starts it, taken by its first line */
	private pending: { projectId: string | null; prompt: string } | null = null;
	private now: () => number;

	constructor(private d: ActivityDeps) {
		this.now = d.now ?? Date.now;
	}

	/** Everything kept, oldest first. */
	recent(): Activity[] {
		return [...this.lines];
	}

	/** agent.send is about to start a run for this project with this text. */
	begin(projectId: string | null, prompt: string) {
		this.pending = { projectId, prompt };
	}

	/** agent.send refused: no run started. */
	cancel() {
		this.pending = null;
	}

	/** agent.send returned this run id. Opens the run unless one of its events already did. */
	bind(runId: string) {
		if (!this.runs.has(runId)) this.open(runId);
	}

	/** The user answered a batch confirmation. */
	confirmed(id: string, allow: boolean) {
		for (const r of this.runs.values()) {
			const line = this.lines.find((l) => l.run === r.id && l.step === `confirm-${id}`);
			if (line) {
				this.push({ ...line, at: this.stamp(), status: allow ? "ok" : "failed", text: `${allow ? "Atļauts" : "Noraidīts"}: ${line.text.replace(/^Gaida apstiprinājumu: /, "")}` });
				return;
			}
		}
	}

	event(runId: string, e: RunEvent) {
		const r = this.runs.get(runId) ?? this.open(runId);
		if (e.type === "text") {
			// after the run ended only the app writes (the revision after a confirmed batch): a note, not the answer
			if (r.ended) {
				const t = e.text.replace(/\[lietotne\]\s*/g, "").trim();
				if (t) this.line(r, "note", t);
				return;
			}
			this.grow(r, "answer", e.text);
			return;
		}
		if (e.type === "thinking") return this.grow(r, "thinking", e.text);
		this.close(r);
		switch (e.type) {
			case "turn":
				return;
			case "tool":
				return this.toolStart(r, e);
			case "tool_result":
				return this.toolEnd(r, e);
			case "compact": {
				const text =
					e.phase === "start" ? "Saspiež sarunas vecāko daļu…" : e.phase === "done" ? "Saruna saspiesta" : `Saspiešana neizdevās, darbs turpinās bez tās${e.message ? `: ${e.message}` : ""}`;
				this.line(r, "note", text, { step: "compact", status: e.phase === "start" ? "running" : e.phase === "done" ? "ok" : "failed" });
				return;
			}
			case "confirm":
				this.line(r, "confirm", `Gaida apstiprinājumu: ${e.tool}`, { step: `confirm-${e.id}`, status: "running", tool: "revit", detail: e.batch });
				return;
			case "retry":
				this.line(r, "note", `Savienojums pārtrūka (${oneLine(e.message, 80)}). Atkārto ${e.attempt}/${e.of}…`, { step: "retry", status: "running" });
				return;
			case "done":
				this.finish(r, "ok");
				this.line(r, "done", "Pabeigts");
				return;
			case "error":
				this.finish(r, "failed");
				this.line(r, "error", oneLine(e.message, 300), { detail: e.message });
				return;
		}
	}

	/** The folder scan of one project, as an "app" run: one line that counts up, then done or the error. */
	scan(p: ScanProgress) {
		let s = this.scans.get(p.projectId);
		if (p.phase === "done") {
			if (!s) return;
			this.scans.delete(p.projectId);
			this.push(this.mk(s.run, p.projectId, "app", "tool", `Avoti nolasīti${p.total ? `: ${p.total}` : ""}`, { step: "scan", tool: "read", status: "ok", progress: { done: p.total, total: p.total } }));
			this.push(this.mk(s.run, p.projectId, "app", "done", "Pabeigts"));
			return;
		}
		if (!s) {
			s = { run: `scan-${p.projectId}-${this.now().toString(36)}`, phase: p.phase, lastSent: 0 };
			this.scans.set(p.projectId, s);
			this.push(this.mk(s.run, p.projectId, "app", "start", "Projekta mapes nolasīšana"));
		}
		if (p.phase === "error") {
			this.scans.delete(p.projectId);
			this.push(this.mk(s.run, p.projectId, "app", "tool", "Nolasīšana apstājās", { step: "scan", tool: "read", status: "failed" }));
			this.push(this.mk(s.run, p.projectId, "app", "error", p.message ?? "Kļūda", { detail: p.message }));
			return;
		}
		const t = this.now();
		if (p.phase === s.phase && t - s.lastSent < SCAN_EVERY_MS) return;
		s.phase = p.phase;
		s.lastSent = t;
		const count = p.total ? `: ${p.done} / ${p.total}` : "";
		this.push(this.mk(s.run, p.projectId, "app", "tool", `${SCAN_PHASE[p.phase]}${count}`, { step: "scan", tool: "read", status: "running", detail: p.current, progress: { done: p.done, total: p.total } }));
	}

	// ---- runs -------------------------------------------------------------------------------------------------------

	private open(runId: string): Run {
		const p = this.pending;
		this.pending = null;
		const r: Run = { id: runId, project: p?.projectId ?? null, calls: new Map(), anonymous: 0, block: null, summary: { steps: 0, listed: null, sources: [], changes: noChanges() }, titles: null, readOk: new Set(), ended: false };
		this.runs.set(runId, r);
		this.prune();
		this.line(r, "start", p ? taskTitle(p.prompt, this.d.templates) : "Uzdevums", { detail: p?.prompt });
		return r;
	}

	/** Forget the oldest finished runs; their lines stay in the buffer until newer lines push them out. */
	private prune() {
		if (this.runs.size <= KEEP_RUNS) return;
		for (const [id, r] of this.runs) {
			if (this.runs.size <= KEEP_RUNS) break;
			if (r.ended) this.runs.delete(id);
		}
	}

	private sourcesOf(r: Run, reload = false): Map<string, SourceRow> {
		if (!r.project) return new Map();
		if (!r.titles || reload) {
			let rows: SourceRow[] = [];
			try {
				rows = this.d.sources(r.project);
			} catch {
				// a project that cannot be read: ids stay ids
			}
			r.titles = new Map(rows.map((s) => [s.id, s]));
		}
		return r.titles;
	}

	private title(r: Run, id: string): string | null {
		return this.sourcesOf(r).get(id)?.title ?? this.sourcesOf(r, true).get(id)?.title ?? null;
	}

	private toolStart(r: Run, e: Extract<RunEvent, { type: "tool" }>) {
		const { text, kind } = toolLine(e.name, e.detail, (id) => this.title(r, id));
		const sourceId = sourceIdOf(e.name, e.detail);
		const page = field(e.detail, "page");
		const call: Call = { step: randomUUID(), name: e.name, kind, text, input: e.detail, sourceId, page: typeof page === "number" ? page : undefined, fact: baseName(e.name) === "set_fact" ? (factOf(e.detail) ?? undefined) : undefined, done: false };
		r.calls.set(e.id ?? `call-${++r.anonymous}`, call);
		r.summary.steps++;
		if (sourceId && kind !== "ui") this.chip(r, sourceId, "reading");
		this.sendCall(r, call, "running");
		this.sendSummary(r);
	}

	private toolEnd(r: Run, e: Extract<RunEvent, { type: "tool_result" }>) {
		// the result completes the call it answers; without an id, the newest unfinished call of that tool
		const call = (e.id ? r.calls.get(e.id) : undefined) ?? [...r.calls.values()].reverse().find((c) => c.name === e.name && !c.done);
		if (!call) {
			if (!e.ok) this.line(r, "tool", `${toolLine(e.name, undefined, () => null).text} — neizdevās`, { status: "failed", detail: e.detail ?? e.output });
			return;
		}
		call.done = true;
		const result = e.ok ? e.output : (e.detail ?? e.output);
		this.sendCall(r, call, e.ok ? "ok" : "failed", result, e.chars);
		if (call.sourceId && call.kind !== "ui") this.chip(r, call.sourceId, e.ok ? "read" : "failed", e.ok && call.fact ? 1 : 0);
		if (e.ok) {
			const c = changeOf(call.name, this.d.levelOf(baseName(call.name)));
			if (c) r.summary.changes[c]++;
			if (baseName(call.name) === "list_sources") {
				const role = String(field(call.input, "role") ?? "");
				r.summary.listed = [...this.sourcesOf(r, true).values()].filter((s) => !role || s.role === role).length;
			}
		}
		this.sendSummary(r);
	}

	private chip(r: Run, id: string, state: "reading" | "read" | "failed", facts = 0) {
		const list = r.summary.sources;
		const at = list.findIndex((s) => s.id === id);
		const title = this.title(r, id) ?? id;
		// a source that was read once stays read: a later failed call on it (a refused quote) does not undo that
		if (state === "read") r.readOk.add(id);
		const prev = at >= 0 ? list[at] : null;
		const next = { id, title, state: state === "failed" && r.readOk.has(id) ? "read" : state, facts: (prev?.facts ?? 0) + facts } as const;
		r.summary.sources = at >= 0 ? list.map((s, i) => (i === at ? next : s)) : [...list, next];
	}

	/** The run ended: calls that never got their result were stopped, sources still being read were not finished. */
	private finish(r: Run, how: "ok" | "failed") {
		r.ended = true;
		for (const c of r.calls.values()) {
			if (!c.done) {
				c.done = true;
				this.sendCall(r, c, "stopped");
			}
		}
		if (r.summary.sources.some((s) => s.state === "reading")) {
			r.summary.sources = r.summary.sources.map((s) => (s.state === "reading" ? { ...s, state: how === "ok" || r.readOk.has(s.id) ? "read" : "failed" } : s));
			this.sendSummary(r);
		}
	}

	private sendCall(r: Run, c: Call, status: Activity["status"], result?: string, chars?: number) {
		const detail = [c.input, result].filter(Boolean).join("\n\n→ ") || undefined;
		const text = status === "failed" ? `${c.text} — neizdevās` : c.text;
		this.line(r, "tool", text, { step: c.step, tool: c.kind, status, detail, chars, fact: c.fact, source: c.sourceId ? { id: c.sourceId, page: c.fact?.page ?? c.page } : undefined });
	}

	private sendSummary(r: Run) {
		this.line(r, "summary", "", { step: "summary", summary: { ...r.summary, sources: [...r.summary.sources], changes: { ...r.summary.changes } } });
	}

	// ---- growing blocks ---------------------------------------------------------------------------------------------

	private flush(r: Run) {
		const b = r.block;
		if (b && b.text.length > b.sent) {
			b.sent = b.text.length;
			b.lastSent = this.now();
			this.line(r, b.kind, b.kind === "answer" ? answerLine(b.text.length) : thinkingLine(b.text), { detail: b.text, step: b.step });
		}
	}

	private grow(r: Run, kind: Block["kind"], text: string) {
		if (r.block && r.block.kind !== kind) this.close(r);
		r.block ??= { kind, step: randomUUID(), text: "", sent: 0, lastSent: 0 };
		r.block.text += text;
		if (this.now() - r.block.lastSent > 1000) this.flush(r);
	}

	private close(r: Run) {
		this.flush(r);
		r.block = null;
	}

	// ---- lines ------------------------------------------------------------------------------------------------------

	private stamp() {
		return new Date(this.now()).toISOString();
	}

	private mk(run: string, project: string | null, who: Activity["who"], kind: Activity["kind"], text: string, more: Partial<Activity> = {}): Activity {
		return { run, project, who, at: this.stamp(), kind, text, ...more };
	}

	private line(r: Run, kind: Activity["kind"], text: string, more: Partial<Activity> = {}) {
		this.push(this.mk(r.id, r.project, "agent", kind, text, more));
	}

	private push(a: Activity) {
		this.lines = addActivity(this.lines, a, this.d.max ?? 600);
		this.d.send(a);
	}
}
