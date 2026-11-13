// Marks drawn on a page or over a view (task 9.4): a line, a circle, a rectangle or a free stroke, kept in fractions of the
// page (2D) or of the view at the pin's camera (3D). MarkupShapes draws what there is; MarkupDraw takes the pointer while a
// shape is chosen and gives back one finished mark. The geometry rules are shared/pins-view.ts checkMarkup.
import { useRef, useState } from "react";
import type { Markup } from "../../core/model";
import { MAX_FREE_POINTS } from "../../shared/pins-view";

export const SHAPE_LABEL: Record<Markup["shape"], string> = { line: "Līnija", circle: "Aplis", rect: "Taisnstūris", free: "Zīmēt" };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function shapeEl(m: Markup, key: number, color: string) {
	const p = m.points;
	const common = { key, stroke: color, fill: "none", strokeWidth: 2.5, vectorEffect: "non-scaling-stroke" as const };
	if (m.shape === "line") return <line {...common} x1={p[0][0]} y1={p[0][1]} x2={p[1][0]} y2={p[1][1]} />;
	if (m.shape === "rect") return <rect {...common} x={Math.min(p[0][0], p[1][0])} y={Math.min(p[0][1], p[1][1])} width={Math.abs(p[1][0] - p[0][0])} height={Math.abs(p[1][1] - p[0][1])} />;
	if (m.shape === "circle") return <ellipse {...common} cx={p[0][0]} cy={p[0][1]} rx={Math.abs(p[1][0] - p[0][0])} ry={Math.abs(p[1][1] - p[0][1])} />;
	return <polyline {...common} points={p.map((q) => q.join(",")).join(" ")} />;
}

/** The marks, as an SVG over the whole page (or view); it never takes the pointer. */
export function MarkupShapes({ marks, color = "#e0675a" }: { marks: Markup[]; color?: string }) {
	if (!marks.length) return null;
	return (
		<svg className="overlay-svg" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ pointerEvents: "none" }}>
			{marks.map((m, i) => shapeEl(m, i, color))}
		</svg>
	);
}

/** Draws one mark of `shape` with the pointer over the element it covers; calls `onDone` with it. */
export function MarkupDraw({ shape, onDone }: { shape: Markup["shape"]; onDone: (m: Markup) => void }) {
	const box = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState<Markup | null>(null);
	const at = (e: React.MouseEvent): [number, number] => {
		const r = box.current!.getBoundingClientRect();
		return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)];
	};
	return (
		<div
			ref={box}
			className="markup-draw"
			onMouseDown={(e) => {
				e.preventDefault();
				const p = at(e);
				setDraft({ shape, points: [p, p] });
			}}
			onMouseMove={(e) => {
				if (!draft) return;
				const p = at(e);
				if (shape === "free") {
					const last = draft.points[draft.points.length - 1];
					if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.004 || draft.points.length >= MAX_FREE_POINTS) return;
					setDraft({ shape, points: [...draft.points, p] });
				} else setDraft({ shape, points: [draft.points[0], p] });
			}}
			onMouseUp={() => {
				if (!draft) return;
				const d = draft;
				setDraft(null);
				const [a, b] = [d.points[0], d.points[d.points.length - 1]];
				if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.004) onDone(d.shape === "free" && d.points.length < 2 ? { shape: "line", points: [a, b] } : d);
			}}
		>
			{draft && <MarkupShapes marks={[draft]} color="#d9a441" />}
		</div>
	);
}

/** The tool buttons: one per shape; pressing the active one turns drawing off. */
export function MarkupTools({ shape, setShape, count, onClear }: { shape: Markup["shape"] | null; setShape: (s: Markup["shape"] | null) => void; count: number; onClear: () => void }) {
	return (
		<>
			{(Object.keys(SHAPE_LABEL) as Markup["shape"][]).map((s) => (
				<button key={s} className={shape === s ? "primary" : ""} title={`${SHAPE_LABEL[s]}: velc skatā; atzīmējums tiek pie nākamās piezīmes`} onClick={() => setShape(shape === s ? null : s)}>
					{SHAPE_LABEL[s]}
				</button>
			))}
			{count > 0 && (
				<button className="ghost small" onClick={onClear} title="Dzēst vēl nesaglabātos atzīmējumus">
					× {count}
				</button>
			)}
		</>
	);
}
