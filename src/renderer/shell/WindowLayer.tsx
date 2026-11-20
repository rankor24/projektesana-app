// Everything that floats: the floating tab groups, the strip of minimised windows, and the drop hint while a window is
// dragged. Docked groups are drawn by the dock areas, not here. Adapted from BIM Crew WindowLayer.tsx.
import type { ReactNode } from "react";
import { floatGroups, snapZones, type Side } from "../../shared/layout";
import { WINDOW_TITLE, windows } from "../windows";
import { useDragHint, workZone } from "./drag";
import { FloatingWindow } from "./FloatingWindow";
import { useShownLayout } from "./visible";
import { tr } from "../i18n";

const SIDE_TEXT: Record<Side, string> = {
	left: tr("Piespraust pa kreisi"),
	right: tr("Piespraust pa labi"),
	top: tr("Piespraust augšā"),
	bottom: tr("Piespraust apakšā"),
};

/** The drop hint that follows the pointer while a window is dragged. Its own component: the windows do not render again with it. */
function DragHintLayer() {
	const hint = useDragHint();
	// while a window is dragged, every place it can dock in is drawn; the one under the pointer is lit
	const zone = hint ? workZone() : undefined;
	const lit = hint?.target?.kind === "side" ? hint.target.side : null;
	return (
		<>
			{zone &&
				snapZones(zone).map((r) => (
					<div key={r.side} className={`snap-zone ${lit === r.side ? "on" : ""}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
						<span>{SIDE_TEXT[r.side]}</span>
					</div>
				))}
			{hint?.target?.kind === "tabs" && <div className="drop-tabs-note" style={{ left: hint.x + 14, top: hint.y + 14 }}>{tr("kļūs par cilni")}</div>}
			{hint && <div className="drag-ghost" style={{ left: hint.x + 12, top: hint.y + 12 }}>{hint.label}</div>}
		</>
	);
}

export function WindowLayer({ render }: { render: (id: string, filter?: string) => ReactNode }) {
	// the page's own windows and the shared ones (B5); the others wait, where they were, for their page
	const layout = useShownLayout();
	const minimized = layout.groups.filter((g) => g.place.kind === "min");
	return (
		<div className="window-layer">
			{floatGroups(layout).map((g) => (
				<FloatingWindow key={g.tabs[0]} group={g} focused={g.tabs.includes(layout.focused ?? "")} render={render} />
			))}
			{minimized.length > 0 && (
				<div className="min-strip">
					{minimized.map((g) => (
						<button key={g.tabs[0]} className="chip" onClick={() => windows.open(g.active)} title={tr("Atjaunot {active}", { active: WINDOW_TITLE[g.active] ?? g.active })}>
							{g.tabs.map((t) => WINDOW_TITLE[t] ?? t).join(" · ")}
						</button>
					))}
				</div>
			)}
			<DragHintLayer />
		</div>
	);
}
