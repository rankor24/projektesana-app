// Versijas: "kas mainījās starp" two dates — sources, deliveries, revisions and the app's own data in one list, each linked
// to its compare view (sheet compare for PDFs, BimCraft's compare for IFC). Below: the project's IFC models, to open one or
// compare two.
import { useState } from "react";
import type { VersionRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const KIND: Record<VersionRow["kind"], string> = { source: "avots", delivery: "nodevums", revision: "revīzija", data: "dati" };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function Versijas() {
	const { projectId } = useUi();
	const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 86_400_000)));
	const [to, setTo] = useState(iso(new Date()));
	const rows = useLoad<VersionRow[]>(() => (projectId ? call("versions.between", projectId, from, to) : Promise.resolve([])), [projectId, from, to]);
	const models = useLoad(() => (projectId ? call("models.list", projectId) : Promise.resolve([])), [projectId]);
	const [pick, setPick] = useState<string[]>([]);
	if (!projectId) return <Empty title="nav projekta" />;
	const name = (rel: string) => models.data?.find((m) => m.rel === rel)?.name ?? rel;
	return (
		<div className="pane fill">
			<div className="row">
				<span>Kas mainījās starp</span>
				<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
				<span>un</span>
				<input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
				<span className="dim small">{rows.data?.length ?? 0} ieraksti</span>
			</div>
			{rows.error ? <Err error={rows.error} /> : null}
			{rows.data?.length === 0 && <Empty title="no data">Šajā laikā izmaiņu nav.</Empty>}
			<table>
				<tbody>
					{(rows.data ?? []).map((r, i) => (
						<tr key={i}>
							<td className="small dim" style={{ whiteSpace: "nowrap" }}>{r.at.slice(0, 10)}</td>
							<td>
								<Badge>{KIND[r.kind]}</Badge>
							</td>
							<td>
								{r.label}
								{r.detail && <div className="dim small">{r.detail}</div>}
							</td>
							<td style={{ whiteSpace: "nowrap" }}>
								{r.open?.sourceId && <button className="small ghost" onClick={() => ui.show({ kind: "source", sourceId: r.open!.sourceId! })}>atvērt</button>}
								{r.open?.ifc && <button className="small ghost" onClick={() => ui.show({ kind: "ifc", path: r.open!.ifc!, label: r.label })}>3D</button>}
								{r.compare && <button className="small" onClick={() => ui.show({ kind: "compare", ...r.compare! })}>salīdzināt</button>}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<RevitSection projectId={projectId} />
			<div className="section-title">Modeļi (IFC no 1.2_Projekta dalas)</div>
			{models.error ? <Err error={models.error} /> : null}
			{models.data?.length === 0 && <div className="dim small">no data: sadaļu mapēs IFC failu nav.</div>}
			<table>
				<tbody>
					{(models.data ?? []).map((m) => (
						<tr key={m.rel}>
							<td>
								<input type="checkbox" checked={pick.includes(m.rel)} onChange={(e) => setPick(e.target.checked ? [...pick, m.rel].slice(-2) : pick.filter((x) => x !== m.rel))} />
							</td>
							<td>{m.section}</td>
							<td>{m.name}</td>
							<td className="small dim">
								{(m.size / 1048576).toFixed(1)} MB · {m.mtime.slice(0, 10)}
							</td>
							<td>
								<button className="small" onClick={() => ui.show({ kind: "ifc", path: m.rel, label: m.name })}>3D</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{pick.length === 2 && (
				<button className="primary" onClick={() => ui.show({ kind: "compare", a: pick[0], b: pick[1], aLabel: name(pick[0]), bLabel: name(pick[1]), mode: "ifc" })}>
					Salīdzināt {name(pick[0])} → {name(pick[1])}
				</button>
			)}
		</div>
	);
}

/** Revit: the working copy (the agent edits only it), exports of a view and of IFC, and a revision Boris fixes himself. */
function RevitSection({ projectId }: { projectId: string }) {
	const status = useLoad(() => call("revit.status"), []);
	const [views, setViews] = useState<{ id: string; name: string; type: string }[] | null>(null);
	const [view, setView] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const run = (what: string, p: () => Promise<unknown>) => {
		setBusy(what);
		setMsg(null);
		p()
			.then((r) => setMsg(`${what}: ${typeof r === "string" ? r : "gatavs"}`))
			.catch((e) => setMsg(`${what}: ${errText(e)}`))
			.finally(() => setBusy(null));
	};
	const st = status.data;
	return (
		<>
			<div className="section-title">Revit</div>
			<div className="row small">
				<Badge tone={st?.state === "savienots" ? "ok" : "dim"}>{st?.state ?? "…"}</Badge>
				{st?.document && <span>{st.document}</span>}
				{st?.message && <span className="dim">{st.message}</span>}
			</div>
			{st?.state === "savienots" && (
				<>
					<div className="row">
						<button disabled={!!busy} title="Saglabā atvērto modeli kā <nosaukums>_WORK.rvt projekta datu mapē; aģents strādā tikai tajā" onClick={() => run("Darba kopija", () => call("revit.workCopy", projectId))}>
							Darba kopija
						</button>
						<button disabled={!!busy} onClick={() => run("IFC eksports", () => call("revit.exportIfc", projectId))}>IFC eksports</button>
						<button disabled={!!busy} onClick={() => run("Revīzija", () => call("revisions.capture", projectId, "Borisa saglabāta revīzija", []).then((r) => `${r.id}${r.diffFromPrev ? ` +${r.diffFromPrev.added} −${r.diffFromPrev.removed} ~${r.diffFromPrev.changed}` : ""}`))}>
							Fiksēt revīziju
						</button>
					</div>
					<div className="row">
						<button disabled={!!busy} onClick={() => run("Skati", () => call("revit.views").then((v) => (setViews(v), `${v.length} skati`)))}>Nolasīt skatus</button>
						{views && (
							<>
								<select value={view} onChange={(e) => setView(e.target.value)}>
									<option value="">— skats —</option>
									{views.map((v) => (
										<option key={v.id} value={v.id}>
											{v.type}: {v.name}
										</option>
									))}
								</select>
								<button disabled={!view || !!busy} onClick={() => run("PDF eksports", () => call("revit.exportView", projectId, view, views.find((v) => v.id === view)?.name ?? "skats"))}>
									PDF
								</button>
							</>
						)}
					</div>
				</>
			)}
			{busy && <div className="dim small">{busy}…</div>}
			{msg && <div className="small">{msg}</div>}
		</>
	);
}
