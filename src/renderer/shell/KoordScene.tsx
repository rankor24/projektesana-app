// The Koordinācija page (task 9.8): every measured model in ONE 3D scene on the canvas (BimCraft's own federated models), the
// matrix of models × Novietne / Hierarhija / Stāvi docked at the bottom, the reference a tab beside the chat, and a window docked
// on the right with the lines of the cell that was clicked ("now → to") while the scene shows that model alone. Nothing here
// measures anything: the matrix is the audit the page already had (shared/coordination-matrix.ts).
import { useEffect, useMemo } from "react";
import type { ReportGroupName } from "../../core/coordination-types";
import type { CoordinationView } from "../../shared/api";
import { cellLines, cellText, rowQuestions, coordMatrix, sceneTarget } from "../../shared/coordination-matrix";
import { call } from "../bridge";
import { commentSubject } from "../comment-subject";
import { bimcraft, IfcView } from "../preview/IfcView";
import { Koordinacija } from "../panels/Koordinacija";
import { ui, useUi } from "../state";
import { Empty, Err, useLoad } from "../ui";
import { windows } from "../windows";
import { useSyncExternalStore } from "react";
import { tr } from "../i18n";

// ---- the clicked cell, shared by the matrix, the scene and the lines window ----
interface Sel {
	file: string | null;
	group: ReportGroupName | null;
}
let sel: Sel = { file: null, group: null };
const ls = new Set<() => void>();
export const coordSel = {
	get: () => sel,
	set(next: Sel) {
		sel = next;
		for (const l of ls) l();
	},
};
function useSel(): Sel {
	return useSyncExternalStore(
		(l) => (ls.add(l), () => ls.delete(l)),
		() => sel,
	);
}

function useCoord(projectId: string | null) {
	return useLoad<CoordinationView | null>(() => (projectId ? call("coordination.get", projectId, false) : Promise.resolve(null)), [projectId]);
}

/** The canvas of the page: all the models in one scene; the clicked model alone while a cell is chosen. */
export function CoordScene() {
	const { projectId } = useUi();
	const view = useCoord(projectId);
	const s = useSel();
	const matrix = useMemo(() => (view.data ? coordMatrix(view.data.audit, view.data.errors) : null), [view.data]);
	const files = view.data?.files ?? [];
	const key = files.map((f) => f.key).join("|");
	// one model alone, or all of them again, as the clicked cell says
	useEffect(() => {
		if (!matrix) return;
		const t = sceneTarget(matrix, s.file);
		const id = setTimeout(() => bimcraft.send({ pj: 1, type: "model", name: t }), 150);
		return () => clearTimeout(id);
	}, [matrix, s.file]);
	if (!projectId) return <Empty title={tr("nav projekta")}>{tr("Atver projektu.")}</Empty>;
	if (view.error) return <Err error={view.error} />;
	if (!view.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa modeļus…")}</div>;
	if (files.length === 0) return <Empty title={tr("nav modeļu")}>{tr("Mapē 1.2_Projekta dalas nav IFC modeļu, ko rādīt kopā.")}</Empty>;
	const load = (k: string) => () => call("models.bytes", projectId, k);
	return <IfcView key={key} projectId={projectId} name={tr("{n} modeļi", { n: files.length })} load={load(files[0].key)} scene={files.map((f) => ({ name: f.file, load: load(f.key) }))} />;
}

/** The matrix: a tick, a count or a dash per cell; a click on a cell opens its lines and isolates the model, a click on a name only isolates it. */
export function CoordMatrixPanel() {
	const { projectId } = useUi();
	const view = useCoord(projectId);
	const s = useSel();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	if (view.error) return <Err error={view.error} />;
	if (!view.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa…")}</div>;
	if (!view.data.reference) return <Empty title={tr("nav atsauces")}>{tr("Atsauci izveido cilnē Atsauce (blakus aģentam).")}</Empty>;
	const m = coordMatrix(view.data.audit, view.data.errors);
	const pick = (file: string, group: ReportGroupName | null, code: string) => {
		coordSel.set({ file, group });
		if (group) {
			commentSubject.pick({ thing: "cell", model: file, group }, `šūna ${code} · ${group}`);
			windows.openWindow("coord.lines");
			windows.dock("coord.lines", "right");
		}
	};
	return (
		<div className="pane fill">
			<div className="row">
				<b>{m.total === 0 ? tr("Visi modeļi sakrīt ar atsauci") : tr("{total} {v} {length} modeļos", { total: m.total, v: m.total === 1 ? "labojums" : "labojumi", length: m.rows.length })}</b>
				<span className="grow" />
				{s.file && (
					<button className="small" onClick={() => coordSel.set({ file: null, group: null })}>
						{tr("Rādīt visus modeļus")}</button>
				)}
			</div>
			<table className="coord-matrix">
				<thead>
					<tr>
						<th>{tr("Modelis")}</th>
						{m.groups.map((g) => (
							<th key={g} style={{ textAlign: "center" }}>{g}</th>
						))}
						<th style={{ textAlign: "center" }} title={tr("Jautājumi, kas vēl jāizlemj (bez tiem labojumu nevar pabeigt)")}>{tr("Vēl jāizlemj")}</th>
					</tr>
				</thead>
				<tbody>
					{m.rows.map((r) => (
						<tr key={r.file} className={s.file === r.file ? "sel" : ""}>
							<td className="click" title={r.note ?? r.file} onClick={() => coordSel.set({ file: r.file, group: null })}>
								<b>{r.code}</b> <span className="dim small">{r.file !== r.code ? r.file : ""}</span>
							</td>
							{r.cells.map((c) => (
								<td key={c.group} className={`cell ${c.state} ${s.file === r.file && s.group === c.group ? "on" : ""}`} style={{ textAlign: "center" }} onClick={() => c.state !== "none" && pick(r.file, c.group, r.code)} title={c.state === "none" ? (r.note ?? tr("nav ko mērīt")) : c.state === "ok" ? tr("sakrīt ar atsauci") : tr("{count} labojumi", { count: c.count })}>
									{cellText(c)}
								</td>
							))}
							{(() => {
								const q = rowQuestions(r);
								return (
									<td style={{ textAlign: "center" }} className={q.length ? "cell fix click" : "dim"} title={q.length ? q.join("\n") : tr("nav atvērtu jautājumu")} onClick={() => q.length && coordSel.set({ file: r.file, group: null })}>
										{q.length ? `? ${q.length}` : "—"}
									</td>
								);
							})()}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The lines of the clicked cell: "now → to", the question for the discipline lead, → aģentam. */
export function CoordLinesPanel() {
	const { projectId } = useUi();
	const view = useCoord(projectId);
	const s = useSel();
	if (!s.file || !s.group) return <Empty title={tr("nav šūnas")}>{tr("Klikšķini matricas šūnu: te būs tās labojumi.")}</Empty>;
	if (!view.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa…")}</div>;
	const m = coordMatrix(view.data.audit, view.data.errors);
	const lines = cellLines(m, s.file, s.group);
	const row = m.rows.find((r) => r.file === s.file);
	return (
		<div className="pane fill">
			<div className="row">
				<b>{row?.code ?? s.file}</b>
				<span className="chip">{s.group}</span>
				<span className="grow" />
				<button
					className="small"
					disabled={lines.length === 0}
					onClick={() => ui.focusAdd({ kind: "text", id: `coord:${s.file}:${s.group}`, label: `koordinācija ${row?.code ?? s.file} · ${s.group}`, data: { model: s.file, group: s.group, lines: lines.map((l) => l.text).slice(0, 20) } })}
				>
					{tr("→ aģentam")}</button>
			</div>
			{lines.length === 0 && <div className="dim small">{tr("Šajā šūnā labojumu nav.")}</div>}
			<table className="small">
				<tbody>
					{lines.map((l, i) => (
						<tr key={i}>
							<td>
								{l.text}
								{l.ask && <div className="warn-text">{l.ask}</div>}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The reference and the audit as they were (the editor and the HTML report), now a tab beside the chat. */
export function CoordReferencePanel() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return <Koordinacija projectId={projectId} />;
}


