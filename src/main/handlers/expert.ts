// Ekspertīze for the panel (task 8.14): the remarks of the project's expert reviews, reading a review into remarks, closing a remark
// (the user's click only), who answers it, and the fix list of a daļa. The `expert` check mirrors the open remarks as findings, so each
// change here runs that check at once.
import { runChecks } from "../../checks/run.js";
import { editRemark, fixList, importReview, readRemarks, setRemarkState, summarize } from "../../core/expertise.js";
import type { Registry } from "../../core/registry.js";
import type { Handlers } from "../../shared/api.js";

type K = "expert.list" | "expert.read" | "expert.setState" | "expert.edit" | "expert.fixList";

const today = () => new Date().toISOString().slice(0, 10);

export const EXPERT_ROLE = "Ekspertīzes atzinums";

/** `setRole` is Avoti's own `sources.setRole`: the user's click on Nolasīt atzinumu gives the document its role the same way. */
export function expertHandlers(d: { registry: Registry; dataDir: string; emit: (e: "data.changed", p: { projectId: string | null; what: string[] }) => void; setRole?: Handlers["sources.setRole"] }): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["expertise", "findings"] });
	const recheck = (id: string) => runChecks(d.registry.store(id), "manual", { dataDir: d.dataDir, today: today(), only: ["expert"] }).catch(() => undefined);
	return {
		"expert.list": (id) => {
			const store = d.registry.store(id);
			const remarks = readRemarks(store);
			const used = new Set(remarks.map((r) => r.sourceId));
			const sources = store
				.read("sources")
				.filter((s) => s.kind === "document" && !s.container && (used.has(s.id) || (s.versions[s.versions.length - 1]?.textState === "ok" && (s.versions[s.versions.length - 1]?.pages ?? 0) > 0)))
				.map((s) => ({ id: s.id, title: s.title, role: s.role, pages: s.versions[s.versions.length - 1]?.pages ?? 0, remarks: remarks.filter((r) => r.sourceId === s.id).length }));
			return { remarks, summary: summarize(remarks), sources };
		},
		"expert.read": async (id, sourceId) => {
			const store = d.registry.store(id);
			const r = importReview(store, sourceId, "user");
			// the panel promises it: the document read as a review gets the review's role (only on the user's click; the agent's
			// expert_import leaves roles to the user)
			if (d.setRole && store.read("sources").find((s) => s.id === sourceId)?.role !== EXPERT_ROLE) await d.setRole(id, sourceId, EXPERT_ROLE);
			await recheck(id);
			changed(id);
			return r;
		},
		"expert.setState": async (id, remarkId, state, note) => {
			setRemarkState(d.registry.store(id), remarkId, state, note);
			await recheck(id);
			changed(id);
		},
		"expert.edit": async (id, remarkId, patch) => {
			editRemark(d.registry.store(id), remarkId, patch);
			await recheck(id);
			changed(id);
		},
		"expert.fixList": (id, daļa) => {
			const store = d.registry.store(id);
			const titles = new Map(store.read("sources").map((s) => [s.id, s.title] as const));
			return fixList(readRemarks(store), daļa, { project: store.project.name, titleOf: (sid) => titles.get(sid) ?? sid });
		},
	};
}
