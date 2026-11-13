// The dashboard's top list (task 8.4): every project's attention items merged, worst and most urgent first. Pure and
// node-free, so the renderer and the tests use the same function.
import type { AttentionItem, ProjectSummary } from "../core/summary-types.js";

export type AttentionRow = AttentionItem & { projectId: string };

export function attentionAcross(summaries: ProjectSummary[]): AttentionRow[] {
	return summaries
		.flatMap((s) => s.attention.map((a) => ({ ...a, projectId: s.id })))
		.sort((a, b) => Number(b.level === "bad") - Number(a.level === "bad") || (a.days ?? Infinity) - (b.days ?? Infinity) || a.projectId.localeCompare(b.projectId));
}
