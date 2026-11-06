// All open floating panel windows plus a strip of minimised ones. Adapted from BIM Crew WindowLayer.tsx
// (feat/floating-workspace-ui): docked windows render in the work area, not here.
import type { ReactNode } from "react";
import { useWindows, windows, type PanelId } from "../windows";
import { FloatingWindow } from "./FloatingWindow";

export function WindowLayer({ render }: { render: (id: PanelId, filter?: string) => ReactNode }) {
	const s = useWindows();
	const visible = s.windows.filter((w) => w.mode === "normal" || w.mode === "maximized");
	const minimized = s.windows.filter((w) => w.mode === "minimized");
	return (
		<div className="window-layer">
			{visible.map((w) => (
				<FloatingWindow key={w.id} win={w} focused={w.id === s.focused}>
					{render(w.id, w.filter)}
				</FloatingWindow>
			))}
			{minimized.length > 0 && (
				<div className="min-strip">
					{minimized.map((w) => (
						<button key={w.id} className="chip" onClick={() => windows.open(w.id)} title={`Atjaunot ${w.title}`}>
							{w.title}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
