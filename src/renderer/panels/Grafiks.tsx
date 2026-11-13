// Grafiks (task 8.5): the project's dates and the user's tasks on a calendar. Planned and sent deliveries (the BIP grafiks
// dates or the user's), the end of every TN and approval clock, and tasks. Month, week, and the task list. Everything on it
// is read from the project's own data (grafiks.items), so it can never disagree with Nodevumi; the only things written
// here are tasks. The agent proposes tasks; they wait here for Pieņemt or Noraidīt.
import { useState } from "react";
import type { Task } from "../../core/model";
import { addDays, monthGrid, mondayOf, taskOrder, weekDays, type GrafikItem } from "../../shared/calendar";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { windows } from "../windows";

const todayLocal = () => new Date().toLocaleDateString("sv-SE");
const MONTHS = ["janvāris", "februāris", "marts", "aprīlis", "maijs", "jūnijs", "jūlijs", "augusts", "septembris", "oktobris", "novembris", "decembris"];
const DOW = ["P", "O", "T", "C", "Pk", "S", "Sv"];
const DAYNAME = ["pirmdiena", "otrdiena", "trešdiena", "ceturtdiena", "piektdiena", "sestdiena", "svētdiena"];

export function Grafiks() {
	const { projectId } = useUi();
	const [tab, setTab] = useState<"month" | "week" | "tasks">("month");
	const [scope, setScope] = useState<"project" | "all">("project");
	const [cursor, setCursor] = useState(todayLocal());
	if (!projectId && scope === "project") return <Empty title="nav projekta">Atver projektu panelī Projekts vai skaties visus projektus.<div><button onClick={() => setScope("all")}>Visi projekti</button></div></Empty>;
	return (
		<div className="fill-col">
			<div className="tabs">
				<button className={tab === "month" ? "on" : ""} onClick={() => setTab("month")}>Mēnesis</button>
				<button className={tab === "week" ? "on" : ""} onClick={() => setTab("week")}>Nedēļa</button>
				<button className={tab === "tasks" ? "on" : ""} disabled={!projectId} onClick={() => setTab("tasks")}>Uzdevumi</button>
				<span className="grow" />
				<button className={scope === "project" ? "on" : ""} disabled={!projectId} onClick={() => setScope("project")}>{projectId ?? "projekts"}</button>
				<button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>Visi projekti</button>
			</div>
			{tab === "tasks" ? projectId ? <Tasks projectId={projectId} /> : <Empty title="nav projekta">Uzdevumi pieder projektam: atver projektu.</Empty> : <Days projectId={projectId} scope={scope} tab={tab} cursor={cursor} setCursor={setCursor} />}
		</div>
	);
}

function chipClass(i: GrafikItem): string {
	return `gchip ${i.kind} ${i.level ?? ""} ${i.done ? "done" : ""} ${i.proposed ? "proposed" : ""}`;
}

function Days({ projectId, scope, tab, cursor, setCursor }: { projectId: string | null; scope: "project" | "all"; tab: "month" | "week"; cursor: string; setCursor: (d: string) => void }) {
	const year = Number(cursor.slice(0, 4));
	const month = Number(cursor.slice(5, 7));
	const grid = monthGrid(year, month);
	const from = tab === "month" ? grid[0][0].date : mondayOf(cursor);
	const to = tab === "month" ? grid.at(-1)![6].date : addDays(mondayOf(cursor), 6);
	const items = useLoad<GrafikItem[]>(() => call("grafiks.items", scope, projectId, from, to), [scope, projectId, from, to]);
	const [err, setErr] = useState<string | null>(null);
	const by = new Map<string, GrafikItem[]>();
	for (const i of items.data ?? []) by.set(i.date, [...(by.get(i.date) ?? []), i]);
	const today = todayLocal();
	const step = (n: number) => setCursor(tab === "month" ? new Date(Date.UTC(year, month - 1 + n, 1)).toISOString().slice(0, 10) : addDays(cursor, 7 * n));

	const go = (i: GrafikItem) => {
		ui.setProject(i.projectId);
		if (i.open) windows.open(i.open.panel, i.open.filter);
	};
	const Chip = ({ i }: { i: GrafikItem }) => (
		<div className={chipClass(i)} title={`${i.projectId}: ${i.title}`} onClick={(e) => (e.stopPropagation(), go(i))}>
			{scope === "all" && <b>{i.projectId} </b>}
			{i.title}
		</div>
	);

	return (
		<div className="fill-col" style={{ minHeight: 0 }}>
			<div className="row" style={{ padding: "6px 10px" }}>
				<button onClick={() => step(-1)}>‹</button>
				<b style={{ minWidth: 170, textAlign: "center" }}>{tab === "month" ? `${MONTHS[month - 1]} ${year}` : `${from} – ${to}`}</b>
				<button onClick={() => step(1)}>›</button>
				<button className="ghost" onClick={() => setCursor(today)}>Šodien</button>
				<span className="grow" />
				<span className="legend small dim"><span className="gchip planned">nodevums</span> <span className="gchip sent">nosūtīts</span> <span className="gchip clock">termiņš</span> <span className="gchip task">uzdevums</span></span>
			</div>
			{err && <div className="err" style={{ margin: "0 10px" }}>{err}</div>}
			{items.error ? <Err error={items.error} /> : null}
			<div className="gwrap">
				{tab === "month" ? (
					<div className="gmonth">
						{DOW.map((d) => (
							<div key={d} className="ghead">{d}</div>
						))}
						{grid.flat().map((c) => {
							const list = by.get(c.date) ?? [];
							return (
								<div key={c.date} className={`gcell ${c.inMonth ? "" : "out"} ${c.date === today ? "today" : ""} ${c.date === cursor ? "cur" : ""}`} onClick={() => setCursor(c.date)}>
									<div className="gnum">{Number(c.date.slice(8))}</div>
									{list.slice(0, 3).map((i) => (
										<Chip key={i.id} i={i} />
									))}
									{list.length > 3 && <div className="dim small">+{list.length - 3} vēl</div>}
								</div>
							);
						})}
					</div>
				) : (
					<div className="gweek">
						{weekDays(cursor).map((d, k) => (
							<div key={d} className={`gday ${d === today ? "today" : ""} ${d === cursor ? "cur" : ""}`} onClick={() => setCursor(d)}>
								<div className="gdayhead">
									<b>{Number(d.slice(8))}.{d.slice(5, 7)}.</b> <span className="dim small">{DAYNAME[k]}</span>
								</div>
								{(by.get(d) ?? []).map((i) => (
									<Chip key={i.id} i={i} />
								))}
								{!(by.get(d) ?? []).length && <div className="dim small">—</div>}
							</div>
						))}
					</div>
				)}
				<DayPanel projectId={projectId} day={cursor} items={by.get(cursor) ?? []} showProject={scope === "all"} onChanged={items.reload} onError={setErr} onGo={go} />
			</div>
		</div>
	);
}

function DayPanel({ projectId, day, items, showProject, onChanged, onError, onGo }: { projectId: string | null; day: string; items: GrafikItem[]; showProject: boolean; onChanged: () => void; onError: (m: string | null) => void; onGo: (i: GrafikItem) => void }) {
	const [title, setTitle] = useState("");
	const add = () => {
		if (!projectId) return onError("Uzdevumu pievieno projektam: atver projektu.");
		onError(null);
		call("todos.add", projectId, { title, due: day })
			.then(() => (setTitle(""), onChanged()))
			.catch((e) => onError(errText(e)));
	};
	const toggle = (i: GrafikItem) => i.taskId && call("todos.update", i.projectId, i.taskId, { state: i.done ? "open" : "done" }).then(onChanged).catch((e) => onError(errText(e)));
	return (
		<aside className="gside">
			<div className="gdayhead">
				<b>{day}</b>
			</div>
			{items.length === 0 && <div className="dim small">Šajā dienā nekā nav.</div>}
			{items.map((i) => (
				<div key={i.id} className="gline">
					{i.taskId ? <input type="checkbox" checked={!!i.done} disabled={i.proposed} onChange={() => toggle(i)} title={i.proposed ? "Piedāvājumu vispirms pieņem sadaļā Uzdevumi" : undefined} /> : <span className={chipClass(i)} style={{ width: 8, height: 8, padding: 0, borderRadius: 4 }} />}
					<span className={`grow ${i.done ? "dim" : ""} ${i.open ? "click" : ""}`} style={{ textDecoration: i.done ? "line-through" : undefined }} onClick={() => i.open && onGo(i)}>
						{showProject && <Badge tone="dim">{i.projectId}</Badge>} {i.title}
					</span>
					{i.proposed && <Badge tone="info">piedāvāts</Badge>}
					{i.level === "bad" && !i.done && <Badge tone="bad">kavējas</Badge>}
				</div>
			))}
			<div className="row" style={{ marginTop: 8 }}>
				<input className="grow" placeholder={projectId ? "jauns uzdevums šai dienai" : "atver projektu, lai pievienotu"} value={title} disabled={!projectId} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
				<button className="primary" disabled={!projectId || title.trim().length < 2} onClick={add}>Pievienot</button>
			</div>
		</aside>
	);
}

function Tasks({ projectId }: { projectId: string }) {
	const todos = useLoad<Task[]>(() => call("todos.list", projectId), [projectId]);
	const [title, setTitle] = useState("");
	const [due, setDue] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const act = (f: () => Promise<unknown>) => f().then(() => (setErr(null), todos.reload())).catch((e) => setErr(errText(e)));
	const all = taskOrder(todos.data ?? []);
	const live = all.filter((t) => t.state !== "done");
	const done = all.filter((t) => t.state === "done");
	return (
		<div className="pane fill">
			<div className="row">
				<input className="grow" placeholder="jauns uzdevums" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && title.trim().length >= 2 && act(() => call("todos.add", projectId, { title, due: due || null }).then(() => (setTitle(""), setDue(""))))} />
				<input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
				<button className="primary" disabled={title.trim().length < 2} onClick={() => act(() => call("todos.add", projectId, { title, due: due || null }).then(() => (setTitle(""), setDue(""))))}>
					Pievienot
				</button>
			</div>
			{err && <div className="err">{err}</div>}
			{todos.error ? <Err error={todos.error} /> : null}
			{live.length === 0 && <div className="dim small">Atvērtu uzdevumu nav.</div>}
			{live.map((t) => (
				<div key={t.id} className={`gtask ${t.state}`}>
					{t.state === "proposed" ? (
						<>
							<Badge tone="info">aģenta piedāvājums</Badge>
							<span className="grow">{t.title}</span>
							<button className="small primary" onClick={() => act(() => call("todos.update", projectId, t.id, { state: "open" }))}>Pieņemt</button>
							<button className="small ghost" onClick={() => act(() => call("todos.remove", projectId, t.id))}>Noraidīt</button>
						</>
					) : (
						<>
							<input type="checkbox" onChange={() => act(() => call("todos.update", projectId, t.id, { state: "done" }))} title="Pabeigts" />
							<span className="grow">{t.title}</span>
							<input type="date" value={t.due ?? ""} onChange={(e) => act(() => call("todos.update", projectId, t.id, { due: e.target.value || null }))} />
							<button className="small ghost" onClick={() => act(() => call("todos.remove", projectId, t.id))}>Noņemt</button>
						</>
					)}
					{t.note && <div className="dim small gtask-note">{t.note}</div>}
				</div>
			))}
			{done.length > 0 && (
				<details>
					<summary className="dim small">Pabeigti ({done.length})</summary>
					{done.map((t) => (
						<div key={t.id} className="gtask done">
							<input type="checkbox" checked onChange={() => act(() => call("todos.update", projectId, t.id, { state: "open" }))} />
							<span className="grow dim" style={{ textDecoration: "line-through" }}>{t.title}</span>
							<span className="dim small">{t.doneAt?.slice(0, 10)}</span>
						</div>
					))}
				</details>
			)}
		</div>
	);
}
