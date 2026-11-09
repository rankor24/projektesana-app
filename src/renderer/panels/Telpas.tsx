// Telpas: the inventory room table read from the property documents (1.10) with the sum check and the Excel export, and
// the comparison with the rooms of the open Revit model (3.2). A row click selects the room in Revit (one Select call).
import { useState } from "react";
import type { InvAreaRow, InventoryTable, RoomCompareRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const KIND: Record<string, string> = { "missing-in-model": "nav modelī", "missing-in-inventory": "nav inventarizācijā", area: "platība", name: "nosaukums", floor: "stāvs", duplicate: "dubults Nr." };

export function Telpas() {
	const { projectId } = useUi();
	const [tab, setTab] = useState<"inv" | "cmp">("inv");
	if (!projectId) return <Empty title="nav projekta" />;
	return (
		<div className="fill-col">
			<div className="tabs">
				<button className={tab === "inv" ? "on" : ""} onClick={() => setTab("inv")}>Inventarizācija</button>
				<button className={tab === "cmp" ? "on" : ""} onClick={() => setTab("cmp")}>Salīdzinājums ar modeli</button>
			</div>
			{tab === "inv" ? <Inventory projectId={projectId} /> : <Compare projectId={projectId} />}
		</div>
	);
}

function Compare({ projectId }: { projectId: string }) {
	const c = useLoad<RoomCompareRow>(() => call("rooms.compare", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const d = c.data;
	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={() => c.reload()}>Salīdzināt vēlreiz</button>
				<button onClick={() => call("findings.runAll", projectId).catch((e) => setErr(errText(e)))}>Ierakstīt atradumos</button>
				{d && d.state === "ok" && (
					<span className="dim small">
						inventarizācijā {d.inventory}, modelī {d.model}, sakrīt pēc Nr. {d.matched}, atšķirības {d.diffs.length}
					</span>
				)}
			</div>
			{err && <div className="err">{err}</div>}
			<InvArea projectId={projectId} onErr={setErr} />
			{c.error ? <Err error={c.error} /> : null}
			{c.loading && <div className="dim small">lasa modeli…</div>}
			{d && d.state !== "ok" && <Empty title={d.state}>{d.message}</Empty>}
			{d && d.state === "ok" && d.diffs.length === 0 && <Empty title="atšķirību nav">Visas telpas sakrīt pielaides robežās.</Empty>}
			{d && d.diffs.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>Nr.</th>
							<th>Atšķirība</th>
							<th>Inventarizācija</th>
							<th>Modelis</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{d.diffs.map((x, i) => (
							<tr key={i}>
								<td>{x.no}</td>
								<td>
									<Badge tone={x.kind === "name" ? "warn" : "bad"}>{KIND[x.kind] ?? x.kind}</Badge>
									{x.delta !== undefined && <span className="small"> {x.delta > 0 ? "+" : ""}{x.delta} m² (±{x.tolerance})</span>}
								</td>
								<td className="small">{x.inventory ? `${x.inventory.floor}. st. · ${x.inventory.name} · ${x.inventory.area} m²` : "—"}</td>
								<td className="small">{x.model ? `${x.model.level} · ${x.model.name} · ${x.model.area} m²` : "—"}</td>
								<td>
									{x.model && (
										<button className="small" onClick={() => call("revit.select", [Number(x.model!.id)]).catch((e) => setErr(errText(e)))}>
											Revit
										</button>
									)}
									<button className="small ghost" onClick={() => ui.focusAdd({ kind: "room", id: x.no, label: `telpa ${x.no}: ${KIND[x.kind] ?? x.kind}`, data: { ...x } })}>→ aģentam</button>
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
				<b>INV Area modelī</b>
				<span className="dim small">inventarizācijas platība Revit telpu parametrā “INV Area”, lai pārbaudes birka to rāda</span>
				<span className="grow" />
				<button disabled={busy} onClick={() => (setDone(null), call("rooms.invAreaPlan", projectId).then(setPlan).catch((e) => onErr(errText(e))))}>Sagatavot partiju</button>
			</div>
			{plan && (
				<>
					<div className="small">
						{plan.length} telpas: {plan.slice(0, 8).map((p) => `${p.number} → ${p.areaM2} m²`).join(", ")}
						{plan.length > 8 ? " …" : ""}
					</div>
					<div className="row">
						<button
							className="primary"
							disabled={busy || !plan.length}
							onClick={() => {
								setBusy(true);
								call("rooms.writeInvArea", projectId, plan)
									.then((r) => (setDone(`ierakstītas ${r.written}${r.noParam.length ? `; bez parametra: ${r.noParam.join(", ")}` : ""}`), setPlan(null)))
									.catch((e) => onErr(errText(e)))
									.finally(() => setBusy(false));
							}}
						>
							{busy ? "raksta…" : `Ierakstīt ${plan.length} telpas`}
						</button>
						<button className="ghost" onClick={() => setPlan(null)}>Atcelt</button>
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
			{tables.loading && <div className="dim small">lasa telpu tabulas…</div>}
			{tables.data && tables.data.length === 0 && <Empty title="no data">Īpašuma dokumentos telpu eksplikācija nav atrasta.</Empty>}
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
					{t.rows.length} telpas · {sum.toLocaleString("lv-LV")} m²
				</span>
				{t.totals.map((x) => (
					<Badge key={x.floor} tone={x.ok ? "ok" : "bad"} title={`dokumentā ${x.stated}, rindu summa ${x.sum}`}>
						{x.floor === "*" ? "kopā" : `${x.floor}. st.`} {x.ok ? "✓" : `${x.sum} ≠ ${x.stated}`}
					</Badge>
				))}
				<span className="grow" />
				<button onClick={() => call("rooms.exportXlsx", projectId, t.sourceId).catch((e) => onErr(errText(e)))}>Eksportēt Excel</button>
			</div>
			<table>
				<thead>
					<tr>
						<th>Stāvs</th>
						<th>Nr.</th>
						<th>Nosaukums</th>
						<th style={{ textAlign: "right" }}>Platība, m²</th>
						<th style={{ textAlign: "right" }}>Augstums</th>
						<th>Lapa</th>
					</tr>
				</thead>
				<tbody>
					{t.rows.map((r, i) => (
						<tr key={i} className="click" onClick={() => ui.show({ kind: "source", sourceId: t.sourceId, page: r.page })}>
							<td>{r.floor}</td>
							<td>{r.no}</td>
							<td>{r.name}</td>
							<td style={{ textAlign: "right" }}>{r.area.toLocaleString("lv-LV", { minimumFractionDigits: 1 })}</td>
							<td style={{ textAlign: "right" }}>{r.height ?? ""}</td>
							<td>{r.page}</td>
						</tr>
					))}
				</tbody>
			</table>
			{t.unread.length > 0 && (
				<div className="err">
					Nenolasītas rindas ({t.unread.length}):
					{t.unread.map((u, i) => (
						<div key={i} className="mono small">
							lpp. {u.page}: {u.line}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
