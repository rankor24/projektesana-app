// Searching a project's threads.db from outside the app's own connection: the agent's tools server (another process, which must
// not write) and the query worker behind the Avoti page's search box. The database is opened read-only; the model that built its
// vectors is found by name in the database itself, loaded from the app's models folder with downloading off, and kept for the
// life of the process (loading takes a second or two; a question after the first costs a few dozen milliseconds).
// No model on disk, or no vectors yet: the search still answers, by words alone, and says so in its note.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SearchKind, SearchResult } from "../shared/search-types.js";
import { loadEmbedder, modelById, modelReady, type Embedder } from "./embedder.js";
import { searchProject } from "./search.js";

export type EmbedderLoader = (modelId: string, modelsDir: string) => Promise<Embedder | null>;

const cache = new Map<string, Promise<Embedder | null>>();

/** The model by id from the models folder, once per process; null when its files are not there or it does not load. */
export const defaultLoader: EmbedderLoader = (modelId, modelsDir) => {
	const key = `${modelsDir}|${modelId}`;
	let p = cache.get(key);
	if (!p) {
		const spec = modelById(modelId);
		p =
			spec && modelReady(modelsDir, spec)
				? loadEmbedder(spec, { modelsDir, download: false }).catch(() => {
						cache.delete(key);
						return null;
					})
				: Promise.resolve(null);
		cache.set(key, p);
	}
	return p;
};

export interface DbSearch {
	query: string;
	kind?: SearchKind;
	limit?: number;
}

/** Null: there is no database file. */
export async function searchDbFile(file: string, modelsDir: string, q: DbSearch, load: EmbedderLoader = defaultLoader): Promise<SearchResult | null> {
	if (!existsSync(file)) return null;
	const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 } as ConstructorParameters<typeof DatabaseSync>[1]);
	try {
		const modelId = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'meta'").get() ? (db.prepare("SELECT value FROM meta WHERE key = 'search.model'").get() as { value: string } | undefined)?.value : undefined;
		let embedder: Embedder | null = null;
		let embedderNote: string | undefined;
		if (!modelId) embedderNote = "Vektori vēl nav uzbūvēti (Avoti → Meklēšanas indekss); meklē tikai pēc atslēgvārdiem.";
		else {
			embedder = await load(modelId, modelsDir);
			if (!embedder) embedderNote = "Modeļa faili nav pieejami (Avoti → Meklēšanas indekss); meklē tikai pēc atslēgvārdiem.";
		}
		return await searchProject(db, { query: q.query, kind: q.kind, limit: q.limit, embedder, embedderNote });
	} finally {
		db.close();
	}
}
