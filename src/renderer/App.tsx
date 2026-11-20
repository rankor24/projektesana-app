// One view: top bar, the rail, the work area (the viewer, or a full page, in the middle; a dock group on each of four sides)
// and the floating windows on top. Every window is in a tab group that floats or docks (task 9.0).
import { ComparePicker } from "./shell/ComparePicker";
import { useEffect, useState, type ReactNode } from "react";
import type { ProjectRow } from "../shared/api";
import { call, on } from "./bridge";
import { AgentDock } from "./shell/AgentDock";
import { Rail } from "./shell/Rail";
import { CommentTools } from "./shell/CommentTools";
import { commentSubject } from "./comment-subject";
import { useFactReview } from "./fact-review";
import { toolsFor } from "../shared/comment-tools";
import { DockArea, EdgeArea } from "./shell/DockArea";
import { Sidebar } from "./shell/Sidebar";
import { SplitHandle, useSplit } from "./shell/SplitHandle";
import { StatusStrip } from "./shell/StatusStrip";
import { Viewer } from "./shell/Preview";
import { ViewerPanel } from "./preview/ViewerPanels";
import { TelpasDiffs, TelpasInventory, TelpasInvArea, TelpasPlan } from "./panels/Telpas";
import { VersList, VersModels, VersRevit, VersSheets } from "./panels/Versijas";
import { CoordLinesPanel, CoordMatrixPanel, CoordReferencePanel, CoordScene } from "./shell/KoordScene";
import { TopBar } from "./shell/TopBar";
import { WindowLayer } from "./shell/WindowLayer";
import { ui, useUi } from "./state";
import { Empty } from "./ui";
import { Iestatijumi } from "./panels/Iestatijumi";
import { AgentiPage } from "./panels/AgentiPage";
import { Prasmes } from "./panels/Prasmes";
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
import { pageById, viewerShownOn } from "../shared/pages";
import { checkRelay, type RelayMsg } from "../shared/popout";
import { bimcraft } from "./preview/IfcView";
import { CHAT, THREADS, TOOLS } from "../shared/layout";
import { ThreadsWindow } from "./shell/ThreadList";
import { getLang, setLang, tr } from "./i18n";

/**
 * Mounts its children when it is first shown and then keeps them mounted, hidden: an iframe that is unmounted loads again
 * (BimCraft with a 120 MB model took seconds on every page change). Hidden means display:none, so it costs no layout.
 */
function KeepAlive({ show, children }: { show: boolean; children: ReactNode }) {
	const [seen, setSeen] = useState(show);
	useEffect(() => {
		if (show) setSeen(true);
	}, [show]);
	if (!show && !seen) return null;
	return <div className={`keep ${show ? "" : "keep-hidden"}`}>{children}</div>;
}

/** The body of any window: the chat, a panel, or one of the viewer's side panels (9.3). */
function Body({ id, filter }: { id: string; filter?: string }) {
	if (id === CHAT) return <AgentDock />;
	if (id === TOOLS) return <CommentTools />;
	if (id === THREADS) return <ThreadsWindow />;
	if (id in PANEL_TITLE) return <Panel id={id as PanelId} filter={filter} />;
	if (id.startsWith("viewer.")) return <ViewerPanel id={id} />;
	if (id === "coord.matrix") return <CoordMatrixPanel />;
	if (id === "coord.reference") return <CoordReferencePanel />;
	if (id === "coord.lines") return <CoordLinesPanel />;
	if (id === "telpas.diffs") return <TelpasDiffs />;
	if (id === "telpas.inventory") return <TelpasInventory />;
	if (id === "telpas.inv") return <TelpasInvArea />;
	if (id === "vers.list") return <VersList />;
	if (id === "vers.models") return <VersModels />;
	if (id === "vers.sheets") return <VersSheets />;
	if (id === "vers.revit") return <VersRevit />;
	return <Empty title={tr("nav skata")}>{WINDOW_TITLE[id] ?? id}</Empty>;
}

function KoordinacijaPage() {
	const { projectId } = useUi();
	return projectId ? <Koordinacija projectId={projectId} /> : <Empty title={tr("nav projekta")} />;
}
function NormativiPage() {
	const { projectId } = useUi();
	return <Normativi projectId={projectId} />;
}

/** A page's panel. The comment tools are a window of their own now (the tool bar), not a part of the page. */
function Panel({ id, filter }: { id: PanelId; filter?: string }) {
	const inner = <PanelBody id={id} filter={filter} />;
	if (toolsFor(id).length === 0) return inner;
	return (
		<div className="fill-col">
			<div className="page-scroll">{inner}</div>
		</div>
	);
}

function PanelBody({ id, filter }: { id: PanelId; filter?: string }) {
	if (id === "iestatijumi") return <Iestatijumi />;
	if (id === "prasmes") return <Prasmes />;
	if (id === "agenti") return <AgentiPage />;
	if (id === "projekts") return <Projekts />;
	if (id === "faili") return <Faili />;
	if (id === "grafiks") return <Grafiks />;
	if (id === "avoti") return <Avoti filter={filter} />;
	if (id === "telpas") return <Telpas />;
	if (id === "prasibas") return <Prasibas filter={filter} />;
	if (id === "atmina") return <Atmina filter={filter} />;
	if (id === "nodevumi") return <Nodevumi filter={filter} />;
	if (id === "versijas") return <Versijas />;
	if (id === "parskats") return <Parskats />;
	if (id === "koordinacija") return <KoordinacijaPage />;
	if (id === "normativi") return <NormativiPage />;
	return <Empty title={tr("nav projekta")}>{PANEL_TITLE[id]}</Empty>;
}

/** A layout window in its own OS window (task 9.11): the same renderer, showing that one window over its whole area. */
export function PopOut({ id }: { id: string }) {
	useEffect(() => on("data.changed", () => ui.bump()), []);
	useEffect(() => {
		void windows.init();
		// no viewer here: opening a file, going to a page and messages for the 3D view are done by the main window
		ui.onShow((t) => void call("layout.relay", { t: "show", target: t as never }).catch(() => undefined));
		bimcraft.setRelay((cmd) => void call("layout.relay", { t: "bimcraft", cmd: cmd as never }).catch(() => undefined));
		// the project follows the main window's (localStorage is shared between the windows)
		const onStore = (e: StorageEvent) => {
			if (e.key !== "projektesana:ui" || !e.newValue) return;
			try {
				ui.adoptProject((JSON.parse(e.newValue) as { projectId?: string | null }).projectId ?? null);
			} catch {
				// unreadable value: keep the project this window has
			}
		};
		window.addEventListener("storage", onStore);
		return () => window.removeEventListener("storage", onStore);
	}, []);
	const { tick } = useUi();
	useEffect(() => {
		call("settings.get").then((s) => {
			const dark = s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
			// the language in settings.json wins over this window's remembered one (a new window, a cleared storage): reload once into it
			if (s.language && s.language !== getLang()) {
				setLang(s.language);
				location.reload();
			}
		});
	}, [tick]);
	const body = <Body id={id} filter={windows.get().layout.filters[id]} />;
	return (
		<div className="app popout">
			<div className="popout-head">
				<b>{WINDOW_TITLE[id] ?? id}</b>
				<span className="grow" />
				<button className="ghost small" title={tr("Aizvērt šo logu: tas atgriežas galvenajā logā")} onClick={() => window.close()}>
					{tr("Atgriezt galvenajā logā")}</button>
			</div>
			<div className="popout-body">{body}</div>
		</div>
	);
}

/** What a pop-out asks of the main window arrives here. */
function runRelay(m: RelayMsg) {
	const bad = checkRelay(m);
	if (bad) return;
	if (m.t === "show") ui.show(m.target as never);
	else if (m.t === "go") windows.go(m.name, m.filter);
	else if (m.t === "bimcraft") bimcraft.send(m.cmd as never);
}

export function App() {
	useEffect(() => on("data.changed", () => ui.bump()), []);
	useEffect(() => on("layout.relay", ({ msg }) => runRelay(msg)), []);
	useEffect(() => {
		void windows.init();
		const refit = () => windows.refit();
		window.addEventListener("resize", refit);
		return () => window.removeEventListener("resize", refit);
	}, []);
	const { page, canvasFilter } = useWindows();
	useEffect(() => {
		commentSubject.clear();
	}, [page]);
	const def = pageById(page);
	const fullPage = def?.kind === "page" && !def.canvas ? page : null;
	const sceneCanvas = def?.canvas === "scene";
	const planCanvas = def?.canvas === "plan";
	const body = (id: string, filter?: string) => <Body id={id} filter={filter} />;
	const { tick, projectId, preview } = useUi();
	// a fact review needs the viewer: its card lives there and opens the cited source (task 9.7), also from a full page with nothing open
	const reviewing = useFactReview().current !== null;
	// the viewer is shown on pages that have it, and on a full page only while a file is open or a fact is reviewed
	const showViewer = viewerShownOn(page, !!preview || reviewing);
	// a full page and the file opened beside it share the main area at a split the user drags (B4), remembered
	const pageSplit = useSplit("projektesana:split:page", 50);
	const [row, setRow] = useState<ProjectRow | null>(null);
	useEffect(() => {
		call("settings.get").then((s) => {
			const dark = s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
		});
	}, [tick]);
	useEffect(() => {
		if (!projectId) {
			setRow(null);
			return;
		}
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
				<Sidebar render={body} />
				<div className="workspace">
					<DockArea side="top" render={body} />
					<div className="ws-mid">
						<DockArea side="left" render={body} />
						<EdgeArea render={body} />
						<main className={`canvas ${fullPage ? "canvas-page" : ""}`}>
							{fullPage && (
								<div ref={pageSplit.ref} className="page-body" style={showViewer ? { flex: `0 0 ${pageSplit.pct}%` } : undefined}>
									<Panel id={fullPage as PanelId} filter={canvasFilter} />
								</div>
							)}
							{fullPage && showViewer && <SplitHandle split={pageSplit} dir="row" />}
							{/* The model viewer and the 3D scene stay mounted once opened and are only hidden: a page change must not load a
						    120 MB model into BimCraft again. The tree here has the same shape on every page, so React never swaps them. */}
							<KeepAlive show={sceneCanvas}>
								<div className="scene-body">
									<div className="scene-view">
										<CoordScene />
									</div>
								</div>
							</KeepAlive>
							{planCanvas && (
								<div className="scene-body">
									<div className="scene-view">
										<TelpasPlan />
									</div>
								</div>
							)}
							<KeepAlive show={showViewer}>
								<div className="scene-body">
									<div className="scene-view">
										<Viewer active={showViewer} />
									</div>
								</div>
							</KeepAlive>
						</main>
						<DockArea side="right" render={body} />
					</div>
					<DockArea side="bottom" render={body} />
				</div>
			</div>
			<StatusStrip />
			<WindowLayer render={body} />
			<CommandPalette />
			<ComparePicker />
		</div>
	);
}
