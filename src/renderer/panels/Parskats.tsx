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
import { Profile } from "./Profile";

export function Parskats() {
	const { projectId } = useUi();
	const d = useLoad<ProjectDashboard | null>(() => (projectId ? call("projects.dashboard", projectId) : Promise.resolve(null)), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const [allFacts, setAllFacts] = useState(false);
	const [scanning, setScanning] = useState(false);
	if (!projectId) return <Empty title="nav projekta">Atver vai pievieno projektu (augšā: projekta nosaukums).</Empty>;
	if (d.error) return <Err error={d.error} />;
	const x = d.data;
	if (!x) return <div className="dim small" style={{ padding: 12 }}>lasa projektu…</div>;

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
				{x.stage ? <Badge tone="info">{x.stage}</Badge> : <span className="dim small">nav nodevumu</span>}
				{x.missing && <Badge tone="bad">mape nav pieejama</Badge>}
				<span className="dim small">{x.lastScan ? `nolasīts ${new Date(x.lastScan).toLocaleString("lv-LV")}` : "vēl nav nolasīts"}</span>
				<button className="primary" disabled={x.missing || scanning} onClick={scan}>
					{scanning ? "Nolasa…" : "Skenēt"}
				</button>
			</div>

			<div className="ps-tiles">
				{x.tiles.map((t) => (
					<div key={t.id} className={`ps-tile ${t.tone}`} onClick={() => windows.go(t.open.panel, t.open.filter)} title="Atvērt lapu">
						<div className="dim small">{t.title}</div>
						<div className="ps-value">{t.value}</div>
						{t.sub && <div className="small dim">{t.sub}</div>}
						<button className="ghost small ps-comment" title="Komentēt šo kartīti" onClick={(e) => (e.stopPropagation(), commentSubject.pick({ thing: "tile", id: t.id }, `kartīte: ${t.title}`))}>
							komentēt
						</button>
					</div>
				))}
			</div>

			<Timeline t={x.timeline} />

			<div className="ps-cols">
				<section>
					<div className="section-title">Jāizdara</div>
					{x.todo.length === 0 ? (
						<div className="dim small">Nekā steidzama: nav kavētu termiņu, atvērtu kļūdu vai nenolasītu mapju.</div>
					) : (
						x.todo.map((r, i) => (
							<div key={i} className="ps-todo">
								<Badge tone={r.level === "bad" ? "bad" : "warn"}>{r.level === "bad" ? "steidzami" : "drīz"}</Badge>
								<span className="grow click" onClick={() => windows.go(r.open.panel, r.open.filter)}>
									{r.text}
								</span>
								<button className="small ghost" title="Kļūst par uzdevumu un nonāk aģenta Fokusā" onClick={() => toAgent(i)}>
									→ aģentam
								</button>
							</div>
						))
					)}
				</section>
				<section>
					<div className="section-title">
						Fakti {proposals.length > 0 && <Badge tone="warn">{proposals.length} gaida</Badge>}
					</div>
					<div className="ps-facts">
						{x.facts.map((f) => (
							<div key={f.key} className={`ps-fact ${f.state}`} title={f.value ?? "nav datu"} onClick={() => (f.state === "proposed" && f.factId ? factReview.start(projectId, f.factId) : commentSubject.pick({ thing: "fact", key: `profile.${f.key}` }, `fakts: ${f.label}`))}>
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
							<button className="small primary" title="Avota dokuments atveras pie citāta; Enter apstiprina, Del noraida, bultiņas pāriet" onClick={() => factReview.start(projectId)}>
								Pārskatīt {proposals.length} priekšlikumus
							</button>
						)}
						<button className="small ghost" onClick={() => setAllFacts(!allFacts)}>
							{allFacts ? "Slēpt faktu tabulu" : "Visi fakti ar avotiem"}
						</button>
					</div>
				</section>
			</div>
			{allFacts && <Profile projectId={projectId} />}

			<div className="ps-cols">
				<section>
					<div className="section-title">Pēdējās izmaiņas (30 dienas)</div>
					{x.recent.length === 0 && <div className="dim small">Šajā laikā izmaiņu nav.</div>}
					{x.recent.map((r, i) => (
						<div key={i} className="ps-recent">
							<span className="dim small mono">{r.at.slice(0, 10)}</span>
							<span className="grow">
								{r.label}
								{r.detail && <span className="dim small"> · {r.detail}</span>}
							</span>
							{r.open?.sourceId && (
								<button className="small ghost" onClick={() => ui.show({ kind: "source", sourceId: r.open!.sourceId! })}>
									atvērt
								</button>
							)}
							{r.open?.ifc && (
								<button className="small ghost" onClick={() => ui.show({ kind: "ifc", path: r.open!.ifc!, label: r.label })}>
									3D
								</button>
							)}
						</div>
					))}
					<button className="small ghost" onClick={() => windows.go("versijas")}>
						Visas versijas
					</button>
				</section>
				<section>
					<div className="section-title">Mapes</div>
					{x.folders.length === 0 && <div className="dim small">no data: projekts vēl nav nolasīts.</div>}
					{x.folders.map((f) => (
						<div key={f.key} className="ps-folder click" onClick={() => windows.go("faili")}>
							<span className="mono small dim">{f.key}</span>
							<span className="grow">{f.name}</span>
							<span className="small">{f.files}</span>
						</div>
					))}
					<div className="section-title">Atradumi laikā</div>
					<HistoryChart h={x.history} />
				</section>
			</div>
		</div>
	);
}

/** Open errors and warnings after each check run. Two runs are needed for a line: until then it says no data. */
function HistoryChart({ h }: { h: ProjectDashboard["history"] }) {
	if (h.state === "no data") return <div className="dim small">no data: vajag vismaz divas pārbaudes (bijušas {h.runs}).</div>;
	const pts: HistoryPoint[] = h.points.slice(-30);
	const max = Math.max(1, ...pts.map((p) => Math.max(p.error, p.warning)));
	const x = (i: number) => (pts.length === 1 ? 0 : (i / (pts.length - 1)) * 100);
	const y = (v: number) => 30 - (v / max) * 28;
	const last = pts[pts.length - 1];
	return (
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" className="ps-chart">
			<polyline fill="none" stroke="var(--bad)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={pts.map((p, i) => `${x(i)},${y(p.error)}`).join(" ")} />
			<polyline fill="none" stroke="var(--warn)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={pts.map((p, i) => `${x(i)},${y(p.warning)}`).join(" ")} />
			<title>{`kļūdas (sarkans) un brīdinājumi (dzeltens) pēc katras pārbaudes; pēdējā: ${last.error} un ${last.warning}`}</title>
		</svg>
	);
}
