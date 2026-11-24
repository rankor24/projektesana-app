// Pan and zoom of a flat canvas (the Telpas tile plan): the view is a scale `k` and the offset of the canvas' top-left corner in
// the window. The canvas always covers the window (at k = 1 it IS the window), so there is never an empty margin to get lost in.
// The wheel helpers are the same rules as Grafiks (src/shared/gantt.ts on the Grafiks branch), kept here so the two can share one
// file when they meet. Pure and node-free.

export interface View {
	/** zoom: 1 = the whole canvas fits the window */
	k: number;
	/** where the canvas' left / top edge is in the window, px (0 or negative) */
	x: number;
	y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 60;
export const HOME: View = { k: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The view kept inside the canvas: the zoom within its limits, and the offset so that the canvas covers a w × h window. */
export function clampView(v: View, w: number, h: number): View {
	const k = clamp(v.k, MIN_ZOOM, MAX_ZOOM);
	return { k, x: clamp(v.x, w - w * k, 0), y: clamp(v.y, h - h * k, 0) };
}

/** Zoom to `k` keeping the canvas point under the window point (cx, cy) where it is. */
export function zoomAt(v: View, k: number, cx: number, cy: number, w: number, h: number): View {
	const next = clamp(k, MIN_ZOOM, MAX_ZOOM);
	const f = next / v.k;
	return clampView({ k: next, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }, w, h);
}

/** Move the view by (dx, dy) window pixels. */
export function panBy(v: View, dx: number, dy: number, w: number, h: number): View {
	return clampView({ k: v.k, x: v.x + dx, y: v.y + dy }, w, h);
}

/** A rectangle of the canvas as it shows in the window at this view. */
export function place(v: View, r: { x: number; y: number; w: number; h: number }): { left: number; top: number; width: number; height: number } {
	return { left: r.x * v.k + v.x, top: r.y * v.k + v.y, width: r.w * v.k, height: r.h * v.k };
}

/** A wheel tick as pixels: lines and pages (a mouse set to scroll by lines) count as 16 and 400 pixels. */
export function wheelPixels(deltaY: number, deltaMode: number): number {
	return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
}

/** The factor one wheel tick zooms by (up = bigger): a mouse notch (about 100 px) is about 16%; the small steps of a pinch are scaled up so they keep up with the fingers. */
export function wheelZoomFactor(pixels: number): number {
	return Math.exp(-pixels * (Math.abs(pixels) < 40 ? 0.01 : 0.0015));
}
