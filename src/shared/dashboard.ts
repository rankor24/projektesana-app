// The dashboard's top list (task 8.4): every project's attention items merged, worst and most urgent first. Pure and
// node-free, so the renderer and the tests use the same function.
import { BIM_STAGES, PROFILE_KEYS, type BimStage, type Delivery, type Fact, type Finding } from "../core/model.js";
import type { Clock } from "../rules/clocks.js";
import type { AttentionItem, DashTile, FactCell, FolderCount, HistoryPoint, ProjectDashboard, ProjectSummary, RecentChange, StageTimeline, TimelineStage, Tone, TodoRow } from "../core/summary-types.js";

export type AttentionRow = AttentionItem & { projectId: string };

export function attentionAcross(summaries: ProjectSummary[]): AttentionRow[] {
	return summaries
		.flatMap((s) => s.attention.map((a) => ({ ...a, projectId: s.id })))
		.sort((a, b) => Number(b.level === "bad") - Number(a.level === "bad") || (a.days ?? Infinity) - (b.days ?? Infinity) || a.projectId.localeCompare(b.projectId));
}


// ---- Pārskats, the project's page (task 9.6) ----

export const PROFILE_LABEL: Record<(typeof PROFILE_KEYS)[number], string> = {
	workType: "Būvniecības veids",
	group: "Ēkas grupa",
	procedure: "Procedūra",
	stagesInContract: "Stadijas līgumā",
	sections: "Sadaļas",
	funding: "Finansējums",
	"bim.bipPresent": "BIP ir",
	"bim.lodByStage": "LOD pa stadijām",
	use: "Lietošanas veids",
	totalAreaM2: "Kopējā platība, m²",
	floorsAbove: "Virszemes stāvi",
	floorsBelow: "Pazemes stāvi",
	address: "Adrese",
	cadastralNo: "Kadastra apzīmējums",
};
/** Keys that hold several values at once (one fact per stage / section). */
export const MULTI_KEYS = new Set<string>(["stagesInContract", "sections"]);

const DAY = 86_400_000;
const dayNo = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const when = (days: number) => (days < 0 ? `kavējas ${-days} d.` : days === 0 ? "šodien" : `pēc ${days} d.`);

/** The profile as a compact grid: confirmed, a proposal waits, or empty. Several values (stages, sections) are joined. */
export function factGrid(facts: Fact[]): FactCell[] {
	return PROFILE_KEYS.map((key): FactCell => {
		const live = facts.filter((f) => f.key === `profile.${key}` && f.state !== "rejected").sort((a, b) => b.at.localeCompare(a.at));
		const confirmed = live.filter((f) => f.state === "confirmed");
		const proposed = live.filter((f) => f.state === "proposed");
		const label = PROFILE_LABEL[key];
		const factId = proposed[0] ? { factId: proposed[0].id } : {};
		if (MULTI_KEYS.has(key)) {
			const all = confirmed.length ? confirmed : proposed;
			return { key, label, value: all.length ? all.map((f) => f.value).join(", ") : null, state: confirmed.length ? "confirmed" : proposed.length ? "proposed" : "none", proposals: proposed.length, ...factId };
		}
		const shown = confirmed[0] ?? proposed[0];
		return { key, label, value: shown?.value ?? null, state: confirmed[0] ? "confirmed" : proposed[0] ? "proposed" : "none", proposals: proposed.length, ...factId };
	});
}

/**
 * The six stages with the deliveries as marks and the clocks as bars on one date axis, late ones flagged, today marked. The
 * axis runs from the earliest date to the latest (at least two weeks wide), so a mark's `pos` is comparable across stages.
 * A delivery with no date has no place on the axis and is left off; the clocks (TN, approvals) sit under Skice.
 */
export function stageTimeline(deliveries: Delivery[], clocks: Clock[], today: string, current: BimStage | null, inContract: ReadonlySet<BimStage>): StageTimeline {
	const dated = deliveries.map((d) => ({ d, date: (d.submittedDate ?? d.plannedDate ?? "").slice(0, 10) })).filter((x) => x.date);
	const days = [dayNo(today), ...dated.map((x) => dayNo(x.date)), ...clocks.flatMap((c) => [dayNo(c.requestedOn), dayNo(c.due)])];
	const lo = Math.min(...days);
	let hi = Math.max(...days);
	if (hi - lo < 14) hi = lo + 14;
	const pos = (iso: string) => Math.round(((dayNo(iso) - lo) / (hi - lo)) * 1000) / 10;
	const stages: TimelineStage[] = BIM_STAGES.map((stage) => ({
		stage,
		inContract: inContract.has(stage),
		current: current === stage,
		marks: dated
			.filter((x) => x.d.stage === stage)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map(({ d, date }) => {
				const sent = !!(d.submittedDate || d.sent);
				return { id: d.id, kind: d.kind, label: d.label, date, pos: pos(date), sent, late: !sent && date < today };
			}),
		bars: stage === "Skice" ? clocks.map((c) => ({ id: c.id, label: `${c.issuer} · ${c.label}`, from: c.requestedOn, to: c.due, fromPos: pos(c.requestedOn), toPos: pos(c.due), late: c.state === "kavē", done: c.state === "saņemts" })) : [],
	}));
	return { today, todayPos: pos(today), from: isoOf(lo), to: isoOf(hi), stages };
}

/** Jāizdara: the attention list of this project, worst first, each row with the task a click makes. */
export function todoRows(attention: AttentionItem[], id: string): TodoRow[] {
	return attention.map((a) => ({ text: a.text, level: a.level, open: a.open, days: a.days, task: { title: a.text.slice(0, 120), note: `${id}: no Pārskata saraksta Jāizdara` } }));
}

/** The chart needs two check runs; until then it says no data, never an empty chart. */
export function historySeries(points: HistoryPoint[]): ProjectDashboard["history"] {
	return points.length >= 2 ? { state: "ok", points } : { state: "no data", runs: points.length };
}

export interface DashboardInput {
	id: string;
	name: string;
	today: string;
	missing: boolean;
	summary: ProjectSummary;
	deliveries: Delivery[];
	findings: Finding[];
	clocks: Clock[];
	facts: Fact[];
	/** the folders of the last scan with their file counts */
	folders: FolderCount[];
	versions: RecentChange[];
	history: HistoryPoint[];
	hasCoordinationReference: boolean;
	stagesInContract: BimStage[];
}

const openOf = (findings: Finding[], checkId: string) => findings.filter((f) => f.checkId === checkId && f.state === "open" && f.severity !== "info").length;
const toneFor = (n: number): Tone => (n === 0 ? "ok" : "warn");

export function dashboardTiles(i: DashboardInput): DashTile[] {
	const s = i.summary;
	const f = s.findings;
	const coord = openOf(i.findings, "coordination");
	const rooms = openOf(i.findings, "rooms");
	return [
		{ id: "findings", title: "Atradumi", value: String(f.error + f.warning), tone: f.error ? "bad" : f.warning ? "warn" : "ok", sub: `${f.error} kļūdas · ${f.warning} brīdinājumi${f.info ? ` · ${f.info} info` : ""}`, open: { panel: "prasibas", filter: "findings" } },
		s.next
			? { id: "delivery", title: "Nākamais nodevums", value: s.next.label, tone: s.next.daysLeft < 0 ? "bad" : s.next.daysLeft <= 7 ? "warn" : "dim", sub: `${s.next.date} · ${when(s.next.daysLeft)}`, open: { panel: "nodevumi", filter: s.next.id } }
			: { id: "delivery", title: "Nākamais nodevums", value: "nav plānots", tone: "dim", open: { panel: "nodevumi" } },
		s.clock
			? { id: "deadline", title: "Tuvākais termiņš", value: s.clock.label, tone: s.clock.state === "kavē" ? "bad" : s.clock.daysLeft <= 3 ? "warn" : "dim", sub: `${s.clock.due} · ${s.clock.state === "kavē" ? `kavē ${-s.clock.daysLeft} d.` : `${s.clock.daysLeft} darba d.`}`, open: { panel: "nodevumi" } }
			: { id: "deadline", title: "Tuvākais termiņš", value: "nav gaidāmu", tone: "dim", open: { panel: "nodevumi" } },
		i.hasCoordinationReference
			? { id: "coordination", title: "Koordinācija", value: String(coord), tone: toneFor(coord), sub: coord ? "labojumi modeļos" : "modeļi sakrīt ar atsauci", open: { panel: "koordinacija" } }
			: { id: "coordination", title: "Koordinācija", value: "no data", tone: "dim", sub: "nav atsauces", open: { panel: "koordinacija" } },
		{ id: "rooms", title: "Telpas", value: String(rooms), tone: toneFor(rooms), sub: rooms ? "atšķirības no inventarizācijas" : "pēc pēdējās pārbaudes atšķirību nav", open: { panel: "telpas" } },
	];
}

/** Everything Pārskats shows, from plain data (core/summary.ts reads it from the stores). `today` fixes the dates. */
export function buildDashboard(i: DashboardInput): ProjectDashboard {
	const recent: RecentChange[] = [...i.versions]
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, 12)
		.map((r) => ({ at: r.at, kind: r.kind, label: r.label, ...(r.detail ? { detail: r.detail } : {}), ...(r.open ? { open: r.open } : {}) }));
	return {
		id: i.id,
		name: i.name,
		stage: i.summary.stage,
		lastScan: i.summary.lastScan,
		missing: i.missing,
		tiles: dashboardTiles(i),
		timeline: stageTimeline(i.deliveries, i.clocks, i.today, i.summary.stage, new Set(i.stagesInContract)),
		todo: todoRows(i.summary.attention, i.id),
		facts: factGrid(i.facts),
		recent,
		folders: i.folders,
		history: historySeries(i.history),
	};
}
