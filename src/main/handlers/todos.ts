// Tasks and the grafiks (task 8.5). The user's to-do list for a project, and the days it and the project's dates fill.
import type { Registry } from "../../core/registry.js";
import { grafikItems } from "../../core/grafiks.js";
import { addTask, removeTask, updateTask } from "../../core/tasks.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";

type K = "todos.list" | "todos.add" | "todos.update" | "todos.remove" | "grafiks.items";

export function todoHandlers(d: { registry: Registry; emit<E extends EventName>(event: E, payload: EventSpec[E]): void }): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["tasks"] });
	const today = () => new Date().toISOString().slice(0, 10);
	return {
		"todos.list": (id) => d.registry.store(id).read("tasks"),
		"todos.add": (id, input) => {
			const t = addTask(d.registry.store(id), input, "user");
			changed(id);
			return t;
		},
		"todos.update": (id, taskId, patch) => {
			const t = updateTask(d.registry.store(id), taskId, patch, "user");
			changed(id);
			return t;
		},
		"todos.remove": (id, taskId) => {
			removeTask(d.registry.store(id), taskId, "user");
			changed(id);
		},
		"grafiks.items": (scope, projectId, from, to) => {
			const ids = scope === "all" ? d.registry.list().map((p) => p.id) : projectId ? [projectId] : [];
			return ids.flatMap((id) => grafikItems(d.registry.store(id), from, to, today()));
		},
	};
}
