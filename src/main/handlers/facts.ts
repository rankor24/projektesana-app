// Facts and the profile: list, Boris's confirm / reject, Boris's own value.
import { borisFact, decideFact } from "../../core/facts.js";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";

export interface FactDeps {
	registry: Registry;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	afterChange?: (store: ProjectStore, what: string) => void | Promise<void>;
}

type K = "facts.list" | "facts.decide" | "facts.setByBoris" | "deliveries.list";

export function factHandlers(d: FactDeps): Pick<Handlers, K> {
	const changed = async (id: string, store: ProjectStore) => {
		await d.afterChange?.(store, "facts");
		d.emit("data.changed", { projectId: id, what: ["facts"] });
	};
	return {
		"facts.list": (id) => d.registry.store(id).read("facts"),
		"deliveries.list": (id) => d.registry.store(id).read("deliveries"),
		"facts.decide": async (id, factId, state) => {
			const store = d.registry.store(id);
			decideFact(store, factId, state);
			await changed(id, store);
		},
		"facts.setByBoris": async (id, key, value) => {
			const store = d.registry.store(id);
			borisFact(store, key, value);
			await changed(id, store);
		},
	};
}
