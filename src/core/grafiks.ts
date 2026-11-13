// What the grafiks puts on each day of a project (task 8.5), from the data the app already keeps: planned deliveries (the
// BIP grafiks dates or the user's), deliveries marked sent, TN and approval clocks that are due, and the user's tasks. A
// view, never a second copy: nothing here is stored.
import { clockOf, type ClockItem } from "../rules/clocks.js";
import type { GrafikItem } from "../shared/calendar.js";
import type { ProjectStore } from "./store.js";

const inRange = (d: string | null | undefined, from: string, to: string): d is string => !!d && d >= from && d <= to;

/** Items with a date from `from` to `to` (both included, ISO). */
export function grafikItems(store: ProjectStore, from: string, to: string, today: string): GrafikItem[] {
	const pid = store.project.id;
	const out: GrafikItem[] = [];
	for (const d of store.read("deliveries")) {
		const sent = d.submittedDate ?? d.sent?.at.slice(0, 10) ?? null;
		if (sent) {
			if (inRange(sent, from, to)) out.push({ id: `d:${d.id}:sent`, date: sent, kind: "sent", title: `${d.label} nosūtīts`, projectId: pid, open: { panel: "nodevumi", filter: d.id }, done: true });
		} else if (inRange(d.plannedDate, from, to)) {
			const late = d.plannedDate < today;
			out.push({ id: `d:${d.id}:plan`, date: d.plannedDate, kind: "planned", title: `${d.label}${d.plannedFrom === "bip" ? " (BIP grafiks)" : ""}`, projectId: pid, open: { panel: "nodevumi", filter: d.id }, ...(late ? { level: "bad" as const } : {}) });
		}
	}
	for (const item of store.readMeta<ClockItem[]>("clocks", [])) {
		const c = clockOf(item, today);
		if (c.state === "saņemts" || !inRange(c.due, from, to)) continue;
		out.push({ id: `c:${c.id}`, date: c.due, kind: "clock", title: `${c.label} (termiņš, ${c.point})`, projectId: pid, open: { panel: "nodevumi" }, ...(c.state === "kavē" ? { level: "bad" as const } : c.daysLeft <= 3 ? { level: "warn" as const } : {}) });
	}
	for (const t of store.read("tasks")) {
		if (!inRange(t.due, from, to)) continue;
		out.push({ id: `t:${t.id}`, date: t.due, kind: "task", title: t.title, projectId: pid, taskId: t.id, open: { panel: "grafiks" }, done: t.state === "done", proposed: t.state === "proposed", ...(t.state === "open" && t.due < today ? { level: "bad" as const } : {}) });
	}
	return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, "lv"));
}
