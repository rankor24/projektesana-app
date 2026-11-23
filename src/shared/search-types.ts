// Shapes of the project search index and its results, shared by the main process, the background worker, the agent's tool and the
// Avoti page. No node imports here: the window reads them too.

export type SearchKind = "sources" | "conversations" | "all";

/** One passage that answers (or may answer) a question, with what to name when citing it. */
export interface Passage {
	kind: "source" | "conversation";
	/** a source's title and page, or a thread's title, date and speaker */
	citation: string;
	text: string;
	/** the fused rank score; only comparable within one result */
	score: number;
	/** which of the two searches found it: the words, the meaning, or both */
	via: ("keyword" | "meaning")[];
	sourceId?: string;
	page?: number;
	threadId?: string;
	at?: string;
}

export interface SearchResult {
	hits: Passage[];
	/** "hybrid": words and meaning. "keyword": no model was ready, only the words were used (see note). */
	mode: "hybrid" | "keyword";
	note?: string;
}

/** What is in a project's index. */
export interface IndexStatus {
	/** the model that made the stored vectors; null before any */
	model: string | null;
	/** pieces in all, and how many have a vector of that model */
	chunks: number;
	embedded: number;
	sources: { chunks: number; embedded: number; files: number };
	messages: { chunks: number; embedded: number };
	updatedAt: string | null;
}

export interface ModelInfo {
	id: string;
	label: string;
	approxMB: number;
	license: string;
	/** the files are in the app's models folder */
	downloaded: boolean;
}

/** A model file being fetched. */
export interface DownloadState {
	file: string;
	loaded: number;
	total: number;
}

/** What the Avoti page shows, and what the `search.progress` event carries (without `index`, which the page asks for again). */
export interface SearchStatus {
	projectId: string;
	model: ModelInfo;
	index: IndexStatus | null;
	/** idle: nothing running; queued: a run is waiting its turn; running: the worker is at work */
	state: "idle" | "queued" | "running";
	phase?: "pieces" | "model" | "vectors";
	/** vectors made in this run, of those waiting when it started */
	done?: number;
	total?: number;
	download?: DownloadState;
	/** why the last run stopped, when it did not finish */
	error?: string;
}
