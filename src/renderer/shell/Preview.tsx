// The viewer (task 9.3): one tab per open file in one pane or two, side by side or one above the other, each pane with its own
// tabs; a file bar with the name only; the viewer's side panels (Īpašības, Elementu koks, IFC metadati, Faila metadati,
// Komentāri / BCF) are layout windows that float over it or dock to its sides (shell/ViewerPanels.tsx). A pane shows a source
// (PDF or text view), a model (IFC), a comparison or a law act; which view is chosen from the file's type.
import { useEffect } from "react";
import type { Source } from "../../core/model";
import { activeTab, targetLabel, type ViewTarget } from "../../shared/viewer";
import { call } from "../bridge";
import { SourcePdf } from "../preview/SourcePdf";
import { PdfView } from "../preview/PdfView";
import { IfcView } from "../preview/IfcView";
import { SheetCompare } from "../preview/SheetCompare";
import { DwgCompareView, DwgView } from "../preview/DwgView";
import { TextCompare } from "../preview/TextCompare";
import { TextView } from "../preview/TextView";
import { LawView } from "../preview/LawView";
import { ui, useUi } from "../state";
import { Empty, useLoad } from "../ui";
import { viewer, useViewer } from "../viewer-store";
import { FactCard } from "../preview/FactCard";
import { WINDOW_TITLE, windows } from "../windows";
import { tr } from "../i18n";

export function sourceExt(s: Source): string {
	const name = s.container?.inner ?? s.paths.find((p) => !p.includes("::")) ?? s.paths[0]?.split("::")[1] ?? "";
	return (/\.[^.\\/]+$/.exec(name)?.[0] ?? "").toLowerCase();
}

const PANEL_BTNS = ["viewer.props", "viewer.tree", "viewer.ifcmeta", "viewer.filemeta", "viewer.comments"] as const;

/** The viewer: the file bars, the split, the link buttons and the panes. Replaces the old single preview. */
/** `active`: the viewer is on screen. Hidden (another page) it stays loaded but gives up the focus and the chat context. */
export function Viewer({ active = true }: { active?: boolean }) {
	const { projectId, preview } = useUi();
	const v = useViewer();
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	const titleOf = (id: string) => sources.data?.find((s) => s.id === id)?.title;

	// a file is opened with ui.show(...) from anywhere: it becomes a tab here
	useEffect(() => {
		ui.onShow((t) => (t ? viewer.open(t as ViewTarget) : viewer.closeAll()));
		return () => ui.onShow(null);
	}, []);

	// what the chat's Auto mode sends: which file is open in the focused pane (selection, camera, page: the views report them)
	const srcTitle = preview?.kind === "source" ? titleOf(preview.sourceId) : undefined;
	useEffect(() => {
		if (!active) return;
		if (!preview) {
			ui.setView({ kind: null });
			return;
		}
		if (preview.kind === "ifc") ui.setView({ kind: "ifc", label: preview.label, path: preview.path, sourceId: undefined });
		else if (preview.kind === "pdf" || preview.kind === "dwg") ui.setView({ kind: "source", label: preview.label, sourceId: undefined, path: preview.path });
		else if (preview.kind === "compare") ui.setView({ kind: "compare", label: `${preview.aLabel} ↔ ${preview.bLabel}`, path: `${preview.a}|${preview.b}`, sourceId: undefined });
		else if (preview.kind === "law") ui.setView({ kind: "law", label: "likums", sourceId: preview.sourceId, path: undefined });
		else {
			const s = sources.data?.find((x) => x.id === preview.sourceId);
			ui.setView({ kind: s && sourceExt(s) === ".ifc" ? "ifc" : "source", label: srcTitle ?? preview.sourceId, sourceId: preview.sourceId, path: undefined, ...(preview.page ? { page: preview.page } : {}) });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preview, srcTitle, active]);

	const two = v.panes.length === 2;
	return (
		<section className="preview viewer">
			<div className="viewer-top">
				<span className="dim small">{tr("Skats")}</span>
				<button className="ghost small" title={tr("Sadalīt: divi skati blakus")} disabled={!activeTab(v)} onClick={() => viewer.split("h")}>◫</button>
				<button className="ghost small" title={tr("Sadalīt: viens virs otra")} disabled={!activeTab(v)} onClick={() => viewer.split("v")}>⬒</button>
				{two && <button className="ghost small" title={tr("Atpakaļ uz vienu skatu")} onClick={() => viewer.unsplit()}>▭</button>}
				{two && (
					<>
						<label className="small" title={tr("Abu modeļu kamera kustas kopā")}><input type="checkbox" checked={v.linkedCamera} onChange={(e) => viewer.linkCamera(e.target.checked)} /> {tr("kamera")}</label>
						<label className="small" title={tr("Abu dokumentu lapa mainās kopā")}><input type="checkbox" checked={v.linkedPage} onChange={(e) => viewer.linkPage(e.target.checked)} /> {tr("lapa")}</label>
					</>
				)}
				<span className="grow" />
				{PANEL_BTNS.map((id) => (
					<button key={id} className="ghost small" title={tr("Atvērt logu — to var vilkt un piespraust malās")} onClick={() => windows.openWindow(id)}>
						{WINDOW_TITLE[id]}
					</button>
				))}
			</div>
			<div className={`viewer-panes ${two ? (v.split === "v" ? "col" : "row") : ""}`}>
				{v.panes.map((p, i) => (
					<div key={i} className={`viewer-pane ${v.focused === i && two ? "focused" : ""}`} onMouseDown={() => viewer.focusPane(i)}>
						<div className="viewer-tabs">
							{p.tabs.map((id) => {
								const t = v.tabs.find((x) => x.id === id)!;
								return (
									<div key={id} className={`viewer-tab ${p.active === id ? "on" : ""}`} onClick={() => viewer.activate(id, i)} title={targetLabel(t.target, titleOf)}>
										<span>{targetLabel(t.target, titleOf)}</span>
										{two && v.panes[1 - i].tabs.includes(id) === false && (
											<button className="ghost small" title={tr("Uz otru skatu")} onClick={(e) => (e.stopPropagation(), viewer.moveTab(id, 1 - i))}>⇄</button>
										)}
										<button className="x" title={tr("Aizvērt")} onClick={(e) => (e.stopPropagation(), viewer.close(id))}>×</button>
									</div>
								);
							})}
							{p.tabs.length === 0 && !two && <span className="dim small" style={{ padding: "6px 10px" }}>{tr("nav atvērtu failu")}</span>}
							{two && p.tabs.length > 0 && <button className="ghost small" title={tr("Šajā skatā atvērt otru failu: izvēlies to sarakstā")} onClick={() => viewer.focusPane(i)}>＋</button>}
						</div>
						<div className="viewer-pane-body">
							<ViewPane target={v.tabs.find((t) => t.id === p.active)?.target ?? null} paneIndex={i} focused={v.focused === i && active} sources={sources.data} loading={sources.loading} />
						</div>
					</div>
				))}
			</div>
			<FactCard />
		</section>
	);
}

/** What one pane shows for a target. */
function ViewPane({ target, paneIndex, focused, sources, loading }: { target: ViewTarget | null; paneIndex: number; focused: boolean; sources: Source[] | null; loading: boolean }) {
	const { projectId } = useUi();
	// the law library is global: its acts open without a project
	if (target?.kind === "law") return <LawView key={target.sourceId} sourceId={target.sourceId} quote={target.quote} />;
	if (!projectId) return <Empty title={tr("nav projekta")}>{tr("Atver vai pievieno projektu (augšā: projekta nosaukums).")}</Empty>;
	if (!target) return <Empty title={tr("nav avota")}>{tr("Izvēlies avotu sarakstā Avoti vai failu sarakstā Faili.")}</Empty>;
	const modelLoad = (ref: string) => () => (ref.startsWith("rev:") ? call("revisions.ifc", projectId, ref.slice(4)) : call("models.bytes", projectId, ref));
	if (target.kind === "ifc") return <IfcView projectId={projectId} key={target.path} name={target.label} load={modelLoad(target.path)} paneIndex={paneIndex} focused={focused} />;
	if (target.kind === "compare" && target.mode === "ifc")
		return <IfcView projectId={projectId} key={`${target.a}|${target.b}`} name={target.aLabel} load={modelLoad(target.a)} compareWith={{ name: target.bLabel, load: modelLoad(target.b) }} paneIndex={paneIndex} focused={focused} />;
	// a PDF from the Faili tab that the scan did not register: view only, no pins or geometry (those hang on a source)
	if (target.kind === "pdf") return <PdfView key={target.path} load={() => call("sheets.bytes", projectId, target.path)} title={target.label} onPage={(pg) => focused && ui.setView({ page: pg })} />;
	if (target.kind === "dwg") return <DwgView key={target.path} projectId={projectId} path={target.path} title={target.label} />;
	if (target.kind === "compare" && target.mode === "dwg") return <DwgCompareView key={`${target.a}|${target.b}`} projectId={projectId} a={target.a} b={target.b} aLabel={target.aLabel} bLabel={target.bLabel} />;
	if (target.kind === "compare" && target.mode === "text") return <TextCompare key={`${target.a}|${target.b}`} projectId={projectId} a={target.a} b={target.b} aLabel={target.aLabel} bLabel={target.bLabel} />;
	if (target.kind === "compare") return <SheetCompare projectId={projectId} a={target.a} b={target.b} aLabel={target.aLabel} bLabel={target.bLabel} only={target.only} paneIndex={paneIndex} />;
	const s = sources?.find((x) => x.id === target.sourceId);
	if (!s) return <Empty title={tr("nav avota")}>{loading ? "…" : tr("Avots vairs nav sarakstā.")}</Empty>;
	// an IFC the scan found (Avoti, the agent's show_source): the 3D view, not the text view that has nothing to show
	if (sourceExt(s) === ".dwg") return <DwgView key={s.id} projectId={projectId} path={`src:${s.id}`} title={s.title} />;
	if (sourceExt(s) === ".ifc") return <IfcView projectId={projectId} key={s.id} name={s.title} load={() => call("models.bytes", projectId, `src:${s.id}`)} paneIndex={paneIndex} focused={focused} />;
	return sourceExt(s) === ".pdf" ? (
		<SourcePdf key={s.id} projectId={projectId} sourceId={s.id} title={s.title} page={target.page} quote={target.quote} paneIndex={paneIndex} focused={focused} />
	) : (
		<TextView sourceId={s.id} title={s.title} page={target.page} />
	);
}
