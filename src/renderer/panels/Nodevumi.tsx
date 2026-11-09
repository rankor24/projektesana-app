// Nodevumi: deliveries read from 1.4_Nodevumi (and planned ones from the BIP grafiks or typed), each with its sheets;
// "Sagatavot" runs the checks for the delivery; "Atzīmēt kā nosūtītu" is the gate: only with no open findings, only by the user.
// Below: the TN and approval clocks.
import { useState } from "react";
import { BIM_STAGES, type Delivery, type Finding } from "../../core/model";
import type { ClockRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { Badge, Empty, Err, useLoad } from "../ui";
import { windows } from "../windows";
import { useUi } from "../state";

export function Nodevumi({ filter }: { filter?: string }) {
	const { projectId } = useUi();
	const list = useLoad<Delivery[]>(() => (projectId ? call("deliveries.list", projectId) : Promise.resolve([])), [projectId]);
	const findings = useLoad<Finding[]>(() => (projectId ? call("findings.list", projectId) : Promise.resolve([])), [projectId]);
	const [open, setOpen] = useState<string | null>(filter ?? null);
	const [err, setErr] = useState<string | null>(null);
	const [plan, setPlan] = useState({ kind: "MBP", date: "" });
	if (!projectId) return <Empty title="nav projekta" />;
	const act = (p: Promise<unknown>) => p.then(() => (list.reload(), findings.reload())).catch((e) => setErr(errText(e)));
	const openFor = (id: string) => (findings.data ?? []).filter((f) => f.state === "open" && f.severity === "error" && (f.where.deliveryId === id || !f.where.deliveryId));
	const rows = [...(list.data ?? [])].sort((a, b) => BIM_STAGES.indexOf(a.stage) - BIM_STAGES.indexOf(b.stage) || (a.submittedDate ?? a.plannedDate ?? "").localeCompare(b.submittedDate ?? b.plannedDate ?? ""));
	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			{list.error ? <Err error={list.error} /> : null}
			{rows.length === 0 && <Empty title="no data">1.4_Nodevumi vēl nav nodevumu (vai projekts nav nolasīts).</Empty>}
			{rows.map((d) => {
				const blocking = openFor(d.id);
				const last = d.checksRun[d.checksRun.length - 1];
				return (
					<div key={d.id} className="confirm" style={{ borderColor: d.sent ? "var(--ok)" : "var(--border)" }}>
						<div className="row">
							<Badge>{d.stage}</Badge>
							<b className="click" onClick={() => setOpen(open === d.id ? null : d.id)}>
								{open === d.id ? "▾" : "▸"} {d.label}
							</b>
							<span className="dim small">
								{d.submittedDate ? `mape ${d.submittedDate}` : "bez datuma mapes"}
								{d.plannedDate ? ` · plānots ${d.plannedDate}${d.plannedFrom === "bip" ? " (BIP)" : ""}` : ""} · {d.items.length} faili
							</span>
							{d.sent ? <Badge tone="ok">nosūtīts {d.sent.at.slice(0, 10)}</Badge> : last ? <Badge tone={last.open ? "bad" : "ok"}>pārbaudīts: {last.open} atvērti</Badge> : <Badge tone="dim">nav pārbaudīts</Badge>}
							<span className="grow" />
							{!d.sent && d.items.length > 0 && <button onClick={() => act(call("deliveries.prepare", projectId, d.id))}>Sagatavot (pārbaudīt)</button>}
							{!d.sent && d.items.length > 0 && (
								<button className="primary" disabled={!last || blocking.length > 0} title={blocking.length ? `${blocking.length} atvērti atradumi` : !last ? "vispirms sagatavo" : ""} onClick={() => act(call("deliveries.markSent", projectId, d.id))}>
									Atzīmēt kā nosūtītu
								</button>
							)}
							<input
								type="date"
								title="plānotais datums"
								defaultValue={d.plannedDate ?? ""}
								onBlur={(e) => e.target.value !== (d.plannedDate ?? "") && act(call("deliveries.setPlanned", projectId, d.id, e.target.value || null))}
							/>
						</div>
						{!d.sent && blocking.length > 0 && last && (
							<div className="small">
								<span className="err" style={{ display: "inline-block", margin: 0, padding: "2px 6px" }}>
									{blocking.length} atvērti atradumi kavē nosūtīšanu
								</span>{" "}
								<button className="small ghost" onClick={() => windows.open("prasibas", "findings")}>skatīt</button>
							</div>
						)}
						{open === d.id && (
							<table>
								<tbody>
									{d.items.map((i) => (
										<tr key={i.file}>
											<td className="mono small">{i.sheetNo ?? <Badge tone="warn">nav Nr.</Badge>}</td>
											<td>{i.title}</td>
											<td className="dim small mono">{i.file.split(/[\\/]/).pop()}</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				);
			})}
			<div className="row">
				<span className="dim small">Plānots nodevums:</span>
				<select value={plan.kind} onChange={(e) => setPlan({ ...plan, kind: e.target.value })}>
					{["SKICE", "MBP", "BP", "DT", "STARP"].map((k) => (
						<option key={k}>{k}</option>
					))}
				</select>
				<input type="date" value={plan.date} onChange={(e) => setPlan({ ...plan, date: e.target.value })} />
				<button disabled={!plan.date} onClick={() => act(call("deliveries.addPlanned", projectId, plan.kind, plan.date))}>Pievienot</button>
			</div>
			<Clocks projectId={projectId} />
		</div>
	);
}

function Clocks({ projectId }: { projectId: string }) {
	const clocks = useLoad<ClockRow[]>(() => call("timeline.clocks", projectId), [projectId]);
	const [draft, setDraft] = useState({ kind: "tn" as "tn" | "approval", issuer: "", issuerKind: "network_owner" as "state_municipal" | "network_owner", requestedOn: "" });
	const [err, setErr] = useState<string | null>(null);
	const act = (p: Promise<unknown>) => p.then(() => clocks.reload()).catch((e) => setErr(errText(e)));
	return (
		<>
			<div className="section-title">Tehnisko noteikumu un saskaņojumu termiņi (darbdienas)</div>
			{err && <div className="err">{err}</div>}
			<table>
				<tbody>
					{(clocks.data ?? []).map((c) => (
						<tr key={c.id}>
							<td>{c.label}</td>
							<td className="small">pieprasīts {c.requestedOn}</td>
							<td className="small">
								termiņš {c.due} <span className="dim">({c.point}{c.extended ? ", pagarināts līdz 20 d.d." : ""})</span>
							</td>
							<td>
								<Badge tone={c.state === "saņemts" ? "ok" : c.state === "kavē" ? "bad" : c.daysLeft <= 3 ? "warn" : "dim"} title={c.caveat}>
									{c.state === "saņemts" ? `saņemts ${c.receivedOn}` : c.state === "kavē" ? `kavē ${-c.daysLeft} d.d.` : `${c.daysLeft} d.d.`}
								</Badge>
							</td>
							<td>
								{!c.receivedOn && (
									<>
										<button className="small" onClick={() => act(call("clocks.update", projectId, c.id, { receivedOn: new Date().toISOString().slice(0, 10) }))}>saņemts šodien</button>
										<button className="small ghost" onClick={() => act(call("clocks.update", projectId, c.id, { extended: !c.extended }))}>{c.extended ? "11/15 d.d." : "pagarināts"}</button>
									</>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<div className="row">
				<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "tn" | "approval" })}>
					<option value="tn">TN pieprasījums</option>
					<option value="approval">saskaņojums</option>
				</select>
				<input className="grow" placeholder="izdevējs (piem., tīkla īpašnieks)" value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
				<select value={draft.issuerKind} onChange={(e) => setDraft({ ...draft, issuerKind: e.target.value as "state_municipal" | "network_owner" })}>
					<option value="network_owner">inženierbūves īpašnieks</option>
					<option value="state_municipal">valsts / pašvaldība</option>
				</select>
				<input type="date" value={draft.requestedOn} onChange={(e) => setDraft({ ...draft, requestedOn: e.target.value })} />
				<button disabled={!draft.issuer.trim() || !draft.requestedOn} onClick={() => act(call("clocks.add", projectId, draft)).then(() => setDraft({ ...draft, issuer: "", requestedOn: "" }))}>
					Pievienot
				</button>
			</div>
		</>
	);
}
