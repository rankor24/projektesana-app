// One side of the work area: its dock group (a tab group) with a resize handle on the edge toward the canvas. A collapsed
// group is a strip of tab names; its body stays mounted when it holds the chat, so a run in progress is not lost.
// BIM Crew's App ResizeHandle for the single right-hand dock, here for four sides and a group each.
import { useRef, type ReactNode } from "react";
import { followMouse } from "./drag";
import { clampDock, dockGroup, type DockPlace, type Side } from "../../shared/layout";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { TabGroup } from "./TabGroup";
import { tr } from "../i18n";

export function DockArea({ side, render }: { side: Side; render: (id: string, filter?: string) => ReactNode }) {
	const { layout } = useWindows();
	const box = useRef<HTMLDivElement>(null);
	const g = dockGroup(layout, side);
	if (!g) return null;
	const p = g.place as DockPlace;
	const vertical = side === "left" || side === "right";

	// the size is written to the element while the edge is dragged and committed once on release: the canvas (a model viewer)
	// beside the dock is not rendered again for every pixel
	const startResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const s0 = vertical ? e.clientX : e.clientY;
		const size0 = p.size;
		const sign = side === "left" || side === "top" ? 1 : -1;
		let size = size0;
		let raf = 0;
		const show = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const el = box.current;
				if (el) el.style[vertical ? "width" : "height"] = `${size}px`;
			});
		};
		const move = (ev: MouseEvent) => {
			size = clampDock(side, size0 + sign * ((vertical ? ev.clientX : ev.clientY) - s0), { w: window.innerWidth, h: window.innerHeight });
			show();
		};
		followMouse(move, () => {
			cancelAnimationFrame(raf);
			if (box.current) box.current.style[vertical ? "width" : "height"] = `${size}px`;
			windows.resizeDock(side, size);
		}, { cursor: vertical ? "col-resize" : "row-resize" });
	};

	// one structure for both states, so the group (and the chat in it) stays mounted when the side is collapsed
	return (
		<div ref={box} className={`dock dock-${side} ${p.collapsed ? "dock-strip" : ""}`} style={p.collapsed ? undefined : vertical ? { width: p.size } : { height: p.size }}>
			{p.collapsed && (
				<div className="dock-strip-btns">
					{g.tabs.map((id) => (
						<button key={id} className="dock-strip-btn" title={tr("Atvērt {id}", { id: WINDOW_TITLE[id] ?? id })} onClick={() => windows.open(id)}>
							{WINDOW_TITLE[id] ?? id}
						</button>
					))}
				</div>
			)}
			<div className="dock-main" style={p.collapsed ? { display: "none" } : undefined}>
				<TabGroup group={g} render={render} mode="dock" />
			</div>
			{!p.collapsed && <div className={`dock-resize dock-resize-${side}`} onMouseDown={startResize} />}
		</div>
	);
}
