// The agent log's recorder (Žurnāls): turns every RunEvent of a run, and what the run started with (system text, prompt, tools), into
// LogEntry lines (shared/agent-log.ts), appends them to <runs>/<runId>/log.jsonl, keeps a small log.json per run for the list,
// and tells the window as each line is made. Nothing here talks to a model: it only listens to what the engines already report.
//
// Rules: a streamed answer or reasoning is one entry that grows (the window gets it at most once a second), written to the file when
// it ends; a tool's whole arguments and whole answer come from the engines' `input` / `full` fields (events.ts), not the cut
// copies the dock shows; every body passes shared/agent-log.ts redact() so keys and tokens never reach the file or the window; a failing
// disk never stops a run (the log is a convenience). No Electron imports: the folder and the sink are injected.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEvent } from "../shared/types.js";
import type { RunMeta } from "../shared/thread-types.js";
import { MAX_BODY, redact, logMarkdown, type LogEntry, type LogKind, type LogLane, type LogNotice, type LogRun, type LogStart, type LogStatus } from "../shared/agent-log.js";
import { safeFileName } from "./thread-export.js";

export interface LogDeps {
	/** the app's runs folder: <runsDir>/<runId>/ */
	runsDir: string;
	send?: (n: LogNotice) => void;
	now?: () => number;
	/** logs older than this many days are removed at start (files only; the run's folder stays) */
	keepDays?: number;
	/** a log file stops growing at this size */
	maxRunBytes?: number;
}

interface Block {
	entry: LogEntry;
	text: string;
	lastSent: number;
}

interface State {
	run: LogRun;
	n: number;
	bytes: number;
	/** open streamed blocks, by lane and kind */
	blocks: Map<string, Block>;
	/** tool call id → when it was called, for the result's duration */
	calls: Map<string, number>;
	metaAt: number;
	full: boolean;
}

const KEEP_STATES = 30;
const FLUSH_EVERY_MS = 1000;
const LOG_FILE = "log.jsonl";
const META_FILE = "log.json";

const firstLine = (s: string, max = 140): string => {
	const t = s.trim().split(/\r?\n/, 1)[0] ?? "";
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The body as kept: masked, and cut at MAX_BODY (the cut is marked). */
function body(text: string | undefined): { text?: string; cut?: boolean } {
	if (!text) return {};
	const r = redact(text);
	return r.length > MAX_BODY ? { text: r.slice(0, MAX_BODY), cut: true } : { text: r };
}

function pretty(json: string): string {
	try {
		return JSON.stringify(JSON.parse(json), null, 2);
	} catch {
		return json;
	}
}

const laneKey = (l?: LogLane) => l?.id ?? "";

export class AgentLog {
	private states = new Map<string, State>();
	private now: () => number;

	constructor(private d: LogDeps) {
		this.now = d.now ?? Date.now;
		this.prune();
	}

	private dir(runId: string): string {
		return join(this.d.runsDir, runId);
	}

	// ---- recording ----------------------------------------------------------------------------------------------------

	/** A run was queued or started: its first line. Called by `event` too, so a run is never missed. */
	begin(runId: string, meta: Pick<RunMeta, "threadId" | "agent" | "projectId" | "wave">, prompt?: string): void {
		this.state(runId, meta, prompt);
	}

	/** An attempt of the run (or of a lane) is about to call the engine: the model, the tools, the system text and the prompt it gets. */
	start(runId: string, meta: RunMeta | undefined, info: LogStart, lane?: LogLane): void {
		const st = this.state(runId, meta, info.prompt);
		this.closeAll(st, lane);
		if (!lane) {
			st.run.model = `${info.provider}/${info.model}`;
			if (info.effort) st.run.effort = info.effort;
		}
		const lines = [
			`engine: ${info.engine}`,
			`model: ${info.provider}/${info.model || "(default)"}${info.effort ? `, effort ${info.effort}` : ""}`,
			`conversation: ${info.resumed ? "a resumed session" : info.history ? `${info.history} earlier messages` : "new"}`,
			...(info.images ? [`images: ${info.images}`] : []),
			...(info.backup ? ["restarted on the backup provider"] : []),
			`tools offered (${info.tools.length}): ${info.tools.join(", ") || "none"}`,
		];
		this.add(st, "run", `${info.provider}/${info.model || "default"}${info.backup ? " (backup)" : ""}`, { text: lines.join("\n") }, lane);
		this.add(st, "system", `${info.system.length} chars`, { text: info.system }, lane);
		this.add(st, "prompt", firstLine(info.prompt), { text: info.prompt }, lane);
	}

	/** One RunEvent of the run (or of a lane inside it). */
	event(runId: string, e: RunEvent, meta?: RunMeta, lane?: LogLane): void {
		const st = this.state(runId, meta);
		const at = this.now();
		if (e.type === "text" || e.type === "thinking") {
			const kind: LogKind = e.type;
			// the other kind of block ends when this one goes on
			for (const k of ["text", "thinking"] as const) if (k !== kind) this.closeBlock(st, `${laneKey(lane)}:${k}`);
			this.grow(st, kind, e.text, lane);
			return;
		}
		this.closeAll(st, lane);
		switch (e.type) {
			case "turn":
				return void this.add(st, "note", `turn ${e.n}`, {}, lane, at);
			case "tool": {
				st.run.tools++;
				if (e.id) st.calls.set(e.id, at);
				const args = pretty(e.input ?? e.detail ?? "");
				return void this.add(st, "tool", e.name, { text: args === "{}" ? undefined : args, ...(e.id ? { id: e.id } : {}), name: e.name }, lane, at);
			}
			case "tool_result": {
				const t0 = e.id ? st.calls.get(e.id) : undefined;
				if (e.id) st.calls.delete(e.id);
				if (!e.ok) st.run.errors++;
				const text = e.full ?? (e.ok ? e.output : (e.detail ?? e.output));
				return void this.add(st, "result", e.name, { text, ok: e.ok, name: e.name, ...(e.id ? { id: e.id } : {}), ...(e.chars !== undefined ? { chars: e.chars } : {}), ...(t0 !== undefined ? { ms: at - t0 } : {}) }, lane, at);
			}
			case "usage": {
				const u = st.run.usage;
				u.turns++;
				u.input += e.input;
				u.output += e.output;
				u.cacheRead += e.cacheRead;
				u.cacheWrite += e.cacheWrite;
				if (e.cost !== null) u.cost = (u.cost ?? 0) + e.cost;
				const price = e.cost === null ? "no price" : `$${e.cost.toFixed(4)}`;
				return void this.add(st, "usage", `in ${e.input} · out ${e.output} · cache ${e.cacheRead}/${e.cacheWrite} · ${price}`, { usage: { input: e.input, output: e.output, cacheRead: e.cacheRead, cacheWrite: e.cacheWrite, cost: e.cost, ...(e.model ? { model: e.model } : {}) } }, lane, at);
			}
			case "compact":
				return void this.add(st, "compact", `${e.phase}: ${e.before}${e.after !== undefined ? ` → ${e.after}` : ""} tokens`, { text: e.message }, lane, at);
			case "steered":
				return void this.add(st, "prompt", e.starts ? "message held while the agent answered: sent as this run" : "message written during the run: read by the agent after its step", { text: e.text }, lane, at);
			case "confirm":
				return void this.add(st, "confirm", e.tool, { text: pretty(e.batch), id: e.id }, lane, at);
			case "retry":
				return void this.add(st, "retry", `attempt ${e.attempt}/${e.of}, again in ${Math.round(e.delayMs / 1000)} s`, { text: e.message }, lane, at);
			case "lane":
				return void this.add(st, "lane", `${e.phase}: ${e.agent ? `${e.agent}: ` : ""}${e.label}`, { text: e.report ?? e.text, ...(e.ok !== undefined ? { ok: e.ok } : {}) }, { id: e.id, label: e.label, ...(e.agent ? { agent: e.agent } : {}) }, at);
			case "check":
				return void this.add(st, "check", `${e.phase} ${e.n}/${e.of} · ${e.by}${e.verdict ? ` · ${e.verdict}` : ""}`, { text: e.report }, lane, at);
			case "done":
				this.add(st, "run", "done", { ms: at - st.run.startedAt }, lane, at);
				return void (lane ? undefined : this.finish(st, "ok"));
			case "error": {
				if (!lane) st.run.errors++;
				this.add(st, "error", firstLine(e.message), { text: e.hint ? `${e.message}\n\nhint: ${JSON.stringify(e.hint)}` : e.message }, lane, at);
				return void (lane ? undefined : this.finish(st, e.message === "aborted" ? "stopped" : "failed"));
			}
		}
	}

	/** The app's own remark on a run (not something the model said). */
	note(runId: string, title: string, text?: string): void {
		const st = this.states.get(runId);
		if (st) this.add(st, "note", title, { text });
	}

	// ---- reading ------------------------------------------------------------------------------------------------------

	/** Runs, newest first. A run the process no longer holds as running was stopped with the app. */
	runs(filter?: { projectId?: string | null }, limit = 300): LogRun[] {
		const out = new Map<string, LogRun>();
		try {
			const dirs = readdirSync(this.d.runsDir)
				.map((n) => {
					try {
						return { n, t: statSync(join(this.dir(n), META_FILE)).mtimeMs };
					} catch {
						return null;
					}
				})
				.filter((x): x is { n: string; t: number } => x !== null)
				.sort((a, b) => b.t - a.t)
				.slice(0, limit);
			for (const { n } of dirs) {
				const r = this.readMeta(n);
				if (r) out.set(n, r);
			}
		} catch {
			// no runs folder yet
		}
		for (const [id, st] of this.states) out.set(id, st.run);
		return [...out.values()]
			.map((r) => (r.status === "running" && !this.states.has(r.runId) ? { ...r, status: "stopped" as LogStatus } : r))
			.filter((r) => !filter || filter.projectId === undefined || r.projectId === filter.projectId)
			.sort((a, b) => b.startedAt - a.startedAt)
			.slice(0, limit);
	}

	/** The run's entries, in order; a block still being written is included as it is now. */
	read(runId: string): LogEntry[] {
		const file = join(this.dir(runId), LOG_FILE);
		const byN = new Map<number, LogEntry>();
		if (existsSync(file)) {
			for (const line of readFileSync(file, "utf8").split("\n")) {
				if (!line) continue;
				try {
					const e = JSON.parse(line) as LogEntry;
					byN.set(e.n, e);
				} catch {
					// a torn last line (the app died mid-write) is skipped
				}
			}
		}
		const st = this.states.get(runId);
		if (st) for (const b of st.blocks.values()) byN.set(b.entry.n, this.shown(b));
		return [...byN.values()].sort((a, b) => a.n - b.n);
	}

	/** A run as a file: Markdown for a person, JSONL (one entry per line) for a tool. Saving it is the window's job. */
	export(runId: string, format: "md" | "jsonl"): { fileName: string; mime: string; text: string } {
		const run = this.runs(undefined, 1000).find((r) => r.runId === runId);
		if (!run) throw new Error(`Žurnāls: gājiens ${runId} nav atrasts.`);
		const entries = this.read(runId);
		const day = new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
		const base = safeFileName(`${run.agent} ${day} ${run.runId.slice(0, 8)}`);
		if (format === "jsonl") return { fileName: `${base}.jsonl`, mime: "application/x-ndjson", text: entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "") };
		return { fileName: `${base}.md`, mime: "text/markdown", text: logMarkdown(run, entries) };
	}

	// ---- internals ----------------------------------------------------------------------------------------------------

	private readMeta(runId: string): LogRun | null {
		try {
			const r = JSON.parse(readFileSync(join(this.dir(runId), META_FILE), "utf8")) as LogRun;
			return r && typeof r.runId === "string" ? r : null;
		} catch {
			return null;
		}
	}

	/** The highest entry number in a run's file and the file's size. */
	private scan(runId: string): { n: number; bytes: number } {
		const file = join(this.dir(runId), LOG_FILE);
		try {
			const text = readFileSync(file, "utf8");
			let n = 0;
			for (const line of text.split("\n")) {
				if (!line) continue;
				try {
					n = Math.max(n, (JSON.parse(line) as { n?: number }).n ?? 0);
				} catch {
					// a torn last line
				}
			}
			return { n, bytes: Buffer.byteLength(text) };
		} catch {
			return { n: 0, bytes: 0 };
		}
	}

	private writeMeta(st: State, force = false) {
		const t = this.now();
		if (!force && t - st.metaAt < 2000) return;
		st.metaAt = t;
		try {
			mkdirSync(this.dir(st.run.runId), { recursive: true });
			writeFileSync(join(this.dir(st.run.runId), META_FILE), JSON.stringify(st.run), "utf8");
		} catch {
			// the log is a convenience
		}
	}

	private state(runId: string, meta?: Pick<RunMeta, "threadId" | "agent" | "projectId" | "wave">, prompt?: string): State {
		let st = this.states.get(runId);
		if (st) {
			// the meta may arrive with a later event only
			if (meta && st.run.agent === "") Object.assign(st.run, { threadId: meta.threadId, agent: meta.agent, projectId: meta.projectId, wave: meta.wave });
			return st;
		}
		const old = this.readMeta(runId);
		const t = this.now();
		const run: LogRun = old ?? {
			runId,
			threadId: meta?.threadId ?? "",
			agent: meta?.agent ?? "",
			projectId: meta?.projectId ?? null,
			wave: meta?.wave ?? "",
			startedAt: t,
			status: "running",
			title: firstLine(prompt ?? ""),
			entries: 0,
			tools: 0,
			errors: 0,
			usage: { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null },
		};
		if (!run.title && prompt) run.title = firstLine(prompt);
		// a run an older process began: numbering goes on after its last line, the size cap counts what the file already holds
		const was = old ? this.scan(runId) : { n: 0, bytes: 0 };
		st = { run, n: Math.max(old?.entries ?? 0, was.n), bytes: was.bytes, blocks: new Map(), calls: new Map(), metaAt: 0, full: false };
		this.states.set(runId, st);
		this.evict();
		if (!old) this.writeMeta(st, true);
		return st;
	}

	/** The newest states stay; ended ones beyond KEEP_STATES leave memory (their file stays). */
	private evict() {
		if (this.states.size <= KEEP_STATES) return;
		for (const [id, st] of this.states) {
			if (this.states.size <= KEEP_STATES) break;
			if (st.run.status !== "running") {
				this.writeMeta(st, true);
				this.states.delete(id);
			}
		}
	}

	private finish(st: State, status: LogStatus) {
		// the first end wins: an "aborted" error after a done is not a failure
		if (st.run.status === "running") {
			st.run.status = status;
			st.run.endedAt = this.now();
		}
		this.writeMeta(st, true);
		// the window learns the run's end (its status and numbers) without a new line
		this.send(st, null);
	}

	private shown(b: Block): LogEntry {
		const x = body(b.text);
		return { ...b.entry, ...x, open: true };
	}

	private grow(st: State, kind: "text" | "thinking", text: string, lane?: LogLane) {
		const key = `${laneKey(lane)}:${kind}`;
		let b = st.blocks.get(key);
		if (!b) {
			const entry: LogEntry = { n: ++st.n, at: this.now(), kind, title: "", ...(lane ? { lane } : {}) };
			b = { entry, text: "", lastSent: 0 };
			st.blocks.set(key, b);
			st.run.entries = Math.max(st.run.entries, st.n);
		}
		b.text += text;
		if (this.now() - b.lastSent > FLUSH_EVERY_MS) {
			b.lastSent = this.now();
			this.send(st, { ...this.shown(b), title: firstLine(redact(b.text)) });
		}
	}

	private closeBlock(st: State, key: string) {
		const b = st.blocks.get(key);
		if (!b) return;
		st.blocks.delete(key);
		const e: LogEntry = { ...b.entry, ...body(b.text), title: firstLine(redact(b.text)) };
		// an empty block (a model that sent a blank delta) leaves nothing behind
		if (b.text.trim()) this.write(st, e);
		this.send(st, e);
	}

	/** Ends the streamed blocks of one lane (or of the run itself when `lane` is absent). */
	private closeAll(st: State, lane?: LogLane) {
		for (const k of [...st.blocks.keys()]) if (k.startsWith(`${laneKey(lane)}:`)) this.closeBlock(st, k);
	}

	private add(st: State, kind: LogKind, title: string, more: Partial<LogEntry>, lane?: LogLane, at = this.now()) {
		const { text: raw, ...rest } = more;
		const e: LogEntry = { ...rest, n: ++st.n, at, kind, title: redact(title), ...body(raw), ...(lane ? { lane } : {}) };
		st.run.entries = Math.max(st.run.entries, st.n);
		this.write(st, e);
		this.send(st, e);
		this.writeMeta(st);
	}

	private write(st: State, e: LogEntry) {
		if (st.full) return;
		const line = `${JSON.stringify(e)}\n`;
		const max = this.d.maxRunBytes ?? 25 * 1024 * 1024;
		try {
			if (st.bytes + line.length > max) {
				st.full = true;
				const stop: LogEntry = { n: ++st.n, at: this.now(), kind: "note", title: "log full: this run's log stopped growing", text: `The log of one run is limited to ${Math.round(max / 1048576)} MB.` };
				mkdirSync(this.dir(st.run.runId), { recursive: true });
				appendFileSync(join(this.dir(st.run.runId), LOG_FILE), `${JSON.stringify(stop)}\n`, "utf8");
				this.send(st, stop);
				return;
			}
			mkdirSync(this.dir(st.run.runId), { recursive: true });
			appendFileSync(join(this.dir(st.run.runId), LOG_FILE), line, "utf8");
			st.bytes += line.length;
		} catch {
			// a full disk must not stop the run
		}
	}

	private send(st: State, entry: LogEntry | null) {
		try {
			this.d.send?.({ run: { ...st.run, usage: { ...st.run.usage } }, entry });
		} catch {
			// a window already gone
		}
	}

	/** Removes the logs of runs older than keepDays: the two files only, never the run's folder. */
	private prune() {
		const cutoff = this.now() - (this.d.keepDays ?? 30) * 86_400_000;
		try {
			for (const n of readdirSync(this.d.runsDir)) {
				const meta = join(this.dir(n), META_FILE);
				try {
					if (statSync(meta).mtimeMs < cutoff) {
						rmSync(meta, { force: true });
						rmSync(join(this.dir(n), LOG_FILE), { force: true });
					}
				} catch {
					// not a run with a log
				}
			}
		} catch {
			// no runs folder yet
		}
	}
}
