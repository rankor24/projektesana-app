// Telpas: the inventory room table read from the property documents (1.10), with the sum check and the Excel export.
// Task 3.2 adds the comparison with the Revit model rooms.
import { useState } from "react";
import type { InventoryTable } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

export function Telpas() {
	const { projectId } = useUi();
	const tables = useLoad<InventoryTable[]>(() => (projectId ? call("rooms.table", projectId) : Promise.resolve([])), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <Empty title="nav projekta" />;
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
