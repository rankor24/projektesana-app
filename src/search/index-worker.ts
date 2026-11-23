// Worker thread: builds or updates one project's search index in the background, so the window never waits for it.
// Does the three steps of index.ts in order (cut the text, cut the new messages, make the missing vectors) with its own
// connection to threads.db (the app's connection keeps writing messages meanwhile; SQLite's write-ahead log lets both work and
// each write here is one short transaction). Tells the main thread what it is doing as plain messages: phase, model download
// progress, vectors made. Lowest priority a thread can have in Node: fewer model threads than the machine has, and a rest after
// every batch (a share of the batch's own time), so a long first build leaves the CPU for the app and for the agent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";
import { ThreadsDb } from "../core/threads-db.js";
import type { DownloadState } from "../shared/search-types.js";
import { loadEmbedder, modelById } from "./embedder.js";
import { adoptModel, embedPending, pendingCount, resetIndex, syncMessages, syncSources, type SourceRef } from "./index.js";
import { ensureSearchSchema } from "./schema.js";

export interface IndexJob {
	dbFile: string;
	modelsDir: string;
	modelId: string;
	/** the project's data folder: text cache at text\<sha>.json */
	projectDir: string;
	/** update: sources and messages; messages: only the new messages (after a turn); rebuild: throw everything away first */
	mode: "update" | "messages" | "rebuild";
	sources: SourceRef[];
	/** pause after each batch, as a share of the batch's time */
	rest: number;
}

export type WorkerMessage =
	| { type: "phase"; phase: "pieces" | "model" | "vectors" }
	| { type: "download"; download: DownloadState }
	| { type: "progress"; done: number; total: number }
	| { type: "done"; left: number }
	| { type: "error"; message: string };

const job = workerData as IndexJob;
const post = (m: WorkerMessage) => parentPort!.postMessage(m);
let stopped = false;
parentPort!.on("message", (m: { type: string }) => {
	if (m.type === "stop") stopped = true;
});

function readPages(sha: string): string[] | null {
	try {
		const t = JSON.parse(readFileSync(join(job.projectDir, "text", `${sha}.json`), "utf8")) as { pages?: unknown };
		return Array.isArray(t.pages) ? t.pages.map((p) => (typeof p === "string" ? p : "")) : null;
	} catch {
		return null;
	}
}

let db: DatabaseSync | null = null;
try {
	// the app's own open makes the file and the conversation tables if there are none yet (and refuses a damaged one); this connection then only adds rows
	ThreadsDb.open(job.dbFile).close();
	db = new DatabaseSync(job.dbFile, { timeout: 5000 } as ConstructorParameters<typeof DatabaseSync>[1]);
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA synchronous = NORMAL");
	ensureSearchSchema(db);
	post({ type: "phase", phase: "pieces" });
	if (job.mode === "rebuild") resetIndex(db);
	if (job.mode !== "messages") syncSources(db, job.sources, readPages);
	syncMessages(db);
	// an index made by another model has to be made again
	if (modelById(job.modelId)) adoptModel(db, job.modelId);
	if (pendingCount(db) > 0 && !stopped) {
		const spec = modelById(job.modelId);
		if (!spec) throw new Error(`Nezināms modelis: ${job.modelId}`);
		post({ type: "phase", phase: "model" });
		let lastPost = 0;
		const embedder = await loadEmbedder(spec, {
			modelsDir: job.modelsDir,
			download: true,
			onProgress: (d) => {
				const now = Date.now();
				// a progress line per received chunk would flood the window: about five a second, and always the last
				if (now - lastPost > 200 || d.loaded >= d.total) {
					lastPost = now;
					post({ type: "download", download: d });
				}
			},
		});
		post({ type: "phase", phase: "vectors" });
		const r = await embedPending(db, embedder, { batch: 16, rest: job.rest, stop: () => stopped, onProgress: (done, total) => post({ type: "progress", done, total }) });
		await embedder.dispose?.();
		post({ type: "done", left: r.left });
	} else post({ type: "done", left: pendingCount(db) });
} catch (e) {
	post({ type: "error", message: e instanceof Error ? e.message : String(e) });
} finally {
	try {
		db?.close();
	} catch {
		// already closed
	}
}
