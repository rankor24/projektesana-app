// The sheet compare's "Izsekot modelī" section (task 8.11): the labelled changes of the sheet traced to elements of a model; with
// the older model too, also to the elements round them that changed between the two. A match opens in 3D with the element selected.
import { useState } from "react";
import type { ModelRow } from "../../shared/api";
import type { TraceView } from "../../shared/trace-types";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { useLoad } from "../ui";

const label = (m: ModelRow) => `${m.origin}${m.section ? ` · ${m.section}` : ""} · ${m.name}`;

export function TracePanel({ projectId, a, b }: { projectId: string; a: string; b: string }) {
	const models = useLoad<ModelRow[]>(() => call("models.list", projectId), [projectId]);
	const [nw, setNw] = useState("");
	const [old, setOld] = useState("");
	const [view, setView] = useState<TraceView | null>(null);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const list = (models.data ?? []).filter((m) => !m.archived);
	const nameOf = (rel: string) => list.find((m) => m.rel === rel)?.name ?? rel;

	const run = () => {
		setBusy(true);
		setErr(null);
		call("sheets.trace", projectId, a, b, nw, old || null)
			.then(setView)
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};
	const open = (guid: string) => {
		ui.highlightNext([guid]);
		ui.show({ kind: "ifc", path: nw, label: nameOf(nw) });
	};

	return (
		<div>
			<div className="section-title">Izsekot modelī</div>
			<div className="dim small">Katras izmainītās iezīmes (telpas numurs, nosaukums, durvju marka) elements tiek meklēts modelī. Ar vecāko modeli tiek parādīti arī elementi tā tuvumā, kas starp versijām mainījušies.</div>
			<div className="row">
				<select className="grow" value={nw} onChange={(e) => setNw(e.target.value)}>
					<option value="">jaunākais modelis…</option>
					{list.map((m) => (
						<option key={m.rel} value={m.rel}>
							{label(m)}
						</option>
					))}
				</select>
			</div>
			<div className="row">
				<select className="grow" value={old} onChange={(e) => setOld(e.target.value)}>
					<option value="">vecākais modelis (nav obligāts)…</option>
					{list
						.filter((m) => m.rel !== nw)
						.map((m) => (
							<option key={m.rel} value={m.rel}>
								{label(m)}
							</option>
						))}
				</select>
				<button className="primary" disabled={!nw || busy} onClick={run}>
					{busy ? "Meklē…" : "Izsekot"}
				</button>
			</div>
			{err && <div className="err">{err}</div>}
			{view && (
				<>
					<div className="small dim">{view.rows.length < view.total ? `Apstrādātas pirmās ${view.rows.length} no ${view.total} iezīmēm.` : `${view.total} iezīmes.`}</div>
					{view.rows.map((r) => (
						<div key={r.item.id} className="text-page small" style={{ margin: "6px 0", padding: 8 }}>
							<div>
								<b>{r.sheetNo ?? `lpp. ${r.page}`}</b> {r.item.kind === "area" ? "platība" : "teksts"}: {r.item.old ?? "—"} → {r.item.new ?? "—"}
								<div className="dim">iezīmes: {r.tokens.join(", ") || "nav"}</div>
							</div>
							{r.matches.length === 0 && <div className="warn-text">Modelī nekas ar šīm iezīmēm netika atrasts: nav ko parādīt (vai tās nav modelī).</div>}
							{r.matches.map((m) => (
								<div key={m.guid} style={{ marginTop: 4 }}>
									{m.lines.map((l, k) => (
										<div key={k} className={k === 0 ? "" : "dim"} style={{ whiteSpace: "pre-wrap" }}>
											{k === 0 ? <b>{l}</b> : l}
										</div>
									))}
									<button className="small" onClick={() => open(m.guid)}>
										3D
									</button>
								</div>
							))}
						</div>
					))}
					{view.untraceable.length > 0 && (
						<details>
							<summary className="dim small">Nav izsekojams: {view.untraceable.length}</summary>
							{view.untraceable.map((u, k) => (
								<div key={k} className="small dim">
									{u.sheetNo ?? ""} {u.text}: {u.why}
								</div>
							))}
						</details>
					)}
				</>
			)}
		</div>
	);
}
