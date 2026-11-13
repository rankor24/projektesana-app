// Projekti as a dashboard (task 8.4; decision 8: Projekti and Pārskats are one thing). On top, what needs the user today
// across all projects, worst first; below, one card per project: stage, next delivery, open findings, closest clock, last
// scan. Every number comes from the project's own stores through projects.summaries — nothing is kept twice.
import type { ProjectRow } from "../../shared/api";
import type { ProjectSummary } from "../../core/summary-types";
import { attentionAcross } from "../../shared/dashboard";
import { ui } from "../state";
import { Badge } from "../ui";
import { windows } from "../windows";

const when = (days: number) => (days < 0 ? `kavējas ${-days} d.` : days === 0 ? "šodien" : `pēc ${days} d.`);

export function Dashboard({ projects, summaries, projectId, onOpen, onScan, onForget }: { projects: ProjectRow[]; summaries: ProjectSummary[]; projectId: string | null; onOpen: (id: string) => void; onScan: (id: string) => void; onForget: (id: string) => void }) {
	const sum = new Map(summaries.map((s) => [s.id, s]));
	const attention = attentionAcross(summaries);
	const go = (pid: string, panel: "prasibas" | "nodevumi" | "projekts", filter?: string) => {
		ui.setProject(pid);
		windows.open(panel, filter);
	};
	return (
		<>
			<div className="dash-attention">
				<div className="dash-title">Šodien jāpievērš uzmanība</div>
				{attention.length === 0 ? (
					<div className="dim small">Nekā steidzama: nav kavētu termiņu, atvērtu kļūdu vai nenolasītu projektu.</div>
				) : (
					attention.slice(0, 12).map((a, i) => (
						<div key={i} className="dash-item click" onClick={() => go(a.projectId, a.open.panel, a.open.filter)}>
							<Badge tone={a.level === "bad" ? "bad" : "warn"}>{a.projectId}</Badge>
							<span>{a.text}</span>
						</div>
					))
				)}
				{attention.length > 12 && <div className="dim small">… vēl {attention.length - 12}</div>}
			</div>
			<div className="dash-grid">
				{projects.map((p) => {
					const s = sum.get(p.id);
					return (
						<div key={p.id} className={`dash-card ${p.id === projectId ? "sel" : ""}`}>
							<div className="row" style={{ alignItems: "baseline" }}>
								<b style={{ fontSize: 15 }}>{p.id}</b>
								{s?.stage ? <Badge tone="info">{s.stage}</Badge> : <span className="dim small">nav nodevumu</span>}
								{p.missing && <Badge tone="bad">mape nav pieejama</Badge>}
							</div>
							<div className="dash-name">{p.name}</div>
							<div className="dim small mono dash-root" title={p.root}>
								{p.root}
							</div>
							{s && (
								<div className="dash-facts">
									<div>
										<span className="dim">Atradumi</span>{" "}
										{s.findings.error ? <Badge tone="bad">{s.findings.error} kļūdas</Badge> : null} {s.findings.warning ? <Badge tone="warn">{s.findings.warning} brīdinājumi</Badge> : null}
										{!s.findings.error && !s.findings.warning ? <Badge tone="ok">0</Badge> : null}
										{s.findings.info > 0 && <span className="dim small"> +{s.findings.info} info</span>}
									</div>
									<div>
										<span className="dim">Nākamais nodevums</span>{" "}
										{s.next ? (
											<>
												{s.next.label} · {s.next.date} <Badge tone={s.next.daysLeft < 0 ? "bad" : s.next.daysLeft <= 7 ? "warn" : "dim"}>{when(s.next.daysLeft)}</Badge>
											</>
										) : (
											<span className="dim">nav plānots</span>
										)}
									</div>
									<div>
										<span className="dim">Termiņš</span>{" "}
										{s.clock ? (
											<>
												{s.clock.label} · {s.clock.due} <Badge tone={s.clock.state === "kavē" ? "bad" : s.clock.daysLeft <= 3 ? "warn" : "dim"}>{s.clock.state === "kavē" ? `kavē ${-s.clock.daysLeft} d.` : `${s.clock.daysLeft} darba d.`}</Badge>
											</>
										) : (
											<span className="dim">nav gaidāmu</span>
										)}
									</div>
									<div className="dim small">{s.lastScan ? `nolasīts ${new Date(s.lastScan).toLocaleString("lv-LV")}` : "run scan: vēl nav nolasīts"}</div>
								</div>
							)}
							<div className="row" style={{ marginTop: 8 }}>
								<button className="primary" onClick={() => onOpen(p.id)}>Atvērt</button>
								<button disabled={p.missing} onClick={() => onScan(p.id)}>Nolasīt</button>
								<span className="grow" />
								<button className="ghost" title="Noņem no saraksta. Mapes paliek." onClick={() => onForget(p.id)}>
									Noņemt
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</>
	);
}
