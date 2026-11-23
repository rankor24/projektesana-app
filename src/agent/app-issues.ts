// The app problem log: a problem with the app itself (a tool that is missing, a document read wrongly, a crash) is written here by the
// agent's `report_app_issue` and not into the project's notes, so Boris sees the list and fixes the code. One line per report in
// <app data>\app-issues.jsonl; a status change is a second line that names the first (open → fixed, and back), nothing is edited.
// Ported in idea from OpenMausBot (Apache-2.0): the incident log and the Chief of Staff's reports about the app itself (docs/proactive-routines.md
// "incidents"); here reduced to a file the Atmiņa page lists with copy-to-clipboard.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { newId } from "../core/model.js";
import type { AppIssue, AppIssueStatus } from "../shared/memory-types.js";
import { redactSecrets } from "./memory-md.js";

export const issuesFile = (appDir: string): string => join(appDir, "app-issues.jsonl");

type Line = ({ t: "issue" } & Omit<AppIssue, "status" | "statusAt">) | { t: "status"; id: string; status: AppIssueStatus; at: string };

function append(appDir: string, l: Line): void {
	const f = issuesFile(appDir);
	mkdirSync(dirname(f), { recursive: true });
	appendFileSync(f, `${JSON.stringify(l)}\n`, "utf8");
}

/** A report. A secret in the text is replaced before it reaches the disk. The same title still open from the same place is not written twice. */
export function reportIssue(appDir: string, r: { agent: string; title: string; details: string; where: string }, now = new Date()): { issue: AppIssue; duplicate: boolean } {
	const title = redactSecrets(r.title.trim()).slice(0, 160);
	if (title.length < 5) throw new Error("Virsraksts: vismaz 5 zīmes.");
	const where = r.where.trim().slice(0, 200);
	const dup = listIssues(appDir).find((i) => i.status === "open" && i.title.toLowerCase() === title.toLowerCase() && i.where.toLowerCase() === where.toLowerCase());
	if (dup) return { issue: dup, duplicate: true };
	const row: AppIssue = { id: newId("ai"), at: now.toISOString(), agent: r.agent, title, details: redactSecrets(r.details.trim()).slice(0, 4000), where, status: "open" };
	append(appDir, { t: "issue", id: row.id, at: row.at, agent: row.agent, title: row.title, details: row.details, where: row.where });
	return { issue: row, duplicate: false };
}

/** Newest first, with the latest status of each. A damaged line is skipped. */
export function listIssues(appDir: string): AppIssue[] {
	const f = issuesFile(appDir);
	if (!existsSync(f)) return [];
	const out = new Map<string, AppIssue>();
	for (const raw of readFileSync(f, "utf8").split("\n")) {
		if (!raw.trim()) continue;
		try {
			const l = JSON.parse(raw) as Line;
			if (l.t === "issue") {
				const { t: _t, ...rest } = l;
				void _t;
				out.set(l.id, { ...rest, status: "open" });
			} else if (l.t === "status") {
				const i = out.get(l.id);
				if (i) out.set(l.id, { ...i, status: l.status, statusAt: l.at });
			}
		} catch {
			// a torn last line
		}
	}
	return [...out.values()].reverse();
}

export function setIssueStatus(appDir: string, id: string, status: AppIssueStatus, now = new Date()): AppIssue {
	if (status !== "open" && status !== "fixed") throw new Error("Statuss: open vai fixed.");
	if (!listIssues(appDir).some((i) => i.id === id)) throw new Error(`Problēma ${id} nav atrasta.`);
	append(appDir, { t: "status", id, status, at: now.toISOString() });
	return listIssues(appDir).find((i) => i.id === id)!;
}
