// The agents and their conversations: the lead first, then departments → agents → threads (fold, drag, search, rename, archive, pin, take back). One dot shows what a thread is doing.
// Phase C adds, at the top and in the menus: the Incidenti list (runs that failed, stalled or could not start, with Retry and Dismiss), a Full stop button, Pause / Resume in the
// menu of every agent and department with a "paused" badge, and pinned threads first with a pin mark. The pause and incident rules are the coordinator's (agent/coordinator.ts);
// this file only shows them and asks (OpenMausBot docs/pausing-bots.md puts the same switches in a bot's and a department's sidebar menu).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import { DEPARTMENT_NAME_MAX, departmentOf, type Department } from "../../shared/departments";
import { LEAD_ID, type HeldView, type PauseTarget, type QueueView, type Thread, type ThreadState, type WaitingItem } from "../../shared/thread-types";
import { agentName, liveState, useThreads } from "./useThreads";
import { AGENT_DRAG_TYPE, DEPARTMENT_DRAG_TYPE, NO_DEPARTMENT, buildTree, dropPlace, interactive, moveDepartment, placeDepartment, planAgentDrop, sameDrop, stepAgent, unusedName, type AgentDrop, type AgentNode, type DropPlace } from "./sidebar-tree";
import { useTreeState } from "./sidebar-state";
import { THREADS } from "../../shared/layout";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { windows } from "../windows";
import { IncidentRow } from "./Waiting";
import { locale, tr } from "../i18n";

export const STATE_TEXT: Record<ThreadState, string> = {
	idle: tr("brīva"),
	queued: tr("gaida rindā"),
	running: tr("strādā"),
	"waiting-confirm": tr("gaida tavu apstiprinājumu"),
	"waiting-reply": tr("gaida atbildi"),
	interrupted: tr("pārtraukta"),
	closed: tr("slēgta"),
};

/** Five dots: idle, running, queued, waiting (both kinds), interrupted. */
const DOT: Record<ThreadState, string> = { idle: "idle", queued: "queued", running: "running", "waiting-confirm": "waiting", "waiting-reply": "waiting", interrupted: "interrupted", closed: "closed" };

export function StateDot({ state }: { state: ThreadState }) {
	return <span className={`tdot ${DOT[state]}`} title={STATE_TEXT[state]} />;
}

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface MenuItem {
	label: string;
	run: () => void;
	disabled?: boolean;
	title?: string;
}

/** The ⋯ button of a row and its small menu: one for a thread (rename, archive) and one for a department (rename, move, delete). Closes on a click outside or Escape.
 *  (OpenMausBot draws these as two portal menus; here a row's menu is two or four lines, so it opens in place.) */
function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		window.addEventListener("mousedown", away);
		window.addEventListener("keydown", key);
		return () => {
			window.removeEventListener("mousedown", away);
			window.removeEventListener("keydown", key);
		};
	}, [open]);
	return (
		<span className="tl-menu-wrap" ref={box} onClick={(e) => e.stopPropagation()}>
			<button className="ghost small tl-more" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
				⋯
			</button>
			{open && (
				<div className="tl-menu" role="menu">
					{items.map((it) => (
						<button
							key={it.label}
							role="menuitem"
							className="ghost small"
							disabled={it.disabled}
							title={it.title}
							onClick={() => {
								setOpen(false);
								it.run();
							}}
						>
							{it.label}
						</button>
					))}
				</div>
			)}
		</span>
	);
}

/** A name typed in place: Enter or leaving the field keeps it, Escape drops it (OpenMausBot's `SectionNameField` and the thread row's rename input). */
function NameField({ value, label, max, onCommit, onCancel }: { value: string; label: string; max: number; onCommit: (v: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(value);
	const field = useRef<HTMLInputElement>(null);
	const settled = useRef(false);
	useEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, []);
	// Enter and the blur it causes must not both commit
	const settle = (save: boolean) => {
		if (settled.current) return;
		settled.current = true;
		if (save) onCommit(draft);
		else onCancel();
	};
	return (
		<input
			ref={field}
			className="tl-name-field"
			value={draft}
			maxLength={max}
			aria-label={label}
			onClick={(e) => e.stopPropagation()}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => settle(true)}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !e.nativeEvent.isComposing) {
					e.preventDefault();
					settle(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					settle(false);
				}
			}}
		/>
	);
}

/** A small drawn pin: the mark of a pinned thread. */
function PinMark() {
	return (
		<svg className="tl-pin" viewBox="0 0 24 24" width="12" height="12" aria-label={tr("Piesprausta")} role="img">
			<path d="M9 3h6l-1 6 3 3v2h-5v7l-1 1-1-1v-7H5v-2l3-3z" fill="currentColor" />
		</svg>
	);
}

/** One thread: its dot, pin mark, title and time; double-click or the menu renames it, the menu pins it and archives it (closes it: the transcript stays, "Rādīt arhivētās" lists it,
 *  and "Atjaunot" takes it back). */
function ThreadRow({ t, state, current, onSelect, onRename, onClose, onPin, onReopen }: { t: Thread; state: ThreadState; current: boolean; onSelect: () => void; onRename: (title: string) => void; onClose: () => void; onPin: (pinned: boolean) => void; onReopen: () => void }) {
	const [renaming, setRenaming] = useState(false);
	const busy = state === "running" || state === "queued" || state === "waiting-confirm";
	if (renaming) {
		return (
			<div className="tl-thread on">
				<StateDot state={state} />
				<NameField
					value={t.title}
					label={tr("Sarunas nosaukums")}
					max={80}
					onCommit={(v) => {
						setRenaming(false);
						if (v.trim() && v.trim() !== t.title) onRename(v.trim());
					}}
					onCancel={() => setRenaming(false)}
				/>
			</div>
		);
	}
	const items: MenuItem[] = [{ label: tr("Pārdēvēt"), run: () => setRenaming(true) }];
	if (t.state !== "closed") items.push({ label: t.pinned ? tr("Atspraust") : tr("Piespraust"), run: () => onPin(!t.pinned), title: tr("Piespraustās sarunas ir aģenta sarakstā pirmās") });
	if (t.state !== "closed") items.push({ label: tr("Arhivēt"), run: onClose, disabled: busy, title: busy ? tr("Nevar arhivēt, kamēr saruna strādā") : tr("Slēdz sarunu; pieraksts paliek") });
	else items.push({ label: tr("Atjaunot"), run: onReopen, title: tr("Atver arhivēto sarunu atkal") });
	return (
		<div className={`tl-thread ${current ? "on" : ""} ${t.state === "closed" ? "closed" : ""}`} onClick={onSelect} onDoubleClick={() => setRenaming(true)} title={STATE_TEXT[state]}>
			<StateDot state={state} />
			{t.pinned && t.state !== "closed" && <PinMark />}
			<span className="tl-title">{t.title}</span>
			{t.state === "closed" ? (
				<button className="ghost small tl-restore" onClick={(e) => (e.stopPropagation(), onReopen())} title={tr("Atver arhivēto sarunu atkal")}>
					{tr("Atjaunot")}
				</button>
			) : (
				<span className="dim small">{when(t.lastAt)}</span>
			)}
			<RowMenu label={tr("Sarunas darbības")} items={items} />
		</div>
	);
}

type DeptDrop = { id: string; place: DropPlace };

interface Props {
	threads: Thread[];
	specs: AgentSpec[];
	departments: Department[];
	queue: QueueView;
	/** the thread the chat shows */
	current: string | null;
	onSelect: (id: string) => void;
	onNew: (agent: string) => void;
	onClose: (id: string) => void;
	onRename: (id: string, title: string) => Promise<unknown>;
	/** a dragged (or Alt+arrow) agent: its department (null = none) and the agent it goes before (null = last) */
	onMoveAgent: (agent: string, department: string | null, before: string | null) => Promise<unknown>;
	/** the whole department list after an add, rename, reorder or removal */
	onSaveDepartments: (list: Department[]) => Promise<unknown>;
	onError: (message: string) => void;
	/** pin or unpin a thread */
	onPin: (id: string, pinned: boolean) => Promise<unknown>;
	/** take an archived thread back */
	onReopen: (id: string) => Promise<unknown>;
	/** what the user paused, and the switches (an agent, a department, everything) */
	held: HeldView;
	onPause: (target: PauseTarget, paused: boolean) => Promise<unknown>;
	/** the runs that failed, stalled or could not start, with Retry and Dismiss */
	incidents: Extract<WaitingItem, { kind: "incident" }>[];
	projectId: string | null;
	onRetry: (id: string) => Promise<unknown>;
	onDismiss: (id: string) => Promise<unknown>;
}

/** The conversations panel: departments (fold, remembered) → agents (fold, activity dot, "+" for a new conversation) → threads newest first (rename, archive), a search that narrows
 *  the tree, and drag: an agent to another department or place, a department to another place (Alt+Up / Alt+Down move one place from the keyboard).
 *  Ported from OpenMausBot (Apache-2.0) src/components/SidebarSections.tsx, SidebarSectionHeader.tsx, SidebarBotDrag.tsx, SidebarThreadRow.tsx; the rules are in sidebar-tree.ts, the
 *  remembered folds in sidebar-state.ts. */
export function ThreadList({ threads, specs, departments, queue, current, onSelect, onNew, onClose, onRename, onMoveAgent, onSaveDepartments, onError, onPin, onReopen, held, onPause, incidents, projectId, onRetry, onDismiss }: Props) {
	const [query, setQuery] = useState("");
	const [showClosed, setShowClosed] = useState(false);
	const [naming, setNaming] = useState<{ kind: "new"; name: string } | { kind: "rename"; id: string } | null>(null);
	const [drag, setDrag] = useState<{ kind: "agent" | "department"; id: string } | null>(null);
	const [agentDrop, setAgentDrop] = useState<AgentDrop | null>(null);
	const [deptDrop, setDeptDrop] = useState<DeptDrop | null>(null);
	const tree = useTreeState();
	const live = interactive(query);
	const searching = !live;

	const view = useMemo(() => buildTree({ specs, departments, threads, queue, showClosed, query, leadName: agentName(LEAD_ID, specs) }), [specs, departments, threads, queue, showClosed, query]);
	// the agents of each list, for the drop rules; "" = the group of agents in none (always a place to drop, even when empty)
	const lists = useMemo(() => {
		const m = new Map<string, string[]>(view.departments.map((d) => [d.id ?? "", d.agents.map((a) => a.id)]));
		if (!m.has("")) m.set("", []);
		return m;
	}, [view]);
	const run = (p: Promise<unknown>) => p.catch((e) => onError(errText(e)));

	// the conversation on screen opens its agent and unfolds its department, once each time it changes (a message sent to another agent, the "@" notice)
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		if (!current || revealed.current === current) return;
		const t = threads.find((x) => x.id === current);
		if (!t) return;
		revealed.current = current;
		if (t.agent === LEAD_ID) return;
		tree.reveal(t.agent, view.departments.find((d) => d.agents.some((a) => a.id === t.agent))?.id ?? "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [current, threads]);

	const endDrag = () => {
		setDrag(null);
		setAgentDrop(null);
		setDeptDrop(null);
	};
	const dropAgent = (d: AgentDrop) => {
		const id = drag?.kind === "agent" ? drag.id : null;
		endDrag();
		const mv = id ? planAgentDrop(lists, id, d) : null;
		if (id && mv) void run(onMoveAgent(id, mv.department, mv.before));
	};
	const step = (agent: string, dir: -1 | 1) => {
		const mv = stepAgent(lists, agent, dir);
		if (mv) void run(onMoveAgent(agent, mv.department, mv.before));
	};
	const ids = departments.map((d) => d.id);
	const reorderDepartments = (next: string[]) => {
		if (next.length === ids.length && next.every((id, k) => id === ids[k])) return;
		void run(onSaveDepartments(next.map((id) => departments.find((d) => d.id === id)!)));
	};

	const names = departments.map((d) => d.name);
	const commitDepartment = (n: NonNullable<typeof naming>, draft: string) => {
		setNaming(null);
		const name = draft.replace(/\s+/g, " ").trim();
		if (!name) return;
		if (n.kind === "new") void run(onSaveDepartments([...departments, { id: "", name }]));
		else if (departments.find((d) => d.id === n.id)?.name !== name) void run(onSaveDepartments(departments.map((d) => (d.id === n.id ? { ...d, name } : d))));
	};

	/** One agent: its row (fold, dot, name, count, "+") and, opened, its threads. `movable`: the row may be dragged (an agent of a department; not the lead, not a removed one). */
	const agentRow = (a: AgentNode, movable: boolean) => {
		const opened = searching || tree.state.opened.includes(a.id);
		const drags = live && movable;
		const openN = a.threads.filter((t) => t.state !== "closed").length;
		const mark = agentDrop?.kind === "row" && agentDrop.agentId === a.id ? `drop-${agentDrop.place}` : "";
		// paused by itself, or by its department (a full stop is the banner at the top, not a badge on every row)
		const own = held.agents.includes(a.id);
		const byDept = !own && specs.some((s) => s.id === a.id && departmentOf(s) !== undefined && held.departments.includes(departmentOf(s)!));
		const paused = own || byDept;
		return (
			<div key={a.id} className="tl-agent">
				<div
					className={`tl-agent-row ${mark} ${drag?.kind === "agent" && drag.id === a.id ? "dragging" : ""}`}
					draggable={drags || undefined}
					onDragStart={
						drags
							? (e) => {
									e.stopPropagation();
									e.dataTransfer.effectAllowed = "move";
									e.dataTransfer.setData(AGENT_DRAG_TYPE, a.id);
									setDrag({ kind: "agent", id: a.id });
								}
							: undefined
					}
					onDragEnd={drags ? endDrag : undefined}
					onDragOver={(e) => {
						if (drag?.kind !== "agent") return;
						e.preventDefault();
						e.stopPropagation();
						const r = e.currentTarget.getBoundingClientRect();
						const next: AgentDrop | null = a.id === drag.id || !movable ? null : { kind: "row", agentId: a.id, place: dropPlace(e.clientY - r.top, r.height) };
						setAgentDrop((prev) => (sameDrop(prev, next) ? prev : next));
					}}
					onDrop={(e) => {
						if (drag?.kind !== "agent") return;
						e.preventDefault();
						e.stopPropagation();
						const r = e.currentTarget.getBoundingClientRect();
						if (a.id === drag.id || !movable) return endDrag();
						dropAgent({ kind: "row", agentId: a.id, place: dropPlace(e.clientY - r.top, r.height) });
					}}
				>
					<button
						className="ghost small tl-fold"
						aria-expanded={opened}
						title={opened ? tr("Sakļaut sarunas") : tr("Rādīt sarunas")}
						disabled={searching}
						onClick={() => tree.toggleOpened(a.id)}
						onKeyDown={(e) => {
							if (!drags || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
							e.preventDefault();
							step(a.id, e.key === "ArrowUp" ? -1 : 1);
						}}
					>
						{opened ? "▾" : "▸"}
					</button>
					<StateDot state={a.state} />
					<b className="tl-agent-name" onClick={() => !searching && tree.toggleOpened(a.id)} title={a.id}>
						{a.name}
					</b>
					{openN > 0 && <span className="dim small">{openN}</span>}
					{a.gone && (
						<span className="badge dim" title={tr("Speciālists ir noņemts Iestatījumos")}>
							{tr("noņemts")}
						</span>
					)}
					{paused && (
						<span className="badge warn tl-paused" title={byDept ? tr("Nodaļa ir apturēta: aģents nesāk jaunu darbu") : tr("Aģents ir apturēts: tas nesāk jaunu darbu, kamēr neatsāc")}>
							{tr("apturēts")}
						</span>
					)}
					<span className="grow" />
					{!a.gone && a.id !== LEAD_ID && (
						<RowMenu
							label={tr("Aģenta darbības")}
							items={[
								own
									? { label: tr("Atsākt aģentu"), run: () => void run(onPause({ kind: "agent", id: a.id }, false)), title: tr("Aģents atkal sāk darbu") }
									: { label: tr("Apturēt aģentu"), run: () => void run(onPause({ kind: "agent", id: a.id }, true)), title: tr("Aptur tā darbu tūlīt un neļauj sākt jaunu, kamēr neatsāc") },
							]}
						/>
					)}
					{!a.gone && (
						<button className="ghost small tl-new" title={tr("Jauna saruna")} aria-label={tr("Jauna saruna")} onClick={() => onNew(a.id)}>
							+
						</button>
					)}
				</div>
				{opened && (
					<div className="tl-threads">
						{a.threads.map((t) => (
							<ThreadRow key={t.id} t={t} state={liveState(t, queue)} current={t.id === current} onSelect={() => onSelect(t.id)} onRename={(title) => void run(onRename(t.id, title))} onClose={() => onClose(t.id)} onPin={(pinned) => void run(onPin(t.id, pinned))} onReopen={() => void run(onReopen(t.id))} />
						))}
						{a.threads.length === 0 && <div className="dim small tl-none">{tr("nav sarunu")}</div>}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="thread-list tl-tree">
			<div className="row tl-search">
				<input
					type="search"
					className="grow"
					value={query}
					placeholder={tr("Meklēt sarunās, aģentos un nodaļās")}
					aria-label={tr("Meklēt sarunās, aģentos un nodaļās")}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => e.key === "Escape" && setQuery("")}
				/>
			</div>
			{held.all ? (
				<div className="tl-banner" role="status">
					<b>{tr("Viss apturēts")}</b>
					<span className="dim small">{tr("Nekas nesāk darbu, kamēr neatsāc.")}</span>
					<span className="grow" />
					<button className="primary small" onClick={() => void run(onPause({ kind: "all" }, false))}>
						{tr("Atsākt visu")}
					</button>
				</div>
			) : (
				<div className="row tl-stoprow">
					<button className="small tl-fullstop" onClick={() => void run(onPause({ kind: "all" }, true))} title={tr("Pilna apturēšana: aptur visus darbus, rindu, palīgus un apakšaģentus; nekas nesākas, kamēr neatsāc")}>
						{tr("Pilna apturēšana")}
					</button>
				</div>
			)}
			{incidents.length > 0 && (
				<div className="tl-incidents">
					<div className="row small">
						<b>{tr("Incidenti")}</b>
						<span className="badge warn">{incidents.length}</span>
					</div>
					{incidents.map((i) => (
						<IncidentRow key={i.id} i={i} specs={specs} projectId={projectId} onOpen={(id) => onSelect(id)} onRetry={(id) => void run(onRetry(id))} onDismiss={(id) => void run(onDismiss(id))} />
					))}
				</div>
			)}
			{view.lead && agentRow(view.lead, false)}
			{view.departments.map((d) => {
				const key = d.id ?? "";
				const folded = live && tree.state.folded.includes(key);
				const own = d.id !== null;
				const renaming = naming?.kind === "rename" && naming.id === d.id;
				const headDrop = deptDrop?.id === d.id ? `drop-${deptDrop.place}` : "";
				const into = agentDrop?.kind === "end" && agentDrop.list === key;
				const at = own ? ids.indexOf(d.id!) : -1;
				return (
					<div
						key={key || "none"}
						className={`tl-dept ${into ? "drop-into" : ""}`}
						onDragOver={(e) => {
							if (drag?.kind !== "agent") return;
							e.preventDefault();
							setAgentDrop((prev) => (prev?.kind === "end" && prev.list === key ? prev : { kind: "end", list: key }));
						}}
						onDrop={(e) => {
							if (drag?.kind !== "agent") return;
							e.preventDefault();
							dropAgent({ kind: "end", list: key });
						}}
					>
						<div
							className={`tl-dept-head ${headDrop} ${drag?.kind === "department" && drag.id === d.id ? "dragging" : ""}`}
							draggable={(live && own && !renaming) || undefined}
							onDragStart={
								live && own
									? (e) => {
											e.dataTransfer.effectAllowed = "move";
											e.dataTransfer.setData(DEPARTMENT_DRAG_TYPE, d.id!);
											setDrag({ kind: "department", id: d.id! });
										}
									: undefined
							}
							onDragEnd={endDrag}
							onDragOver={(e) => {
								if (drag?.kind !== "department" || !own) return;
								e.preventDefault();
								e.stopPropagation();
								const r = e.currentTarget.getBoundingClientRect();
								const next: DeptDrop | null = d.id === drag.id ? null : { id: d.id!, place: dropPlace(e.clientY - r.top, r.height) };
								setDeptDrop((prev) => (prev?.id === next?.id && prev?.place === next?.place ? prev : next));
							}}
							onDrop={(e) => {
								if (drag?.kind !== "department" || !own) return;
								e.preventDefault();
								e.stopPropagation();
								const r = e.currentTarget.getBoundingClientRect();
								const from = drag.id;
								endDrag();
								if (from !== d.id) reorderDepartments(placeDepartment(ids, from, d.id!, dropPlace(e.clientY - r.top, r.height)));
							}}
						>
							{renaming ? (
								<NameField value={d.name} label={tr("Nodaļas nosaukums")} max={DEPARTMENT_NAME_MAX} onCommit={(v) => commitDepartment(naming!, v)} onCancel={() => setNaming(null)} />
							) : (
								<button
									className="ghost tl-dept-toggle"
									aria-expanded={!folded}
									title={folded ? tr("Atvērt nodaļu") : tr("Sakļaut nodaļu")}
									disabled={searching}
									onClick={() => tree.toggleFolded(key)}
									onKeyDown={(e) => {
										if (!live || !own || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
										e.preventDefault();
										reorderDepartments(moveDepartment(ids, d.id!, e.key === "ArrowUp" ? -1 : 1));
									}}
								>
									<span className="tl-chev">{folded ? "▸" : "▾"}</span>
									<span className="tl-dept-name">{d.name}</span>
									{own && held.departments.includes(d.id!) && (
										<span className="badge warn tl-paused" title={tr("Nodaļa ir apturēta: tās aģenti nesāk jaunu darbu")}>
											{tr("apturēta")}
										</span>
									)}
									{folded && d.active > 0 && (
										<>
											<StateDot state={d.state} />
											<span className="dim small">{d.active}</span>
										</>
									)}
								</button>
							)}
							{live && own && !renaming && (
								<RowMenu
									label={tr("Nodaļas darbības")}
									items={[
										{ label: tr("Pārdēvēt"), run: () => setNaming({ kind: "rename", id: d.id! }) },
										held.departments.includes(d.id!)
											? { label: tr("Atsākt nodaļu"), run: () => void run(onPause({ kind: "department", id: d.id! }, false)), title: tr("Nodaļas aģenti atkal sāk darbu") }
											: { label: tr("Apturēt nodaļu"), run: () => void run(onPause({ kind: "department", id: d.id! }, true)), title: tr("Aptur visu nodaļas darbu tūlīt un neļauj sākt jaunu, kamēr neatsāc") },
										{ label: tr("Uz augšu"), run: () => reorderDepartments(moveDepartment(ids, d.id!, -1)), disabled: at <= 0 },
										{ label: tr("Uz leju"), run: () => reorderDepartments(moveDepartment(ids, d.id!, 1)), disabled: at < 0 || at >= ids.length - 1 },
										{
											label: tr("Dzēst nodaļu"),
											run: () => {
												tree.forget(d.id!);
												void run(onSaveDepartments(departments.filter((x) => x.id !== d.id)));
											},
											disabled: d.agents.length > 0,
											title: d.agents.length > 0 ? tr("Nodaļā ir aģenti: vispirms pārvieto tos citur") : tr("Noņem tukšo nodaļu"),
										},
									]}
								/>
							)}
						</div>
						{!folded && (
							<div className="tl-dept-body">
								{d.agents.map((a) => agentRow(a, true))}
								{d.agents.length === 0 && !searching && <div className="dim small tl-none">{drag?.kind === "agent" ? tr("Atlaid šeit") : tr("nav aģentu")}</div>}
							</div>
						)}
					</div>
				);
			})}
			{live && drag?.kind === "agent" && !view.departments.some((d) => d.id === null) && (
				<div
					className={`tl-dept tl-slot ${agentDrop?.kind === "end" && agentDrop.list === "" ? "drop-into" : ""}`}
					onDragOver={(e) => {
						e.preventDefault();
						setAgentDrop((prev) => (prev?.kind === "end" && prev.list === "" ? prev : { kind: "end", list: "" }));
					}}
					onDrop={(e) => {
						e.preventDefault();
						dropAgent({ kind: "end", list: "" });
					}}
				>
					{NO_DEPARTMENT()}: {tr("atlaid šeit, lai izņemtu no nodaļas")}
				</div>
			)}
			{view.removed.length > 0 && (
				<div className="tl-dept">
					<div className="tl-dept-head">
						<span className="tl-dept-name dim">{tr("Noņemtie aģenti")}</span>
					</div>
					<div className="tl-dept-body">{view.removed.map((a) => agentRow(a, false))}</div>
				</div>
			)}
			{searching && !view.lead && view.departments.length === 0 && view.removed.length === 0 && <div className="dim small tl-none">{tr("Nekas nav atrasts.")}</div>}
			{live &&
				(naming?.kind === "new" ? (
					<div className="tl-dept-head">
						<NameField value={naming.name} label={tr("Nodaļas nosaukums")} max={DEPARTMENT_NAME_MAX} onCommit={(v) => commitDepartment(naming, v)} onCancel={() => setNaming(null)} />
					</div>
				) : (
					<button className="ghost small tl-add" onClick={() => setNaming({ kind: "new", name: unusedName(tr("Jauna nodaļa"), names) })}>
						{tr("+ nodaļa")}
					</button>
				))}
			<label className="small dim tl-closed">
				<input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> {tr("Rādīt arhivētās")}
			</label>
		</div>
	);
}

/**
 * The chat's header line: which conversation the chat shows, and a button that opens the list as a window of its own.
 * BIM Crew keeps the history out of the chat (a separate "Chat history" panel); an expanded list here pushed the chat out
 * of the dock. This line never grows.
 */
export function ThreadPanel({ current, threads, specs, queue }: { threads: Thread[]; specs: AgentSpec[]; queue: QueueView; current: string | null }) {
	const t = threads.find((x) => x.id === current);
	const open = threads.filter((x) => x.state !== "closed").length;
	return (
		<div className="threads-line">
			{t && <StateDot state={liveState(t, queue)} />}
			<span className="threads-now" title={t ? `${agentName(t.agent, specs)} · ${t.title}` : undefined}>
				{t ? `${agentName(t.agent, specs)} · ${t.title}` : tr("vadošais aģents")}
			</span>
			<button className="small" onClick={() => windows.toggleThreads()} title={tr("Visas sarunas: katram aģentam savas, jauna saruna, slēgšana")}>
				☰ {tr("Sarunas")}{open > 1 ? ` (${open})` : ""}
			</button>
		</div>
	);
}

/** The app's departments, in their order; reloaded when main says data changed and when the window gets focus again (the Aģenti page may be in another window). */
function useDepartments() {
	const { tick } = useUi();
	const [list, setList] = useState<Department[] | null>(null);
	const reload = useCallback(() => {
		call("departments.list")
			.then((v) => setList(v.departments))
			.catch(() => undefined);
	}, []);
	useEffect(reload, [tick, reload]);
	useEffect(() => {
		window.addEventListener("focus", reload);
		return () => window.removeEventListener("focus", reload);
	}, [reload]);
	return { list, setList };
}

/** The list of conversations as a window: departments, their agents and threads, a new conversation, rename, archive, the archived ones. */
export function ThreadsWindow() {
	const { projectId, thread: selId } = useUi();
	const T = useThreads(projectId);
	const D = useDepartments();
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <div className="threads-win dim">{tr("Atver projektu, lai redzētu sarunas.")}</div>;
	return (
		<div className="threads-win">
			{err && <div className="err small">{err}</div>}
			{D.list && (
				<ThreadList
					threads={T.threads}
					specs={T.specs}
					departments={D.list}
					queue={T.queue}
					current={T.viewId}
					onSelect={T.select}
					onNew={(a) => void T.open(a).catch((e) => setErr(errText(e)))}
					onClose={(id) =>
						void T.close(id)
							.then(() => id === selId && ui.selectThread(null))
							.catch((e) => setErr(errText(e)))
					}
					onRename={(id, title) => T.rename(id, title)}
					// the agents and departments are saved in main; the bump makes every panel of this window (Aģenti, the chat's roster) read them again
					onMoveAgent={(agent, department, before) => call("agents.move", agent, department, before).then(() => ui.bump())}
					onSaveDepartments={(list) =>
						call("departments.save", list).then((saved) => {
							D.setList(saved);
							ui.bump();
						})
					}
					onError={setErr}
					onPin={T.pin}
					onReopen={T.reopen}
					held={T.queue.held}
					onPause={T.pause}
					incidents={T.incidents}
					projectId={projectId}
					onRetry={T.retry}
					onDismiss={T.dismiss}
				/>
			)}
		</div>
	);
}

/** "@" at the start of the message: the agents that fit what is typed. */
export function MentionPop({ options, active, onPick }: { options: AgentSpec[]; active: number; onPick: (id: string) => void }) {
	if (options.length === 0) return null;
	return (
		<div className="mention-pop" role="listbox">
			{options.map((o, i) => (
				<button key={o.id} role="option" aria-selected={i === active} className={`ghost ${i === active ? "on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(o.id)} title={o.description}>
					<b>@{o.id}</b> <span className="dim">{o.name}</span>
				</button>
			))}
		</div>
	);
}

/** A message went to another agent's thread: it does not show in this chat, so say where it went. */
export function SentNotice({ name, onOpen, onClose }: { name: string; onOpen: () => void; onClose: () => void }) {
	return (
		<div className="row small notice">
			<span>{tr("Nosūtīts: {name}.", { name: name })}</span>
			<button className="ghost small" onClick={onOpen}>
				{tr("Atvērt sarunu")}</button>
			<button className="ghost small x" onClick={onClose}>
				×
			</button>
		</div>
	);
}
