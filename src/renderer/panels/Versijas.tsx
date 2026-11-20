// Versijas (task 9.9 splits it into windows around the viewer): "kas mainījās starp" two dates — sources, deliveries, revisions and the app's own data in one list, each linked
// to its compare view (sheet compare for PDFs, BimCraft's compare for IFC). Below: the project's IFC models, to open one or
// compare two.
import { comparePicker } from "../shell/ComparePicker";
import { useState, useSyncExternalStore } from "react";
import type { VersionRow } from "../../shared/api";
import { changeId, filterRows, kindCounts, KIND_LABEL, KINDS, modesFor, planFor, type ChangeKind, type CompareMode, type OpenPlan } from "../../shared/versions-view";
import { viewer } from "../viewer-store";
import { call, errText } from "../bridge";
import { commentSubject } from "../comment-subject";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { tr, trDyn } from "../i18n";
import { lastPair, type DrawingFile, type PdfDwgState } from "../../shared/drawing-sets";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// the picked change and how it opens, shared by the list, the sheet list and the viewer
let picked: { row: VersionRow | null; mode: CompareMode } = { row: null, mode: "side" };
const subs = new Set<() => void>();
const setPicked = (p: typeof picked) => {
	picked = p;
	for (const l of subs) l();
};
function usePicked() {
	return useSyncExternalStore(
		(l) => (subs.add(l), () => subs.delete(l)),
		() => picked,
	);
}

/** Does what planFor says in the viewer: a split of two models, a compare tab, a file. Returns the problem in words, or null. */
function runPlan(plan: OpenPlan): string | null {
	if (plan.how === "none") return plan.why;
	if (plan.how === "split") viewer.compareSplit(plan.a, plan.b, plan.dir);
	else ui.show(plan.target);
	return null;
}

/** The changes between two dates, filtered by kind; a click picks one and opens it in the viewer in the chosen mode. */
export function VersList() {
	const { projectId } = useUi();
	const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 86_400_000)));
	const [to, setTo] = useState(iso(new Date()));
	const [kinds, setKinds] = useState<Set<ChangeKind>>(new Set());
	const [msg, setMsg] = useState<string | null>(null);
	const p = usePicked();
	const rows = useLoad<VersionRow[]>(() => (projectId ? call("versions.between", projectId, from, to) : Promise.resolve([])), [projectId, from, to]);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	const all = rows.data ?? [];
	const shown = filterRows(all, kinds);
	const counts = kindCounts(all);
	const modes = modesFor(p.row);
	const pick = (r: VersionRow, mode: CompareMode) => {
		setPicked({ row: r, mode });
		commentSubject.pick({ thing: "change", version: changeId(r), side: "A" }, `izmaiņa: ${r.label.slice(0, 40)}`);
		setMsg(runPlan(planFor(r, mode)));
	};
	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={() => comparePicker.open()} title={tr("Jebkuri divi faili: PDF, DWG, IFC, DOCX, XLSX")}>
					⇄ {tr("Salīdzināt divus failus…")}
				</button>
			</div>
			<div className="row">
				<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
				<span>–</span>
				<input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
				<span className="dim small">{tr("{v} no {v2}", { v: shown.length, v2: all.length })}</span>
			</div>
			<div className="row" style={{ flexWrap: "wrap" }}>
				{KINDS.map((k) => (
					<button key={k} className={`small ${kinds.has(k) ? "primary" : ""}`} onClick={() => setKinds((x) => (x.has(k) ? new Set([...x].filter((y) => y !== k)) : new Set([...x, k])))}>
						{KIND_LABEL[k]} {counts[k]}
					</button>
				))}
				{kinds.size > 0 && (
					<button className="small ghost" onClick={() => setKinds(new Set())}>
						{tr("visi")}</button>
				)}
			</div>
			{modes.length > 0 && (
				<div className="row">
					<span className="dim small">{tr("Skats:")}</span>
					{modes.map((m) => (
						<button key={m} className={`small ${p.mode === m ? "primary" : ""}`} onClick={() => p.row && pick(p.row, m)} title={m === "side" ? tr("A un B blakus, kamera kopā") : m === "overlay" ? tr("viens skats ar abiem") : tr("tikai izmaiņas")}>
							{m === "side" ? tr("blakus") : m === "overlay" ? tr("pārklāt") : tr("tikai izmaiņas")}
						</button>
					))}
				</div>
			)}
			{msg && <div className="dim small">{msg}</div>}
			{rows.error ? <Err error={rows.error} /> : null}
			{all.length === 0 && !rows.loading && <Empty title={tr("no data")}>{tr("Šajā laikā izmaiņu nav.")}</Empty>}
			<table>
				<tbody>
					{shown.map((r, i) => (
						<tr key={i} className={`click ${p.row === r ? "sel" : ""}`} onClick={() => pick(r, modesFor(r).includes(p.mode) ? p.mode : (modesFor(r)[0] ?? p.mode))}>
							<td className="small dim" style={{ whiteSpace: "nowrap" }}>{r.at.slice(0, 10)}</td>
							<td>
								<Badge>{KIND_LABEL[r.kind]}</Badge>
							</td>
							<td>
								{r.label}
								{r.detail && <div className="dim small">{r.detail}</div>}
							</td>
							<td className="small dim">{r.compare ? (r.compare.mode === "ifc" ? tr("3D") : tr("lapa")) : ""}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The project's IFC models: open one, or tick two to compare. */
export function VersModels() {
	const { projectId } = useUi();
	const models = useLoad(() => (projectId ? call("models.list", projectId) : Promise.resolve([])), [projectId]);
	const [pick, setPick] = useState<string[]>([]);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	const name = (rel: string) => models.data?.find((m) => m.rel === rel)?.name ?? rel;
	return (
		<div className="pane fill">
			<div className="section-title">{tr("Modeļi (visi projekta IFC: izejas dati, daļas, nodevumi, uzmetumi, revīzijas)")}</div>
			{models.error ? <Err error={models.error} /> : null}
			{models.data?.length === 0 && <div className="dim small">{tr("no data: projekta mapē, uzmetumos un revīzijās IFC failu nav.")}</div>}
			{/* E3: the name is what is read first; where the file comes from sits under it, not in a column at the far left */}
			<table className="models-table">
				<tbody>
					{(models.data ?? []).map((m) => (
						<tr key={m.rel}>
							<td>
								<input type="checkbox" checked={pick.includes(m.rel)} onChange={(e) => setPick(e.target.checked ? [...pick, m.rel].slice(-2) : pick.filter((x) => x !== m.rel))} />
							</td>
							<td className="models-name">
								<div className={m.archived ? "dim" : ""}>
									{m.name}
									{m.archived && (
										<>
											{" "}
											<Badge tone="dim" title={tr("arhīvs: vecāks par failu sadaļas mapē")}>{tr("arhīvs")}</Badge>
										</>
									)}
								</div>
								<div className="small dim">
									{m.origin}
									{m.section ? <> · {m.section}</> : null}
								</div>
							</td>
							<td className="small dim models-meta">
								{tr("{v} MB · {v2}", { v: (m.size / 1048576).toFixed(1), v2: m.mtime.slice(0, 10) })}</td>
							<td>
								<button className="small" onClick={() => ui.show({ kind: "ifc", path: m.rel, label: m.name })}>{tr("3D")}</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{pick.length === 2 && (
				<div className="row">
					<button className="primary" onClick={() => ui.show({ kind: "compare", a: pick[0], b: pick[1], aLabel: name(pick[0]), bLabel: name(pick[1]), mode: "ifc" })}>
						{tr("Pārklāt {v} → {v2}", { v: name(pick[0]), v2: name(pick[1]) })}</button>
					<button
						onClick={() => {
							const [a, b] = pick;
							runPlan(planFor({ at: "", kind: "data", label: "", compare: { a, b, mode: "ifc", aLabel: name(a), bLabel: name(b) } }, "side"));
						}}
					>
						{tr("Blakus, kamera kopā")}</button>
				</div>
			)}
		</div>
	);
}

/** Lapu izmaiņas: the project's drawings (PDF and DWG, like the Models tab lists IFC) and the sheet pairs of the picked pair. */
export function VersSheets() {
	const { projectId } = useUi();
	const p = usePicked();
	const c = p.row?.compare;
	const rows = useLoad(() => (projectId && c && c.mode === "sheet" ? call("sheets.diff", projectId, c.a, c.b) : Promise.resolve([])), [projectId, c?.a, c?.b]);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return (
		<div className="pane fill">
			{c && c.mode === "sheet" && (
				<>
					<div className="row">
						<b>{c.aLabel} ↔ {c.bLabel}</b>
						<span className="grow" />
						<button className="small" onClick={() => ui.show({ kind: "compare", a: c.a, b: c.b, aLabel: c.aLabel, bLabel: c.bLabel, mode: "sheet", only: true })}>
							{tr("Tikai izmaiņas")}</button>
					</div>
					{rows.error ? <Err error={rows.error} /> : null}
					{rows.loading && <div className="dim small">{tr("salīdzina lapas…")}</div>}
					{rows.data?.length === 0 && !rows.loading && <div className="dim small">{tr("Lapu pāru nav vai neviena nemainījās.")}</div>}
					<table>
						<tbody>
							{(rows.data ?? []).map((r, i) => (
								<tr key={i}>
									<td className="mono small">{r.sheetNo ?? tr("lpp. {a}", { a: r.a })}</td>
									<td className="small">{r.summary.length ? r.summary.join("; ") : <span className="dim">{tr("nemainīta")}</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
			<DrawingSets projectId={projectId} />
		</div>
	);
}

type SetFilter = "all" | "versions" | "mismatch";
const STATE_TONE: Record<PdfDwgState, "ok" | "warn" | "bad" | "dim"> = { "sakrīt": "ok", "tikai PDF": "dim", "tikai DWG": "dim", "versijas nesakrīt": "bad", "DWG jaunāks": "warn" };
const fileLabel = (f: DrawingFile) => `${f.name} · ${f.mtime.slice(0, 10)}`;

/** Opens two versions of one drawing: PDF in the sheet compare (its sheet list fills the part above), DWG in CadCraft's compare. */
function openPair(a: DrawingFile, b: DrawingFile) {
	const mode = /\.dwg$/i.test(b.name) ? "dwg" : "sheet";
	const compare = { a: a.rel, b: b.rel, mode, aLabel: fileLabel(a), bLabel: fileLabel(b) } as const;
	if (mode === "sheet") setPicked({ row: { at: b.mtime, kind: "source", label: b.name, compare }, mode: "overlay" });
	ui.show({ kind: "compare", ...compare });
}

/**
 * Every PDF and DWG of the project folder, grouped by drawing. A drawing's PDFs are one version chain and its DWGs another:
 * tick two versions of the same kind to compare them, or take the last two with one click. The state says whether the newest
 * PDF and the newest DWG are the same issue.
 */
function DrawingSets({ projectId }: { projectId: string }) {
	const sets = useLoad(() => call("sheets.sets", projectId), [projectId]);
	const [filter, setFilter] = useState<SetFilter>("all");
	const [sel, setSel] = useState<DrawingFile[]>([]);
	const all = sets.data ?? [];
	const counts = { all: all.length, versions: all.filter((x) => x.pdf.length > 1 || x.dwg.length > 1).length, mismatch: all.filter((x) => x.state === "versijas nesakrīt" || x.state === "DWG jaunāks").length };
	const shown = all.filter((x) => (filter === "versions" ? x.pdf.length > 1 || x.dwg.length > 1 : filter === "mismatch" ? x.state === "versijas nesakrīt" || x.state === "DWG jaunāks" : true));
	const kindOf = (f: DrawingFile) => (/\.dwg$/i.test(f.name) ? "dwg" : "pdf");
	// two of one kind at most: a tick of the other kind starts the choice again (PDF is compared with PDF, DWG with DWG)
	const toggle = (f: DrawingFile) =>
		setSel((x) => (x.some((y) => y.rel === f.rel) ? x.filter((y) => y.rel !== f.rel) : x.length && kindOf(x[0]!) !== kindOf(f) ? [f] : [...x, f].slice(-2)));
	const chain = (files: DrawingFile[], kind: "PDF" | "DWG") =>
		files.length === 0 ? (
			<span className="dim">{tr("{k}: nav", { k: kind })}</span>
		) : (
			<span className="row" style={{ flexWrap: "wrap", gap: 4 }}>
				<span className="dim">{kind}</span>
				{files.map((f) => (
					<label key={f.rel} className={`badge ${sel.some((y) => y.rel === f.rel) ? "info" : ""} ${f.archived ? "dim" : ""}`} title={`${f.rel}\n${tr("{v} MB · {v2}", { v: (f.size / 1048576).toFixed(1), v2: f.mtime.slice(0, 16).replace("T", " ") })}`} style={{ cursor: "pointer" }}>
						<input type="checkbox" checked={sel.some((y) => y.rel === f.rel)} onChange={() => toggle(f)} style={{ margin: "0 4px 0 0" }} />
						{f.rev ? `_${String(f.rev).padStart(2, "0")}` : tr("1. izd.")} · {f.mtime.slice(0, 10)}
					</label>
				))}
			</span>
		);
	return (
		<>
			<div className="section-title">{tr("Rasējumi (visi projekta PDF un DWG, pa rasējumiem: PDF salīdzina ar PDF, DWG ar DWG)")}</div>
			<div className="row" style={{ flexWrap: "wrap" }}>
				{(["all", "versions", "mismatch"] as const).map((k) => (
					<button key={k} className={`small ${filter === k ? "primary" : ""}`} onClick={() => setFilter(k)}>
						{k === "all" ? tr("visi {n}", { n: counts.all }) : k === "versions" ? tr("ar vairākām versijām {n}", { n: counts.versions }) : tr("PDF ≠ DWG {n}", { n: counts.mismatch })}
					</button>
				))}
				<span className="grow" />
				<button className="small ghost" onClick={sets.reload}>{tr("pārlasīt mapi")}</button>
			</div>
			{sel.length === 2 && (
				<div className="row">
					<button className="primary" onClick={() => openPair(sel[0]!, sel[1]!)}>
						⇄ {tr("Salīdzināt {a} → {b}", { a: sel[0]!.name, b: sel[1]!.name })}</button>
					<button className="small ghost" onClick={() => setSel([])}>{tr("notīrīt")}</button>
				</div>
			)}
			{sets.error ? <Err error={sets.error} /> : null}
			{sets.loading && !sets.data && <div className="dim small">{tr("lasa projekta mapi…")}</div>}
			{sets.data?.length === 0 && <div className="dim small">{tr("no data: projekta mapē PDF un DWG failu nav.")}</div>}
			<div className="dim small">{tr("PDF = DWG pārbauda nosaukuma versiju un datumu, ne rasējuma saturu.")}</div>
			<table className="models-table">
				<tbody>
					{shown.map((x) => {
						const lp = lastPair(x.pdf);
						const ld = lastPair(x.dwg);
						return (
							<tr key={x.key}>
								<td className="models-name">
									<div>{x.title}</div>
									<div className="small dim">{x.section ?? ""}</div>
								</td>
								<td className="small">
									<div>{chain(x.pdf, "PDF")}</div>
									<div>{chain(x.dwg, "DWG")}</div>
								</td>
								<td className="small">
									<Badge tone={STATE_TONE[x.state]} title={x.why}>{tr(x.state)}</Badge>
									<div className="dim">{trDyn(x.why)}</div>
								</td>
								<td className="small models-meta">
									{lp && <button className="small" title={tr("pēdējās divas PDF versijas")} onClick={() => openPair(...lp)}>PDF ⇄</button>}
									{ld && <button className="small" title={tr("pēdējās divas DWG versijas")} onClick={() => openPair(...ld)}>DWG ⇄</button>}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</>
	);
}

export function VersRevit() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return (
		<div className="pane fill">
			<RevitSection projectId={projectId} />
			<RevitFiles projectId={projectId} />
		</div>
	);
}

/**
 * The Revit files of the project folder, like the Models tab lists IFC. The one open in Revit is marked: the app asks Revit for
 * the open document's path, so it knows the file by where it is; only the name matching (a local copy of a central model) says so.
 */
function RevitFiles({ projectId }: { projectId: string }) {
	const v = useLoad(() => call("revit.files", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const d = v.data;
	return (
		<>
			<div className="section-title">{tr("Revit faili projekta mapē")}</div>
			<div className="row small">
				{d?.open ? (
					<>
						<span>{tr("Revit atvērts:")}</span>
						<b>{d.open.title}</b>
						{d.open.rel ? (
							<Badge tone={d.open.by === "path" ? "ok" : "warn"} title={d.open.path}>{d.open.by === "path" ? tr("šis projekta fails") : tr("sakrīt tikai nosaukums")}</Badge>
						) : (
							<Badge tone="dim" title={d.open.path}>{tr("nav no šī projekta mapes")}</Badge>
						)}
					</>
				) : (
					<span className="dim">{d?.message ? trDyn(d.message) : tr("pārbauda Revit…")}</span>
				)}
				<span className="grow" />
				<button className="small ghost" onClick={v.reload}>{tr("pārbaudīt")}</button>
			</div>
			{v.error ? <Err error={v.error} /> : null}
			{err && <Err error={err} />}
			{d?.files.length === 0 && <div className="dim small">{tr("no data: projekta mapē RVT failu nav.")}</div>}
			<table className="models-table">
				<tbody>
					{(d?.files ?? []).map((m) => {
						const isOpen = d?.open?.rel === m.rel;
						return (
							<tr key={m.rel}>
								<td className="models-name">
									<div className={m.archived ? "dim" : ""}>
										{isOpen ? <b>{m.name}</b> : m.name}{" "}
										{isOpen && <Badge tone="ok">{tr("atvērts Revit")}</Badge>}
										{m.archived && <Badge tone="dim" title={tr("arhīvs: vecāks par failu sadaļas mapē")}>{tr("arhīvs")}</Badge>}
									</div>
									<div className="small dim">
										{m.origin}
										{m.section ? <> · {m.section}</> : null}
									</div>
								</td>
								<td className="small dim models-meta">{tr("{v} MB · {v2}", { v: (m.size / 1048576).toFixed(1), v2: m.mtime.slice(0, 10) })}</td>
								<td>
									{!isOpen && (
										<button className="small" title={tr("Atver failu Revit (datora programmā)")} onClick={() => call("files.open", projectId, "projekts", m.rel).then(() => setErr(null), (e) => setErr(errText(e)))}>
											{tr("Atvērt")}</button>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{!!d?.backups && <div className="dim small">{tr("{n} Revit rezerves kopijas (.0001.rvt) nav uzskaitītas.", { n: d.backups })}</div>}
		</>
	);
}

/** The old single panel: the change list. */
export const Versijas = VersList;

/** Revit: the working copy (the agent edits only it), exports of a view and of IFC, and a revision the user fixes themself. */
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
			<div className="section-title">{tr("Revit")}</div>
			<div className="row small">
				<Badge tone={st?.state === "savienots" ? "ok" : "dim"}>{st?.state ?? "…"}</Badge>
				{st?.document && <span>{st.document}</span>}
				{st?.message && <span className="dim">{st.message}</span>}
			</div>
			{st?.state === "savienots" && (
				<>
					<div className="row">
						<button disabled={!!busy} title={tr("Saglabā atvērto modeli kā <nosaukums>_WORK.rvt projekta datu mapē; aģents strādā tikai tajā")} onClick={() => run("Darba kopija", () => call("revit.workCopy", projectId))}>
							{tr("Darba kopija")}</button>
						<button disabled={!!busy} onClick={() => run("IFC eksports", () => call("revit.exportIfc", projectId))}>{tr("IFC eksports")}</button>
						<button disabled={!!busy} onClick={() => run("Revīzija", () => call("revisions.capture", projectId, "Saglabāta ar roku", []).then((r) => `${r.id}${r.diffFromPrev ? ` +${r.diffFromPrev.added} −${r.diffFromPrev.removed} ~${r.diffFromPrev.changed}` : ""}`))}>
							{tr("Fiksēt revīziju")}</button>
					</div>
					<div className="row">
						<button disabled={!!busy} onClick={() => run("Skati", () => call("revit.views").then((v) => (setViews(v), `${v.length} skati`)))}>{tr("Nolasīt skatus")}</button>
						{views && (
							<>
								<select value={view} onChange={(e) => setView(e.target.value)}>
									<option value="">{tr("— skats —")}</option>
									{views.map((v) => (
										<option key={v.id} value={v.id}>
											{v.type}: {v.name}
										</option>
									))}
								</select>
								<button disabled={!view || !!busy} onClick={() => run("PDF eksports", () => call("revit.exportView", projectId, view, views.find((v) => v.id === view)?.name ?? "skats"))}>
									{tr("PDF")}</button>
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
