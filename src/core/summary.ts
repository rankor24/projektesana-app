// What the projects dashboard shows about one project (task 8.4), computed from what the app already stores — findings,
// deliveries, clocks, the last scan — never from a second copy. `attention` is why the project needs the user today, worst
// first; `attentionAcross` merges those lists over all projects for the top of the dashboard.
import { clockOf, type Clock, type ClockItem } from "../rules/clocks.js";
import type { BimStage, Delivery, Finding } from "./model.js";
import type { AttentionItem, ProjectDashboard, ProjectSummary, FolderCount } from "./summary-types.js";
import type { ProjectStore } from "./store.js";
import { readHistory } from "./history.js";
import { versionsBetween } from "./versions.js";
import { buildDashboard } from "../shared/dashboard.js";
import { STAGES_OF } from "./stages.js";

const DAY = 86_400_000;
/** Calendar days from a to b (ISO dates); negative when b is before a. */
export function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY);
}

export function openCounts(findings: Finding[]): ProjectSummary["findings"] {
	const out = { error: 0, warning: 0, info: 0 };
	for (const f of findings) if (f.state === "open") out[f.severity === "error" ? "error" : f.severity === "warning" ? "warning" : "info"]++;
	return out;
}

/** The last delivery the user marked sent decides the stage (as the project list always did). */
export function stageOf(deliveries: Delivery[]): BimStage | null {
	return deliveries.filter((d) => d.submittedDate).sort((a, b) => (a.submittedDate! < b.submittedDate! ? 1 : -1))[0]?.stage ?? null;
}

export function nextDelivery(deliveries: Delivery[], today: string): ProjectSummary["next"] {
	const pending = deliveries.filter((d) => !d.submittedDate && !d.sent && d.plannedDate).sort((a, b) => a.plannedDate!.localeCompare(b.plannedDate!));
	const d = pending[0];
	return d ? { id: d.id, label: d.label, date: d.plannedDate!, daysLeft: daysBetween(today, d.plannedDate!) } : null;
}

export function closestClock(clocks: Clock[]): ProjectSummary["clock"] {
	const live = clocks.filter((c) => c.state !== "saņemts").sort((a, b) => a.daysLeft - b.daysLeft);
	const c = live[0];
	return c ? { label: c.label, due: c.due, daysLeft: c.daysLeft, state: c.state } : null;
}

export function projectSummary(store: ProjectStore, today: string, missing = false): ProjectSummary {
	const deliveries = store.read("deliveries");
	const findings = openCounts(store.read("findings"));
	const clocks = store.readMeta<ClockItem[]>("clocks", []).map((c) => clockOf(c, today));
	const next = nextDelivery(deliveries, today);
	const clock = closestClock(clocks);
	const scan = store.readMeta<{ at: string } | null>("scan", null);
	const attention: AttentionItem[] = [];
	const add = (a: AttentionItem) => attention.push(a);

	if (missing) add({ level: "bad", open: { panel: "projekts" }, text: "Projekta mape nav pieejama", days: null });
	else if (!scan) add({ level: "warn", open: { panel: "projekts" }, text: "Projekts vēl nav nolasīts", days: null });
	if (findings.error) add({ level: "bad", open: { panel: "prasibas" }, text: `${findings.error} atvērtas kļūdas`, days: null });
	if (findings.warning) add({ level: "warn", open: { panel: "prasibas" }, text: `${findings.warning} brīdinājumi`, days: null });
	if (clock?.state === "kavē") add({ level: "bad", open: { panel: "nodevumi" }, text: `${clock.label} kavējas ${-clock.daysLeft} darba d.`, days: clock.daysLeft });
	else if (clock && clock.daysLeft <= 3) add({ level: "warn", open: { panel: "nodevumi" }, text: `${clock.label}: atlikušas ${clock.daysLeft} darba d.`, days: clock.daysLeft });
	if (next && next.daysLeft < 0) add({ level: "bad", open: { panel: "nodevumi", filter: next.id }, text: `Nodevums ${next.label} kavējas ${-next.daysLeft} d.`, days: next.daysLeft });
	else if (next && next.daysLeft <= 7) add({ level: "warn", open: { panel: "nodevumi", filter: next.id }, text: `Nodevums ${next.label} pēc ${next.daysLeft} d.`, days: next.daysLeft });

	attention.sort((a, b) => Number(b.level === "bad") - Number(a.level === "bad") || (a.days ?? Infinity) - (b.days ?? Infinity));
	return { id: store.project.id, stage: stageOf(deliveries), findings, next, clock, lastScan: scan?.at ?? null, attention };
}

export { attentionAcross } from "../shared/dashboard.js";
export type { AttentionItem, Level, ProjectSummary } from "./summary-types.js";

/** The folders of the last scan with how many models each holds and how many files changed since `since` (P4). */
export function folderCounts(folders: { folderKey: string; name: string; files: number }[], sources: { folderKey: string; paths: string[]; versions: { mtime: string }[] }[], since: string): FolderCount[] {
	return folders.map((f) => {
		const mine = sources.filter((s) => s.folderKey === f.folderKey);
		const models = mine.filter((s) => /\.(ifc|rvt)$/i.test(s.paths[0]?.split("::").pop() ?? "")).length;
		const changed = mine.filter((s) => (s.versions[s.versions.length - 1]?.mtime ?? "").slice(0, 10) >= since).length;
		return { key: f.folderKey, name: f.name, files: f.files, models, changed };
	});
}

/** The project's own page (task 9.6): every number from the stores, `today` fixes the dates (and the 30 days of changes). */
export function projectDashboard(store: ProjectStore, today: string, missing = false): ProjectDashboard {
	const summary = projectSummary(store, today, missing);
	const facts = store.read("facts");
	const scan = store.readMeta<{ at: string; folders?: { folderKey: string; name: string; files: number }[] } | null>("scan", null);
	const contract = new Set<BimStage>(facts.filter((f) => f.key === "profile.stagesInContract" && f.state !== "rejected").flatMap((f) => STAGES_OF[(f.value as keyof typeof STAGES_OF) ?? "custom"] ?? []));
	return buildDashboard({
		id: store.project.id,
		name: store.project.name,
		today,
		missing,
		summary,
		deliveries: store.read("deliveries"),
		findings: store.read("findings"),
		clocks: store.readMeta<ClockItem[]>("clocks", []).map((c) => clockOf(c, today)),
		facts,
		folders: folderCounts(scan?.folders ?? [], store.read("sources"), shiftDay(today, -30)),
		versions: versionsBetween(store, shiftDay(today, -30), today),
		history: readHistory(store),
		hasCoordinationReference: !!store.readMeta<unknown>("coordination", null),
		stagesInContract: [...contract],
	});
}

const shiftDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
