// Clocks on the timeline (task 4.2): technical conditions and approvals, counted in working days with Latvian holidays.
// MK 500 27.1 (state and municipal institutions) and 27.2 (network owners): TN within 11 working days, extendable with a
// reason to 20. MK 500 27.3: approval of the design within 15 working days, extendable to 20. Every clock cites its point.
import { HOLIDAY_CAVEAT, addWorkingDays, workingDaysBetween } from "./workdays.js";

export type ClockKind = "tn" | "approval";

export interface ClockItem {
	id: string;
	kind: ClockKind;
	issuer: string;
	issuerKind: "state_municipal" | "network_owner";
	requestedOn: string;
	/** the issuer said it needs more time (with a reason): 20 working days */
	extended: boolean;
	receivedOn: string | null;
	sourceId: string | null;
	by: "boris" | "agent" | "app";
}

export interface Clock extends ClockItem {
	label: string;
	due: string;
	daysLeft: number;
	ruleId: string;
	point: string;
	caveat: string;
	state: "gaida" | "kavē" | "saņemts";
}

export function clockOf(c: ClockItem, today: string): Clock {
	const days = c.kind === "tn" ? (c.extended ? 20 : 11) : c.extended ? 20 : 15;
	const due = addWorkingDays(c.requestedOn, days);
	const ruleId = c.kind === "approval" ? "approval-deadline" : c.issuerKind === "state_municipal" ? "tr-deadline-state" : "tr-deadline-network";
	const point = c.kind === "approval" ? "MK 500 27.3" : c.issuerKind === "state_municipal" ? "MK 500 27.1" : "MK 500 27.2";
	const end = c.receivedOn ?? today;
	const left = workingDaysBetween(end, due);
	return {
		...c,
		label: `${c.kind === "tn" ? "TN" : "Saskaņojums"}: ${c.issuer}`,
		due,
		daysLeft: c.receivedOn ? left : workingDaysBetween(today, due),
		ruleId,
		point,
		caveat: HOLIDAY_CAVEAT,
		state: c.receivedOn ? "saņemts" : today > due ? "kavē" : "gaida",
	};
}
