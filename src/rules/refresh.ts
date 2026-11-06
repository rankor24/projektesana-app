// One call that re-derives a project's requirements from its profile, its documents and the office standard, and stores
// the merge.
import type { ProjectStore } from "../core/store.js";
import { officeRequirements } from "./office.js";
import { documentRequirements, lawRequirements, mergeRequirements } from "./requirements.js";
import { loadRules } from "./rules.js";

export interface OfficeStandard {
	file: string;
	pages: string[];
}

export function refreshRequirements(store: ProjectStore, dataDir: string, office: OfficeStandard | null = null, today = new Date().toISOString().slice(0, 10)): { count: number; notes: string[] } {
	const rules = loadRules(dataDir);
	const law = lawRequirements(rules, store.read("facts"), dataDir, today);
	const docs = documentRequirements(store.read("sources"), (s) => store.readText(s.versions[s.versions.length - 1]?.sha256 ?? ""));
	const notes = [...law.notes];
	let off: ReturnType<typeof officeRequirements>["rows"] = [];
	if (office) {
		const o = officeRequirements(office.file, office.pages);
		off = o.rows;
		if (o.missing.length) notes.push(`Biroja standartā neatrada: ${o.missing.join(", ")} — vai fails ir pareizais?`);
	} else notes.push("Biroja standarts nav norādīts iestatījumos: biroja prasības (nosaukumi, datumi) nav citējamas.");
	const prev = store.read("requirements");
	const next = mergeRequirements(prev, [...law.rows, ...docs, ...off]);
	// office rows that are not derived any more (standard unset) are dropped like the law and document rows
	const kept = next.filter((r) => !(r.id.startsWith("office:") && !off.some((o) => o.id === r.id)));
	if (JSON.stringify(prev) !== JSON.stringify(kept)) store.write("requirements", kept, { kind: "requirements.refreshed", by: "app", data: { law: law.rows.length, documents: docs.length, office: off.length } });
	store.writeMeta("requirements-notes", notes);
	return { count: kept.length, notes };
}
