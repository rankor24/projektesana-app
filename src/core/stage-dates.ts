// The dates of the six BIM stages (the Gantt of Grafiks): where each starts and ends, as the user sets them. Kept in one small
// file of the project (stage-dates.json), the previous copy in versions\, as the clocks are. The app invents no stage date: a
// stage with none has a span derived from its own deliveries on the page, and says so.
import { BIM_STAGES, type BimStage, type Who } from "./model.js";
import type { ProjectStore } from "./store.js";
import type { StageDates } from "../shared/gantt.js";

const NAME = "stage-dates";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const real = (d: unknown): d is string => typeof d === "string" && ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** What is on disk, repaired: only known stages, real dates, start not after end. */
export function readStageDates(store: ProjectStore): StageDates {
	const raw = store.readMeta<Record<string, { start?: unknown; end?: unknown }>>(NAME, {});
	const out: StageDates = {};
	for (const stage of BIM_STAGES) {
		const r = raw?.[stage];
		if (r && real(r.start) && real(r.end) && r.start <= r.end) out[stage] = { start: r.start, end: r.end };
	}
	return out;
}

/** Sets a stage's dates, or clears them (`range` null). Both dates are needed; the first is not after the second. */
export function setStageDates(store: ProjectStore, stage: BimStage, range: { start: string; end: string } | null, by: Who): StageDates {
	if (!BIM_STAGES.includes(stage)) throw new Error(`Nezināma stadija: ${stage}`);
	const next = readStageDates(store);
	if (range === null) delete next[stage];
	else {
		if (!real(range.start) || !real(range.end)) throw new Error("Stadijas datumi formā GGGG-MM-DD.");
		if (range.start > range.end) throw new Error("Stadijas sākums ir pēc beigām.");
		next[stage] = { start: range.start, end: range.end };
	}
	store.writeMeta(NAME, next, { kind: "stage.dates", by, data: { stage, ...(range ?? {}) } });
	const from = { ...stageDatesFrom(store) };
	if (range === null) delete from[stage];
	else from[stage] = by === "app" ? "bip" : by;
	store.writeMeta(FROM, from, { kind: "stage.dates.from", by, data: { stage } });
	return next;
}

const FROM = "stage-dates-from";
/** Who set each stage's dates: "bip" (read from the BIP by the scan), "user" or "agent". A stage set before 2.6.8 has none. */
export function stageDatesFrom(store: ProjectStore): Partial<Record<BimStage, "bip" | "user" | "agent">> {
	return store.readMeta<Partial<Record<BimStage, "bip" | "user" | "agent">>>(FROM, {});
}

/**
 * The stages' spans the scan read from the BIP (sources/deliveries.ts stagesFromSchedule). A stage the user or the agent set,
 * or one set before the origin was kept, is left as it is; an empty one, or one the BIP set before, takes the BIP's dates.
 */
export function applyBipStageDates(store: ProjectStore, rows: { stage: BimStage; start: string; end: string }[]): BimStage[] {
	const have = readStageDates(store);
	const from = stageDatesFrom(store);
	const set: BimStage[] = [];
	for (const r of rows) {
		const cur = have[r.stage];
		if (cur && from[r.stage] !== "bip") continue;
		if (cur && cur.start === r.start && cur.end === r.end) continue;
		setStageDates(store, r.stage, { start: r.start, end: r.end }, "app");
		set.push(r.stage);
	}
	return set;
}
