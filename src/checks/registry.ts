// Checks are code (design doc 6, rule: code raises findings, the agent proposes, the user decides). Each check names the
// events it runs on and returns its results; run.ts turns results into findings and keeps the user's overrides.
import type { Severity, Where } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";

/** What happened: a scan changed sources, the user confirmed a fact, a delivery is being prepared, a pin was resolved, … */
export type CheckEvent = "sources" | "facts" | "roles" | "requirements" | "delivery" | "pins" | "rooms" | "manual";

export interface CheckContext {
	store: ProjectStore;
	/** shipped data: rules.json, law snapshots */
	dataDir: string;
	today: string;
	/** set when the event is "delivery": the delivery being prepared */
	deliveryId?: string;
	/** model rooms from Revit, when connected (3.2) */
	modelRooms?: { number: string; name: string; level: string; area: number; id: string }[];
}

export interface CheckResult {
	/** stable within the check: the same problem gives the same key on every run */
	key: string;
	severity: Severity;
	message: string;
	where: Where;
	requirementId?: string;
}

export interface CheckRun {
	results: CheckResult[];
	/** requirements this run looked at and found met */
	met?: string[];
	/** the check could not run (no Revit, no delivery): its earlier findings are kept as they are */
	skipped?: string;
}

export interface Check {
	id: string;
	title: string;
	on: CheckEvent[];
	run(ctx: CheckContext): CheckRun | Promise<CheckRun>;
}

const checks = new Map<string, Check>();

export function registerCheck(c: Check): void {
	if (checks.has(c.id)) throw new Error(`Pārbaude ${c.id} jau reģistrēta.`);
	checks.set(c.id, c);
}

export function allChecks(): Check[] {
	return [...checks.values()];
}

export function checksFor(event: CheckEvent): Check[] {
	return allChecks().filter((c) => event === "manual" || c.on.includes(event));
}

export function getCheck(id: string): Check | undefined {
	return checks.get(id);
}

/** Tests register their own checks and remove them again. */
export function unregisterCheck(id: string): void {
	checks.delete(id);
}
