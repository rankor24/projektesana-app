// One side of the work area: its dock group (a tab group) with a resize handle on the edge toward the canvas. A collapsed
// group is a strip of tab names; its body stays mounted when it holds the chat, so a run in progress is not lost.
// BIM Crew's App ResizeHandle for the single right-hand dock, here for four sides and a group each.
import type { ReactNode } from "react";
import { followMouse } from "./drag";
import { dockGroup, type DockPlace, type Side } from "../../shared/layout";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { TabGroup } from "./TabGroup";
import { tr } from "../i18n";

export function DockArea({ side, render }: { side: Side; render: (id: string, filter?: string) => ReactNode }) {
	const { layout } = useWindows();
	const g = dockGroup(layout, side);
	if (!g) return null;
	const p = g.place as DockPlace;
	const vertical = side === "left" || side === "right";

	const startResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const s0 = vertical ? e.clientX : e.clientY;
		const size0 = p.size;
		const sign = side === "left" || side === "top" ? 1 : -1;
		const move = (ev: MouseEvent) => windows.resizeDock(side, size0 + sign * ((vertical ? ev.clientX : ev.clientY) - s0));
		followMouse(move, () => {}, { cursor: vertical ? "col-resize" : "row-resize" });
	};

	// one structure for both states, so the group (and the chat in it) stays mounted when the side is collapsed
	return (
		<div className={`dock dock-${side} ${p.collapsed ? "dock-strip" : ""}`} style={p.collapsed ? undefined : vertical ? { width: p.size } : { height: p.size }}>
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
