// Pārskats, the open project's own page (task 9.6; it replaces the Profils panel, decision 8 of v2-design): a header with the
// stage and Skenēt, five tiles that open their pages, the stage timeline, Jāizdara (what needs the user, worst first), Fakti
// (the profile as a grid), the last 30 days of changes, the folders, and the findings over time. Every number is read from the
// stores that exist (projects.dashboard); nothing here is a second copy.
// BIM Crew reference: ProjectsArtifact/ProjectInsights.tsx, dashboard/{DetailPanel,ProjectCard}.tsx.
import { useState } from "react";
import type { HistoryPoint, ProjectDashboard } from "../../core/summary-types";
import { call, errText } from "../bridge";
import { commentSubject } from "../comment-subject";
import { Timeline } from "../shell/Timeline";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { windows } from "../windows";
import { factReview } from "../fact-review";
import { ProcessBlock } from "./ProcessBlock";
import { Profile } from "./Profile";
import { locale, tr, trDyn } from "../i18n";

export function Parskats() {
	const [waiting, setWaiting] = useState(false);
	const { projectId } = useUi();
	const d = useLoad<ProjectDashboard | null>(() => (projectId ? call("projects.dashboard", projectId) : Promise.resolve(null)), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const [allFacts, setAllFacts] = useState(false);
	const [scanning, setScanning] = useState(false);
	if (!projectId) return <Empty title={tr("nav projekta")}>{tr("Atver vai pievieno projektu (augšā: projekta nosaukums).")}</Empty>;
	if (d.error) return <Err error={d.error} />;
	const x = d.data;
	if (!x) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa projektu…")}</div>;

	const scan = () => {
		setScanning(true);
		setErr(null);
		call("projects.scan", projectId)
			.then(() => ui.bump())
			.catch((e) => setErr(errText(e)))
			.finally(() => setScanning(false));
	};
	const toAgent = (i: number) => {
		const row = x.todo[i];
		call("todos.add", projectId, { title: row.task.title, note: row.task.note })
			.then(() => (ui.focusAdd({ kind: "text", id: `todo:${i}:${row.text.slice(0, 20)}`, label: `jāizdara: ${row.text}`, data: { open: row.open } }), ui.bump()))
			.catch((e) => setErr(errText(e)));
	};
	const proposals = x.facts.filter((f) => f.state === "proposed");

	return (
		<div className="pane fill parskats">
			{err && <div className="err">{err}</div>}
			<div className="row ps-head">
				<b style={{ fontSize: 16 }}>{x.id}</b>
				<span className="grow ps-name">{x.name}</span>
				{x.stage ? <Badge tone="info">{x.stage}</Badge> : <span className="dim small">{tr("nav nodevumu")}</span>}
				{x.missing && <Badge tone="bad">{tr("mape nav pieejama")}</Badge>}
				<span className="dim small">{x.lastScan ? tr("nolasīts {v}", { v: new Date(x.lastScan).toLocaleString(locale()) }) : tr("vēl nav nolasīts")}</span>
				<button className="primary" disabled={x.missing || scanning} onClick={scan}>
					{scanning ? tr("Nolasa…") : tr("Skenēt")}
				</button>
			</div>

			<div className="ps-tiles">
				{x.tiles.map((t) => (
					<div key={t.id} className={`ps-tile ${t.tone}`} onClick={() => windows.go(t.open.panel, t.open.filter)} title={tr("Atvērt lapu")}>
						<div className="dim small">{trDyn(t.title)}</div>
						<div className="ps-value">{trDyn(t.value)}</div>
						{t.sub && <div className="small dim">{trDyn(t.sub)}</div>}
						<button className="ghost small ps-comment" title={tr("Komentēt šo kartīti")} onClick={(e) => (e.stopPropagation(), commentSubject.pick({ thing: "tile", id: t.id }, `kartīte: ${t.title}`))}>
							{tr("komentēt")}</button>
					</div>
				))}
			</div>

			<Timeline t={x.timeline} />

			<div className="ps-cols">
				<section>
					<div className="section-title">{tr("Jāizdara")}</div>
					{x.todo.length === 0 ? (
						<div className="dim small">{tr("Nekā steidzama: nav kavētu termiņu, atvērtu kļūdu vai nenolasītu mapju.")}</div>
					) : (
						x.todo.map((r, i) => (
							<div key={i} className="ps-todo">
								<Badge tone={r.level === "bad" ? "bad" : "warn"}>{r.level === "bad" ? tr("steidzami") : tr("drīz")}</Badge>
								<span className="grow click" onClick={() => windows.go(r.open.panel, r.open.filter)}>
									{r.text}
								</span>
								<button className="small ghost" title={tr("Kļūst par uzdevumu un nonāk aģenta Fokusā")} onClick={() => toAgent(i)}>
									{tr("→ aģentam")}</button>
							</div>
						))
					)}
				</section>
				<section>
					<div className="section-title">
						{tr("Fakti")} {proposals.length > 0 && <Badge tone="warn">{tr("{v} gaida", { v: proposals.length })}</Badge>}
						{proposals.length > 0 && (
							<button className={`small ${waiting ? "primary" : "ghost"}`} onClick={() => setWaiting(!waiting)} title={tr("Rādīt tikai faktus, kas gaida tavu apstiprinājumu")}>
								{waiting ? tr("rādīt visus") : tr("tikai gaidošie")}
							</button>
						)}
						{proposals.length > 0 && (
							<button className="small ghost" onClick={() => proposals[0].factId && factReview.start(projectId, proposals[0].factId)} title={tr("Pārskatīt gaidošos pa vienam, blakus avotam")}>
								{tr("pārskatīt")}
							</button>
						)}
					</div>
					<div className="ps-facts">
						{x.facts.filter((f) => !waiting || f.state === "proposed").map((f) => (
							<div key={f.key} className={`ps-fact ${f.state}`} title={f.value ?? tr("nav datu")} onClick={() => (f.state === "proposed" && f.factId ? factReview.start(projectId, f.factId) : commentSubject.pick({ thing: "fact", key: `profile.${f.key}` }, `fakts: ${f.label}`))}>
								<span className="dim small">{f.label}</span>
								<span className="ps-fact-v">
									{f.state === "confirmed" ? "✓ " : f.state === "proposed" ? "? " : ""}
									{f.value ?? <span className="dim">—</span>}
								</span>
							</div>
						))}
					</div>
					<div className="row">
						{proposals.length > 0 && (
							<button className="small primary" title={tr("Avota dokuments atveras pie citāta; Enter apstiprina, Del noraida, bultiņas pāriet")} onClick={() => factReview.start(projectId)}>
								{tr("Pārskatīt {v} priekšlikumus", { v: proposals.length })}</button>
						)}
						<button className="small ghost" onClick={() => setAllFacts(!allFacts)}>
							{allFacts ? tr("Slēpt faktu tabulu") : tr("Visi fakti ar avotiem")}
						</button>
					</div>
				</section>
			</div>
			{allFacts && <Profile projectId={projectId} />}

			<div className="ps-cols">
				<section>
					<div className="section-title">{tr("Pēdējās izmaiņas (30 dienas)")}</div>
					{x.recent.length === 0 && <div className="dim small">{tr("Šajā laikā izmaiņu nav.")}</div>}
					{x.recent.map((r, i) => (
						<div key={i} className="ps-recent">
							<span className="dim small mono">{r.at.slice(0, 10)}</span>
							<span className="grow">
								{r.label}
								{r.detail && <span className="dim small"> · {r.detail}</span>}
							</span>
							{r.open?.sourceId && (
								<button className="small ghost" onClick={() => ui.show({ kind: "source", sourceId: r.open!.sourceId! })}>
									{tr("atvērt")}</button>
							)}
							{r.open?.ifc && (
								<button className="small ghost" onClick={() => ui.show({ kind: "ifc", path: r.open!.ifc!, label: r.label })}>
									{tr("3D")}</button>
							)}
						</div>
					))}
					<button className="small ghost" onClick={() => windows.go("versijas")}>
						{tr("Visas versijas")}</button>
				</section>
				<section>
					<div className="section-title">{tr("Mapes")}</div>
					{x.folders.length === 0 && <div className="dim small">{tr("no data: projekts vēl nav nolasīts.")}</div>}
					{x.folders.map((f) => (
						<div key={f.key} className="ps-folder click" onClick={() => windows.go("faili")}>
							<span className="mono small dim">{f.key}</span>
							<span className="grow">{f.name}</span>
							<span className="small" title={tr("faili")}>{f.files}</span>
							<span className="small dim" title={tr("modeļi (IFC, RVT)")}>{f.models ? tr("{n} mod.", { n: f.models }) : ""}</span>
							<span className={`small ${f.changed ? "" : "dim"}`} title={tr("mainīti pēdējās 30 dienās")}>{f.changed ? tr("{n} mainīti", { n: f.changed }) : ""}</span>
						</div>
					))}
					<div className="section-title">{tr("Atradumi laikā")}</div>
					<HistoryChart h={x.history} />
				</section>
			</div>
		</div>
	);
}

/** Open errors and warnings after each check run (P3): one pair of bars per run, errors red, warnings yellow. */
function HistoryChart({ h }: { h: ProjectDashboard["history"] }) {
	if (h.state === "no data") return <div className="dim small">{tr("no data: vajag vismaz divas pārbaudes (bijušas {runs}).", { runs: h.runs })}</div>;
	const pts: HistoryPoint[] = h.points.slice(-30);
	const max = Math.max(1, ...pts.map((p) => Math.max(p.error, p.warning)));
	const w = 100 / pts.length;
	const bar = Math.max(0.6, w * 0.36);
	const y = (v: number) => (v / max) * 28;
	const last = pts[pts.length - 1];
	return (
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" className="ps-chart">
			{pts.map((p, i) => (
				<g key={i}>
					<rect x={i * w + w * 0.12} y={30 - y(p.error)} width={bar} height={y(p.error)} fill="var(--bad)">
						<title>{tr("{at}: {error} kļūdas, {warning} brīdinājumi", { at: p.at.slice(0, 10), error: p.error, warning: p.warning })}</title>
					</rect>
					<rect x={i * w + w * 0.12 + bar} y={30 - y(p.warning)} width={bar} height={y(p.warning)} fill="var(--warn)">
						<title>{tr("{at}: {error} kļūdas, {warning} brīdinājumi", { at: p.at.slice(0, 10), error: p.error, warning: p.warning })}</title>
					</rect>
				</g>
			))}
			<line x1="0" y1="30" x2="100" y2="30" stroke="var(--border)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
			<title>{tr("kļūdas (sarkans) un brīdinājumi (dzeltens) pēc katras pārbaudes; pēdējā: {error} un {warning}", { error: last.error, warning: last.warning })}</title>
		</svg>
	);
}
