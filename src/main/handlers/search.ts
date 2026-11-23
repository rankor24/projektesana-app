// The project search index as the window and the agent's app_* tools see it: its state, a build on request, a rebuild, and a
// question. The work itself is the SearchIndexer's (src/search/manager.ts), which also runs after every folder scan and
// conversation turn without anyone asking; these four calls only read it or ask it for a run.
import type { SearchIndexer } from "../../search/manager.js";
import type { Handlers } from "../../shared/api.js";

export interface SearchDeps {
	/** absent in tests and when the app was started without it */
	search?: SearchIndexer;
}

type K = "search.status" | "search.update" | "search.reindex" | "search.query";

export function searchHandlers(d: SearchDeps): Pick<Handlers, K> {
	const need = (): SearchIndexer => {
		if (!d.search) throw new Error("Meklēšanas indekss nav ieslēgts.");
		return d.search;
	};
	return {
		"search.status": (id) => need().status(id),
		"search.update": (id) => need().request(id, "update", 0),
		"search.reindex": (id) => need().reindex(id),
		"search.query": (id, query, kind, limit) => {
			if (query.trim().length < 2) throw new Error("Jautājums ir par īsu.");
			return need().query(id, query, kind, limit);
		},
	};
}
