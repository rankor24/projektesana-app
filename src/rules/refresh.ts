// One call that re-derives a project's requirements from its profile and documents and stores the merge.
import type { ProjectStore } from "../core/store.js";
import { documentRequirements, lawRequirements, mergeRequirements } from "./requirements.js";
import { loadRules } from "./rules.js";

export function refreshRequirements(store: ProjectStore, dataDir: string, today = new Date().toISOString().slice(0, 10)): { count: number; notes: string[] } {
	const rules = loadRules(dataDir);
	const law = lawRequirements(rules, store.read("facts"), dataDir, today);
	const docs = documentRequirements(store.read("sources"), (s) => store.readText(s.versions[s.versions.length - 1]?.sha256 ?? ""));
	const prev = store.read("requirements");
	const next = mergeRequirements(prev, [...law.rows, ...docs]);
	const same = JSON.stringify(prev) === JSON.stringify(next);
	if (!same) store.write("requirements", next, { kind: "requirements.refreshed", by: "app", data: { law: law.rows.length, documents: docs.length } });
	store.writeMeta("requirements-notes", law.notes);
	return { count: next.length, notes: law.notes };
}
