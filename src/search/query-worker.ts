// Worker thread that answers the Avoti page's search box. The model (a second or two to load, a few hundred MB of memory) is not
// loaded in the main process: it is loaded here, on the first question, and stays loaded while questions keep coming; the manager
// ends this worker after a quiet spell. Each request is one message in, one message out.
import { parentPort } from "node:worker_threads";
import type { SearchKind, SearchResult } from "../shared/search-types.js";
import { searchDbFile } from "./query.js";

export interface QueryRequest {
	id: number;
	dbFile: string;
	modelsDir: string;
	query: string;
	kind?: SearchKind;
	limit?: number;
}
export type QueryReply = { id: number; result: SearchResult | null } | { id: number; error: string };

parentPort!.on("message", async (r: QueryRequest) => {
	try {
		parentPort!.postMessage({ id: r.id, result: await searchDbFile(r.dbFile, r.modelsDir, { query: r.query, kind: r.kind, limit: r.limit }) } satisfies QueryReply);
	} catch (e) {
		parentPort!.postMessage({ id: r.id, error: e instanceof Error ? e.message : String(e) } satisfies QueryReply);
	}
});
