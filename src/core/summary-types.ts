// The shapes of the projects dashboard (task 8.4). Types only, no node imports: the renderer imports them through
// shared/api.ts. The computing is in summary.ts.
import type { BimStage } from "./model.js";

export type Level = "bad" | "warn";

export interface AttentionItem {
	level: Level;
	/** what to do about it: the panel to open, with a filter when one thing is meant */
	open: { panel: "prasibas" | "nodevumi" | "projekts" | "koordinacija" | "telpas" | "grafiks" | "parskats"; filter?: string };
	text: string;
	/** smaller = more urgent inside one level (days left; overdue is negative) */
	days: number | null;
}

export interface ProjectSummary {
	id: string;
	stage: BimStage | null;
	findings: { error: number; warning: number; info: number };
	/** the next delivery not yet sent that has a planned date (overdue ones first) */
	next: { id: string; label: string; date: string; daysLeft: number } | null;
	/** the clock closest to its end that is still waiting or late */
	clock: { label: string; due: string; daysLeft: number; state: "gaida" | "kavē" | "saņemts" } | null;
	lastScan: string | null;
	attention: AttentionItem[];
}

// ---- the project's own page, Pārskats (task 9.6): every number from the stores that exist, never a second copy ----

export type Tone = "ok" | "warn" | "bad" | "dim";
export type DashPanel = AttentionItem["open"]["panel"];

export interface DashTile {
	id: "findings" | "delivery" | "deadline" | "coordination" | "rooms";
	title: string;
	value: string;
	tone: Tone;
	sub?: string;
	open: { panel: DashPanel; filter?: string };
}

/** A delivery on the stage timeline. `pos` is 0-100 along the axis. */
export interface TimelineMark {
	id: string;
	kind: string;
	label: string;
	date: string;
	pos: number;
	late: boolean;
	sent: boolean;
}
/** A clock (TN, approval) as a bar from the day it was asked to the day it is due. */
export interface TimelineBar {
	id: string;
	label: string;
	from: string;
	to: string;
	fromPos: number;
	toPos: number;
	late: boolean;
	done: boolean;
}
export interface TimelineStage {
	stage: BimStage;
	inContract: boolean;
	current: boolean;
	marks: TimelineMark[];
	bars: TimelineBar[];
}
export interface StageTimeline {
	today: string;
	todayPos: number;
	from: string;
	to: string;
	stages: TimelineStage[];
}

/** One row of Jāizdara: why the project needs the user, where to go, and the task a click on a button makes. */
export interface TodoRow {
	text: string;
	level: Level;
	open: AttentionItem["open"];
	days: number | null;
	task: { title: string; note: string };
}

export interface FactCell {
	/** the profile key, e.g. "workType" */
	key: string;
	label: string;
	value: string | null;
	state: "confirmed" | "proposed" | "none";
	/** proposals waiting for the user on this key */
	proposals: number;
	/** the proposed fact the review (9.7) starts from */
	factId?: string;
}

export interface RecentChange {
	at: string;
	kind: "source" | "delivery" | "revision" | "data";
	label: string;
	detail?: string;
	open?: { sourceId?: string; ifc?: string };
}
export interface FolderCount {
	key: string;
	name: string;
	files: number;
	/** IFC and RVT files among them */
	models?: number;
	/** files with a version in the last 30 days */
	changed?: number;
}

/** Open findings after one check run: the history that makes "Atradumi over time" possible. */
export interface HistoryPoint {
	at: string;
	error: number;
	warning: number;
	info: number;
}

export interface ProjectDashboard {
	id: string;
	name: string;
	stage: BimStage | null;
	lastScan: string | null;
	missing: boolean;
	tiles: DashTile[];
	timeline: StageTimeline;
	todo: TodoRow[];
	facts: FactCell[];
	recent: RecentChange[];
	folders: FolderCount[];
	/** a chart needs two runs: until then it says no data */
	history: { state: "ok"; points: HistoryPoint[] } | { state: "no data"; runs: number };
}
