// A drawing on a canvas: layers of flat lines ([x1, y1, x2, y2, …] in drawing units, y up as in CAD), pan with the mouse,
// zoom at the cursor with the wheel, fit on double-click. The view can be held outside (`view` / `onView`) so two canvases
// show the same place at the same zoom (A | B). Used by the DWG view and the DWG compare.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bounds, Lines } from "../../shared/compare2d";

export interface DrawLayer {
	lines: Lines;
	color: string;
	width?: number;
	dash?: number[];
}
/** centre (drawing units) and pixels per drawing unit */
export interface View2d {
	cx: number;
	cy: number;
	scale: number;
}

export function fitView(b: Bounds | null, w: number, h: number): View2d {
	if (!b || w <= 0 || h <= 0) return { cx: 0, cy: 0, scale: 1 };
	const bw = Math.max(b[2] - b[0], 1e-6), bh = Math.max(b[3] - b[1], 1e-6);
	return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, scale: 0.92 * Math.min(w / bw, h / bh) };
}

export function DwgCanvas({ layers, bounds, view, onView, marker, background = "#fff" }: { layers: DrawLayer[]; bounds: Bounds | null; view?: View2d | null; onView?: (v: View2d) => void; /** a place to ring (a picked change) */ marker?: { x: number; y: number } | null; background?: string }) {
	const box = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [own, setOwn] = useState<View2d | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const v = view ?? own;
	const setView = useCallback((n: View2d) => (onView ? onView(n) : setOwn(n)), [onView]);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	// the first sight of a drawing: fitted
	useEffect(() => {
		if (!v && size.w > 0) setView(fitView(bounds, size.w, size.h));
	}, [v, size, bounds, setView]);

	useEffect(() => {
		const c = canvas.current;
		if (!c || !v || !size.w) return;
		const dpr = window.devicePixelRatio || 1;
		c.width = Math.round(size.w * dpr);
		c.height = Math.round(size.h * dpr);
		const ctx = c.getContext("2d")!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, size.w, size.h);
		const ox = size.w / 2 - v.cx * v.scale, oy = size.h / 2 + v.cy * v.scale;
		for (const l of layers) {
			if (!l.lines.length) continue;
			ctx.strokeStyle = l.color;
			ctx.lineWidth = l.width ?? 1;
			ctx.setLineDash(l.dash ?? []);
			ctx.beginPath();
			const p = l.lines;
			for (let i = 0; i + 3 < p.length; i += 4) {
				ctx.moveTo(ox + p[i] * v.scale, oy - p[i + 1] * v.scale);
				ctx.lineTo(ox + p[i + 2] * v.scale, oy - p[i + 3] * v.scale);
			}
			ctx.stroke();
		}
		if (marker) {
			ctx.setLineDash([]);
			ctx.strokeStyle = "#e0a400";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(ox + marker.x * v.scale, oy - marker.y * v.scale, 18, 0, Math.PI * 2);
			ctx.stroke();
		}
	}, [layers, v, size, marker, background]);

	const drag = useRef<{ x: number; y: number; v: View2d } | null>(null);
	return (
		<div
			ref={box}
			className="dwg-canvas"
			onMouseDown={(e) => v && (drag.current = { x: e.clientX, y: e.clientY, v })}
			onMouseMove={(e) => {
				const d = drag.current;
				if (!d) return;
				setView({ ...d.v, cx: d.v.cx - (e.clientX - d.x) / d.v.scale, cy: d.v.cy + (e.clientY - d.y) / d.v.scale });
			}}
			onMouseUp={() => (drag.current = null)}
			onMouseLeave={() => (drag.current = null)}
			onDoubleClick={() => setView(fitView(bounds, size.w, size.h))}
			onWheel={(e) => {
				if (!v) return;
				const r = box.current!.getBoundingClientRect();
				const mx = e.clientX - r.left - size.w / 2, my = e.clientY - r.top - size.h / 2;
				const k = Math.exp(-e.deltaY * 0.0015);
				// the point under the cursor stays under it
				const wx = v.cx + mx / v.scale, wy = v.cy - my / v.scale;
				const scale = v.scale * k;
				setView({ scale, cx: wx - mx / scale, cy: wy + my / scale });
			}}
		>
			<canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
		</div>
	);
}
