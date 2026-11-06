// A draggable / resizable / maximisable / minimisable / dockable panel window.
// Adapted from BIM Crew apps/client/src/components/FloatingWindow.tsx (branch feat/floating-workspace-ui): the drag and
// resize math, the local geometry override during a drag committed once on pointer-up, the eight resize handles.
// Changed: plain CSS classes instead of Tailwind, no icon library, our window store.
import { useCallback, useState, type ReactNode } from "react";
import { windows, type WindowState } from "../windows";

const MIN_W = 360;
const MIN_H = 240;

type Geo = { x: number; y: number; w: number; h: number };
type Dir = "se" | "sw" | "ne" | "nw" | "e" | "w" | "s" | "n";

function clamp({ x, y, w, h }: Geo): Geo {
	const cw = Math.max(MIN_W, Math.min(w, window.innerWidth - 16));
	const ch = Math.max(MIN_H, Math.min(h, window.innerHeight - 16));
	return { x: Math.max(0, Math.min(x, window.innerWidth - cw)), y: Math.max(0, Math.min(y, window.innerHeight - ch)), w: cw, h: ch };
}

export function FloatingWindow({ win, focused, children }: { win: WindowState; focused: boolean; children: ReactNode }) {
	const [live, setLive] = useState<Geo | null>(null);
	const geo = live ?? { x: win.x, y: win.y, w: win.w, h: win.h };
	const maximized = win.mode === "maximized";

	const track = useCallback((e: React.MouseEvent, next: (dx: number, dy: number) => Geo, commit: (g: Geo) => void) => {
		e.preventDefault();
		e.stopPropagation();
		windows.focus(win.id);
		const sx = e.clientX;
		const sy = e.clientY;
		let final: Geo = { x: win.x, y: win.y, w: win.w, h: win.h };
		const onMove = (ev: MouseEvent) => {
			final = clamp(next(ev.clientX - sx, ev.clientY - sy));
			setLive(final);
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			commit(final);
			setLive(null);
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	}, [win.id, win.x, win.y, win.w, win.h]);

	const onDrag = (e: React.MouseEvent) => {
		if (maximized || (e.target as HTMLElement).closest("button")) return;
		track(e, (dx, dy) => ({ x: win.x + dx, y: win.y + dy, w: win.w, h: win.h }), (g) => windows.move(win.id, g.x, g.y));
	};

	const onResize = (e: React.MouseEvent, dir: Dir) => {
		if (maximized) return;
		const o = { x: win.x, y: win.y, w: win.w, h: win.h };
		track(
			e,
			(dx, dy) => {
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
				return { x, y, w, h };
			},
			(g) => windows.resize(win.id, g),
		);
	};

	const zIndex = 200 + win.z;
	const style: React.CSSProperties = maximized ? { left: 8, top: 8, right: 8, bottom: 8, zIndex } : { left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex };

	return (
		<div className={`fw ${focused ? "fw-focused" : ""}`} style={style} onMouseDown={() => windows.focus(win.id)}>
			<div className={`fw-title ${maximized ? "" : "fw-grab"}`} onMouseDown={onDrag} onDoubleClick={() => windows.mode(win.id, maximized ? "normal" : "maximized")}>
				<span>{win.title}</span>
				<div className="fw-buttons">
					<button title="Minimizēt" onClick={() => windows.mode(win.id, "minimized")}>–</button>
					<button title="Piespraust blakus čatam" onClick={() => windows.mode(win.id, "docked")}>⇥</button>
					<button title={maximized ? "Atjaunot" : "Maksimizēt"} onClick={() => windows.mode(win.id, maximized ? "normal" : "maximized")}>{maximized ? "❐" : "□"}</button>
					<button title="Aizvērt" className="fw-close" onClick={() => windows.close(win.id)}>×</button>
				</div>
			</div>
			<div className="fw-body">{children}</div>
			{!maximized &&
				(["e", "w", "s", "n", "se", "sw", "ne", "nw"] as Dir[]).map((d) => <div key={d} className={`fw-rz fw-rz-${d}`} onMouseDown={(e) => onResize(e, d)} />)}
		</div>
	);
}
