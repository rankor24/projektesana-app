// Nodevumi (work plan 7.7): where a delivery is made. "Nodot projektu" starts a draft; its checklist (law items for the kind,
// Revit sheets, IFC, TN and approvals) is filled with the agent in a staging folder; then the user's three clicks:
// Sagatavot (checks) → Kopēt uz 1.4_Nodevumi (shows the exact target first) → Atzīmēt kā nosūtītu. Past deliveries read from
// 1.4_Nodevumi and planned ones sit below; the TN and approval clocks too.
import { useMemo, useState } from "react";
import { BIM_STAGES, type Delivery, type Finding } from "../../core/model";
import type { ClockRow } from "../../shared/api";
import type { ChecklistGroup, ChecklistRow, CopyPlan, RowStatus } from "../../shared/nodevums";
import { validName, type RenameMode, type RenameResult, type RenameRow } from "../../shared/rename";
import { markaByCode, markaOfDeliveryFile, markasOfDelivery } from "../../shared/markas";
import { call, errText } from "../bridge";
import { Badge, Empty, Err, useLoad } from "../ui";
import { windows } from "../windows";
import { commentSubject } from "../comment-subject";
import { ui, useUi } from "../state";
import { tr } from "../i18n";

const KINDS = ["MBP", "BP", "SKICE", "DT", "STARP"] as const;
const GROUPS: ChecklistGroup[] = ["Lapas", "Modelis", "Likums", "Saskaņojumi"];
const TONE: Record<RowStatus, "ok" | "info" | "warn" | "bad" | "dim"> = { gatavs: "ok", pamatots: "info", pārbaudi: "warn", trūkst: "bad", neobligāts: "dim" };
const todayIso = () => new Date().toISOString().slice(0, 10);
const mb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function Nodevumi({ filter }: { filter?: string }) {
	const { projectId } = useUi();
	const list = useLoad<Delivery[]>(() => (projectId ? call("deliveries.list", projectId) : Promise.resolve([])), [projectId]);
	const findings = useLoad<Finding[]>(() => (projectId ? call("findings.list", projectId) : Promise.resolve([])), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	const reload = () => (list.reload(), findings.reload());
	const all = list.data ?? [];
	const active = all.filter((d) => d.draft && !d.sent).sort((a, b) => (filter === a.id ? -1 : filter === b.id ? 1 : b.draft!.startedAt.localeCompare(a.draft!.startedAt)));
	const history = all
		.filter((d) => !active.includes(d))
		.sort((a, b) => BIM_STAGES.indexOf(a.stage) - BIM_STAGES.indexOf(b.stage) || (a.submittedDate ?? a.plannedDate ?? "").localeCompare(b.submittedDate ?? b.plannedDate ?? ""));
	const blockingFor = (id: string) => (findings.data ?? []).filter((f) => f.state === "open" && f.severity === "error" && (f.where.deliveryId === id || !f.where.deliveryId));
	const start = (kind: string, date: string) =>
		call("deliveries.start", projectId, kind, date)
			.then(() => (setErr(null), reload()))
			.catch((e) => setErr(errText(e)));

	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			{list.error ? <Err error={list.error} /> : null}
			{active.length === 0 && (
				<div className="confirm" style={{ gap: 8 }}>
					<b style={{ fontSize: "1.1em" }}>{tr("Nodot projektu")}</b>
					<span className="dim small">
						{tr("Izvēlies nodevuma veidu un datumu. Lietotne izveido sarakstu ar to, kas šim nodevumam jāsatur (MK 529, lapas, IFC, TN), un aģents to kopā ar tevi aizpilda atsevišķā mapē. Uz 1.4_Nodevumi tas nonāk tikai ar tavu klikšķi.")}</span>
					<StartForm onStart={start} />
				</div>
			)}
			{active.map((d) => (
				<DraftCard key={d.id} d={d} projectId={projectId} blocking={blockingFor(d.id)} onChanged={reload} />
			))}
			{active.length > 0 && (
				<details>
					<summary className="dim small click">{tr("+ vēl viens nodevums")}</summary>
					<StartForm onStart={start} />
				</details>
			)}
			<details open={active.length === 0 && history.length > 0}>
				<summary className="section-title click">{tr("Iepriekšējie un plānotie nodevumi ({v})", { v: history.length })}</summary>
				{history.length === 0 ? (
					<span className="dim small">{tr("1.4_Nodevumi vēl nav nodevumu.")}</span>
				) : (
					history.map((d) => <HistoryRow key={d.id} d={d} projectId={projectId} blocking={blockingFor(d.id)} onStart={start} onChanged={reload} onErr={setErr} />)
				)}
			</details>
			<details>
				<summary className="section-title click">{tr("Tehnisko noteikumu un saskaņojumu termiņi (darbdienas)")}</summary>
				<Clocks projectId={projectId} />
			</details>
		</div>
	);
}

function StartForm({ onStart }: { onStart: (kind: string, date: string) => void }) {
	const [kind, setKind] = useState<string>("MBP");
	const [date, setDate] = useState(todayIso());
	return (
		<div className="row">
			<select value={kind} onChange={(e) => setKind(e.target.value)} title={tr("nodevuma veids")}>
				{KINDS.map((k) => (
					<option key={k}>{k}</option>
				))}
			</select>
			<input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={tr("nodevuma datums (mapes YYMMDD)")} />
			<button className="primary" disabled={!date} onClick={() => onStart(kind, date)}>
				{tr("Nodot projektu")}</button>
		</div>
	);
}

function DraftCard({ d, projectId, blocking, onChanged }: { d: Delivery; projectId: string; blocking: Finding[]; onChanged: () => void }) {
	const draft = d.draft!;
	const [withRevit, setWithRevit] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [copyOpen, setCopyOpen] = useState(false);
	const [part, setPart] = useState("AR");
	const checklist = useLoad(() => call("deliveries.checklist", projectId, d.id, withRevit), [projectId, d.id, withRevit, d.items.length, d.checksRun.length]);
	const plan = useLoad<CopyPlan | null>(() => (copyOpen ? call("deliveries.copyPlan", projectId, d.id) : Promise.resolve(null)), [projectId, d.id, copyOpen, d.items.length, d.checksRun.length]);
	const run = async (label: string, fn: () => Promise<unknown>, done?: (r: unknown) => string | null) => {
		setBusy(label);
		setErr(null);
		setNote(null);
		try {
			const r = await fn();
			setNote(done?.(r) ?? null);
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(null);
			onChanged();
			checklist.reload();
			plan.reload();
		}
	};
	const rows = checklist.data?.rows ?? [];
	const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
	const last = d.checksRun[d.checksRun.length - 1];
	const copied = !!draft.copiedTo;
	const canSend = copied && !!last && blocking.length === 0;
	const toAgent = () => ui.focusAdd({ kind: "delivery", id: d.id, label: `nodevums ${d.label}`, data: { kind: d.kind, date: draft.date, stagingDir: draft.stagingDir, copiedTo: draft.copiedTo } });
	const pickFile = () =>
		call("dialog.pickFile", "Pievienot nodevumam", ["*"])
			.then((p) => (p ? run("Pievieno", () => call("deliveries.stageFile", projectId, d.id, p), () => `Pievienots: ${fileName(p)}`) : undefined))
			.catch((e) => setErr(errText(e)));

	return (
		<div className="confirm" style={{ borderColor: copied ? "var(--ok)" : "var(--accent)" }}>
			<div className="row">
				<Badge>{d.kind}</Badge>
				<b>{d.label}</b>
				<span className="dim small">
					{tr("{stage} · datums {date} · {v} faili", { stage: d.stage, date: draft.date, v: d.items.length })}</span>
				<span className="grow" />
				<button className="small ghost" title={tr("Pievieno Fokusam; tad aģenta dokā uzdevums “Nodot projektu”")} onClick={toAgent}>
					{tr("→ aģentam")}</button>
				{!copied && (
					<button className="small ghost" onClick={() => run("Atver", () => call("deliveries.openStaging", projectId, d.id))}>
						{tr("Atvērt mapi")}</button>
				)}
			</div>

			<div className="row small">
				<Step n={1} on={!last && !copied} done={rows.length > 0 && count("trūkst") === 0}>
					{tr("Gatavo:")} {count("gatavs") + count("pamatots")} {tr("gatavi, {v} trūkst, {v2} pārbaudīt", { v: count("trūkst"), v2: count("pārbaudi") })}</Step>
				<Step n={2} on={!!last && !copied} done={!!last && last.open === 0}>
					{last ? tr("Pārbaudīts: {open} atvērti", { open: last.open }) : tr("Sagatavot")}
				</Step>
				<Step n={3} on={copied && !d.sent} done={copied}>
					{copied ? tr("Nokopēts: {copiedTo}", { copiedTo: draft.copiedTo }) : tr("Kopēt uz 1.4")}
				</Step>
				<Step n={4} on={false} done={!!d.sent}>
					{tr("Nosūtīts")}</Step>
			</div>

			{busy && <span className="dim small">{busy}…</span>}
			{note && <span className="small" style={{ color: "var(--ok)" }}>{note}</span>}
			{err && <div className="err">{err}</div>}
			{checklist.error ? <Err error={checklist.error} /> : null}

			<div className="row">
				{!copied && (
					<button disabled={!!busy || d.items.length === 0} title={d.items.length ? "" : tr("nodevumā nav failu")} onClick={() => run(tr("Pārbauda"), () => call("deliveries.prepare", projectId, d.id), (r) => tr("Pārbaudīts: {open} atvērti atradumi", { open: (r as { open: number }).open }))}>
						{tr("Sagatavot (pārbaudīt)")}</button>
				)}
				{!copied && (
					<button disabled={!!busy || !last} title={last ? "" : tr("vispirms sagatavo")} onClick={() => setCopyOpen(!copyOpen)}>
						{tr("Kopēt uz 1.4_Nodevumi…")}</button>
				)}
				<button className="primary" disabled={!!busy || !canSend} title={!copied ? tr("vispirms nokopē uz 1.4_Nodevumi") : blocking.length ? tr("{length} atvērti atradumi", { length: blocking.length }) : ""} onClick={() => run(tr("Atzīmē"), () => call("deliveries.markSent", projectId, d.id))}>
					{tr("Atzīmēt kā nosūtītu")}</button>
				{last && blocking.length > 0 && (
					<button className="small ghost" onClick={() => windows.open("prasibas", "findings")}>
						{tr("{v} atvērti atradumi — skatīt", { v: blocking.length })}</button>
				)}
			</div>

			{copyOpen && !copied && (
				<div className="confirm" style={{ borderColor: plan.data?.blockers.length ? "var(--bad)" : "var(--ok)" }}>
					{!plan.data ? (
						<span className="dim small">…</span>
					) : plan.data.blockers.length ? (
						<>
							<b className="small">{tr("Kopēt vēl nevar:")}</b>
							<ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
								{plan.data.blockers.map((b) => (
									<li key={b}>{b}</li>
								))}
							</ul>
						</>
					) : (
						<>
							<span className="small">
								{tr("Kopēs {files} failus ({bytes}) uz jaunu mapi biroja projektā. Nekas netiek pārrakstīts; katrs fails tiek salīdzināts ar oriģinālu.", { files: plan.data.files, bytes: mb(plan.data.bytes) })}</span>
							<span className="mono small">{plan.data.target}</span>
							<div className="row">
								<button className="primary" disabled={!!busy} onClick={() => run(tr("Kopē"), () => call("deliveries.copy", projectId, d.id), (r) => tr("Nokopēti {files} faili", { files: (r as { files: number }).files })).then(() => setCopyOpen(false))}>
									{tr("Kopēt")}</button>
								<button className="ghost" onClick={() => setCopyOpen(false)}>
									{tr("Atcelt")}</button>
							</div>
						</>
					)}
				</div>
			)}

			{GROUPS.map((g) => {
				const rs = rows.filter((r) => r.group === g);
				if (!rs.length) return null;
				return (
					<div key={g}>
						<div className="section-title">
							{tr(g)}
							{g === "Lapas" && (
								<span className="dim small" style={{ fontWeight: 400, marginLeft: 8 }}>
									{withRevit ? (checklist.data?.revitNote ? tr("Revit: {revitNote}", { revitNote: checklist.data.revitNote }) : tr("salīdzināts ar atvērto modeli")) : ""}
								</span>
							)}
						</div>
						<table>
							<tbody>
								{rs.map((r) => (
									<ChecklistLine
										key={r.id}
										r={r}
										busy={!!busy || copied}
										withRevit={withRevit}
										part={part}
										setPart={setPart}
										onCompare={() => setWithRevit(true)}
										onSheets={(replace) => run(tr("Eksportē lapas no Revit"), () => call("deliveries.stageSheets", projectId, d.id, { replace }), (x) => {
											const s = x as { exported: string[]; kept: string[]; unknown: string[]; total: number };
											return tr("Lapas: eksportētas {exported}, atstātas {kept} (no {total})", { exported: s.exported.length, kept: s.kept.length, total: s.total });
										})}
										onIfc={(replace) => run(tr("Eksportē IFC"), () => call("deliveries.stageIfc", projectId, d.id, { part, replace }), (x) => tr("IFC: {file}", { file: fileName((x as { file: string }).file) }))}
										onFile={pickFile}
										onPick={() => commentSubject.pick({ thing: "item", delivery: d.id, item: r.id }, `punkts: ${r.label.slice(0, 40)}`)}
										onAgent={() =>
											ui.focusAdd({ kind: r.requirementId ? "requirement" : "delivery", id: r.requirementId ?? `${d.id}:${r.id}`, label: `${r.citation ? `${r.citation}: ` : ""}${r.label.slice(0, 60)}`, data: { deliveryId: d.id, status: r.status, detail: r.detail } })
										}
									/>
								))}
							</tbody>
						</table>
					</div>
				);
			})}

			<div className="section-title">
				{tr("Faili nodevumā ({v})", { v: d.items.length })}{!copied && (
					<button className="small ghost" style={{ marginLeft: 8 }} disabled={!!busy} onClick={pickFile}>
						{tr("+ fails")}</button>
				)}
			</div>
			{!copied && d.items.length > 0 && <RenamePanel projectId={projectId} deliveryId={d.id} busy={!!busy} run={run} />}
			{d.items.length === 0 ? (
				<span className="dim small">{tr("Vēl nav failu. Eksportē lapas no Revit vai pievieno failu; aģentam — uzdevums “Nodot projektu”.")}</span>
			) : (
				<table>
					<tbody>
						{d.items.map((i) => (
							<tr key={i.file}>
								<td className="mono small">{i.sheetNo ?? <Badge tone="dim">—</Badge>}</td>
								<td>{i.title}</td>
								<td className="dim small mono">{fileName(i.file)}</td>
								<td>
									{!copied && (
										<button
											className="small ghost"
											title={tr("Izņemt no nodevuma")}
											disabled={!!busy}
											onClick={() => window.confirm(tr("Izņemt “{file}” no nodevuma?", { file: fileName(i.file) })) && run(tr("Izņem"), () => call("deliveries.unstage", projectId, d.id, fileName(i.file)))}
										>
											✕
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

type RunFn = (label: string, fn: () => Promise<unknown>, done?: (r: unknown) => string | null) => Promise<void>;
const RENAME_TONE = { same: "dim", rename: "ok", input: "warn", conflict: "bad" } as const;
const RENAME_LABEL = { same: tr("kārtībā"), rename: tr("pārdēvēs"), input: tr("jānorāda"), conflict: tr("konflikts") } as const;

/** Pārdēvēt (8.12): the plan first (old → new), the user fixes what could not be decided, then Piemērot; Atsaukt takes the batch back. */
function RenamePanel({ projectId, deliveryId, busy, run }: { projectId: string; deliveryId: string; busy: boolean; run: RunFn }) {
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<RenameMode>("office");
	const [revision, setRevision] = useState("01");
	const [typed, setTyped] = useState<Record<string, string>>({});
	const [batch, setBatch] = useState<string | null>(null);
	const plan = useLoad<RenameRow[]>(() => (open ? call("deliveries.renamePlan", projectId, deliveryId, mode, revision) : Promise.resolve([])), [projectId, deliveryId, open, mode, revision]);
	const rows = plan.data ?? [];
	const needsName = (r: RenameRow) => r.status === "input" || r.status === "conflict";
	// what each row will really become: the typed name wins for rows that needed one
	const target = (r: RenameRow) => (needsName(r) ? (typed[r.file] ?? "").trim() : r.to ?? "");
	const problem = (r: RenameRow): string | null => {
		if (!needsName(r)) return null;
		const t = target(r);
		return t ? validName(t) : null; // empty = left alone
	};
	const pairs = rows.filter((r) => r.status === "rename" || (needsName(r) && target(r) && !problem(r))).map((r) => ({ file: r.file, to: target(r) }));
	const bad = rows.some((r) => problem(r));
	const close = () => {
		setOpen(false);
		setTyped({});
	};
	const undo = () =>
		run("Atsauc", () => call("deliveries.renameUndo", projectId, deliveryId, batch!), (r) => {
			const x = r as { reverted: number; errors: string[] };
			setBatch(null);
			return `Atsaukti ${x.reverted}${x.errors.length ? `; ${x.errors.join("; ")}` : ""}`;
		});
	if (!open)
		return (
			<div style={{ margin: "6px 0" }}>
				<button className="small ghost" disabled={busy} onClick={() => setOpen(true)} title={tr("Nosaukumi pēc biroja kārtības vai BIS augšupielādei")}>
					{tr("Pārdēvēt")}</button>
				{batch && (
					<button className="small ghost" style={{ marginLeft: 8 }} disabled={busy} onClick={undo}>
						{tr("Atsaukt pēdējo pārdēvēšanu")}</button>
				)}
			</div>
		);
	return (
		<div className="card" style={{ margin: "6px 0", padding: 8 }}>
			<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
				<b>{tr("Pārdēvēt")}</b>
				<select value={mode} onChange={(e) => setMode(e.target.value as RenameMode)}>
					<option value="office">{tr("Biroja kārta: LAPAS-NR_nosaukums")}</option>
					<option value="bis">{tr("BIS: NUMURS_MARKA_REVĪZIJA_LAPAS")}</option>
				</select>
				{mode === "bis" && (
					<label className="small">
						{tr("revīzija")} <input style={{ width: 48 }} value={revision} onChange={(e) => setRevision(e.target.value)} />
					</label>
				)}
				<button className="small ghost" onClick={close}>
					{tr("Aizvērt")}</button>
			</div>
			{plan.error ? <Err error={plan.error} /> : null}
			<table>
				<tbody>
					{rows.map((r) => {
						const p = problem(r);
						return (
							<tr key={r.file}>
								<td className="mono small">{r.file}</td>
								<td>→</td>
								<td className="mono small">
									{needsName(r) ? <input style={{ width: "100%" }} value={typed[r.file] ?? ""} placeholder={r.to ?? tr("jaunais nosaukums ar paplašinājumu")} onChange={(e) => setTyped({ ...typed, [r.file]: e.target.value })} /> : r.to}
									{p && (
										<div className="small" style={{ color: "var(--bad)" }}>
											{p}
										</div>
									)}
								</td>
								<td>
									<Badge tone={RENAME_TONE[r.status]} title={r.why}>
										{RENAME_LABEL[r.status]}
									</Badge>
								</td>
								<td className="dim small">{r.why}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
				<button
					className="primary"
					disabled={busy || bad || pairs.length === 0}
					onClick={() =>
						run(tr("Pārdēvē"), () => call("deliveries.renameApply", projectId, deliveryId, pairs), (r) => {
							const x = r as RenameResult;
							setBatch(x.batch);
							close();
							return tr("Pārdēvēti {applied}{errors}", { applied: x.applied, errors: x.errors.length ? `; ${x.errors.join("; ")}` : "" });
						})
					}
				>
					{tr("Piemērot ({v})", { v: pairs.length })}</button>
				<span className="dim small">{tr("Tikai nodevuma starpmapē; neko nepārraksta; var atsaukt.")}</span>
			</div>
		</div>
	);
}

function Step({ n, on, done, children }: { n: number; on: boolean; done: boolean; children: React.ReactNode }) {
	return (
		<span
			className="badge"
			style={{ borderColor: on ? "var(--accent)" : undefined, color: done ? "var(--ok)" : on ? "var(--text)" : "var(--muted)", fontWeight: on ? 700 : 400 }}
		>
			{done ? "✓" : n} {children}
		</span>
	);
}

function ChecklistLine(p: {
	r: ChecklistRow;
	busy: boolean;
	withRevit: boolean;
	part: string;
	setPart: (s: string) => void;
	onCompare: () => void;
	onSheets: (replace: boolean) => void;
	onIfc: (replace: boolean) => void;
	onFile: () => void;
	onAgent: () => void;
	/** the user clicked the row: it is what the comment strip comments on */
	onPick: () => void;
}) {
	const { r } = p;
	return (
		<tr className="click" onClick={p.onPick}>
			<td style={{ whiteSpace: "nowrap" }}>
				<Badge tone={TONE[r.status]}>{tr(r.status)}</Badge>
			</td>
			<td>
				{r.label}
				{r.citation && <span className="dim small"> · {r.citation}</span>}
				{r.detail && <div className="dim small">{r.detail}</div>}
				{r.files.length > 0 && <div className="small mono dim">{r.files.slice(0, 4).join(", ")}{r.files.length > 4 ? ` … +${r.files.length - 4}` : ""}</div>}
			</td>
			<td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
				{r.action === "revit_sheets" && (
					<>
						{!p.withRevit && (
							<button className="small ghost" disabled={p.busy} onClick={p.onCompare} title={tr("Nolasa atvērtā modeļa lapu sarakstu")}>
								{tr("Salīdzināt ar Revit")}</button>
						)}
						<button className="small" disabled={p.busy} onClick={() => p.onSheets(false)} title={tr("Visas modeļa lapas, katra savā PDF; esošās paliek")}>
							{tr("Eksportēt lapas")}</button>
						{r.files.length > 0 && (
							<button className="small ghost" disabled={p.busy} onClick={() => window.confirm(tr("Eksportēt visas lapas no jauna (esošie PDF tiek aizstāti)?")) && p.onSheets(true)}>
								{tr("no jauna")}</button>
						)}
					</>
				)}
				{r.action === "revit_ifc" && r.status !== "neobligāts" && (
					<>
						<input value={p.part} onChange={(e) => p.setPart(e.target.value)} title={tr("daļa faila nosaukumā (AR, BK, …)")} style={{ width: 48 }} />
						<button className="small" disabled={p.busy} onClick={() => p.onIfc(r.files.length > 0 && window.confirm(tr("Aizstāt esošo IFC?")))}>
							{tr("Eksportēt IFC")}</button>
					</>
				)}
				{r.action === "revit_ifc" && r.status === "neobligāts" && (
					<button className="small ghost" disabled={p.busy} onClick={() => p.onIfc(false)}>
						{tr("Eksportēt IFC")}</button>
				)}
				{(r.action === "file" || r.action === "justify") && r.status !== "gatavs" && r.status !== "pamatots" && (
					<button className="small" disabled={p.busy} onClick={p.onFile}>
						{tr("Pievienot failu")}</button>
				)}
				{r.action === "coordination" && (
					<button className="small" onClick={() => windows.open("prasibas", "coordination")}>
						{tr("Koordinācija")}</button>
				)}
				{r.action === "requirements" && (
					<button className="small" onClick={() => windows.open("prasibas")}>
						{tr("Prasības")}</button>
				)}
				{r.status !== "gatavs" && r.status !== "neobligāts" && (
					<button className="small ghost" title={tr("Pievieno Fokusam: aģents paskaidro vai piedāvā pamatojumu")} onClick={p.onAgent}>
						{tr("→ aģentam")}</button>
				)}
			</td>
		</tr>
	);
}

function HistoryRow({ d, projectId, blocking, onStart, onChanged, onErr }: { d: Delivery; projectId: string; blocking: Finding[]; onStart: (k: string, date: string) => void; onChanged: () => void; onErr: (e: string) => void }) {
	const [open, setOpen] = useState(false);
	const act = (p: Promise<unknown>) => p.then(onChanged).catch((e) => onErr(errText(e)));
	const last = d.checksRun[d.checksRun.length - 1];
	const planned = d.id.startsWith("plan_");
	// the LBN 202-18 marka of each file: its sheet number, its name, or the folder it sits in (shared/markas.ts)
	const byMarka = useMemo(() => markasOfDelivery(d.items), [d.items]);
	return (
		<div className="confirm" style={{ borderColor: d.sent ? "var(--ok)" : "var(--border)" }}>
			<div className="row">
				<Badge>{d.stage}</Badge>
				<b className="click" onClick={() => setOpen(!open)}>
					{open ? "▾" : "▸"} {d.label}
				</b>
				<span className="dim small">
					{d.submittedDate ? tr("mape {submittedDate}", { submittedDate: d.submittedDate }) : planned ? tr("plānots") : tr("bez datuma mapes")}
					{d.plannedDate ? tr(" · plānots {plannedDate}{v}", { plannedDate: d.plannedDate, v: d.plannedFrom === "bip" ? " (BIP)" : "" }) : ""} {tr("· {v} faili", { v: d.items.length })}</span>
				{d.sent ? <Badge tone="ok">{tr("nosūtīts {v}", { v: d.sent.at.slice(0, 10) })}</Badge> : last ? <Badge tone={last.open ? "bad" : "ok"}>{tr("pārbaudīts: {open} atvērti", { open: last.open })}</Badge> : null}
				<span className="grow" />
				{planned && ["SKICE", "MBP", "BP", "DT", "STARP"].includes(d.kind) && d.plannedDate && (
					<button className="small primary" onClick={() => onStart(d.kind, d.plannedDate!)}>
						{tr("Nodot šo")}</button>
				)}
				{!planned && !d.sent && !d.draft && d.items.length > 0 && <button className="small" onClick={() => act(call("deliveries.prepare", projectId, d.id))}>{tr("Sagatavot")}</button>}
				{!planned && !d.sent && !d.draft && d.items.length > 0 && (
					<button className="small" disabled={!last || blocking.length > 0} title={blocking.length ? tr("{length} atvērti atradumi", { length: blocking.length }) : !last ? tr("vispirms sagatavo") : ""} onClick={() => act(call("deliveries.markSent", projectId, d.id))}>
						{tr("Atzīmēt kā nosūtītu")}</button>
				)}
				<input
					type="date"
					title={tr("plānotais datums")}
					defaultValue={d.plannedDate ?? ""}
					onBlur={(e) => e.target.value !== (d.plannedDate ?? "") && act(call("deliveries.setPlanned", projectId, d.id, e.target.value || null))}
				/>
			</div>
			{open && d.items.length > 0 && (
				<div className="row small dim" style={{ flexWrap: "wrap", gap: 4, padding: "4px 0" }}>
					<span>{tr("Markas (LBN 202-18):")}</span>
					{byMarka.counts.map((m) => (
						<Badge key={m.code} tone="info" title={markaByCode(m.code)?.name}>
							{m.code} · {m.files}
						</Badge>
					))}
					{byMarka.none > 0 && <Badge tone="warn" title={tr("Faili, kuru numurā, nosaukumā vai mapē nav markas")}>{tr("bez markas · {n}", { n: byMarka.none })}</Badge>}
				</div>
			)}
			{open && d.items.length > 0 && (
				<table>
					<tbody>
						{d.items.map((i) => (
							<tr key={i.file}>
								<td className="mono small">{i.sheetNo ?? <Badge tone="warn">{tr("nav Nr.")}</Badge>}</td>
								<td className="small">{(() => {
									const code = markaOfDeliveryFile(i);
									return code ? <Badge tone="info" title={markaByCode(code)?.name}>{code}</Badge> : null;
								})()}</td>
								<td>{i.title}</td>
								<td className="dim small mono">{fileName(i.file)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
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
			{err && <div className="err">{err}</div>}
			{(clocks.data ?? []).length === 0 && <span className="dim small">{tr("Nav pieprasītu TN vai saskaņojumu.")}</span>}
			<table>
				<tbody>
					{(clocks.data ?? []).map((c) => (
						<tr key={c.id}>
							<td>{c.label}</td>
							<td className="small">{tr("pieprasīts {requestedOn}", { requestedOn: c.requestedOn })}</td>
							<td className="small">
								{tr("termiņš {due}", { due: c.due })} <span className="dim">({c.point}{c.extended ? tr(", pagarināts līdz 20 d.d.") : ""})</span>
							</td>
							<td>
								<Badge tone={c.state === "saņemts" ? "ok" : c.state === "kavē" ? "bad" : c.daysLeft <= 3 ? "warn" : "dim"} title={c.caveat}>
									{c.state === "saņemts" ? tr("saņemts {receivedOn}", { receivedOn: c.receivedOn }) : c.state === "kavē" ? tr("kavē {daysLeft} d.d.", { daysLeft: -c.daysLeft }) : tr("{daysLeft} d.d.", { daysLeft: c.daysLeft })}
								</Badge>
							</td>
							<td>
								{!c.receivedOn && (
									<>
										<button className="small" onClick={() => act(call("clocks.update", projectId, c.id, { receivedOn: todayIso() }))}>{tr("saņemts šodien")}</button>
										<button className="small ghost" onClick={() => act(call("clocks.update", projectId, c.id, { extended: !c.extended }))}>{c.extended ? tr("11/15 d.d.") : tr("pagarināts")}</button>
									</>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<div className="row">
				<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "tn" | "approval" })}>
					<option value="tn">{tr("TN pieprasījums")}</option>
					<option value="approval">{tr("saskaņojums")}</option>
				</select>
				<input className="grow" placeholder={tr("izdevējs (piem., tīkla īpašnieks)")} value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} />
				<select value={draft.issuerKind} onChange={(e) => setDraft({ ...draft, issuerKind: e.target.value as "state_municipal" | "network_owner" })}>
					<option value="network_owner">{tr("inženierbūves īpašnieks")}</option>
					<option value="state_municipal">{tr("valsts / pašvaldība")}</option>
				</select>
				<input type="date" value={draft.requestedOn} onChange={(e) => setDraft({ ...draft, requestedOn: e.target.value })} />
				<button disabled={!draft.issuer.trim() || !draft.requestedOn} onClick={() => act(call("clocks.add", projectId, draft)).then(() => setDraft({ ...draft, issuer: "", requestedOn: "" }))}>
					{tr("Pievienot")}</button>
			</div>
		</>
	);
}
