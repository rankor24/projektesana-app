// Everything that floats: the floating tab groups, the strip of minimised windows, and the drop hint while a window is
// dragged. Docked groups are drawn by the dock areas, not here. Adapted from BIM Crew WindowLayer.tsx.
import type { ReactNode } from "react";
import { floatGroups } from "../../shared/layout";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { useDragHint } from "./drag";
import { FloatingWindow } from "./FloatingWindow";

const SIDE_BOX: Record<string, React.CSSProperties> = {
	left: { left: 0, top: 0, bottom: 0, width: "30%" },
	right: { right: 0, top: 0, bottom: 0, width: "30%" },
	top: { left: 0, right: 0, top: 0, height: "35%" },
	bottom: { left: 0, right: 0, bottom: 0, height: "35%" },
};

export function WindowLayer({ render }: { render: (id: string, filter?: string) => ReactNode }) {
	const { layout } = useWindows();
	const hint = useDragHint();
	const minimized = layout.groups.filter((g) => g.place.kind === "min");
	return (
		<div className="window-layer">
			{floatGroups(layout).map((g) => (
				<FloatingWindow key={g.tabs[0]} group={g} focused={g.tabs.includes(layout.focused ?? "")} render={render} />
			))}
			{minimized.length > 0 && (
				<div className="min-strip">
					{minimized.map((g) => (
						<button key={g.tabs[0]} className="chip" onClick={() => windows.open(g.active)} title={`Atjaunot ${WINDOW_TITLE[g.active] ?? g.active}`}>
							{g.tabs.map((t) => WINDOW_TITLE[t] ?? t).join(" · ")}
						</button>
					))}
				</div>
			)}
			{hint?.target?.kind === "side" && <div className="drop-side" style={SIDE_BOX[hint.target.side]} />}
			{hint?.target?.kind === "tabs" && <div className="drop-tabs-note" style={{ left: hint.x + 14, top: hint.y + 14 }}>kļūs par cilni</div>}
			{hint && <div className="drag-ghost" style={{ left: hint.x + 12, top: hint.y + 12 }}>{hint.label}</div>}
		</div>
	);
}
