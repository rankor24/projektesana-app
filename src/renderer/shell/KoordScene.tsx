// The Koordinācija page (task 9.8): the models the user ticks in ONE 3D scene on the canvas (BimCraft's own federated models;
// none is opened by itself, a 120 MB model is the user's choice), the matrix of models × Novietne / Hierarhija / Stāvi docked
// at the bottom, the reference a window of its own, and a window docked on the right with the lines of the cell that was
// clicked ("now → to") while the scene shows that model alone. Nothing here measures anything: the matrix is the audit the
// page already had (shared/coordination-matrix.ts). The page's top strip always has the buttons for its windows, so a closed
// matrix or reference is one click away.
import { useEffect, useMemo, useState } from "react";
import type { ReportGroupName } from "../../core/coordination-types";
import type { CoordinationView } from "../../shared/api";
import { cellLines, cellText, rowQuestions, coordMatrix, sceneTarget } from "../../shared/coordination-matrix";
import { call, errText } from "../bridge";
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

// ---- the models the user opened in the scene (kept per project; none by default) ----
const openKey = (pid: string) => `projektesana:coord-open:${pid}`;
const openCache = new Map<string, string[]>();
const openSubs = new Set<() => void>();
const NONE: string[] = [];
function readOpen(pid: string): string[] {
	try {
		const v = JSON.parse(localStorage.getItem(openKey(pid)) ?? "[]");
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}
export const coordOpen = {
	get(pid: string | null): string[] {
		if (!pid) return NONE;
		let v = openCache.get(pid);
		if (!v) openCache.set(pid, (v = readOpen(pid)));
		return v;
	},
	set(pid: string, files: string[]) {
		openCache.set(pid, files);
		try {
			localStorage.setItem(openKey(pid), JSON.stringify(files));
		} catch {
			// not remembered after a restart
		}
		for (const l of openSubs) l();
	},
	toggle(pid: string, file: string) {
		const cur = coordOpen.get(pid);
		coordOpen.set(pid, cur.includes(file) ? cur.filter((f) => f !== file) : [...cur, file]);
	},
	/** a model named in the matrix is shown too */
	add(pid: string, file: string) {
		if (!coordOpen.get(pid).includes(file)) coordOpen.set(pid, [...coordOpen.get(pid), file]);
	},
};
function useOpenFiles(pid: string | null): string[] {
	return useSyncExternalStore(
		(l) => (openSubs.add(l), () => openSubs.delete(l)),
		() => coordOpen.get(pid),
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
	const picked = useOpenFiles(projectId);
	const shown = files.filter((f) => picked.includes(f.file));
	const key = shown.map((f) => f.key).join("|");
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
	return (
		<div className="fill-col">
			<div className="coord-strip">
				<span className="dim small">{tr("Modeļi 3D skatā:")}</span>
				{files.map((f) => (
					<label key={f.key} className={`coord-model ${picked.includes(f.file) ? "on" : ""}`} title={f.file}>
						<input type="checkbox" checked={picked.includes(f.file)} onChange={() => coordOpen.toggle(projectId, f.file)} />
						<span>{f.file}</span>
					</label>
				))}
				<span className="grow" />
				<button className="small" title={tr("Atvērt vai aizvērt matricu")} onClick={() => windows.toggleOnPage("coord.matrix")}>
					{tr("Matrica")}
				</button>
				<button className="small" title={tr("Atvērt vai aizvērt atsauci: pamatpunkts, nosaukumi, stāvi")} onClick={() => windows.toggleOnPage("coord.reference")}>
					{tr("Atsauce")}
				</button>
			</div>
			{shown.length === 0 ? (
				<Empty title={tr("Neviens modelis nav atvērts")}>{tr("Atzīmē augšā modeļus, ko rādīt kopā. Nekas neatveras pats: modelis var būt simtiem megabaitu.")}</Empty>
			) : (
				<IfcView key={key} projectId={projectId} name={tr("{n} modeļi", { n: shown.length })} load={load(shown[0].key)} scene={shown.map((f) => ({ name: f.file, load: load(f.key) }))} />
			)}
		</div>
	);
}

/** The matrix: a tick, a count or a dash per cell; a click on a cell opens its lines and isolates the model, a click on a name only isolates it. */
export function CoordMatrixPanel() {
	const { projectId } = useUi();
	const view = useCoord(projectId);
	const s = useSel();
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	if (view.error) return <Err error={view.error} />;
	if (!view.data) return <div className="dim small" style={{ padding: 12 }}>{tr("lasa…")}</div>;
	if (!view.data.reference)
		return (
			<div className="pane fill">
				<Empty title={tr("nav atsauces")}>{tr("Matrica mēra katru modeli pret kopīgu atsauci (pamatpunkts, nosaukumi, stāvi). Atsauci var izveidot no pašiem modeļiem.")}</Empty>
				<div className="row" style={{ justifyContent: "center" }}>
					<button
						className="primary"
						disabled={busy || !view.data.models}
						onClick={() => {
							setBusy(true);
							setErr(null);
							call("coordination.seed", projectId)
								.then(() => view.reload())
								.catch((e) => setErr(errText(e)))
								.finally(() => setBusy(false));
						}}
					>
						{busy ? tr("Nolasa modeļus…") : tr("Izveidot atsauci no modeļiem")}
					</button>
					<button onClick={() => windows.openWindow("coord.reference")} title={tr("BIP vērtības un citi iestatījumi")}>
						{tr("Atvērt atsauces logu")}
					</button>
				</div>
				{err && <div className="err">{err}</div>}
			</div>
		);
	const m = coordMatrix(view.data.audit, view.data.errors);
	const pick = (file: string, group: ReportGroupName | null, code: string) => {
		coordOpen.add(projectId, file);
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
							<td className="click" title={r.note ?? r.file} onClick={() => (coordOpen.add(projectId, r.file), coordSel.set({ file: r.file, group: null }))}>
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

/** The reference and the audit (the editor and the HTML report): a window of its own, opened from the page's top strip. */
export function CoordReferencePanel() {
	const { projectId } = useUi();
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	return <Koordinacija projectId={projectId} />;
}


