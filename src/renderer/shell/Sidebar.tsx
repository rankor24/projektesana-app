// The list sidebar (B3): the list pages (Avoti, Faili, Prasības, Telpas, Normatīvi, Atmiņa) open here, between the rail and
// the chat, as on the layout board and in BIM Crew (App.tsx: the secondary column, ProjectSidebar / SessionSidebar, and its
// ResizeHandle with collapseThreshold). It collapses three ways, as BIM Crew's does: a second click on its rail item, the
// « button in its header, or dragging its edge past the minimum. The edge drag uses our followMouse, not pointer capture:
// the cover sheet keeps the BimCraft iframe from taking the release, and the width is written to the element while dragging
// and saved once on release, so the viewer beside it is not redrawn for every pixel (C1).
import { useRef, type ReactNode } from "react";
import { groupOf, SIDEBAR_COLLAPSE, SIDEBAR_MAX, SIDEBAR_MIN } from "../../shared/layout";
import { pageById } from "../../shared/pages";
import { Icon } from "../icons";
import { tr } from "../i18n";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { followMouse } from "./drag";

export function Sidebar({ render }: { render: (id: string, filter?: string) => ReactNode }) {
	const { sidebar, layout } = useWindows();
	const box = useRef<HTMLDivElement>(null);
	// a list the user made a window is drawn there, never twice
	if (!sidebar.open || !sidebar.id || groupOf(layout, sidebar.id)) return null;
	const id = sidebar.id;
	const def = pageById(id);

	const startResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const x0 = e.clientX;
		const w0 = sidebar.width;
		let w = w0;
		let gone = false;
		let raf = 0;
		followMouse(
			(ev) => {
				const raw = w0 + (ev.clientX - x0);
				// BIM Crew ResizeHandle: past the minimum by the threshold, the column closes instead of stopping
				gone = raw < SIDEBAR_MIN - SIDEBAR_COLLAPSE;
				w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, raw));
				cancelAnimationFrame(raf);
				raf = requestAnimationFrame(() => {
					if (!box.current) return;
					box.current.style.width = `${w}px`;
					box.current.style.opacity = gone ? "0.45" : "";
				});
			},
			() => {
				cancelAnimationFrame(raf);
				if (box.current) box.current.style.opacity = "";
				if (gone) return windows.closeSidebar();
				windows.setSidebarWidth(w);
			},
			{ cursor: "col-resize" },
		);
	};

	return (
		<aside ref={box} className="sidebar" style={{ width: sidebar.width }} aria-label={WINDOW_TITLE[id] ?? id}>
			<div className="sidebar-head">
				<b className="sidebar-title" title={def ? tr(def.hint) : undefined}>
					{WINDOW_TITLE[id] ?? id}
				</b>
				<span className="grow" />
				<button className="sidebar-btn" title={tr("Atvērt kā logu: to var vilkt un piespraust malās")} aria-label={tr("Atvērt kā logu")} onClick={() => windows.sidebarToWindow()}>
					<Icon name="winFloat" size={14} />
				</button>
				<button className="sidebar-btn" title={tr("Sakļaut sānjoslu (arī otrs klikšķis uz tās joslas ikonas)")} aria-label={tr("Sakļaut sānjoslu")} onClick={() => windows.closeSidebar()}>
					<Icon name="panelClose" size={14} />
				</button>
			</div>
			<div className="sidebar-body">{render(id, sidebar.filter)}</div>
			<div className="sidebar-resize" role="separator" aria-orientation="vertical" onMouseDown={startResize} />
		</aside>
	);
}
