// The Gantt of the Schedule page: the whole project on one date axis. The six BIM stages as bars (the one the project is in
// is blue; a stage the contract does not include is dim), the deliveries as ◆ on their stage (hollow = planned, green = sent,
// red = late), the TN and approval clocks as thin bars, the tasks as bars (a task that lasts has a start and an end), and a red
// line for today. Click a bar to edit it, click empty track to add a task on that day (BIM Crew's popup, TaskPopup), drag a task
// to move it or drag its edge to change its first or last day. Everything is read from the project's own stores (the same
// stage timeline as Pārskats, the tasks of Grafiks); the only things written here are tasks and the stages' dates.
import { useEffect, useMemo, useRef, useState } from "react";
import type { BimStage, Task } from "../../core/model";
import { dateAtIndex, dayIndex, dragSpan, ganttAxis, monthTicks, spanPatch, stageSpan, taskSpan, weekLines, ZOOMS, type Axis, type DragEdge, type Span, type Zoom } from "../../shared/gantt";
import { call, errText } from "../bridge";
import { Err, useLoad } from "../ui";
import { windows } from "../windows";
import { followMouse } from "../shell/drag";
import { TaskPopup, type PopupTarget } from "./TaskPopup";
import { tr } from "../i18n";

const LABEL_W = 210;
const ZOOM_KEY = "projektesana:gantt-zoom";
const MONTH_NAMES = [tr("janvāris"), tr("februāris"), tr("marts"), tr("aprīlis"), tr("maijs"), tr("jūnijs"), tr("jūlijs"), tr("augusts"), tr("septembris"), tr("oktobris"), tr("novembris"), tr("decembris")];
type View = Zoom | "fit";
const VIEWS: View[] = ["fit", "year", "quarter", "month", "week"];
const VIEW_LABEL: Record<View, string> = { fit: tr("Viss projekts"), year: tr("Gads"), quarter: tr("Ceturksnis"), month: tr("Mēnesis"), week: tr("Nedēļa") };

/** the whole project fits the window until the user picks a zoom (then that one is remembered) */
function readZoom(): View {
	try {
		const z = localStorage.getItem(ZOOM_KEY);
		return z && (z === "fit" || z in ZOOMS) ? (z as View) : "fit";
	} catch {
		return "fit";
	}
}

export function Gantt({ projectId }: { projectId: string }) {
	const dash = useLoad(() => call("projects.dashboard", projectId), [projectId]);
	const todos = useLoad<Task[]>(() => call("todos.list", projectId), [projectId]);
	const dates = useLoad(() => call("stages.dates", projectId), [projectId]);
	const [zoom, setZoomState] = useState<View>(readZoom);
	const [width, setWidth] = useState(0);
	const [showDone, setShowDone] = useState(false);
	const [popup, setPopup] = useState<PopupTarget | null>(null);
	const [stagePop, setStagePop] = useState<{ stage: BimStage; x: number; y: number } | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const scrolledFor = useRef<string>("");
	const setZoom = (z: View) => {
		setZoomState(z);
		try {
			localStorage.setItem(ZOOM_KEY, z);
		} catch {
			// not remembered
		}
	};

	const timeline = dash.data?.timeline;
	// the width of the window, for "whole project"
	const ready = !!timeline;
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const ro = new ResizeObserver(() => setWidth(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, [ready]);
	const model = useMemo(() => {
		if (!timeline) return null;
		const stageDates = dates.data ?? {};
		const stages = timeline.stages.map((s) => ({ ...s, span: stageSpan(stageDates[s.stage], s.marks, s.bars) }));
		const clocks = timeline.stages.flatMap((s) => s.bars);
		const all = todos.data ?? [];
		const tasks = all
			.filter((t) => showDone || t.state !== "done")
			.map((t) => ({ t, span: taskSpan(t) }))
			.filter((x): x is { t: Task; span: Span } => !!x.span)
			.sort((a, b) => a.span.start.localeCompare(b.span.start) || a.span.end.localeCompare(b.span.end));
		const undated = all.filter((t) => t.state !== "done" && !taskSpan(t)).length;
		const days = [
			...stages.flatMap((s) => [...s.marks.map((m) => m.date), ...(s.span ? [s.span.start, s.span.end] : [])]),
			...clocks.flatMap((c) => [c.from, c.to]),
			...tasks.flatMap((x) => [x.span.start, x.span.end]),
		];
		return { stages, clocks, tasks, undated, axis: ganttAxis(days, timeline.today) };
	}, [timeline, dates.data, todos.data, showDone]);

	if (dash.error) return <Err error={dash.error} />;
	if (!timeline || !model) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa grafiku…")}</div>;
	const { axis } = model;
	const today = timeline.today;
	// "whole project": the axis (the first to the last date, a margin each side) is squeezed to the window; the least is 1.5 px a day
	const dw = zoom === "fit" ? Math.max(1.5, (width - LABEL_W - 4) / axis.days) : ZOOMS[zoom];
	const trackW = axis.days * dw;
	const x = (iso: string) => dayIndex(axis, iso) * dw;
	const span = (s: Span) => ({ left: x(s.start), width: (dayIndex(axis, s.end) - dayIndex(axis, s.start) + 1) * dw });
	const reload = () => {
		todos.reload();
		dates.reload();
		dash.reload();
	};

	// the page opens with today in the middle of the screen; a change of zoom does the same
	const key = `${zoom}:${projectId}`;
	if (scrolledFor.current !== key) {
		scrolledFor.current = key;
		requestAnimationFrame(() => {
			const el = scroller.current;
			if (el) el.scrollLeft = zoom === "fit" ? 0 : Math.max(0, LABEL_W + dayIndex(axis, today) * dw - el.clientWidth / 2);
		});
	}

	const dateAt = (e: React.MouseEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return dateAtIndex(axis, Math.max(0, Math.min(axis.days - 1, Math.floor((e.clientX - r.left) / dw))));
	};
	const addAt = (e: React.MouseEvent) => {
		if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("gantt-today")) return;
		setStagePop(null);
		setPopup({ mode: "create", projectId, date: dateAt(e), x: e.clientX, y: e.clientY });
	};
	const openStage = (stage: BimStage, e: React.MouseEvent) => {
		setPopup(null);
		setStagePop({ stage, x: e.clientX, y: e.clientY });
	};
	const shift = (t: Task, s: Span) =>
		call("todos.update", projectId, t.id, spanPatch(s))
			.then(() => (setErr(null), reload()))
			.catch((e) => (setErr(errText(e)), reload()));

	const todayLine = <div className="gantt-today" style={{ left: x(today) + dw / 2 }} title={tr("šodien {today}", { today })} />;
	const trackStyle = { width: trackW, backgroundSize: `${7 * dw}px 100%` };

	return (
		<div className="gantt">
			<div className="gantt-bar">
				<span className="seg" role="group" aria-label={tr("Mērogs")}>
					{VIEWS.map((z) => (
						<button key={z} className={zoom === z ? "on" : ""} onClick={() => setZoom(z)} title={z === "fit" ? tr("Rādīt visu projektu logā") : undefined}>
							{VIEW_LABEL[z]}
						</button>
					))}
				</span>
				<button
					onClick={() => {
						const el = scroller.current;
						if (el) el.scrollTo({ left: Math.max(0, LABEL_W + dayIndex(axis, today) * dw - el.clientWidth / 2), behavior: "smooth" });
					}}
				>
					{tr("Šodien")}
				</button>
				<button
					className="primary"
					onClick={(e) => {
						const r = e.currentTarget.getBoundingClientRect();
						setStagePop(null);
						setPopup({ mode: "create", projectId, date: today, x: r.left, y: r.bottom + 30 });
					}}
				>
					＋ {tr("Uzdevums")}
				</button>
				<label className="small" title={tr("Rādīt arī pabeigtos uzdevumus")}>
					<input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {tr("pabeigti")}
				</label>
				<span className="grow" />
				{model.undated > 0 && (
					<span className="dim small" title={tr("Uzdevumi bez datuma nav uz laika ass: tos redz cilnē Uzdevumi")}>
						{tr("{n} bez datuma", { n: model.undated })}
					</span>
				)}
				<span className="gantt-key small dim">
					<span className="gk-mark">◇</span> {tr("nodevums")} <span className="gk-mark">◆</span> {tr("nosūtīts")} <span className="gk-mark late">◇</span> {tr("kavējas")} <span className="gk-line" /> {tr("šodien")}
				</span>
			</div>
			{err && <div className="err" style={{ margin: "0 10px" }}>{err}</div>}
			<div className="gantt-scroll" ref={scroller}>
				<div className="gantt-inner" style={{ width: LABEL_W + trackW }}>
					<Axis axis={axis} dw={dw} />
					<div className="gantt-group">{tr("Stadijas un nodevumi")}</div>
					{model.stages.map((s, n) => (
						<div key={s.stage} className={`gantt-row stage ${s.current ? "cur" : ""}`} style={{ "--sc": `var(--st${n})` } as React.CSSProperties}>
							<div className="gantt-label stage" title={s.inContract ? undefined : tr("stadija nav līgumā")} style={s.inContract ? undefined : { opacity: 0.6 }}>
								<i className="gdot" />
								{s.stage}
								{s.current && <span className="chip"> {tr("tagad")}</span>}
							</div>
							<div className="gantt-track" style={trackStyle} onClick={(e) => e.target === e.currentTarget && openStage(s.stage, e)} title={s.span ? undefined : tr("Klikšķis: ievadīt stadijas datumus")}>
								{todayLine}
								{s.span && (
									<button
										className={`gstage ${s.current ? "cur" : ""} ${s.span.stored ? "" : "derived"} ${s.inContract ? "" : "off"}`}
										style={span(s.span)}
										title={`${s.stage}: ${s.span.start} → ${s.span.end}${s.span.stored ? "" : ` (${tr("no nodevumiem; klikšķis: ievadīt datumus")})`}`}
										onClick={(e) => (e.stopPropagation(), openStage(s.stage, e))}
									>
										<span>{s.stage}</span>
										<em>{s.span.start.slice(5)} → {s.span.end.slice(5)}</em>
									</button>
								)}
								{!s.span && <span className="gantt-hint">{tr("nav datumu · klikšķis, lai ievadītu")}</span>}
								{s.marks.map((m) => (
									<button key={m.id} className={`gmark ${m.late ? "late" : ""} ${m.sent ? "sent" : ""}`} style={{ left: x(m.date) + dw / 2 }} title={`${m.label} · ${m.date}${m.sent ? ` · ${tr("nosūtīts")}` : m.late ? ` · ${tr("kavējas")}` : ` · ${tr("plānots")}`}`} onClick={(e) => (e.stopPropagation(), windows.go("nodevumi", m.id))}>
										<i>{m.sent ? "◆" : "◇"}</i>
										<span>{m.kind}</span>
									</button>
								))}
							</div>
						</div>
					))}
					{model.clocks.length > 0 && <div className="gantt-group">{tr("Termiņi (TN, saskaņojumi)")}</div>}
					{model.clocks.map((c) => (
						<div key={c.id} className="gantt-row">
							<div className="gantt-label" title={c.label}>{c.label}</div>
							<div className="gantt-track" style={trackStyle}>
								{todayLine}
								<button className={`gclock ${c.late ? "late" : ""} ${c.done ? "done" : ""}`} style={span({ start: c.from, end: c.to })} title={`${c.label}: ${c.from} → ${c.to}${c.late ? ` (${tr("kavē")})` : ""}`} onClick={() => windows.go("nodevumi")} />
							</div>
						</div>
					))}
					<div className="gantt-group">{tr("Uzdevumi")} <span className="dim small">· {tr("klikšķis uz tukšas vietas pievieno uzdevumu")}</span></div>
					{model.tasks.map(({ t, span: sp }) => (
						<div key={t.id} className="gantt-row">
							<div className="gantt-label click" title={t.title} onClick={(e) => setPopup({ mode: "edit", projectId, task: t, x: e.clientX, y: e.clientY })}>
								<span className={t.state === "done" ? "done" : ""}>{t.title}</span>
							</div>
							<div className="gantt-track" style={trackStyle} onClick={addAt}>
								{todayLine}
								<TaskBar
									task={t}
									span={sp}
									axis={axis}
									dw={dw}
									today={today}
									onOpen={(cx, cy) => setPopup({ mode: "edit", projectId, task: t, x: cx, y: cy })}
									onShift={(s) => void shift(t, s)}
								/>
							</div>
						</div>
					))}
					<div className="gantt-row new">
						<div className="gantt-label dim">{tr("＋ jauns uzdevums")}</div>
						<div className="gantt-track" style={trackStyle} onClick={addAt} title={tr("Klikšķis: jauns uzdevums šajā dienā")}>
							{todayLine}
						</div>
					</div>
				</div>
			</div>
			{popup && <TaskPopup key={popup.mode === "edit" ? popup.task.id : `new:${popup.date}:${popup.x}`} target={popup} onClose={() => setPopup(null)} onChanged={reload} />}
			{stagePop && <StagePopup key={stagePop.stage} projectId={projectId} stage={stagePop.stage} current={dates.data?.[stagePop.stage]} x={stagePop.x} y={stagePop.y} onClose={() => setStagePop(null)} onChanged={reload} />}
		</div>
	);
}

/** The header: the months, and at a zoom wide enough the Mondays. */
function Axis({ axis, dw }: { axis: Axis; dw: number }) {
	return (
		<div className="gantt-axis">
			<div className="gantt-label corner" />
			<div className="gantt-track axis" style={{ width: axis.days * dw }}>
				{monthTicks(axis).map((m) => (
					<div key={m.date} className="gantt-month" style={{ left: m.index * dw, width: m.days * dw }}>
						{m.days * dw >= 70 ? `${MONTH_NAMES[m.month - 1]} ${m.year}` : m.days * dw >= 28 ? `${MONTH_NAMES[m.month - 1].slice(0, 3)}` : ""}
					</div>
				))}
				{dw >= 14 &&
					weekLines(axis).map((w) => (
						<div key={w.date} className="gantt-week" style={{ left: w.index * dw }}>
							{Number(w.date.slice(8))}
						</div>
					))}
			</div>
		</div>
	);
}

/** A task as a bar: red when it is late, dashed while it is the agent's proposal, struck through when done; moves and resizes by drag. */
function TaskBar({ task, span, axis, dw, today, onOpen, onShift }: { task: Task; span: Span; axis: Axis; dw: number; today: string; onOpen: (x: number, y: number) => void; onShift: (s: Span) => void }) {
	const el = useRef<HTMLDivElement>(null);
	const place = (s: Span) => ({ left: dayIndex(axis, s.start) * dw, width: (dayIndex(axis, s.end) - dayIndex(axis, s.start) + 1) * dw });
	const shown = place(span);
	const late = task.state === "open" && span.end < today;
	const down = (e: React.MouseEvent, edge: DragEdge) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		const x0 = e.clientX;
		const canDrag = task.state !== "proposed";
		let delta = 0;
		let moved = false;
		const apply = (s: Span) => {
			const p = place(s);
			if (el.current) {
				el.current.style.left = `${p.left}px`;
				el.current.style.width = `${p.width}px`;
			}
		};
		followMouse(
			(ev) => {
				const dx = ev.clientX - x0;
				if (!canDrag || (!moved && Math.abs(dx) < 4)) return;
				moved = true;
				delta = Math.round(dx / dw);
				apply(dragSpan(span, delta, edge));
			},
			(ev) => {
				if (!moved) return onOpen(ev.clientX, ev.clientY);
				if (delta === 0) return apply(span);
				onShift(dragSpan(span, delta, edge));
			},
			{ cursor: edge === "move" ? "grabbing" : "ew-resize" },
		);
	};
	const done = task.state === "done";
	const one = span.start === span.end;
	return (
		<div
			ref={el}
			className={`gtask-bar p-${task.priority ?? "normal"} ${late ? "late" : ""} ${done ? "done" : ""} ${task.state === "proposed" ? "proposed" : ""} ${one ? "one" : ""}`}
			style={shown}
			title={`${task.title}\n${span.start === span.end ? span.start : `${span.start} → ${span.end}`}${task.assignee ? `\n${task.assignee}` : ""}${late ? `\n${tr("kavējas")}` : ""}`}
			onMouseDown={(e) => down(e, "move")}
		>
			{task.state !== "proposed" && !one && <i className="gh gh-l" onMouseDown={(e) => down(e, "start")} />}
			<span className="gtask-name">{task.title}</span>
			{task.checklist && task.checklist.length > 0 && (
				<em className="gtask-check">
					{task.checklist.filter((c) => c.done).length}/{task.checklist.length}
				</em>
			)}
			{task.state !== "proposed" && !one && <i className="gh gh-r" onMouseDown={(e) => down(e, "end")} />}
		</div>
	);
}

/** A stage's start and end, set by the user (the app keeps no stage dates of its own). */
function StagePopup({ projectId, stage, current, x, y, onClose, onChanged }: { projectId: string; stage: BimStage; current: { start: string; end: string } | undefined; x: number; y: number; onClose: () => void; onChanged: () => void }) {
	const [start, setStart] = useState(current?.start ?? "");
	const [end, setEnd] = useState(current?.end ?? "");
	const [err, setErr] = useState<string | null>(null);
	const box = useRef<HTMLDivElement>(null);
	const save = (range: { start: string; end: string } | null) =>
		call("stages.setDates", projectId, stage, range)
			.then(() => (onChanged(), onClose()))
			.catch((e) => setErr(errText(e)));
	useCloseOutside(box, onClose);
	return (
		<div ref={box} className="task-popup" role="dialog" aria-label={stage} style={{ left: Math.max(8, Math.min(x + 12, window.innerWidth - 328)), top: Math.max(8, Math.min(y - 24, window.innerHeight - 220)), width: 320 }}>
			<div className="tp-head">
				<b>{stage}</b>
				<span className="dim small">{tr("stadijas datumi")}</span>
				<span className="grow" />
				<button className="ghost small" onClick={onClose} aria-label={tr("Aizvērt")}>
					×
				</button>
			</div>
			<div className="tp-grid2">
				<label className="tp-field">
					<span className="tp-label">{tr("Sākums")}</span>
					<input type="date" autoFocus value={start} onChange={(e) => setStart(e.target.value)} />
				</label>
				<label className="tp-field">
					<span className="tp-label">{tr("Beigas")}</span>
					<input type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
				</label>
			</div>
			{err && <div className="err small">{err}</div>}
			<div className="tp-foot">
				{current && (
					<button className="small danger" onClick={() => void save(null)} title={tr("Joslu atkal rāda pēc nodevumiem, ja tādi ir")}>
						{tr("Noņemt datumus")}
					</button>
				)}
				<span className="grow" />
				<button className="small" onClick={onClose}>
					{tr("Atcelt")}
				</button>
				<button className="small primary" disabled={!start || !end} onClick={() => void save({ start, end })}>
					{tr("Saglabāt")}
				</button>
			</div>
		</div>
	);
}

/** Escape or a click outside the box closes it (the same as the task popup). */
function useCloseOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
	useEffect(() => {
		const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
		document.addEventListener("keydown", key);
		document.addEventListener("mousedown", away);
		return () => {
			document.removeEventListener("keydown", key);
			document.removeEventListener("mousedown", away);
		};
	}, [ref, onClose]);
}
