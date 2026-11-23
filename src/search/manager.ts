// The app side of the search index: decides when a project's index is built or brought up to date, runs the background worker
// for it, tells the window how far it is, and answers the window's own questions through a second, long-lived worker.
// No Electron imports: everything it needs from the app (where the data is, which sources a project has, how to emit an event,
// the log) is handed in, so a test can run it on a temporary folder.
//
// When it runs. The index builds itself: after a folder scan finishes (new text), after a conversation turn (new messages) and
// a little after the app starts (whatever a crash or an earlier closed window left unfinished). A request is held a moment so a
// burst of them (several threads finishing together) becomes one run, and only one run goes at a time across all projects, so a
// first build of a large project cannot take every core. A request that arrives while its project is being built is remembered
// and run again afterwards. Nothing is lost if the app closes in between: the worker commits in small batches and the next run
// starts at the first piece without a vector (see index.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import type { DownloadState, ModelInfo, SearchKind, SearchResult, SearchStatus } from "../shared/search-types.js";
import { DEFAULT_MODEL_ID, MODELS, modelById, modelReady } from "./embedder.js";
import { indexStatus, type SourceRef } from "./index.js";
import type { IndexJob, WorkerMessage } from "./index-worker.js";
import type { QueryReply, QueryRequest } from "./query-worker.js";
import { hasSearchSchema } from "./schema.js";

export type IndexMode = IndexJob["mode"];
const STRENGTH: Record<IndexMode, number> = { messages: 0, update: 1, rebuild: 2 };

export interface IndexerDeps {
	/** <appData>\Projektesana (the models folder is inside it) */
	appDir: string;
	/** <appData>\Projektesana\projects */
	projectsDir: string;
	/** the project's sources with the text-cache hash of each one's newest version */
	sources: (projectId: string) => SourceRef[];
	/** every state change and progress step, for the window */
	emit: (s: SearchStatus) => void;
	log: (line: string) => void;
	modelId?: string;
	/** how long a request waits for others to join it */
	delayMs?: number;
	/** the share of its own time a batch rests, so the CPU is left for everything else */
	rest?: number;
	/** how long the query worker lives without questions */
	queryIdleMs?: number;
}

const workerUrl = (name: string) => new URL(import.meta.url.endsWith(".ts") ? `./${name}.ts` : `./${name}.js`, import.meta.url);

interface Run {
	projectId: string;
	worker: Worker;
	state: SearchStatus;
}

export class SearchIndexer {
	private wanted = new Map<string, IndexMode>();
	private timers = new Map<string, NodeJS.Timeout>();
	private run: Run | null = null;
	private lastError = new Map<string, string>();
	private queryWorker: Worker | null = null;
	private queryIdle: NodeJS.Timeout | null = null;
	private queries = new Map<number, { resolve: (r: SearchResult) => void; reject: (e: Error) => void }>();
	private nextQuery = 1;
	private disposed = false;

	constructor(private readonly d: IndexerDeps) {}

	get modelsDir(): string {
		return join(this.d.appDir, "models");
	}
	private get modelId(): string {
		return this.d.modelId ?? DEFAULT_MODEL_ID;
	}
	dbFile(projectId: string): string {
		return join(this.d.projectsDir, projectId, "threads.db");
	}
	modelInfo(): ModelInfo {
		const spec = modelById(this.modelId) ?? MODELS[DEFAULT_MODEL_ID];
		return { id: spec.id, label: spec.label, approxMB: spec.approxMB, license: spec.license, downloaded: modelReady(this.modelsDir, spec) };
	}

	/** Asks for a run for this project; many asks close together make one run, of the strongest kind asked for. */
	request(projectId: string, mode: IndexMode = "update", delayMs = this.d.delayMs ?? 4000): void {
		if (this.disposed) return;
		const had = this.wanted.get(projectId);
		if (had === undefined || STRENGTH[mode] > STRENGTH[had]) this.wanted.set(projectId, mode);
		this.lastError.delete(projectId);
		if (this.run?.projectId === projectId) return this.publish(this.run.state);
		clearTimeout(this.timers.get(projectId));
		this.timers.set(
			projectId,
			setTimeout(() => {
				this.timers.delete(projectId);
				this.pump();
			}, delayMs),
		);
		this.emitIdle(projectId);
	}

	/** The user's Reindex: everything is thrown away and made again, at once. */
	reindex(projectId: string): void {
		this.request(projectId, "rebuild", 0);
	}

	/** Asks for every given project, one after another: what an earlier session left unfinished. */
	requestAll(projectIds: string[], delayMs = 20_000): void {
		projectIds.forEach((id, i) => this.request(id, "update", delayMs + i * 1000));
	}

	private pump(): void {
		if (this.run || this.disposed) return;
		const next = [...this.wanted.keys()].find((id) => !this.timers.has(id));
		if (!next) return;
		const mode = this.wanted.get(next)!;
		this.wanted.delete(next);
		this.start(next, mode);
	}

	private start(projectId: string, mode: IndexMode): void {
		const dbFile = this.dbFile(projectId);
		let job: IndexJob;
		try {
			job = { dbFile, modelsDir: this.modelsDir, modelId: this.modelId, projectDir: join(this.d.projectsDir, projectId), mode, sources: this.d.sources(projectId), rest: this.d.rest ?? 0.35 };
		} catch (e) {
			// a project that was forgotten since the request
			this.fail(projectId, (e as Error).message);
			return this.pump();
		}
		const state: SearchStatus = { projectId, model: this.modelInfo(), index: null, state: "running", phase: "pieces" };
		let worker: Worker;
		try {
			worker = new Worker(workerUrl("index-worker"), { workerData: job });
		} catch (e) {
			this.fail(projectId, (e as Error).message);
			return this.pump();
		}
		this.run = { projectId, worker, state };
		this.publish(state);
		let finished = false;
		const end = (error?: string) => {
			if (finished) return;
			finished = true;
			if (error) {
				this.lastError.set(projectId, error);
				this.d.log(`search index ${projectId}: ${error}`);
			}
			this.run = null;
			void worker.terminate();
			this.emitIdle(projectId);
			this.pump();
		};
		worker.on("message", (m: WorkerMessage) => {
			if (m.type === "phase") state.phase = m.phase;
			else if (m.type === "download") state.download = m.download as DownloadState;
			else if (m.type === "progress") (state.done = m.done), (state.total = m.total);
			else if (m.type === "error") return end(m.message);
			else if (m.type === "done") return end();
			this.publish(state);
		});
		worker.on("error", (e) => end(e.message));
		worker.on("exit", () => end());
	}

	private fail(projectId: string, message: string): void {
		this.lastError.set(projectId, message);
		this.d.log(`search index ${projectId}: ${message}`);
		this.emitIdle(projectId);
	}

	private publish(s: SearchStatus): void {
		this.d.emit({ ...s, model: this.modelInfo(), index: this.readIndex(s.projectId) });
	}

	private emitIdle(projectId: string): void {
		this.d.emit(this.status(projectId));
	}

	private readIndex(projectId: string) {
		const file = this.dbFile(projectId);
		if (!existsSync(file)) return null;
		let db: DatabaseSync | null = null;
		try {
			db = new DatabaseSync(file, { readOnly: true, timeout: 1000 } as ConstructorParameters<typeof DatabaseSync>[1]);
			return hasSearchSchema(db) ? indexStatus(db) : null;
		} catch {
			return null;
		} finally {
			try {
				db?.close();
			} catch {
				// nothing to close
			}
		}
	}

	status(projectId: string): SearchStatus {
		const running = this.run?.projectId === projectId ? this.run.state : null;
		const queued = this.wanted.has(projectId);
		const error = this.lastError.get(projectId);
		return { ...(running ?? { projectId, state: queued ? ("queued" as const) : ("idle" as const) }), projectId, model: this.modelInfo(), index: this.readIndex(projectId), ...(error ? { error } : {}) };
	}

	/** The question of the window's search box, answered by the query worker (the model loads there, not in the main process). */
	query(projectId: string, query: string, kind?: SearchKind, limit?: number): Promise<SearchResult> {
		if (this.disposed) return Promise.reject(new Error("Meklēšana ir izslēgta."));
		const w = (this.queryWorker ??= this.spawnQueryWorker());
		const id = this.nextQuery++;
		clearTimeout(this.queryIdle ?? undefined);
		this.queryIdle = setTimeout(() => this.endQueryWorker(), this.d.queryIdleMs ?? 5 * 60_000);
		return new Promise<SearchResult>((resolve, reject) => {
			this.queries.set(id, { resolve, reject });
			w.postMessage({ id, dbFile: this.dbFile(projectId), modelsDir: this.modelsDir, query, kind, limit } satisfies QueryRequest);
		});
	}

	private spawnQueryWorker(): Worker {
		const w = new Worker(workerUrl("query-worker"));
		w.on("message", (r: QueryReply) => {
			const q = this.queries.get(r.id);
			if (!q) return;
			this.queries.delete(r.id);
			if ("error" in r) q.reject(new Error(r.error));
			else if (r.result) q.resolve(r.result);
			else q.resolve({ hits: [], mode: "keyword", note: "Šī projekta sarunu datubāze vēl nav izveidota." });
		});
		const gone = (e?: Error) => {
			for (const q of this.queries.values()) q.reject(e ?? new Error("Meklēšanas process beidzās."));
			this.queries.clear();
			if (this.queryWorker === w) this.queryWorker = null;
		};
		w.on("error", gone);
		w.on("exit", () => gone());
		return w;
	}

	private endQueryWorker(): void {
		const w = this.queryWorker;
		this.queryWorker = null;
		if (w) void w.terminate();
	}

	/** On quit: the running build is told to stop after its batch, the workers are ended. */
	async dispose(): Promise<void> {
		this.disposed = true;
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
		clearTimeout(this.queryIdle ?? undefined);
		this.endQueryWorker();
		const r = this.run;
		if (r) {
			r.worker.postMessage({ type: "stop" });
			// a batch is a few seconds at most; after that the worker is ended anyway (what it committed stays)
			await Promise.race([new Promise((res) => r.worker.once("exit", res)), new Promise((res) => setTimeout(res, 4000))]);
			await r.worker.terminate();
		}
	}
}
