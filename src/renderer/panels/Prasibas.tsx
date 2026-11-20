// Prasības: the one requirements list (law by profile, PU, BIP, TN, permit, office) and the findings of the checks.
// Every row shows its citation; law points open on likumi.lv, document quotes open the page in the preview.
// Findings: the user overrides with a reason (the check is not changed), accepts the agent's proposed justification, reopens,
// or sends the finding to the agent's Fokuss.
import { useMemo, useState } from "react";
import { BIM_STAGES, USER_LABEL, type Finding, type Requirement, type Source } from "../../core/model";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { commentSubject } from "../comment-subject";
import { Badge, Empty, Err, useLoad } from "../ui";
import { Ekspertize } from "./Ekspertize";
import { locale, tr } from "../i18n";

const ORIGIN: Record<string, string> = { law: tr("likums"), pu: tr("PU"), bip: tr("BIP"), tn: tr("TN"), permit: tr("atļauja"), office: tr("birojs") };
const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "dim" | "info" }> = {
	open: { label: tr("nav pārbaudīts"), tone: "dim" },
	met: { label: tr("izpildīts"), tone: "ok" },
	failed: { label: tr("neizpildīts"), tone: "bad" },
	justified: { label: tr("pamatots"), tone: "info" },
};

export function Prasibas({ filter }: { filter?: string }) {
	const { projectId } = useUi();
	const [tab, setTab] = useState<"req" | "findings" | "expert">(filter === "findings" ? "findings" : filter === "expert" ? "expert" : "req");
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return (
		<div className="fill-col">
			<div className="tabs">
				<button className={tab === "req" ? "on" : ""} onClick={() => setTab("req")}>{tr("Prasības")}</button>
				<button className={tab === "findings" ? "on" : ""} onClick={() => setTab("findings")}>{tr("Atradumi")}</button>
				<button className={tab === "expert" ? "on" : ""} onClick={() => setTab("expert")} title={tr("Ekspertīzes atzinuma piezīmes pa daļām un atbildīgajiem")}>{tr("Ekspertīze")}</button>
			</div>
			{tab === "req" ? <Requirements projectId={projectId} /> : tab === "findings" ? <Findings projectId={projectId} /> : <Ekspertize projectId={projectId} />}
		</div>
	);
}

function Citation({ r, title }: { r: Requirement; title: (id: string) => string }) {
	const c = r.citation;
	if (c.kind === "law")
		return (
			<div className="small">
				<a href={c.url} target="_blank" rel="noreferrer">
					{c.act} {c.point}
				</a>{" "}
				<span className="dim">
					{tr("· nolasīts {readOn}", { readOn: c.readOn })}{c.actVersionDate ? tr(" · redakcija no {actVersionDate}", { actVersionDate: c.actVersionDate }) : tr(" · redakcijas datums nav nolasīts")}
				</span>
				<div className="quote">{c.quote}</div>
			</div>
		);
	if (c.kind === "office")
		return (
			<div className="small">
				{tr("biroja standarts, lpp. {page}", { page: c.page })} <span className="dim mono">{c.file}</span>
				<div className="quote">{c.quote}</div>
			</div>
		);
	return (
		<div className="small">
			<button className="ghost small" onClick={() => ui.show({ kind: "source", sourceId: c.sourceId, page: c.page })}>
				{tr("{sourceId}, lpp. {page}", { sourceId: title(c.sourceId), page: c.page })}</button>
			<div className="quote">{c.quote}</div>
		</div>
	);
}

function Requirements({ projectId }: { projectId: string }) {
	const reqs = useLoad<Requirement[]>(() => call("requirements.list", projectId), [projectId]);
	const notes = useLoad<string[]>(() => call("requirements.notes", projectId), [projectId]);
	const sources = useLoad<Source[]>(() => call("sources.list", projectId), [projectId]);
	const [f, setF] = useState({ origin: "", stage: "", section: "", status: "", state: "active", q: "" });
	const [open, setOpen] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const title = (id: string) => sources.data?.find((s) => s.id === id)?.title ?? id;
	const sections = useMemo(() => [...new Set((reqs.data ?? []).flatMap((r) => r.appliesTo.sections ?? []))].sort(), [reqs.data]);
	const rows = (reqs.data ?? []).filter(
		(r) =>
			(!f.origin || r.origin === f.origin) &&
			(!f.stage || !r.appliesTo.stages || r.appliesTo.stages.includes(f.stage as never)) &&
			(!f.section || r.appliesTo.sections?.includes(f.section)) &&
			(!f.status || r.status === f.status) &&
			(f.state === "all" || (f.state === "active" ? r.state !== "rejected" : r.state === f.state)) &&
			(!f.q || `${r.text} ${r.citation.quote}`.toLowerCase().includes(f.q.toLowerCase())),
	);
	const act = (p: Promise<unknown>) => p.then(() => reqs.reload()).catch((e) => setErr(errText(e)));
	return (
		<div className="pane fill">
			<div className="row">
				<button
					className="primary"
					disabled={busy}
					onClick={() => {
						setBusy(true);
						act(call("requirements.refresh", projectId)).finally(() => (setBusy(false), notes.reload()));
					}}
				>
					{busy ? tr("atjauno…") : tr("Atjaunot no profila un dokumentiem")}
				</button>
				<select value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })}>
					<option value="">{tr("visi avoti")}</option>
					{Object.entries(ORIGIN).map(([k, v]) => (
						<option key={k} value={k}>{v}</option>
					))}
				</select>
				<select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>
					<option value="">{tr("visas stadijas")}</option>
					{BIM_STAGES.map((s) => (
						<option key={s}>{s}</option>
					))}
				</select>
				<select value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })}>
					<option value="">{tr("visas sadaļas")}</option>
					{sections.map((s) => (
						<option key={s}>{s}</option>
					))}
				</select>
				<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
					<option value="">{tr("jebkāds statuss")}</option>
					{Object.entries(STATUS).map(([k, v]) => (
						<option key={k} value={k}>{v.label}</option>
					))}
				</select>
				<select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
					<option value="active">{tr("bez noraidītajām")}</option>
					<option value="proposed">{tr("tikai priekšlikumi")}</option>
					<option value="confirmed">{tr("tikai apstiprinātās")}</option>
					<option value="rejected">{tr("noraidītās")}</option>
					<option value="all">{tr("visas")}</option>
				</select>
				<input className="grow" placeholder={tr("meklēt…")} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
				<span className="dim small">{rows.length} / {reqs.data?.length ?? 0}</span>
			</div>
			{err && <div className="err">{err}</div>}
			{reqs.error ? <Err error={reqs.error} /> : null}
			{notes.data?.map((n) => (
				<div key={n} className="dim small">⚠ {n}</div>
			))}
			{reqs.data?.length === 0 && <Empty title={tr("no data")}>{tr("Prasību vēl nav. Apstiprini profilu panelī Projekts un spied “Atjaunot”.")}</Empty>}
			{rows.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>{tr("Avots")}</th>
							<th>{tr("Prasība")}</th>
							<th>{tr("Attiecas")}</th>
							<th>{tr("Statuss")}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.id} className={`click ${open === r.id ? "sel" : ""}`} onClick={() => (setOpen(open === r.id ? null : r.id), commentSubject.pick({ thing: "requirement", id: r.id }, `prasība: ${r.text.slice(0, 40)}`))}>
								<td>
									<Badge>{ORIGIN[r.origin]}</Badge>
								</td>
								<td>
									{r.text}
									{open === r.id && <Citation r={r} title={title} />}
									{open === r.id && r.evidence.length > 0 && (
										<div className="small">
											{r.evidence.map((e) => (
												<div key={e}>✓ {e}</div>
											))}
										</div>
									)}
								</td>
								<td className="small dim">
									{[...(r.appliesTo.deliveries ?? []), ...(r.appliesTo.sections ?? [])].join(" · ") || (r.appliesTo.stages ?? []).join(", ") || tr("viss projekts")}
								</td>
								<td>
									<Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
									{r.state === "proposed" && <Badge tone="warn">{tr("priekšlikums")}</Badge>}
									{r.state === "rejected" && <Badge tone="dim">{tr("noraidīts")}</Badge>}
								</td>
								<td onClick={(e) => e.stopPropagation()}>
									{r.state === "proposed" && r.origin !== "law" && (
										<div className="row">
											<button className="small" onClick={() => act(call("requirements.decide", projectId, r.id, "confirmed"))}>{tr("Apstiprināt")}</button>
											<button className="small ghost" onClick={() => act(call("requirements.decide", projectId, r.id, "rejected"))}>{tr("Noraidīt")}</button>
										</div>
									)}
									{r.state === "rejected" && <button className="small ghost" onClick={() => act(call("requirements.decide", projectId, r.id, "confirmed"))}>{tr("Atjaunot")}</button>}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

const SEV: Record<string, "bad" | "warn" | "info"> = { error: "bad", warning: "warn", info: "info" };

function Findings({ projectId }: { projectId: string }) {
	const findings = useLoad<Finding[]>(() => call("findings.list", projectId), [projectId]);
	const [show, setShow] = useState<"open" | "overridden" | "closed" | "all">("open");
	const [reason, setReason] = useState<Record<string, string>>({});
	const [err, setErr] = useState<string | null>(null);
	const act = (p: Promise<unknown>) => p.then(() => findings.reload()).catch((e) => setErr(errText(e)));
	const rows = (findings.data ?? []).filter((f) => show === "all" || f.state === show).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={() => act(call("findings.runAll", projectId))}>{tr("Palaist visas pārbaudes")}</button>
				<button title={tr("Atvērtie un pieņemtie atradumi kā BCF 2.1 (Solibri, Navisworks, BimCraft)")} onClick={() => act(call("bcf.export", projectId, null))}>{tr("BCF eksports")}</button>
				<button
					title={tr("BCF tēmas no Solibri / Navisworks kā atradumi, sakārtoti pa disciplīnām")}
					onClick={async () => {
						const f = await call("dialog.pickFile", "BCF fails", ["bcf", "bcfzip"]);
						if (f) act(call("bcf.import", projectId, f).then((r) => alert(tr("Importētas {topics} tēmas: {byDiscipline}", { topics: r.topics, byDiscipline: Object.entries(r.byDiscipline).map(([k, n]) => `${k} ${n}`).join(", ") }))));
					}}
				>
					{tr("BCF imports")}</button>
				{(["open", "overridden", "closed", "all"] as const).map((s) => (
					<button key={s} className={show === s ? "primary" : ""} onClick={() => setShow(s)}>
						{s === "open" ? tr("atvērtie") : s === "overridden" ? tr("pieņemtie") : s === "closed" ? tr("novērstie") : tr("visi")} ({(findings.data ?? []).filter((f) => s === "all" || f.state === s).length})
					</button>
				))}
			</div>
			{err && <div className="err">{err}</div>}
			{findings.error ? <Err error={findings.error} /> : null}
			{rows.length === 0 && <Empty title={show === "open" ? tr("atvērto atradumu nav") : tr("no data")} />}
			{rows.map((f) => (
				<div key={f.id} className="confirm" onClick={() => commentSubject.pick({ thing: "finding", id: f.id }, `atradums: ${f.message.slice(0, 40)}`)} style={{ borderColor: f.state === "open" ? (f.severity === "error" ? "var(--bad)" : "var(--warn)") : "var(--border)" }}>
					<div className="row">
						<Badge tone={SEV[f.severity]}>{f.severity}</Badge>
						<span className="mono small dim">{f.checkId}</span>
						<span className="grow">{f.message}</span>
						{f.where.sourceId && (
							<button className="small ghost" onClick={() => ui.show({ kind: "source", sourceId: f.where.sourceId!, page: f.where.page })}>{tr("atvērt")}</button>
						)}
						<button className="small" title={tr("Pievieno Fokusam; aģents redz šo atradumu")} onClick={() => ui.focusAdd({ kind: "finding", id: f.id, label: f.message.slice(0, 60), data: { checkId: f.checkId, requirementId: f.requirementId, where: f.where, message: f.message } })}>
							{tr("→ aģentam")}</button>
					</div>
					{f.requirementId && <div className="small dim">{tr("prasība: {requirementId}", { requirementId: f.requirementId })}</div>}
					{f.decision && (
						<div className="small">
							{f.decision.name || USER_LABEL} {new Date(f.decision.at).toLocaleDateString(locale())}: <i>{f.decision.reason}</i>
						</div>
					)}
					{f.proposal && f.state === "open" && (
						<div className="small">
							{tr("Aģenta pamatojums:")} <i>{f.proposal.reason}</i>{" "}
							<button className="small" onClick={() => act(call("findings.override", projectId, f.id, f.proposal!.reason))}>{tr("Pieņemt šo pamatojumu")}</button>
						</div>
					)}
					{(f.severity === "info" || f.checkId === "bcf" || f.state === "closed") && (
						<div className="row">
							<span className="grow small dim">{f.severity === "info" && f.state === "open" ? tr("Informācija: neaptur nodevumu.") : ""}</span>
							<button
								className="small ghost"
								title={f.severity === "info" && f.state === "open" ? tr("Noņem šo piezīmi. Tā pati neparādīsies atkal; ja vērtības mainās, parādīsies jauna.") : tr("Noņem no saraksta (žurnālā paliek).")}
								onClick={() => confirm(tr("Noņemt atradumu?") + "\n\n" + f.message.slice(0, 200)) && act(call("findings.remove", projectId, f.id))}
							>
								{tr("Noņemt")}</button>
						</div>
					)}
					{f.state === "open" && f.severity === "info" ? null : f.state === "open" ? (
						<div className="row">
							<input className="grow" placeholder={tr("Pamatojums, kāpēc šī situācija ir pieļaujama (obligāts)")} value={reason[f.id] ?? ""} onChange={(e) => setReason({ ...reason, [f.id]: e.target.value })} />
							<button disabled={(reason[f.id] ?? "").trim().length < 5} onClick={() => act(call("findings.override", projectId, f.id, reason[f.id]))}>{tr("Pieņemt ar pamatojumu")}</button>
						</div>
					) : f.state === "overridden" ? (
						<button className="small ghost" onClick={() => act(call("findings.reopen", projectId, f.id))}>{tr("Atvērt atkal")}</button>
					) : null}
				</div>
			))}
		</div>
	);
}
