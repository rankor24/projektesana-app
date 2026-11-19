// A floating tab group: dragged by its strip, resized from eight handles, brought to the front on a click. Adapted from
// BIM Crew apps/client/src/components/FloatingWindow.tsx: the drag and resize math, the local geometry override during a
// drag committed once on pointer-up, the eight resize handles. Changed: plain CSS classes, our layout store, and a drag
// that ends on a screen edge docks the group, and on another strip joins it (shell/drag.ts).
import { useCallback, useState, type ReactNode } from "react";
import { clampGeo, MIN_H, MIN_W, type FloatPlace, type Geo, type Group } from "../../shared/layout";
import { windows } from "../windows";
import { followMouse, track } from "./drag";
import { TabGroup } from "./TabGroup";

type Dir = "se" | "sw" | "ne" | "nw" | "e" | "w" | "s" | "n";
const vp = () => ({ w: window.innerWidth, h: window.innerHeight });

export function FloatingWindow({ group, focused, render }: { group: Group; focused: boolean; render: (id: string, filter?: string) => ReactNode }) {
	const p = group.place as FloatPlace;
	const id = group.active;
	const [live, setLive] = useState<Geo | null>(null);
	const geo = live ?? { x: p.x, y: p.y, w: p.w, h: p.h };

	const onMove = (e: React.MouseEvent) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
		windows.focus(id);
		const o = { x: p.x, y: p.y, w: p.w, h: p.h };
		track(e, id, group.tabs.length > 1 ? `${group.tabs.length} logi` : id, {
			onMove: (_x, _y, dx, dy) => setLive(clampGeo({ ...o, x: o.x + dx, y: o.y + dy }, vp())),
			onEnd(_x, _y, moved, target) {
				const final = live ?? o;
				setLive(null);
				if (!moved) return;
				if (target?.kind === "tabs") return windows.mergeGroup(id, target.targetId);
				if (target?.kind === "side") return windows.dock(id, target.side, { whole: true });
				windows.move(id, final.x, final.y);
			},
		});
	};

	const onResize = useCallback(
		(e: React.MouseEvent, dir: Dir) => {
			e.preventDefault();
			e.stopPropagation();
			windows.focus(id);
			const o = { x: p.x, y: p.y, w: p.w, h: p.h };
			const sx = e.clientX;
			const sy = e.clientY;
			let final: Geo = o;
			const move = (ev: MouseEvent) => {
				const dx = ev.clientX - sx;
				const dy = ev.clientY - sy;
				let { x, y, w, h } = o;
				if (dir.includes("e")) w = Math.max(MIN_W, o.w + dx);
				if (dir.includes("s")) h = Math.max(MIN_H, o.h + dy);
				if (dir.includes("w")) {
					w = Math.max(MIN_W, o.w - dx);
					x = o.x + (o.w - w);
				}
				if (dir.includes("n")) {
					h = Math.max(MIN_H, o.h - dy);
					y = o.y + (o.h - h);
				}
				final = clampGeo({ x, y, w, h }, vp());
				setLive(final);
			};
			const up = () => {
				windows.resize(id, final);
				setLive(null);
			};
			followMouse(move, up, { cursor: `${dir}-resize` });
		},
		[id, p.x, p.y, p.w, p.h],
	);

	return (
		<div className={`fw ${focused ? "fw-focused" : ""}`} style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 200 + p.z }} onMouseDown={() => windows.focus(id)}>
			<TabGroup group={group} render={render} mode="float" onStripDown={onMove} />
			{(["e", "w", "s", "n", "se", "sw", "ne", "nw"] as Dir[]).map((d) => (
				<div key={d} className={`fw-rz fw-rz-${d}`} onMouseDown={(e) => onResize(e, d)} />
			))}
		</div>
	);
}
