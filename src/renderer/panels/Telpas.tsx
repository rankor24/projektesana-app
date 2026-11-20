// Telpas: the inventory room table read from the property documents (1.10) with the sum check and the Excel export, and
// the comparison with the rooms of the open Revit model (3.2). A row click selects the room in Revit (one Select call).
// Task 9.10: as a sidebar it is the room list with the floor totals and "Atvērt kā lapu"; as a page (telpaslapa) the canvas is
// the floor strip with each floor's sum check and the tile plan of the picked floor (rooms coloured by their difference), the
// differences and the inventory a group docked on the right, INV Area at the bottom.
import { useEffect, useRef, useState } from "react";
import type { InvAreaRow, InventoryTable, RoomCompareRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { windows } from "../windows";
import { DIFF_LABEL, DIFF_TONE, floorStrip, pickFloor, planRooms, tiles, type DiffKind } from "../../shared/rooms-plan";
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
	const box = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 600, h: 360 });
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(160, el.clientHeight) }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	if (!projectId) return <Empty title={tr("nav projekta")}>{tr("Atver projektu.")}</Empty>;
	if (tables.error) return <Err error={tables.error} />;
	const t = tables.data ?? [];
	const diffs = cmp.data && cmp.data.state === "ok" ? cmp.data.diffs : [];
	const strip = floorStrip(t, diffs);
	const cur = pickFloor(strip, floor);
	if (tables.loading && !tables.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa telpu tabulas…")}</div>;
	if (!cur) return <Empty title={tr("no data")}>{tr("Īpašuma dokumentos telpu eksplikācija nav atrasta.")}</Empty>;
	const rooms = planRooms(t, diffs, cur);
	const tl = tiles(rooms, size.w, size.h);
	return (
		<div className="fill-col">
			<div className="floor-strip">
				{strip.map((c) => (
					<button key={c.floor} className={`floor-chip ${cur === c.floor ? "on" : ""} ${c.ok ? "" : "bad"}`} onClick={() => setFloor(c.floor)} title={c.stated !== null ? tr("dokumentā {stated} m², rindu summa {sum} m²", { stated: c.stated, sum: c.sum }) : tr("rindu summa {sum} m²", { sum: c.sum })}>
						<b>{tr("{floor}. st.", { floor: c.floor })}</b> {c.ok ? "✓" : `${c.sum} ≠ ${c.stated}`}
						<span className="dim small"> {tr("· {rooms} telpas", { rooms: c.rooms })}{c.diffs ? tr(" · {diffs} atšķ.", { diffs: c.diffs }) : ""}</span>
					</button>
				))}
				<span className="grow" />
				{cmp.data && cmp.data.state !== "ok" && <span className="dim small" title={cmp.data.message}>{tr("modeļa nav: {state}", { state: cmp.data.state })}</span>}
				<button className="small" onClick={() => cmp.reload()}>{tr("Salīdzināt vēlreiz")}</button>
			</div>
			{err && <div className="err">{err}</div>}
			<div className="tile-plan" ref={box}>
				{tl.map((x) => {
					const tone = x.room.diff ? DIFF_TONE[x.room.diff as DiffKind] : "ok";
					return (
						<div
							key={x.room.no}
							className={`tile ${tone} ${x.room.modelOnly ? "model-only" : ""}`}
							style={{ left: x.x, top: x.y, width: x.w, height: x.h, background: `color-mix(in srgb, ${TONE_VAR[tone]} ${tone === "ok" ? 14 : 30}%, var(--panel))`, borderColor: TONE_VAR[tone] }}
							title={tr("{no} {name} · {area} m²{v}", { no: x.room.no, name: x.room.name, area: x.room.area, v: x.room.diff ? ` · ${DIFF_LABEL[x.room.diff as DiffKind]}` : "" })}
							onClick={() => {
								commentSubject.pick({ thing: "room", no: x.room.no, floor: cur }, `telpa ${x.room.no}`);
								ui.focusAdd({ kind: "room", id: x.room.no, label: `telpa ${x.room.no}${x.room.diff ? `: ${DIFF_LABEL[x.room.diff as DiffKind]}` : ""}`, data: { floor: cur, name: x.room.name, area: x.room.area, diff: x.room.diff } });
								if (x.room.modelId) call("revit.select", [Number(x.room.modelId)]).catch((e) => setErr(errText(e)));
							}}
						>
							<b>{x.room.no}</b>
							{x.w > 70 && x.h > 38 && <div className="small">{x.room.name}</div>}
							{x.w > 70 && x.h > 54 && <div className="small dim">{tr("{area} m²", { area: x.room.area })}</div>}
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
	return (
		<div>
			<div className="row">
				<b>{t.title}</b>
				<span className="dim small">
					{tr("{v} telpas · {v2} m²", { v: t.rows.length, v2: sum.toLocaleString(locale()) })}</span>
				{t.totals.map((x) => (
					<Badge key={x.floor} tone={x.ok ? "ok" : "bad"} title={tr("dokumentā {stated}, rindu summa {sum}", { stated: x.stated, sum: x.sum })}>
						{x.floor === "*" ? tr("kopā") : tr("{floor}. st.", { floor: x.floor })} {x.ok ? "✓" : `${x.sum} ≠ ${x.stated}`}
					</Badge>
				))}
				<span className="grow" />
				<button onClick={() => call("rooms.exportXlsx", projectId, t.sourceId).catch((e) => onErr(errText(e)))}>{tr("Eksportēt Excel")}</button>
			</div>
			<table>
				<thead>
					<tr>
						<th>{tr("Stāvs")}</th>
						<th>{tr("Nr.")}</th>
						<th>{tr("Nosaukums")}</th>
						<th style={{ textAlign: "right" }}>{tr("Platība, m²")}</th>
						<th style={{ textAlign: "right" }}>{tr("Augstums")}</th>
						<th>{tr("Lapa")}</th>
					</tr>
				</thead>
				<tbody>
					{t.rows.map((r, i) => (
						<tr key={i} className="click" onClick={() => (ui.show({ kind: "source", sourceId: t.sourceId, page: r.page }), commentSubject.pick({ thing: "room", no: r.no, floor: String(r.floor) }, `telpa ${r.no}`))}>
							<td>{r.floor}</td>
							<td>{r.no}</td>
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
