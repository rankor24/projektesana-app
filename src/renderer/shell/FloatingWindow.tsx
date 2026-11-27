// A floating tab group: dragged by its strip, resized from eight handles, brought to the front on a click. Adapted from
// BIM Crew apps/client/src/components/FloatingWindow.tsx: the drag and resize math, the geometry held outside the store during
// a drag and committed once on pointer-up, the eight resize handles. Changed: plain CSS classes, our layout store, and a drag
// that ends on a screen edge docks the group, and on another strip joins it (shell/drag.ts).
//
// Smooth by construction: during a move or a resize nothing in React changes. The new geometry is written straight to the
// element (one write per animation frame), so the window's contents (a model viewer, a table of hundreds of rows) are not
// rendered again for every pixel the mouse travels; the store gets the final geometry once, on release. The component is
// memoised, so the drop hint that follows the pointer (a separate layer) never re-renders the windows either.
import { memo, useCallback, useEffect, useRef, type ReactNode } from "react";
import { clampGeo, minHOf, minWOf, TOOLS, type FloatPlace, type Geo, type Group } from "../../shared/layout";
import { windows } from "../windows";
import { dragActive, followMouse, track } from "./drag";
import { TabGroup } from "./TabGroup";

type Dir = "se" | "sw" | "ne" | "nw" | "e" | "w" | "s" | "n";
const DIRS: Dir[] = ["e", "w", "s", "n", "se", "sw", "ne", "nw"];
const vp = () => ({ w: window.innerWidth, h: window.innerHeight });
/** The comment tools window is as tall as its contents, but never past the bottom of the screen (then its icons scroll). */
const maxH = (top: number) => `calc(100vh - ${Math.round(top)}px - 8px)`;

function FloatingWindowView({ group, focused, render }: { group: Group; focused: boolean; render: (id: string, filter?: string) => ReactNode }) {
	const p = group.place as FloatPlace;
	const id = group.active;
	const root = useRef<HTMLDivElement>(null);
	const minW = minWOf(group.tabs);
	const minH = minHOf(minW);
	const slimTools = group.tabs.length === 1 && group.tabs[0] === TOOLS;
	const frame = useRef(0);
	// The comment tools alone in a window: the width is the one the user drags to, the height is never set by code. The browser
	// makes the window exactly as tall as its icons at that width (CSS height: auto), live while the width is dragged, so nothing
	// changes after the mouse is let go. Measuring the icons and storing a fitted size (2.13.2 to 2.18.2) fought the user: it
	// measured under one header layout and the header switched layout after the store write, so the window grew.
	// The stored height only records what the browser drew (it keeps the window on the screen when moved).
	const measured = () => root.current?.offsetHeight ?? p.h;
	useEffect(() => {
		const el = root.current;
		if (!slimTools || !el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			if (!dragActive()) windows.recordHeight(id, el.offsetHeight);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [slimTools, id]);

	/** Writes a geometry to the element, at most once per animation frame. */
	const apply = useCallback((g: Geo) => {
		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(() => {
			const el = root.current;
			if (!el) return;
			el.style.left = `${g.x}px`;
			el.style.top = `${g.y}px`;
			el.style.width = `${g.w}px`;
			if (slimTools) el.style.maxHeight = maxH(g.y);
			else el.style.height = `${g.h}px`;
		});
	}, [slimTools]);
	/** The element shows `g` now (a drag that ends: the store is about to say the same). */
	const settle = useCallback(
		(g: Geo) => {
			cancelAnimationFrame(frame.current);
			apply(g);
		},
		[apply],
	);

	const onMove = (e: React.MouseEvent) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
		windows.focus(id);
		const o = { x: p.x, y: p.y, w: p.w, h: slimTools ? measured() : p.h };
		let final: Geo = o;
		track(e, id, group.tabs.length > 1 ? `${group.tabs.length} logi` : id, {
			onMove: (_x, _y, dx, dy) => {
				final = clampGeo({ ...o, x: o.x + dx, y: o.y + dy }, vp(), minW);
				apply(final);
			},
			onEnd(_x, _y, moved, target) {
				if (!moved) return;
				if (target?.kind === "tabs") return windows.mergeGroup(id, target.targetId);
				if (target?.kind === "side") return windows.dock(id, target.side, { whole: true });
				settle(final);
				if (slimTools) windows.resize(id, final);
				else windows.move(id, final.x, final.y);
			},
		});
	};

	const onResize = useCallback(
		(e: React.MouseEvent, dir: Dir) => {
			e.preventDefault();
			e.stopPropagation();
			windows.focus(id);
			const o = { x: p.x, y: p.y, w: p.w, h: slimTools ? measured() : p.h };
			const sx = e.clientX;
			const sy = e.clientY;
			let final: Geo = o;
			const move = (ev: MouseEvent) => {
				const dx = ev.clientX - sx;
				const dy = ev.clientY - sy;
				let { x, y, w, h } = o;
				if (dir.includes("e")) w = Math.max(minW, o.w + dx);
				// the comment tools' height is their contents: a drag changes the width only
				if (dir.includes("s") && !slimTools) h = Math.max(minH, o.h + dy);
				if (dir.includes("w")) {
					w = Math.max(minW, o.w - dx);
					x = o.x + (o.w - w);
				}
				if (dir.includes("n") && !slimTools) {
					h = Math.max(minH, o.h - dy);
					y = o.y + (o.h - h);
				}
				final = clampGeo({ x, y, w, h }, vp(), minW);
				apply(final);
			};
			const up = () => {
				settle(final);
				windows.resize(id, slimTools ? { ...final, h: measured() } : final);
			};
			followMouse(move, up, { cursor: `${dir}-resize` });
		},
		[id, p.x, p.y, p.w, p.h, minW, minH, slimTools, apply, settle],
	);

	return (
		<div
			ref={root}
			className={`fw ${focused ? "fw-focused" : ""}`}
			style={slimTools ? { left: p.x, top: p.y, width: p.w, maxHeight: maxH(p.y), zIndex: 200 + p.z } : { left: p.x, top: p.y, width: p.w, height: p.h, zIndex: 200 + p.z }}
			onMouseDown={() => windows.focus(id)}
			// Alt + drag anywhere on the window moves it (BIM Crew), not only by the title strip
			onMouseDownCapture={(e) => {
				if (!e.altKey || e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				onMove(e);
			}}
		>
			<TabGroup group={group} render={render} mode="float" onStripDown={onMove} />
			{DIRS.map((d) => (
				<div key={d} className={`fw-rz fw-rz-${d}`} onMouseDown={(e) => onResize(e, d)} />
			))}
		</div>
	);
}

export const FloatingWindow = memo(FloatingWindowView);
