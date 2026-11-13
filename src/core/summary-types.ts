// The shapes of the projects dashboard (task 8.4). Types only, no node imports: the renderer imports them through
// shared/api.ts. The computing is in summary.ts.
import type { BimStage } from "./model.js";

export type Level = "bad" | "warn";

export interface AttentionItem {
	level: Level;
	/** what to do about it: the panel to open, with a filter when one thing is meant */
	open: { panel: "prasibas" | "nodevumi" | "projekts"; filter?: string };
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
