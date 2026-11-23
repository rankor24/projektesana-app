// What the conversations panel draws, as plain data: departments → agents → threads, the search that narrows it, and where a dragged agent or department lands.
// No React here, so the rules can be read (and tried) apart from the markup.
//
// Ported from OpenMausBot (Apache-2.0):
//   src/lib/sidebar-bot-drop.ts  `botListOf`, `placed`, `planBotDrop`, `stepBot`, `unusedName`   → listOf, place, planAgentDrop, stepAgent, unusedName
//   src/lib/sidebar-layout.ts    `moveSection`, `placeSection`, `sidebarLayoutInteractive`      → moveDepartment, placeDepartment, interactive
//   src/components/SidebarThreadRow.tsx  `visibleSidebarThreads` (search over titles), `attentionRank`  → the search and the agent's dot
// Adapted: a department has an id and a name (OpenMausBot's section is its name, so a rename rewrites every bot); there is no "drop on a bot to start a
// department" (a department is added by name, and the list of departments is the app's, not the bots'); threads are listed pinned first, then newest first (OpenMausBot's pin; nothing is snoozed);
// a closed thread is the archive, shown on request, and can be taken back ("Atjaunot").
import { normRef, type AgentSpec } from "../../shared/agent-types";
import { departmentOf, type Department } from "../../shared/departments";
import { LEAD_ID, type QueueView, type Thread, type ThreadState } from "../../shared/thread-types";
import { liveState } from "./useThreads";
import { tr } from "../i18n";

export interface AgentNode {
	id: string;
	name: string;
	/** no specialist of this id any more (removed in Iestatījumi) but it still owns threads */
	gone: boolean;
	threads: Thread[];
	/** the most pressing state of its open threads: what its dot shows */
	state: ThreadState;
}

export interface DepartmentNode {
	/** the department's id; null = agents in none (or in a department the list no longer has) */
	id: string | null;
	name: string;
	agents: AgentNode[];
	/** the most pressing state among its agents, for the mark on a folded header */
	state: ThreadState;
	/** open threads that are not idle, for the same mark */
	active: number;
}

export interface Tree {
	/** null while a search leaves nothing of it */
	lead: AgentNode | null;
	departments: DepartmentNode[];
	/** agents that were removed in Iestatījumi but still own threads */
	removed: AgentNode[];
}

/** How pressing a state is, for the dot of an agent and of a folded department: waiting for the user first (OpenMausBot's `attentionRank`: waiting-on-you before working before queued). */
const RANK: Record<ThreadState, number> = { "waiting-confirm": 6, interrupted: 5, running: 4, "waiting-reply": 3, queued: 2, idle: 1, closed: 0 };
export const mostPressing = (states: readonly ThreadState[]): ThreadState => states.reduce<ThreadState>((a, b) => (RANK[b] > RANK[a] ? b : a), "idle");

/** The user's pins first, then the newest. */
export const newestFirst = (a: Thread, b: Thread) => Number(!!b.pinned) - Number(!!a.pinned) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0);

/** The window's own name for the group of agents in no department. */
export const NO_DEPARTMENT = (): string => tr("Bez nodaļas");

function node(id: string, name: string, gone: boolean, all: Thread[], queue: QueueView, showClosed: boolean): AgentNode {
	const threads = all.filter((t) => t.agent === id && (showClosed || t.state !== "closed")).sort(newestFirst);
	return { id, name, gone, threads, state: mostPressing(threads.filter((t) => t.state !== "closed").map((t) => liveState(t, queue))) };
}

/** True when `needle` (already `normRef`-ed) is in `text`: case, diacritics and punctuation do not matter ("bk 3" finds "BK-3", "Ugunsdrosiba" finds "Ugunsdrošība"). */
const has = (text: string, needle: string) => normRef(text).includes(needle);

/** The tree for the panel. `query` narrows it: a department or agent whose name matches keeps everything under it, otherwise only the threads whose title matches
 *  (and the agents and departments above them). An empty query keeps all. */
export function buildTree(i: { specs: readonly AgentSpec[]; departments: readonly Department[]; threads: readonly Thread[]; queue: QueueView; showClosed: boolean; query: string; leadName: string }): Tree {
	const needle = normRef(i.query);
	const all = [...i.threads];
	const make = (id: string, name: string, gone: boolean) => node(id, name, gone, all, i.queue, i.showClosed);
	const narrow = (a: AgentNode, deptMatches: boolean): AgentNode | null => {
		if (!needle || deptMatches || has(a.name, needle) || has(a.id, needle)) return a;
		const threads = a.threads.filter((t) => has(t.title, needle));
		return threads.length ? { ...a, threads } : null;
	};
	const known = new Set(i.departments.map((d) => d.id));
	const groups: { id: string | null; name: string; specs: AgentSpec[] }[] = i.departments.map((d) => ({ id: d.id, name: d.name, specs: i.specs.filter((s) => departmentOf(s) === d.id) }));
	// agents in no department, or in one the list does not have: one group at the end (a drop on it files them in none)
	const loose = i.specs.filter((s) => {
		const d = departmentOf(s);
		return d === undefined || !known.has(d);
	});
	groups.push({ id: null, name: NO_DEPARTMENT(), specs: loose });

	const departments: DepartmentNode[] = [];
	for (const g of groups) {
		const deptMatches = !!needle && has(g.name, needle);
		const agents = g.specs.map((s) => narrow(make(s.id, s.name, false), deptMatches)).filter((a): a is AgentNode => a !== null);
		// an empty department stays (it is a place to drag to), but not while a search narrows the tree; "no department" only when someone is in it
		if (agents.length === 0 && (needle || g.id === null)) continue;
		departments.push({ id: g.id, name: g.name, agents, state: mostPressing(agents.map((a) => a.state)), active: agents.reduce((n, a) => n + a.threads.filter((t) => t.state !== "closed" && liveState(t, i.queue) !== "idle").length, 0) });
	}

	const lead = narrow(make(LEAD_ID, i.leadName, false), false);
	const ids = new Set<string>([LEAD_ID, ...i.specs.map((s) => s.id)]);
	const orphans = [...new Set(all.filter((t) => !ids.has(t.agent)).map((t) => t.agent))];
	const removed = orphans.map((id) => narrow(make(id, id, true), false)).filter((a): a is AgentNode => a !== null && a.threads.length > 0);
	return { lead, departments, removed };
}

// ---- drag: an agent into a department, a department among departments ---------------------------------------------------------------------------------------

export const AGENT_DRAG_TYPE = "application/x-projektesana-agent";
export const DEPARTMENT_DRAG_TYPE = "application/x-projektesana-department";

/** Where a dragged agent lands against the row under the pointer: above it or below it. */
export type DropPlace = "before" | "after";

/** The agents of each list in the order shown: a department's id (or "" for agents in none) → their ids. */
export type AgentLists = ReadonlyMap<string, readonly string[]>;

export type AgentDrop = { kind: "row"; agentId: string; place: DropPlace } | { kind: "end"; list: string };

/** What the Aģenti call needs: the department (null = in none) and the agent it goes before (null = last of its department). */
export interface AgentMove {
	department: string | null;
	before: string | null;
}

export function listOf(lists: AgentLists, agentId: string): string | undefined {
	for (const [list, ids] of lists) if (ids.includes(agentId)) return list;
	return undefined;
}

export function sameDrop(a: AgentDrop | null, b: AgentDrop | null): boolean {
	if (!a || !b) return a === b;
	if (a.kind === "row") return b.kind === "row" && a.agentId === b.agentId && a.place === b.place;
	return b.kind === "end" && a.list === b.list;
}

/** The pointer in the top half of a row = before it, else after. */
export const dropPlace = (offset: number, height: number): DropPlace => ((height > 0 ? offset / height : 0.5) < 0.5 ? "before" : "after");

function place(lists: AgentLists, agentId: string, from: string, to: string, at: (others: string[]) => number): AgentMove | null {
	const current = lists.get(to) ?? [];
	const order = current.filter((id) => id !== agentId);
	order.splice(at(order), 0, agentId);
	// the same list and the same order: nothing to do
	if (from === to && order.every((id, k) => id === current[k])) return null;
	const next = order[order.indexOf(agentId) + 1];
	return { department: to === "" ? null : to, before: next ?? null };
}

/** What dropping `agentId` there does, or null when it changes nothing. */
export function planAgentDrop(lists: AgentLists, agentId: string, drop: AgentDrop): AgentMove | null {
	const from = listOf(lists, agentId);
	if (from === undefined) return null;
	if (drop.kind === "end") return lists.has(drop.list) ? place(lists, agentId, from, drop.list, (others) => others.length) : null;
	const to = listOf(lists, drop.agentId);
	if (drop.agentId === agentId || to === undefined) return null;
	return place(lists, agentId, from, to, (others) => others.indexOf(drop.agentId) + (drop.place === "after" ? 1 : 0));
}

/** Alt+Up / Alt+Down on an agent row: one place within its own list. */
export function stepAgent(lists: AgentLists, agentId: string, direction: -1 | 1): AgentMove | null {
	const from = listOf(lists, agentId);
	if (from === undefined) return null;
	const ids = lists.get(from)!;
	const index = ids.indexOf(agentId);
	if (index + direction < 0 || index + direction >= ids.length) return null;
	return place(lists, agentId, from, from, () => index + direction);
}

/** One place up or down in the order of departments (Alt+Up / Alt+Down on a header). */
export function moveDepartment(ids: readonly string[], id: string, direction: -1 | 1): string[] {
	const at = ids.indexOf(id);
	const to = at + direction;
	if (at < 0 || to < 0 || to >= ids.length) return [...ids];
	const next = [...ids];
	next.splice(at, 1);
	next.splice(to, 0, id);
	return next;
}

/** `from` dropped before or after `over`. */
export function placeDepartment(ids: readonly string[], from: string, over: string, where: DropPlace): string[] {
	if (from === over) return [...ids];
	const rest = ids.filter((x) => x !== from);
	const at = rest.indexOf(over);
	if (at < 0) return [...ids];
	rest.splice(where === "before" ? at : at + 1, 0, from);
	return rest;
}

/** The layout is live (fold by click, drag) only with nothing typed in the search: a narrowed tree is a result, not a layout. */
export const interactive = (query: string): boolean => query.trim().length === 0;

/** "Jauna nodaļa", "Jauna nodaļa 2", … the first not in `taken`. */
export function unusedName(base: string, taken: readonly string[]): string {
	const used = new Set(taken.map((t) => t.toLowerCase()));
	if (!used.has(base.toLowerCase())) return base;
	let n = 2;
	while (used.has(`${base} ${n}`.toLowerCase())) n += 1;
	return `${base} ${n}`;
}
