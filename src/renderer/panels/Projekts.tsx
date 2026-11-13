// Projekts: the project list (pick an office folder, BD code from its name), scan with progress, the one-time role
// questions for free 1.1.x folders, and the open project's profile (task 1.11).
import { useEffect, useState } from "react";
import type { ProjectRow, RoleQuestion, ScanProgress, ScanSummaryRow } from "../../shared/api";
import type { ProjectSummary } from "../../core/summary-types";
import { call, errText, on } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { Dashboard } from "./Dashboard";
import { Profile } from "./Profile";

export function Projekts() {
	const { projectId } = useUi();
	const [tab, setTab] = useState<"list" | "profile">(projectId ? "profile" : "list");
	return (
		<div className="fill-col">
			<div className="tabs">
				<button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>Projekti</button>
				<button className={tab === "profile" ? "on" : ""} disabled={!projectId} onClick={() => setTab("profile")}>Profils</button>
			</div>
			{tab === "list" || !projectId ? <ProjectList onOpen={() => setTab("profile")} /> : <Profile projectId={projectId} />}
		</div>
	);
}

export function useScanProgress(projectId: string | null): ScanProgress | null {
	const [p, setP] = useState<ScanProgress | null>(null);
	useEffect(
		() =>
			on("scan.progress", (e) => {
				if (e.projectId === projectId) setP(e.phase === "done" ? null : e);
			}),
		[projectId],
	);
	return p;
}

const PHASE: Record<ScanProgress["phase"], string> = { walk: "mapes", hash: "kontrolsummas", text: "teksts", done: "gatavs", error: "kļūda" };

export function ScanBar({ p }: { p: ScanProgress }) {
	if (p.phase === "error") return <div className="err">Nolasīšana neizdevās: {p.message}</div>;
	const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
	return (
		<div className="pane" style={{ padding: "4px 0" }}>
			<div className="row small">
				<span>
					{PHASE[p.phase]}: {p.done}
					{p.total ? ` / ${p.total}` : ""}
				</span>
				<span className="dim grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
					{p.current}
				</span>
			</div>
			{p.total > 0 && (
				<div className="progress">
					<div style={{ width: `${pct}%` }} />
				</div>
			)}
		</div>
	);
}

function ProjectList({ onOpen }: { onOpen: () => void }) {
	const { projectId } = useUi();
	const list = useLoad<ProjectRow[]>(() => call("projects.list"), []);
	const summaries = useLoad<ProjectSummary[]>(() => call("projects.summaries"), []);
	const [err, setErr] = useState<string | null>(null);
	const progress = useScanProgress(projectId);

	const add = async () => {
		setErr(null);
		try {
			const root = await call("dialog.pickFolder", "Projekta mape (nosaukums sākas ar BD kodu)");
			if (!root) return;
			const p = await call("projects.add", root);
			ui.setProject(p.id);
			await call("projects.scan", p.id);
			list.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};

	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={add}>Pievienot projektu…</button>
				<span className="dim small">Izvēlies biroja projekta mapi. Lasīta tiek tikai 01_Projektesana\1.1_Izejas dati; mapē nekas netiek rakstīts.</span>
			</div>
			{err && <div className="err">{err}</div>}
			{list.error ? <Err error={list.error} /> : null}
			{list.data && list.data.length === 0 && <Empty title="nav projekta">Pievieno pirmo projektu.</Empty>}
			{list.data && list.data.length > 0 && (
				<Dashboard
					projects={list.data}
					summaries={summaries.data ?? []}
					projectId={projectId}
					onOpen={(id) => (ui.setProject(id), onOpen())}
					onScan={(id) => call("projects.scan", id).catch((e) => setErr(errText(e)))}
					onForget={(id) => {
						if (confirm(`Noņemt ${id} no saraksta? Biroja mape un app dati paliek.`)) call("projects.forget", id).then(() => (id === projectId && ui.setProject(null), list.reload()));
					}}
				/>
			)}
			{progress && <ScanBar p={progress} />}
			{projectId && <RoleQuestions projectId={projectId} />}
			{projectId && <ScanSummary projectId={projectId} />}
		</div>
	);
}

export function RoleQuestions({ projectId }: { projectId: string }) {
	const q = useLoad<RoleQuestion[]>(() => call("projects.roleQuestions", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	if (!q.data?.length) return null;
	return (
		<div className="confirm">
			<b>Brīvo mapju loma (jautā vienreiz, atceras šim projektam)</b>
			{err && <div className="err">{err}</div>}
			{q.data.map((r) => (
				<div key={r.folderKey} className="row">
					<span className="mono">{r.folderName}</span>
					<span className="dim small">{r.files} faili</span>
					<span className="grow" />
					<select defaultValue={r.proposed} id={`role-${r.folderKey}`}>
						{r.options.map((o) => (
							<option key={o}>{o}</option>
						))}
					</select>
					<button
						onClick={() => {
							const v = (document.getElementById(`role-${r.folderKey}`) as HTMLSelectElement).value;
							call("projects.confirmRole", projectId, r.folderKey, v)
								.then(() => q.reload())
								.catch((e) => setErr(errText(e)));
						}}
					>
						Apstiprināt
					</button>
				</div>
			))}
		</div>
	);
}

function ScanSummary({ projectId }: { projectId: string }) {
	const s = useLoad<ScanSummaryRow | null>(() => call("projects.scanSummary", projectId), [projectId]);
	if (!s.data) return <div className="dim small">run scan — projekts vēl nav nolasīts.</div>;
	const d = s.data;
	return (
		<div className="small dim">
			Nolasīts {new Date(d.at).toLocaleString("lv-LV")}: {d.files} faili, {d.surveys} fotofiksācijas
			{d.skipped.archive ? `, arhīvā ${d.skipped.archive} faili netiek lasīti` : ""}. Jauni {d.added}, mainīti {d.changed}, pazuduši {d.gone}.
			{d.problems.map((p) => (
				<div key={p} className="err">
					{p}
				</div>
			))}
		</div>
	);
}
