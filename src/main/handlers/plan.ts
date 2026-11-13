// The plan above the chat input (task 9.2), the user's side: read it, and send the whole edited list. The agent's side is the
// update_plan tool (agent/tools/plan.ts); both write core/plan.ts, and the user's version wins there.
import type { Registry } from "../../core/registry.js";
import { getPlan, userSetPlan } from "../../core/plan.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";

type K = "plan.get" | "plan.set";

export function planHandlers(d: { registry: Registry; emit<E extends EventName>(event: E, payload: EventSpec[E]): void }): Pick<Handlers, K> {
	return {
		"plan.get": (id) => getPlan(d.registry.store(id)),
		"plan.set": (id, steps) => {
			const doc = userSetPlan(d.registry.store(id), steps);
			d.emit("data.changed", { projectId: id, what: ["plan"] });
			return doc;
		},
	};
}
