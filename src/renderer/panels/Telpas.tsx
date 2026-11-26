// Telpas: the inventory room table read from the property documents (1.10) with the sum check and the Excel export, and
// the comparison with the rooms of the open Revit model (3.2). A row click selects the room in Revit (one Select call).
// Task 9.10: as a sidebar it is the room list with the floor totals and "Atvērt kā lapu"; as a page (telpaslapa) the canvas is
// the floor strip with each floor's sum check and the tile plan of the picked floor (rooms coloured by their difference), the
// differences and the inventory a group docked on the right, INV Area at the bottom. The plan pans and zooms (wheel at the
// pointer, drag or middle button) and has a room search, a status filter and a sort order.
import { useEffect, useRef, useState } from "react";
import type { InvAreaRow, InventoryTable, RoomCompareRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { windows } from "../windows";
import { DIFF_LABEL, DIFF_TONE, filterRooms, floorStrip, kindsPresent, NO_FILTER, pickFloor, planRooms, sortRooms, tiles, type DiffKind, type PlanFilter, type SortKey, type StatusFilter } from "../../shared/rooms-plan";
import { clampView, HOME, MAX_ZOOM, MIN_ZOOM, panBy, place, wheelPixels, wheelZoomFactor, zoomAt, type View } from "../../shared/pan-zoom";
import { commentSubject } from "../comment-subject";
import { Badge, Empty, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";

const KIND: Record<string, string> = { "missing-in-model": tr("nav modelī"), "missing-in-inventory": tr("nav inventarizācijā"), area: tr("platība"), name: tr("nosaukums"), floor: tr("stāvs"), duplicate: tr("dubults Nr.") };

export function Telpas() {
	const { projectId } = useUi();
	const [tab, setTab] = useState<"inv" | "cmp">("inv");
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return (
		<div className="fill-col">
			<div className="tabs">
				<button className={tab === "inv" ? "on" : ""} onClick={() => setTab("inv")}>{tr("Inventarizācija")}</button>
				<button className={tab === "cmp" ? "on" : ""} onClick={() => setTab("cmp")}>{tr("Salīdzinājums ar modeli")}</button>
				<span className="grow" />
				<button className="small" title={tr("Telpu plāns pa stāviem uz visu laukumu, atšķirības blakus")} onClick={() => windows.go("telpaslapa")}>
					{tr("Atvērt kā lapu")}</button>
			</div>
			{tab === "inv" ? <Inventory projectId={projectId} /> : <Compare projectId={projectId} />}
		</div>
	);
}

/** The page's windows: the differences, the inventory, and INV Area. */
export function TelpasDiffs() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return <Compare projectId={projectId} withInvArea={false} />;
}
export function TelpasInventory() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return <Inventory projectId={projectId} />;
}
export function TelpasInvArea() {
	const { projectId } = useUi();
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			<InvArea projectId={projectId} onErr={setErr} />
		</div>
	);
}

const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" } as const;

/** The canvas of the page: the floor strip (each floor's sum check picks the plan) and the tile plan of the picked floor. */
export function TelpasPlan() {
	const { projectId } = useUi();
	const tables = useLoad<InventoryTable[]>(() => (projectId ? call("rooms.table", projectId) : Promise.resolve([])), [projectId]);
	const cmp = useLoad<RoomCompareRow | null>(() => (projectId ? call("rooms.compare", projectId) : Promise.resolve(null)), [projectId]);
	const [floor, setFloor] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	// the plan's box is only on screen once the tables are read, so the element is state (a plain ref was empty when the effects ran)
	const [box, setBox] = useState<HTMLDivElement | null>(null);
	const [size, setSize] = useState({ w: 600, h: 360 });
	const [view, setView] = useState<View>(HOME);
	const [sort, setSort] = useState<SortKey>("area-desc");
	const [filter, setFilter] = useState<PlanFilter>(NO_FILTER);
	const [dragging, setDragging] = useState(false);
	const live = useRef({ view, size });
	live.current = { view, size };
	/** set the view and note it at once: wheel ticks come faster than the page redraws, so each must start from the last tick, not the last drawing */
	const show = (v: View) => {
		live.current.view = v;
		setView(v);
	};
	const moved = useRef(false);
	useEffect(() => {
		if (!box) return;
		const fit = () => setSize({ w: Math.max(200, box.clientWidth), h: Math.max(160, box.clientHeight) });
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(box);
		return () => ro.disconnect();
	}, [box]);
	// the view stays inside the plan when the plan changes size
	useEffect(() => show(clampView(live.current.view, size.w, size.h)), [size]);
	// the wheel zooms at the pointer (a listener of its own: a React wheel handler cannot cancel the page's own zoom)
	useEffect(() => {
		if (!box) return;
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			const { view: v, size: z } = live.current;
			const r = box.getBoundingClientRect();
			show(zoomAt(v, v.k * wheelZoomFactor(wheelPixels(e.deltaY, e.deltaMode)), e.clientX - r.left, e.clientY - r.top, z.w, z.h));
		};
		box.addEventListener("wheel", wheel, { passive: false });
		return () => box.removeEventListener("wheel", wheel);
	}, [box]);
	/** drag with the left button pans (a click that did not move still picks the room); the middle button pans from anywhere */
	const panStart = (e: React.MouseEvent) => {
		if (e.button !== 0 && e.button !== 1) return;
		const middle = e.button === 1;
		if (middle) e.preventDefault();
		const x0 = e.clientX;
		const y0 = e.clientY;
		const from = live.current.view;
		moved.current = false;
		const move = (ev: MouseEvent) => {
			if (!moved.current && !middle && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return;
			if (!moved.current) setDragging(true);
			moved.current = true;
			const z = live.current.size;
			show(panBy(from, ev.clientX - x0, ev.clientY - y0, z.w, z.h));
		};
		const up = () => {
			window.removeEventListener("mousemove", move);
			window.removeEventListener("mouseup", up);
			setDragging(false);
		};
		window.addEventListener("mousemove", move);
		window.addEventListener("mouseup", up);
	};
	const zoomBy = (f: number) => show(zoomAt(live.current.view, live.current.view.k * f, size.w / 2, size.h / 2, size.w, size.h));
	if (!projectId) return <Empty title={tr("nav projekta")}>{tr("Atver projektu.")}</Empty>;
	if (tables.error) return <Err error={tables.error} />;
	const t = tables.data ?? [];
	const diffs = cmp.data && cmp.data.state === "ok" ? cmp.data.diffs : [];
	const strip = floorStrip(t, diffs);
	const cur = pickFloor(strip, floor);
	if (tables.loading && !tables.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa telpu tabulas…")}</div>;
	if (!cur) return <Empty title={tr("no data")}>{tr("Īpašuma dokumentos telpu eksplikācija nav atrasta.")}</Empty>;
	const all = planRooms(t, diffs, cur);
	const kinds = kindsPresent(all);
	// a status the picked floor does not have shows everything rather than an empty plan nobody can explain
	const f: PlanFilter = filter.status !== "all" && filter.status !== "diffs" && filter.status !== "ok" && !kinds.includes(filter.status) ? { ...filter, status: "all" } : filter;
	const rooms = sortRooms(filterRooms(all, f), sort);
	const tl = tiles(rooms, size.w, size.h);
	const shownArea = Math.round(rooms.reduce((s, r) => s + r.area, 0) * 10) / 10;
	const filtered = f.text.trim() !== "" || f.status !== "all";
	const pick = (id: string) => (setFloor(id), show(HOME));
	return (
		<div className="fill-col">
			<div className="floor-strip">
				{strip.map((c) => (
					<button key={c.floor} className={`floor-chip ${cur === c.floor ? "on" : ""} ${c.ok ? "" : "bad"}`} onClick={() => pick(c.floor)} title={c.stated !== null ? tr("dokumentā {stated} m², rindu summa {sum} m²", { stated: c.stated, sum: c.sum }) : tr("rindu summa {sum} m²", { sum: c.sum })}>
						<b>{tr("{floor}. st.", { floor: c.floor })}</b> {c.ok ? "✓" : `${c.sum} ≠ ${c.stated}`}
						<span className="dim small"> {tr("· {rooms} telpas", { rooms: c.rooms })}{c.diffs ? tr(" · {diffs} atšķ.", { diffs: c.diffs }) : ""}</span>
					</button>
				))}
				<span className="grow" />
				{cmp.data && cmp.data.state !== "ok" && <span className="dim small" title={cmp.data.message}>{tr("modeļa nav: {state}", { state: cmp.data.state })}</span>}
				<button className="small" onClick={() => cmp.reload()}>{tr("Salīdzināt vēlreiz")}</button>
			</div>
			<div className="plan-bar">
				<input type="search" className="plan-find" value={filter.text} placeholder={tr("Meklēt telpu pēc Nr. vai nosaukuma")} onChange={(e) => (setFilter({ ...f, text: e.target.value }), show(HOME))} />
				<select value={f.status} title={tr("Kuras telpas rādīt")} onChange={(e) => (setFilter({ ...f, status: e.target.value as StatusFilter }), show(HOME))}>
					<option value="all">{tr("Visas telpas")}</option>
					<option value="diffs">{tr("Ar atšķirībām")}</option>
					<option value="ok">{tr("Bez atšķirībām")}</option>
					{kinds.map((k) => (
						<option key={k} value={k}>{KIND[k]}</option>
					))}
				</select>
				<select value={sort} title={tr("Telpu kārtība plānā")} onChange={(e) => (setSort(e.target.value as SortKey), show(HOME))}>
					<option value="area-desc">{tr("Platība ↓")}</option>
					<option value="area-asc">{tr("Platība ↑")}</option>
					<option value="no">{tr("Pēc Nr.")}</option>
					<option value="name">{tr("Pēc nosaukuma")}</option>
					<option value="diff">{tr("Atšķirības vispirms")}</option>
				</select>
				{filtered && <button className="small ghost" onClick={() => (setFilter(NO_FILTER), show(HOME))}>{tr("Notīrīt filtru")}</button>}
				<span className="dim small">{tr("{shown} / {total} telpas · {area} m²", { shown: rooms.length, total: all.length, area: shownArea.toLocaleString(locale()) })}</span>
				<span className="grow" />
				<span className="plan-zoom" title={tr("Ritenis tuvina uz kursoru; velc (vai vidējā poga), lai pārbīdītu")}>
					<button className="small" onClick={() => zoomBy(1 / 1.5)} disabled={view.k <= MIN_ZOOM}>−</button>
					<span className="small dim">{Math.round(view.k * 100)}%</span>
					<button className="small" onClick={() => zoomBy(1.5)} disabled={view.k >= MAX_ZOOM}>+</button>
					<button className="small" onClick={() => show(HOME)} disabled={view.k === 1}>{tr("Viss plāns")}</button>
				</span>
			</div>
			{err && <div className="err">{err}</div>}
			<div className={`tile-plan ${dragging ? "dragging" : ""}`} ref={setBox} onMouseDown={panStart}>
				{rooms.length === 0 && <Empty title={tr("Neviena telpa neatbilst filtram")} />}
				{tl.map((x) => {
					const p = place(view, x);
					// only the tiles that show in the window are drawn: at high zoom most of the plan is outside it
					if (p.left > size.w || p.top > size.h || p.left + p.width < 0 || p.top + p.height < 0) return null;
					const tone = x.room.diff ? DIFF_TONE[x.room.diff as DiffKind] : "ok";
					return (
						<div
							key={x.room.no}
							className={`tile ${tone} ${x.room.modelOnly ? "model-only" : ""}`}
							style={{ ...p, borderWidth: p.width < 24 || p.height < 24 ? 1 : 2, background: `color-mix(in srgb, ${TONE_VAR[tone]} ${tone === "ok" ? 14 : 30}%, var(--panel))`, borderColor: TONE_VAR[tone] }}
							title={tr("{no} {name} · {area} m²{v}", { no: x.room.no, name: x.room.name, area: x.room.area, v: x.room.diff ? ` · ${DIFF_LABEL[x.room.diff as DiffKind]}` : "" })}
							onClick={() => {
								if (moved.current) return; // the mouse went up after a pan, not after a click
								commentSubject.pick({ thing: "room", no: x.room.no, floor: cur }, `telpa ${x.room.no}`);
								ui.focusAdd({ kind: "room", id: x.room.no, label: `telpa ${x.room.no}${x.room.diff ? `: ${DIFF_LABEL[x.room.diff as DiffKind]}` : ""}`, data: { floor: cur, name: x.room.name, area: x.room.area, diff: x.room.diff } });
								if (x.room.modelId) call("revit.select", [Number(x.room.modelId)]).catch((e) => setErr(errText(e)));
							}}
						>
							{p.width > 22 && p.height > 16 && <b>{x.room.no}</b>}
							{p.width > 70 && p.height > 38 && <div className="small">{x.room.name}</div>}
							{p.width > 70 && p.height > 54 && <div className="small dim">{tr("{area} m²", { area: x.room.area })}</div>}
						</div>
					);
				})}
			</div>
			<div className="dim small" style={{ padding: "2px 8px" }}>
				{tr("Plāns: telpas pēc platības (nav stāva zīmējuma — inventarizācijā un modeļa telpu sarakstā ir platības, nevis robežas). Krāsa: sarkans — modelis neatbilst, dzeltens — nosaukums vai stāvs. Klikšķis atzīmē telpu Revit.")}</div>
		</div>
	);
}

function Compare({ projectId, withInvArea = true }: { projectId: string; withInvArea?: boolean }) {
	const c = useLoad<RoomCompareRow>(() => call("rooms.compare", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const d = c.data;
	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={() => c.reload()}>{tr("Salīdzināt vēlreiz")}</button>
				<button onClick={() => call("findings.runAll", projectId).catch((e) => setErr(errText(e)))}>{tr("Ierakstīt atradumos")}</button>
				{d && d.state === "ok" && (
					<span className="dim small">
						{tr("inventarizācijā {inventory}, modelī {model}, sakrīt pēc Nr. {matched}, atšķirības {v}", { inventory: d.inventory, model: d.model, matched: d.matched, v: d.diffs.length })}</span>
				)}
			</div>
			{err && <div className="err">{err}</div>}
			{withInvArea && <InvArea projectId={projectId} onErr={setErr} />}
			{c.error ? <Err error={c.error} /> : null}
			{c.loading && <div className="dim small">{tr("lasa modeli…")}</div>}
			{d && d.state !== "ok" && <Empty title={d.state}>{d.message}</Empty>}
			{d && d.state === "ok" && d.diffs.length === 0 && <Empty title={tr("atšķirību nav")}>{tr("Visas telpas sakrīt pielaides robežās.")}</Empty>}
			{d && d.diffs.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>{tr("Nr.")}</th>
							<th>{tr("Atšķirība")}</th>
							<th>{tr("Inventarizācija")}</th>
							<th>{tr("Modelis")}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{d.diffs.map((x, i) => (
							<tr key={i} className="click" onClick={() => commentSubject.pick({ thing: "room", no: x.no, ...(x.inventory?.floor ? { floor: String(x.inventory.floor) } : {}) }, `telpa ${x.no}`)}>
								<td>{x.no}</td>
								<td>
									<Badge tone={x.kind === "name" ? "warn" : "bad"}>{KIND[x.kind] ?? x.kind}</Badge>
									{x.delta !== undefined && <span className="small"> {x.delta > 0 ? "+" : ""}{tr("{delta} m² (±{tolerance})", { delta: x.delta, tolerance: x.tolerance })}</span>}
								</td>
								<td className="small">{x.inventory ? tr("{floor}. st. · {name} · {area} m²", { floor: x.inventory.floor, name: x.inventory.name, area: x.inventory.area }) : "—"}</td>
								<td className="small">{x.model ? tr("{level} · {name} · {area} m²", { level: x.model.level, name: x.model.name, area: x.model.area }) : "—"}</td>
								<td>
									{x.model && (
										<button className="small" onClick={() => call("revit.select", [Number(x.model!.id)]).catch((e) => setErr(errText(e)))}>
											{tr("Revit")}</button>
									)}
									<button className="small ghost" onClick={() => ui.focusAdd({ kind: "room", id: x.no, label: `telpa ${x.no}: ${KIND[x.kind] ?? x.kind}`, data: { ...x } })}>{tr("→ aģentam")}</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

/** INV Area into the model: first the batch (which rooms, which values), then the user writes it. One Revit call per room. */
function InvArea({ projectId, onErr }: { projectId: string; onErr: (e: string) => void }) {
	const [plan, setPlan] = useState<InvAreaRow[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<string | null>(null);
	return (
		<div className="confirm">
			<div className="row">
				<b>{tr("INV Area modelī")}</b>
				<span className="dim small">{tr("inventarizācijas platība Revit telpu parametrā “INV Area”, lai pārbaudes birka to rāda")}</span>
				<span className="grow" />
				<button disabled={busy} onClick={() => (setDone(null), call("rooms.invAreaPlan", projectId).then(setPlan).catch((e) => onErr(errText(e))))}>{tr("Sagatavot partiju")}</button>
			</div>
			{plan && (
				<>
					<div className="small">
						{tr("{v} telpas:", { v: plan.length })} {plan.slice(0, 8).map((p) => `${p.number} → ${p.areaM2} m²`).join(", ")}
						{plan.length > 8 ? " …" : ""}
					</div>
					<div className="row">
						<button
							className="primary"
							disabled={busy || !plan.length}
							onClick={() => {
								setBusy(true);
								call("rooms.writeInvArea", projectId, plan)
									.then((r) => (setDone(tr("ierakstītas {written}{noParam}", { written: r.written, noParam: r.noParam.length ? tr("; bez parametra: {list}", { list: r.noParam.join(", ") }) : "" })), setPlan(null)))
									.catch((e) => onErr(errText(e)))
									.finally(() => setBusy(false));
							}}
						>
							{busy ? tr("raksta…") : tr("Ierakstīt {length} telpas", { length: plan.length })}
						</button>
						<button className="ghost" onClick={() => setPlan(null)}>{tr("Atcelt")}</button>
					</div>
				</>
			)}
			{done && <Badge tone="ok">{done}</Badge>}
		</div>
	);
}

function Inventory({ projectId }: { projectId: string }) {
	const tables = useLoad<InventoryTable[]>(() => call("rooms.table", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			{tables.error ? <Err error={tables.error} /> : null}
			{tables.loading && <div className="dim small">{tr("lasa telpu tabulas…")}</div>}
			{tables.data && tables.data.length === 0 && <Empty title={tr("no data")}>{tr("Īpašuma dokumentos telpu eksplikācija nav atrasta.")}</Empty>}
			{tables.data?.map((t) => (
				<InventoryView key={t.sourceId} t={t} projectId={projectId} onErr={setErr} />
			))}
		</div>
	);
}

function InventoryView({ t, projectId, onErr }: { t: InventoryTable; projectId: string; onErr: (e: string) => void }) {
	const sum = Math.round(t.rows.reduce((s, r) => s + r.area, 0) * 100) / 100;
	// the rooms ticked for deleting (by row id); a shift-click ticks the run between two rows
	const [sel, setSel] = useState<Set<string>>(new Set());
	const [anchor, setAnchor] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		// after a reload keep only the rooms that are still there
		const ids = new Set(t.rows.map((r) => r.id));
		setSel((p) => (p.size && [...p].some((x) => !ids.has(x)) ? new Set([...p].filter((x) => ids.has(x))) : p));
	}, [t.rows]);
	const allOn = t.rows.length > 0 && t.rows.every((r) => sel.has(r.id));
	const tick = (id: string, on: boolean, range: boolean) => {
		const next = new Set(sel);
		const ids = range && anchor ? (() => {
			const a = t.rows.findIndex((r) => r.id === anchor);
			const b = t.rows.findIndex((r) => r.id === id);
			return a < 0 || b < 0 ? [id] : t.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id);
		})() : [id];
		for (const x of ids) on ? next.add(x) : next.delete(x);
		setSel(next);
		setAnchor(id);
	};
	const remove = (ids: string[]) => {
		if (!ids.length || busy) return;
		if (!window.confirm(tr("Dzēst {n} telpas no šīs tabulas? Dzēstās telpas neatgriežas, kad dokumentu nolasa vēlreiz; «Atjaunot no dokumenta» tās atgriež.", { n: ids.length }))) return;
		setBusy(true);
		call("rooms.delete", projectId, t.sourceId, ids.length === t.rows.length ? "all" : ids)
			.then(() => setSel(new Set()))
			.catch((e) => onErr(errText(e)))
			.finally(() => setBusy(false));
	};
	const restore = () => {
		if (!window.confirm(tr("Atjaunot tabulu tādu, kādu to nolasa no dokumenta? Visi labojumi un dzēsumi šim dokumentam pazudīs."))) return;
		call("rooms.restore", projectId, t.sourceId).then(() => setSel(new Set())).catch((e) => onErr(errText(e)));
	};
	return (
		<div>
			<div className="row">
				<b>{t.title}</b>
				<span className="dim small">
					{tr("{v} telpas · {v2} m²", { v: t.rows.length, v2: sum.toLocaleString(locale()) })}</span>
				{t.totals.map((x) => (
					<Badge key={`${x.group ?? ""}/${x.floor}`} tone={x.ok ? "ok" : "bad"} title={tr("dokumentā {stated}, rindu summa {sum}", { stated: x.stated, sum: x.sum })}>
						{x.group ? tr("{group}. gr.", { group: x.group }) : x.floor === "*" ? tr("kopā") : tr("{floor}. st.", { floor: x.floor })} {x.ok ? "✓" : `${x.sum} ≠ ${x.stated}`}
					</Badge>
				))}
				<span className="grow" />
				<button onClick={() => call("rooms.exportXlsx", projectId, t.sourceId).catch((e) => onErr(errText(e)))}>{tr("Eksportēt Excel")}</button>
			</div>
			{/* a table code read from a scan is often wrong (OCR): say so, and one click gives the agent the job of reading it right */}
			{t.state === "skenēts" && (
				<div className="row small">
					<Badge tone="warn">{tr("nolasīts no skenēta dokumenta")}</Badge>
					<span className="dim">{tr("Rindas var būt kļūdainas vai trūkt; pārbaudi pret lapām.")}</span>
					<span className="grow" />
					<button className="small" onClick={() => call("agent.send", projectId, `Telpu inventarizācija dokumentā «${t.title}» nolasīta no skenēta dokumenta, un rindas ir kļūdainas. Apskati katru tā lapu ar telpu tabulām kā attēlu (view_page; koda OCR teksts šim skenējumam ir sajaukts), sastādi pilnu telpu sarakstu — katru telpu, ne izlasi — (stāvs, numurs, nosaukums bez telpas veida, platība m², augstums m, lapa; bez grupu kopsummām) un ieraksti to ar set_inventory_rooms (sourceId ${t.sourceId}). Beigās salīdzini ar dokumenta kopsummām.`, []).catch((e) => onErr(errText(e)))}>
						{tr("Lūgt aģentam pārbaudīt un salabot")}
					</button>
				</div>
			)}
			{t.state === "labots" && (
				<div className="row small">
					<Badge tone="ok">{t.correctedBy === "agent" ? tr("labojis aģents") : tr("labots")}</Badge>
					<span className="dim">{tr("Šīs rindas aizstāj no dokumenta nolasītās visur: salīdzinājumā ar modeli un pārbaudēs.")}</span>
					<span className="grow" />
					<button className="small" onClick={restore}>{tr("Atjaunot no dokumenta")}</button>
				</div>
			)}
			{sel.size > 0 && (
				<div className="row small">
					<b>{tr("Atlasītas {n} telpas", { n: sel.size })}</b>
					<button className="small danger" disabled={busy} onClick={() => remove([...sel])}>{tr("Dzēst atlasītās")}</button>
					<button className="small ghost" onClick={() => setSel(new Set())}>{tr("Noņemt atlasi")}</button>
				</div>
			)}
			{t.rows.length === 0 && t.state === "labots" && <div className="dim small">{tr("Visas šī dokumenta telpas ir izdzēstas.")}</div>}
			<table>
				<thead>
					<tr>
						<th style={{ width: 24 }}>
							<input type="checkbox" checked={allOn} disabled={!t.rows.length} title={tr("Atlasīt visas")} onChange={(e) => setSel(e.target.checked ? new Set(t.rows.map((r) => r.id)) : new Set())} />
						</th>
						<th>{tr("Stāvs")}</th>
						<th>{tr("Nr.")}</th>
						<th>{tr("Nosaukums")}</th>
						<th style={{ textAlign: "right" }}>{tr("Platība, m²")}</th>
						<th style={{ textAlign: "right" }}>{tr("Augstums")}</th>
						<th>{tr("Lapa")}</th>
					</tr>
				</thead>
				<tbody>
					{t.rows.map((r) => (
						<tr key={r.id} className={`click ${sel.has(r.id) ? "sel" : ""}`} onClick={() => (ui.show({ kind: "source", sourceId: t.sourceId, page: r.page }), commentSubject.pick({ thing: "room", no: r.no, floor: String(r.floor) }, `telpa ${r.no}`))}>
							<td onClick={(e) => e.stopPropagation()}>
								<input type="checkbox" checked={sel.has(r.id)} onChange={() => undefined} onClick={(e) => tick(r.id, !sel.has(r.id), e.shiftKey)} />
							</td>
							<td>{r.floor}</td>
							<td>{r.no}{r.group && <span className="dim small" title={tr("Telpu grupa")}> {r.group}</span>}</td>
							<td>{r.name}</td>
							<td style={{ textAlign: "right" }}>{r.area.toLocaleString(locale(), { minimumFractionDigits: 1 })}</td>
							<td style={{ textAlign: "right" }}>{r.height ?? ""}</td>
							<td>{r.page}</td>
						</tr>
					))}
				</tbody>
			</table>
			{t.unread.length > 0 && (
				<div className="err">
					{tr("Nenolasītas rindas ({v}):", { v: t.unread.length })}{t.unread.map((u, i) => (
						<div key={i} className="mono small">
							{tr("lpp. {page}: {line}", { page: u.page, line: u.line })}</div>
					))}
				</div>
			)}
		</div>
	);
}
