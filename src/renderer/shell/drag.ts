// Dragging a window: one pointer tracker for tabs and floating windows, and the drop hint the layer draws while a window
// is over a screen edge (it will dock there) or over another window's tab strip (it will join that group).
import { useSyncExternalStore } from "react";
import { dropTarget, type DropTarget, type StripRect } from "../../shared/layout";

export interface DragHint {
	label: string;
	x: number;
	y: number;
	target: DropTarget;
}
let hint: DragHint | null = null;
const listeners = new Set<() => void>();
const set = (h: DragHint | null) => {
	hint = h;
	for (const l of listeners) l();
};
export function useDragHint(): DragHint | null {
	return useSyncExternalStore(
		(l) => (listeners.add(l), () => listeners.delete(l)),
		() => hint,
	);
}

/** Every tab strip on screen as a rectangle, with a tab id of its group (the strips mark themselves data-strip). */
export function stripRects(except?: string): StripRect[] {
	return [...document.querySelectorAll<HTMLElement>("[data-strip]")]
		.filter((el) => el.dataset.strip !== except && !(except && el.dataset.tabs?.split(",").includes(except)))
		.map((el) => {
			const r = el.getBoundingClientRect();
			return { id: el.dataset.strip!, x: r.left, y: r.top, w: r.width, h: r.height };
		});
}
/** The tabs of the strip belonging to `id`, left edges and widths, for the position a tab is dropped at. */
export function tabRects(id: string): { x: number; w: number }[] {
	const strip = [...document.querySelectorAll<HTMLElement>("[data-strip]")].find((el) => el.dataset.strip === id);
	if (!strip) return [];
	return [...strip.querySelectorAll<HTMLElement>("[data-tab]")].map((t) => {
		const r = t.getBoundingClientRect();
		return { x: r.left, w: r.width };
	});
}

export interface Tracker {
	/** called once the pointer moved past the threshold */
	onStart?(): void;
	onMove(x: number, y: number, dx: number, dy: number, target: DropTarget): void;
	/** `moved` is false for a plain click */
	onEnd(x: number, y: number, moved: boolean, target: DropTarget): void;
}

/** Follows the pointer from a mouse-down until the button is released. `id` is the window being dragged. */
export function track(e: { clientX: number; clientY: number }, id: string, label: string, t: Tracker, threshold = 5) {
	const sx = e.clientX;
	const sy = e.clientY;
	let moved = false;
	const target = (x: number, y: number) => dropTarget({ w: window.innerWidth, h: window.innerHeight }, stripRects(id), x, y, id);
	const onMove = (ev: MouseEvent) => {
		if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
		if (!moved) {
			moved = true;
			t.onStart?.();
		}
		const tg = target(ev.clientX, ev.clientY);
		set({ label, x: ev.clientX, y: ev.clientY, target: tg });
		t.onMove(ev.clientX, ev.clientY, ev.clientX - sx, ev.clientY - sy, tg);
	};
	const onUp = (ev: MouseEvent) => {
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onUp);
		set(null);
		t.onEnd(ev.clientX, ev.clientY, moved, moved ? target(ev.clientX, ev.clientY) : null);
	};
	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onUp);
}
