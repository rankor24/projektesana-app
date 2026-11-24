// The Gantt of the Schedule page: the whole project on one date axis. The six BIM stages as bars, one colour per stage (the stage
// the project is in is outlined; a stage the contract does not include is dim), the deliveries as ◇ planned / ◆ sent on their stage
// (red = late), the TN and approval clocks as thin bars, the tasks as bars (a task that lasts has a start and an end), and a red
// line for today. Click a bar to edit it, click empty track to add a task on that day (BIM Crew's popup, TaskPopup), drag a task
// to move it or drag its edge to change its first or last day; a stage bar with dates of its own moves and resizes the same way.
// While a bar is dragged its dates show beside the pointer and the page follows when the pointer reaches the window's edge. The
// view: drag empty space (or press the middle button anywhere) to pan; Ctrl + wheel, or the wheel over the date ruler, zooms at
// the pointer; the wheel scrolls the rows, and sideways when there is nothing to scroll up or down; Shift + wheel (or the scroll
// bar) pans sideways; "Viss projekts" fits everything in the window. Everything is read from the project's own stores (the same
// stage timeline as Pārskats, the tasks of Grafiks); the only things written here are tasks and the stages' dates.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BimStage, Task } from "../../core/model";
import { dateAtIndex, dayIndex, dayUnder, dragSpan, ganttAxis, monthTicks, spanLabel, spanPatch, stageSpan, taskSpan, weekLines, wheelPixels, wheelZoomFactor, ZOOMS, type Axis, type DragEdge, type Span } from "../../shared/gantt";
import { call, errText } from "../bridge";
import { Err, useLoad } from "../ui";
import { windows } from "../windows";
import { followMouse } from "../shell/drag";
import { TaskPopup, type PopupTarget } from "./TaskPopup";
import { tr } from "../i18n";

const LABEL_W = 210;
const ZOOM_KEY = "projektesana:gantt-view";
const MIN_DW = 0.8;
const MAX_DW = 80;
const clampDw = (n: number) => Math.min(MAX_DW, Math.max(MIN_DW, n));
const MONTH_NAMES = [tr("janvāris"), tr("februāris"), tr("marts"), tr("aprīlis"), tr("maijs"), tr("jūnijs"), tr("jūlijs"), tr("augusts"), tr("septembris"), tr("oktobris"), tr("novembris"), tr("decembris")];
/** the view: the whole project in the window, or a number of pixels per day */
type View = "fit" | number;
const PRESETS: { view: View; label: string }[] = [
	{ view: "fit", label: tr("Viss projekts") },
	{ view: ZOOMS.year, label: tr("Gads") },
	{ view: ZOOMS.quarter, label: tr("Ceturksnis") },
	{ view: ZOOMS.month, label: tr("Mēnesis") },
	{ view: ZOOMS.week, label: tr("Nedēļa") },
];

/** the whole project fits the window until the user picks another view (then that one is remembered) */
function readView(): View {
	try {
		const z = localStorage.getItem(ZOOM_KEY);
		const n = Number(z);
		return z && z !== "fit" && Number.isFinite(n) ? clampDw(n) : "fit";
	} catch {
		return "fit";
	}
}

/** what to do to the scroll position once the new scale is drawn: show today in the middle, or keep a day under the pointer */
type Pending = { kind: "today" } | { kind: "anchor"; day: number; cx: number };

export function Gantt({ projectId }: { projectId: string }) {
	const dash = useLoad(() => call("projects.dashboard", projectId), [projectId]);
	const todos = useLoad<Task[]>(() => call("todos.list", projectId), [projectId]);
	const dates = useLoad(() => call("stages.dates", projectId), [projectId]);
	const [view, setViewState] = useState<View>(readView);
	const [width, setWidth] = useState(0);
	const [showDone, setShowDone] = useState(false);
	const [popup, setPopup] = useState<PopupTarget | null>(null);
	const [stagePop, setStagePop] = useState<{ stage: BimStage; x: number; y: number } | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const pending = useRef<Pending | null>({ kind: "today" });
	const panned = useRef(false);
	// the scale asked for while the last zoom is not drawn yet (wheel ticks come faster than the page redraws)
	const want = useRef<number | null>(null);
	const geo = useRef<{ axis: Axis; today: string; dw: number } | null>(null);
	const setView = (v: View, p: Pending | null = { kind: "today" }) => {
		pending.current = p;
		want.current = null;
		setViewState(v);
		try {
			localStorage.setItem(ZOOM_KEY, String(v));
		} catch {
			// not remembered
		}
	};

	const timeline = dash.data?.timeline;
	const ready = !!timeline;
	// the width of the window, for "whole project"
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
	// "whole project": the axis (the first to the last date, a margin each side) is squeezed to the window
	const dw = !model ? 0 : view === "fit" ? Math.max(MIN_DW, (width - LABEL_W - 4) / model.axis.days) : clampDw(view);
	if (model && timeline) geo.current = { axis: model.axis, today: timeline.today, dw };

	// after a new scale is drawn: today in the middle, or the day that was under the pointer still under it
	useLayoutEffect(() => {
		const el = scroller.current;
		const g = geo.current;
		const p = pending.current;
		if (!el || !g || !p || g.dw <= 0 || el.clientWidth === 0) return;
		pending.current = null;
		want.current = null;
		if (p.kind === "anchor") el.scrollLeft = Math.max(0, LABEL_W + p.day * g.dw - p.cx);
		else el.scrollLeft = view === "fit" ? 0 : Math.max(0, LABEL_W + dayIndex(g.axis, g.today) * g.dw - (el.clientWidth + LABEL_W) / 2);
	}, [dw, ready, view]);

	/** zoom to `next` px/day keeping the day under `cx` (a position inside the window) where it is, also across several ticks before a redraw */
	const zoomAt = (next: number, cx: number) => {
		const el = scroller.current;
		const g = geo.current;
		if (!el || !g) return;
		const shown = want.current ?? g.dw;
		const n = clampDw(next);
		if (n === shown) return;
		const p = pending.current;
		const day = dayUnder(p && p.kind === "anchor" ? p : null, shown, cx, el.scrollLeft, LABEL_W);
		setView(n, { kind: "anchor", day, cx });
		want.current = n;
	};
	const zoomBy = (f: number) => {
		const el = scroller.current;
		if (el) zoomAt((want.current ?? geo.current?.dw ?? 7) * f, LABEL_W + (el.clientWidth - LABEL_W) / 2);
	};
	// The wheel (a listener of its own: a React wheel handler cannot cancel the page's own zoom). Ctrl + wheel, or the wheel over
	// the date ruler, zooms at the pointer; the wheel over the rows scrolls them, and when there is nothing to scroll up or down
	// it pans sideways instead of doing nothing. Shift + wheel and a trackpad's sideways swipe are the browser's own.
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const wheel = (e: WheelEvent) => {
			const g = geo.current;
			if (!g) return;
			const px = wheelPixels(e.deltaY, e.deltaMode);
			if (e.ctrlKey || e.metaKey || (e.target as HTMLElement).closest(".gantt-axis")) {
				e.preventDefault();
				zoomAt((want.current ?? g.dw) * wheelZoomFactor(px), e.clientX - el.getBoundingClientRect().left);
			} else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollHeight <= el.clientHeight + 1) {
				e.preventDefault();
				el.scrollLeft += px;
			}
		};
		el.addEventListener("wheel", wheel, { passive: false });
		return () => el.removeEventListener("wheel", wheel);
	});
	/** drag on empty space pans (both ways); a click that did not move still adds a task there. The middle button pans from anywhere, bars and buttons too. */
	const panStart = (e: React.MouseEvent) => {
		const el = scroller.current;
		const middle = e.button === 1;
		if (!el || (e.button !== 0 && !middle)) return;
		if (!middle && (e.target as HTMLElement).closest("button, .gtask-bar, .gantt-label, .gantt-group, a, input, label")) return;
		if (middle) e.preventDefault();
		const x0 = e.clientX;
		const y0 = e.clientY;
		const l0 = el.scrollLeft;
		const t0 = el.scrollTop;
		panned.current = false;
		// the sheet over the page goes up only once the drag is a pan, so a plain click still reaches the track
		const follow = followMouse(
			(ev) => {
				if (!panned.current && !middle && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return;
				if (!panned.current) follow.cover();
				panned.current = true;
				el.scrollLeft = l0 - (ev.clientX - x0);
				el.scrollTop = t0 - (ev.clientY - y0);
			},
			() => {
				// the click that follows a pan is not a click on the track
				if (panned.current) setTimeout(() => (panned.current = false), 0);
			},
			{ cursor: "grabbing", cover: false },
		);
	};

	if (dash.error) return <Err error={dash.error} />;
	if (!timeline || !model) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa grafiku…")}</div>;
	const { axis } = model;
	const today = timeline.today;
	const trackW = axis.days * dw;
	const x = (iso: string) => dayIndex(axis, iso) * dw;
	const span = (s: Span) => ({ left: x(s.start), width: (dayIndex(axis, s.end) - dayIndex(axis, s.start) + 1) * dw });
	const reload = () => {
		todos.reload();
		dates.reload();
		dash.reload();
	};

	const goToday = () => {
		const el = scroller.current;
		if (view === "fit") return setView(ZOOMS.quarter);
		if (el) el.scrollTo({ left: Math.max(0, LABEL_W + dayIndex(axis, today) * dw - (el.clientWidth + LABEL_W) / 2), behavior: "smooth" });
	};
	const dateAt = (e: React.MouseEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return dateAtIndex(axis, Math.max(0, Math.min(axis.days - 1, Math.floor((e.clientX - r.left) / dw))));
	};
	const addAt = (e: React.MouseEvent) => {
		if (panned.current || (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("gantt-today"))) return;
		setStagePop(null);
		setPopup({ mode: "create", projectId, date: dateAt(e), x: e.clientX, y: e.clientY });
	};
	const openStage = (stage: BimStage, e: { clientX: number; clientY: number }) => {
		if (panned.current) return;
		setPopup(null);
		setStagePop({ stage, x: e.clientX, y: e.clientY });
	};
	// true when saved; false puts the bar back where it was
	const shift = (t: Task, s: Span): Promise<boolean> =>
		call("todos.update", projectId, t.id, spanPatch(s))
			.then(() => (setErr(null), reload(), true))
			.catch((e) => (setErr(errText(e)), reload(), false));
	const shiftStage = (stage: BimStage, s: Span): Promise<boolean> =>
		call("stages.setDates", projectId, stage, { start: s.start, end: s.end })
			.then(() => (setErr(null), reload(), true))
			.catch((e) => (setErr(errText(e)), reload(), false));

	const todayLine = <div className="gantt-today" style={{ left: x(today) + dw / 2 }} title={tr("šodien {today}", { today })} />;
	const trackStyle = { width: trackW, backgroundSize: `${7 * dw}px 100%` };

	return (
		<div className="gantt">
			<div className="gantt-bar">
				<span className="seg" role="group" aria-label={tr("Mērogs")}>
					{PRESETS.map((p) => (
						<button key={p.label} className={view === p.view ? "on" : ""} onClick={() => setView(p.view)} title={p.view === "fit" ? tr("Rādīt visu projektu logā") : undefined}>
							{p.label}
						</button>
					))}
				</span>
				<span className="seg" role="group" aria-label={tr("Tuvināt")}>
					<button onClick={() => zoomBy(1 / 1.4)} title={tr("Tālināt (Ctrl + ritenis)")} aria-label={tr("Tālināt (Ctrl + ritenis)")}>
						−
					</button>
					<button onClick={() => zoomBy(1.4)} title={tr("Tuvināt (Ctrl + ritenis)")} aria-label={tr("Tuvināt (Ctrl + ritenis)")}>
						+
					</button>
				</span>
				<button onClick={goToday} title={tr("Rādīt šodienu vidū")}>
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
				<span className="small dim" title={tr("Velc tukšu vietu vai spied vidējo pogu, lai pārbīdītu; Ctrl + ritenis (vai ritenis uz datumu joslas) tuvina; Shift + ritenis bīda sāņus; joslu velc, lai mainītu datumus")}>{tr("velc: pārbīdīt · Ctrl + ritenis: tuvināt · joslu velc: datumi")}</span>
				<span className="gantt-key small dim">
					<span className="gk-mark">◇</span> {tr("nodevums")} <span className="gk-mark">◆</span> {tr("nosūtīts")} <span className="gk-mark late">◇</span> {tr("kavējas")} <span className="gk-line" /> {tr("šodien")}
				</span>
			</div>
			{err && <div className="err" style={{ margin: "0 10px" }}>{err}</div>}
			<div className="gantt-scroll" ref={scroller} onMouseDown={panStart}>
				<div className="gantt-inner" style={{ width: LABEL_W + trackW }}>
					<Axis axis={axis} dw={dw} />
					<div className="gantt-group">{tr("Stadijas un nodevumi")}</div>
					{model.stages.map((s, n) => (
						<div key={s.stage} className={`gantt-row gst ${s.current ? "cur" : ""}`} style={{ "--sc": `var(--st${n})` } as React.CSSProperties}>
							<div className="gantt-label gst" title={s.inContract ? undefined : tr("stadija nav līgumā")} style={s.inContract ? undefined : { opacity: 0.6 }}>
								<i className="gdot" />
								{s.stage}
								{s.current && <span className="chip"> {tr("tagad")}</span>}
							</div>
							<div className="gantt-track" style={trackStyle} onClick={(e) => e.target === e.currentTarget && openStage(s.stage, e)} title={s.span ? undefined : tr("Klikšķis: ievadīt stadijas datumus")}>
								{todayLine}
								{s.span && <StageBar stage={s.stage} current={s.current} inContract={s.inContract} span={s.span} axis={axis} dw={dw} scroller={scroller} onOpen={(cx, cy) => openStage(s.stage, { clientX: cx, clientY: cy })} onShift={(sp) => shiftStage(s.stage, sp)} />}
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
					<RoutineRows projectId={projectId} axis={axis} dw={dw} trackStyle={trackStyle} todayLine={todayLine} />
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
									scroller={scroller}
									onShift={(s) => shift(t, s)}
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

/** The routines of the project (and of the whole app) as recurring ticks on their own rows: one mark on each day a routine runs (routines.occurrences). Nothing shows without a routine. */
function RoutineRows({ projectId, axis, dw, trackStyle, todayLine }: { projectId: string; axis: Axis; dw: number; trackStyle: React.CSSProperties; todayLine: React.ReactNode }) {
	const occ = useLoad(() => call("routines.occurrences", projectId, axis.from, axis.to), [projectId, axis.from, axis.to]);
	const rows = new Map<string, { name: string; days: { date: string; time: string }[]; idle: boolean; whole: boolean }>();
	for (const o of occ.data ?? []) {
		const r = rows.get(o.routineId) ?? { name: o.name, days: [], idle: o.paused || o.proposed, whole: o.projectId === null };
		r.days.push({ date: o.date, time: o.time });
		rows.set(o.routineId, r);
	}
	if (rows.size === 0) return null;
	return (
		<>
			<div className="gantt-group">{tr("Rutīnas")} <span className="dim small">· {tr("atkārtojas; pārvaldība: Rutīnas cilnē")}</span></div>
			{[...rows].map(([id, r]) => (
				<div key={id} className="gantt-row">
					<div className="gantt-label" title={r.name}>⟳ {r.name}{r.whole ? <span className="dim small"> ({tr("visa lietotne")})</span> : null}</div>
					<div className="gantt-track" style={trackStyle}>
						{todayLine}
						{r.days.map((d) => (
							<i key={d.date + d.time} className={`groutine ${r.idle ? "idle" : ""}`} style={{ left: dayIndex(axis, d.date) * dw, width: Math.max(2, dw - 1) }} title={`${r.name} · ${d.date} ${d.time}`} />
						))}
					</div>
				</div>
			))}
		</>
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
function TaskBar({ task, span, axis, dw, today, scroller, onOpen, onShift }: { task: Task; span: Span; axis: Axis; dw: number; today: string; scroller: React.RefObject<HTMLDivElement | null>; onOpen: (x: number, y: number) => void; onShift: (s: Span) => Promise<boolean> }) {
	const el = useRef<HTMLDivElement>(null);
	const late = task.state === "open" && span.end < today;
	const down = (e: React.MouseEvent, edge: DragEdge) => dragBar(e, { el, scroller, axis, dw, span, edge, canDrag: task.state !== "proposed", onOpen, onShift });
	const done = task.state === "done";
	const one = span.start === span.end;
	return (
		<div
			ref={el}
			className={`gtask-bar p-${task.priority ?? "normal"} ${late ? "late" : ""} ${done ? "done" : ""} ${task.state === "proposed" ? "proposed" : ""} ${one ? "one" : ""}`}
			style={placeSpan(axis, dw, span)}
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

/** A stage as a bar. With dates of its own it moves and resizes by drag like a task, a click opens the dates. A bar drawn from the stage's deliveries is no date anyone set, so it only opens the popup. */
function StageBar({ stage, current, inContract, span, axis, dw, scroller, onOpen, onShift }: { stage: BimStage; current: boolean; inContract: boolean; span: Span & { stored: boolean }; axis: Axis; dw: number; scroller: React.RefObject<HTMLDivElement | null>; onOpen: (x: number, y: number) => void; onShift: (s: Span) => Promise<boolean> }) {
	const el = useRef<HTMLButtonElement>(null);
	const down = (e: React.MouseEvent, edge: DragEdge) => {
		if (span.stored) dragBar(e, { el, scroller, axis, dw, span, edge, canDrag: true, onOpen, onShift });
	};
	const one = span.start === span.end;
	return (
		<button
			ref={el}
			className={`gstage ${current ? "cur" : ""} ${span.stored ? "stored" : "derived"} ${inContract ? "" : "off"}`}
			style={placeSpan(axis, dw, span)}
			title={`${stage}: ${span.start} → ${span.end}${span.stored ? "" : ` (${tr("no nodevumiem; klikšķis: ievadīt datumus")})`}`}
			onMouseDown={(e) => down(e, "move")}
			onClick={(e) => {
				// a mouse press is handled on mouse-down/up (dragBar); this is the keyboard (Enter, Space) and a derived bar's click
				if (e.detail === 0 || !span.stored) onOpen(e.clientX, e.clientY);
			}}
		>
			{span.stored && !one && <i className="gh gh-l" onMouseDown={(e) => down(e, "start")} />}
			<span>{stage}</span>
			<em>{span.start.slice(5)} → {span.end.slice(5)}</em>
			{span.stored && !one && <i className="gh gh-r" onMouseDown={(e) => down(e, "end")} />}
		</button>
	);
}

const placeSpan = (axis: Axis, dw: number, s: Span) => ({ left: dayIndex(axis, s.start) * dw, width: (dayIndex(axis, s.end) - dayIndex(axis, s.start) + 1) * dw });

/**
 * A mouse press on a bar or one of its edges: a click opens it, a drag moves the bar or the edge by whole days. While it is
 * dragged the dates show beside the pointer, and the window scrolls when the pointer is near its left or right side (the bar
 * follows by the days scrolled too). A drop saves; if the save fails the bar goes back.
 */
function dragBar(
	e: React.MouseEvent,
	o: { el: React.RefObject<HTMLElement | null>; scroller: React.RefObject<HTMLDivElement | null>; axis: Axis; dw: number; span: Span; edge: DragEdge; canDrag: boolean; onOpen: (x: number, y: number) => void; onShift: (s: Span) => Promise<boolean> },
) {
	if (e.button !== 0) return;
	e.preventDefault();
	e.stopPropagation();
	const sc = o.scroller.current;
	const x0 = e.clientX;
	const scroll0 = sc?.scrollLeft ?? 0;
	let last = { x: x0, y: e.clientY };
	let delta = 0;
	let moved = false;
	let tip: HTMLDivElement | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	const apply = (s: Span) => {
		const p = placeSpan(o.axis, o.dw, s);
		if (o.el.current) {
			o.el.current.style.left = `${p.left}px`;
			o.el.current.style.width = `${p.width}px`;
		}
	};
	const update = () => {
		const dx = last.x - x0 + ((sc?.scrollLeft ?? 0) - scroll0);
		delta = Math.round(dx / o.dw);
		const s = dragSpan(o.span, delta, o.edge);
		apply(s);
		if (!tip) {
			tip = document.createElement("div");
			tip.className = "gantt-drag-tip";
			document.body.appendChild(tip);
		}
		tip.textContent = spanLabel(s);
		tip.style.left = `${last.x + 14}px`;
		tip.style.top = `${last.y + 18}px`;
	};
	// the window follows the pointer at its sides (the left side starts after the label column)
	const edgeScroll = () => {
		if (!sc) return;
		const r = sc.getBoundingClientRect();
		const zone = 48;
		const left = r.left + LABEL_W + zone;
		const right = r.right - zone;
		const v = last.x > right ? Math.min(28, (last.x - right) / 2 + 2) : last.x < left ? -Math.min(28, (left - last.x) / 2 + 2) : 0;
		if (!v) return;
		const before = sc.scrollLeft;
		sc.scrollLeft += v;
		if (sc.scrollLeft !== before) update();
	};
	followMouse(
		(ev) => {
			last = { x: ev.clientX, y: ev.clientY };
			if (!o.canDrag || (!moved && Math.abs(ev.clientX - x0) < 4)) return;
			if (!moved) timer = setInterval(edgeScroll, 16);
			moved = true;
			update();
		},
		(ev) => {
			clearInterval(timer);
			tip?.remove();
			if (!moved) return o.onOpen(ev.clientX, ev.clientY);
			if (delta === 0) return apply(o.span);
			void o.onShift(dragSpan(o.span, delta, o.edge)).then((ok) => ok || apply(o.span));
		},
		{ cursor: o.edge === "move" ? "grabbing" : "ew-resize" },
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
