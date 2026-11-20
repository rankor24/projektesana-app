// A split the user drags (B4: "why split in the middle is not movable?"): between a full page and the file opened beside it,
// and between the viewer's two panes. The first part's share is written to its element while dragging and saved once on
// release (the model viewer beside it is not redrawn for every pixel); the share is remembered per split. The drag runs on
// followMouse, whose cover sheet keeps the BimCraft iframe from swallowing the release.
import { useRef, useState, type RefObject } from "react";
import { followMouse } from "./drag";
import { tr } from "../i18n";

export const SPLIT_MIN = 15;
export const SPLIT_MAX = 85;
export const clampSplit = (pct: number): number => Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, Math.round(pct * 10) / 10));

export interface Split {
	/** the first part's share of the parent, in % */
	pct: number;
	/** the first part's element: written to directly while dragging */
	ref: RefObject<HTMLDivElement | null>;
	set(pct: number): void;
}

function read(key: string, fallback: number): number {
	try {
		const v = Number(localStorage.getItem(key));
		return Number.isFinite(v) && v > 0 ? clampSplit(v) : fallback;
	} catch {
		return fallback;
	}
}

export function useSplit(key: string, fallback = 50): Split {
	const [pct, setPct] = useState(() => read(key, fallback));
	const ref = useRef<HTMLDivElement | null>(null);
	return {
		pct,
		ref,
		set(next: number) {
			const v = clampSplit(next);
			setPct(v);
			try {
				localStorage.setItem(key, String(v));
			} catch {
				// not remembered: the split starts in the middle next time
			}
		},
	};
}

/** `row`: the parts sit side by side (a vertical bar, dragged left / right); `col`: one above the other. Double-click: middle. */
export function SplitHandle({ split, dir }: { split: Split; dir: "row" | "col" }) {
	const start = (e: React.MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		const parent = e.currentTarget.parentElement;
		if (!parent) return;
		const r = parent.getBoundingClientRect();
		let pct = split.pct;
		let raf = 0;
		followMouse(
			(ev) => {
				pct = clampSplit(dir === "row" ? ((ev.clientX - r.left) / r.width) * 100 : ((ev.clientY - r.top) / r.height) * 100);
				cancelAnimationFrame(raf);
				raf = requestAnimationFrame(() => {
					if (split.ref.current) split.ref.current.style.flex = `0 0 ${pct}%`;
				});
			},
			() => {
				cancelAnimationFrame(raf);
				split.set(pct);
			},
			{ cursor: dir === "row" ? "col-resize" : "row-resize" },
		);
	};
	return (
		<div
			className={`split-handle split-handle-${dir}`}
			role="separator"
			aria-orientation={dir === "row" ? "vertical" : "horizontal"}
			title={tr("Velc, lai mainītu dalījumu; dubultklikšķis: uz pusēm")}
			onMouseDown={start}
			onDoubleClick={() => {
				if (split.ref.current) split.ref.current.style.flex = "0 0 50%";
				split.set(50);
			}}
		/>
	);
}
