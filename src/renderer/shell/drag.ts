// Dragging a window: one pointer tracker for tabs and floating windows, and the drop hint the layer draws while a window
// is over a screen edge (it will dock there) or over another window's tab strip (it will join that group).
import { useSyncExternalStore } from "react";
import { dropTarget, type DropTarget, type StripRect, type Zone } from "../../shared/layout";

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

/** The work area a window can dock in: what the workspace element covers (the rail and the top bar are outside it). */
export function workZone(): Zone | undefined {
	const r = document.querySelector<HTMLElement>(".workspace")?.getBoundingClientRect();
	return r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined;
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

let following = 0;
/** True while a window is being moved or resized (the comment tools window records its drawn height only when no drag runs). */
export const dragActive = (): boolean => following > 0;

export interface Follow {
	/** puts the cover sheet up now (for drags that start as a possible click) */
	cover(): void;
}

/**
 * Follows a mouse drag on the whole window until the button is released. While it runs, a transparent sheet covers the
 * page: an iframe (the BimCraft IFC viewer) under the pointer would otherwise take the mousemove/mouseup for its own
 * document, the drag would never hear the release, and the handle would stay stuck to the mouse. A move with no button
 * held (released outside the window) or the window losing focus ends the drag too, at the last known pointer position.
 * `cover: false` waits for `.cover()` so a plain click still reaches the element it was pressed on.
 */
export function followMouse(
	onMove: (ev: MouseEvent) => void,
	onUp: (ev: { clientX: number; clientY: number }) => void,
	{ cursor = "", cover = true }: { cursor?: string; cover?: boolean } = {},
): Follow {
	let sheet: HTMLDivElement | null = null;
	let last = { clientX: 0, clientY: 0 };
	const putUp = () => {
		if (sheet) return;
		sheet = document.createElement("div");
		sheet.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:transparent;cursor:${cursor || "default"}`;
		document.body.appendChild(sheet);
	};
	const move = (ev: MouseEvent) => {
		if (ev.buttons === 0) return up(last);
		last = { clientX: ev.clientX, clientY: ev.clientY };
		onMove(ev);
	};
	const up = (ev: { clientX: number; clientY: number }) => {
		following = Math.max(0, following - 1);
		document.removeEventListener("mousemove", move);
		document.removeEventListener("mouseup", up);
		window.removeEventListener("blur", blur);
		sheet?.remove();
		sheet = null;
		onUp(ev);
	};
	const blur = () => up(last);
	following++;
	document.addEventListener("mousemove", move);
	document.addEventListener("mouseup", up);
	window.addEventListener("blur", blur);
	if (cover) putUp();
	return { cover: putUp };
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
	const target = (x: number, y: number) => dropTarget({ w: window.innerWidth, h: window.innerHeight }, stripRects(id), x, y, id, workZone());
	const onMove = (ev: MouseEvent) => {
		if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < threshold) return;
		if (!moved) {
			moved = true;
			follow.cover();
			t.onStart?.();
		}
		const tg = target(ev.clientX, ev.clientY);
		set({ label, x: ev.clientX, y: ev.clientY, target: tg });
		t.onMove(ev.clientX, ev.clientY, ev.clientX - sx, ev.clientY - sy, tg);
	};
	const onUp = (ev: { clientX: number; clientY: number }) => {
		set(null);
		t.onEnd(ev.clientX, ev.clientY, moved, moved ? target(ev.clientX, ev.clientY) : null);
	};
	const follow = followMouse(onMove, onUp, { cover: false });
}
