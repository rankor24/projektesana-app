// One view: top bar, the rail, the work area (the viewer, or a full page, in the middle; a dock group on each of four sides)
// and the floating windows on top. Every window is in a tab group that floats or docks (task 9.0).
import { useEffect, useState } from "react";
import type { ProjectRow } from "../shared/api";
import { call, on } from "./bridge";
import { AgentDock } from "./shell/AgentDock";
import { Rail } from "./shell/Rail";
import { CommentTools } from "./shell/CommentTools";
import { commentSubject } from "./comment-subject";
import { toolsFor } from "../shared/comment-tools";
import { DockArea } from "./shell/DockArea";
import { StatusStrip } from "./shell/StatusStrip";
import { Viewer } from "./shell/Preview";
import { ViewerPanel } from "./preview/ViewerPanels";
import { CoordLinesPanel, CoordMatrixPanel, CoordReferencePanel, CoordScene } from "./shell/KoordScene";
import { TopBar } from "./shell/TopBar";
import { WindowLayer } from "./shell/WindowLayer";
import { ui, useUi } from "./state";
import { Empty } from "./ui";
import { Iestatijumi } from "./panels/Iestatijumi";
import { Projekts } from "./panels/Projekts";
import { Avoti } from "./panels/Avoti";
import { Faili } from "./panels/Faili";
import { Grafiks } from "./panels/Grafiks";
import { CommandPalette } from "./shell/CommandPalette";
import { Telpas } from "./panels/Telpas";
import { Prasibas } from "./panels/Prasibas";
import { Atmina } from "./panels/Atmina";
import { Nodevumi } from "./panels/Nodevumi";
import { Versijas } from "./panels/Versijas";
import { Parskats } from "./panels/Parskats";
import { Koordinacija } from "./panels/Koordinacija";
import { Normativi } from "./panels/Normativi";
import { PANEL_TITLE, WINDOW_TITLE, useWindows, windows, type PanelId } from "./windows";
import { pageById } from "../shared/pages";
import { CHAT } from "../shared/layout";

/** The body of any window: the chat, a panel, or one of the viewer's side panels (9.3). */
function Body({ id, filter }: { id: string; filter?: string }) {
	if (id === CHAT) return <AgentDock />;
	if (id in PANEL_TITLE) return <Panel id={id as PanelId} filter={filter} />;
	if (id.startsWith("viewer.")) return <ViewerPanel id={id} />;
	if (id === "coord.matrix") return <CoordMatrixPanel />;
	if (id === "coord.reference") return <CoordReferencePanel />;
	if (id === "coord.lines") return <CoordLinesPanel />;
	return <Empty title="nav skata">{WINDOW_TITLE[id] ?? id}</Empty>;
}

function KoordinacijaPage() {
	const { projectId } = useUi();
	return projectId ? <Koordinacija projectId={projectId} /> : <Empty title="nav projekta" />;
}
function NormativiPage() {
	const { projectId } = useUi();
	return <Normativi projectId={projectId} />;
}

/** A page with comment tools: the panel above, the comment strip under it. */
function Panel({ id, filter }: { id: PanelId; filter?: string }) {
	const inner = <PanelBody id={id} filter={filter} />;
	if (toolsFor(id).length === 0) return inner;
	return (
		<div className="fill-col">
			<div className="page-scroll">{inner}</div>
			<CommentTools page={id} />
		</div>
	);
}

function PanelBody({ id, filter }: { id: PanelId; filter?: string }) {
	if (id === "iestatijumi") return <Iestatijumi />;
	if (id === "projekts") return <Projekts />;
	if (id === "faili") return <Faili />;
	if (id === "grafiks") return <Grafiks />;
	if (id === "avoti") return <Avoti filter={filter} />;
	if (id === "telpas") return <Telpas />;
	if (id === "prasibas") return <Prasibas filter={filter} />;
	if (id === "atmina") return <Atmina />;
	if (id === "nodevumi") return <Nodevumi filter={filter} />;
	if (id === "versijas") return <Versijas />;
	if (id === "parskats") return <Parskats />;
	if (id === "koordinacija") return <KoordinacijaPage />;
	if (id === "normativi") return <NormativiPage />;
	return <Empty title="nav projekta">{PANEL_TITLE[id]}</Empty>;
}

export function App() {
	useEffect(() => on("data.changed", () => ui.bump()), []);
	useEffect(() => {
		void windows.init();
		const refit = () => windows.refit();
		window.addEventListener("resize", refit);
		return () => window.removeEventListener("resize", refit);
	}, []);
	const { page, canvasFilter } = useWindows();
	useEffect(() => commentSubject.clear(), [page]);
	const def = pageById(page);
	const fullPage = def?.kind === "page" && def.canvas !== "scene" ? page : null;
	const sceneCanvas = def?.canvas === "scene";
	const body = (id: string, filter?: string) => <Body id={id} filter={filter} />;
	const { tick, projectId, preview } = useUi();
	const [row, setRow] = useState<ProjectRow | null>(null);
	useEffect(() => {
		call("settings.get").then((s) => {
			const dark = s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
		});
	}, [tick]);
	useEffect(() => {
		if (!projectId) return setRow(null);
		call("projects.list")
			.then((l) => {
				const r = l.find((p) => p.id === projectId) ?? null;
				setRow(r);
				// a project removed from the list is no longer open
				if (!r) ui.setProject(null);
			})
			.catch(() => setRow(null));
	}, [projectId, tick]);
	return (
		<div className="app">
			<TopBar projectLabel={row ? row.name : null} openFindings={row ? row.openFindings : null} openInfo={row?.openInfo ?? 0} stage={row?.stage ?? null} />
			<div className="body">
				<Rail />
				<div className="workspace">
					<DockArea side="top" render={body} />
					<div className="ws-mid">
						<DockArea side="left" render={body} />
						<main className={`canvas ${fullPage ? "canvas-page" : ""}`}>
							{fullPage && (
								<div className="page-body">
									<Panel id={fullPage as PanelId} filter={canvasFilter} />
								</div>
							)}
							{sceneCanvas && (
								<div className="scene-body">
									<div className="scene-view">
										<CoordScene />
									</div>
									<CommentTools page={page} />
								</div>
							)}
							{!sceneCanvas && (!fullPage || preview) && <Viewer />}
						</main>
						<DockArea side="right" render={body} />
					</div>
					<DockArea side="bottom" render={body} />
				</div>
			</div>
			<StatusStrip />
			<WindowLayer render={body} />
			<CommandPalette />
		</div>
	);
}
