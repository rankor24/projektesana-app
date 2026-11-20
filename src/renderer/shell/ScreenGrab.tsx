// The screen grab of the comment tools: on every page, the same two steps. 1) drag a rectangle anywhere on the window; 2) draw on
// it (arrow, rectangle, circle, free line, in a colour) and send it to the agent: the picture goes into the chat as an
// attachment, as a pasted screenshot does. The picture is taken from the window itself (main: capturePage), so the model viewer's
// frame is in it, and the drawing is on a canvas over the rectangle, so it is in it too. The dimming and the toolbar are hidden
// for the moment of the capture.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COMMENT_COLOURS } from "../../shared/comment-tools";
import { attachBus } from "../attach-bus";
import { call, errText } from "../bridge";
import { tr } from "../i18n";
import { windows } from "../windows";
import { followMouse } from "./drag";

interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}
type Phase = { phase: "idle" } | { phase: "select"; colour: string } | { phase: "mark"; colour: string; rect: Rect };

let state: Phase = { phase: "idle" };
const subs = new Set<() => void>();
const set = (p: Phase) => {
	state = p;
	subs.forEach((f) => f());
};
export const screenGrab = {
	/** Starts a grab: the user drags a rectangle, then draws on it. `colour` is the one the tool column has picked. */
	start: (colour?: string) => set({ phase: "select", colour: colour ?? COMMENT_COLOURS[0].hex }),
	cancel: () => set({ phase: "idle" }),
	active: () => state.phase !== "idle",
};
const useGrab = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

type Tool = "arrow" | "rect" | "circle" | "free";
interface Shape {
	tool: Tool;
	colour: string;
	/** arrow, rect, circle: two points; free: the whole line. Relative to the rectangle. */
	pts: [number, number][];
}
const TOOLS: { id: Tool; icon: string; label: string }[] = [
	{ id: "arrow", icon: "↗", label: tr("Bulta") },
	{ id: "rect", icon: "▭", label: tr("Taisnstūris") },
	{ id: "circle", icon: "◯", label: tr("Aplis") },
	{ id: "free", icon: "〰", label: tr("Zīmēt") },
];

function paint(g: CanvasRenderingContext2D, shapes: Shape[]) {
	g.lineCap = "round";
	g.lineJoin = "round";
	for (const s of shapes) {
		g.strokeStyle = s.colour;
		g.fillStyle = s.colour;
		g.lineWidth = 3;
		const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
		g.beginPath();
		if (s.tool === "free") {
			s.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
			g.stroke();
		} else if (s.tool === "rect") {
			g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
		} else if (s.tool === "circle") {
			const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
			g.ellipse(cx, cy, Math.max(1, Math.abs(b[0] - a[0]) / 2), Math.max(1, Math.abs(b[1] - a[1]) / 2), 0, 0, Math.PI * 2);
			g.stroke();
		} else {
			g.moveTo(a[0], a[1]);
			g.lineTo(b[0], b[1]);
			g.stroke();
			const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
			const head = 14;
			g.beginPath();
			g.moveTo(b[0], b[1]);
			g.lineTo(b[0] - head * Math.cos(ang - 0.45), b[1] - head * Math.sin(ang - 0.45));
			g.lineTo(b[0] - head * Math.cos(ang + 0.45), b[1] - head * Math.sin(ang + 0.45));
			g.closePath();
			g.fill();
		}
	}
}

function Select({ colour }: { colour: string }) {
	const [r, setR] = useState<Rect | null>(null);
	useEffect(() => {
		const k = (e: KeyboardEvent) => e.key === "Escape" && screenGrab.cancel();
		document.addEventListener("keydown", k);
		return () => document.removeEventListener("keydown", k);
	}, []);
	const down = (e: React.MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const x0 = e.clientX, y0 = e.clientY;
		let last: Rect = { x: x0, y: y0, w: 0, h: 0 };
		followMouse(
			(ev) => {
				last = { x: Math.min(x0, ev.clientX), y: Math.min(y0, ev.clientY), w: Math.abs(ev.clientX - x0), h: Math.abs(ev.clientY - y0) };
				setR(last);
			},
			() => (last.w >= 24 && last.h >= 24 ? set({ phase: "mark", colour, rect: last }) : setR(null)),
			{ cursor: "crosshair" },
		);
	};
	return (
		<div className="grab-root grab-select" onMouseDown={down}>
			{r ? <div className="grab-rect" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} /> : <div className="grab-veil" />}
			<div className="grab-hint">{tr("Velc, lai atzīmētu apgabalu · Esc atceļ")}</div>
		</div>
	);
}

function Mark({ rect, colour: first }: { rect: Rect; colour: string }) {
	const [tool, setTool] = useState<Tool>("arrow");
	const [colour, setColour] = useState(first);
	const [shapes, setShapes] = useState<Shape[]>([]);
	const [live, setLive] = useState<Shape | null>(null);
	const [hide, setHide] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const canvas = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const k = (e: KeyboardEvent) => {
			if (e.key === "Escape") screenGrab.cancel();
			if (e.key === "z" && (e.ctrlKey || e.metaKey)) setShapes((s) => s.slice(0, -1));
		};
		document.addEventListener("keydown", k);
		return () => document.removeEventListener("keydown", k);
	}, []);
	useEffect(() => {
		const c = canvas.current;
		if (!c) return;
		const dpr = window.devicePixelRatio || 1;
		c.width = Math.round(rect.w * dpr);
		c.height = Math.round(rect.h * dpr);
		const g = c.getContext("2d")!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, rect.w, rect.h);
		paint(g, live ? [...shapes, live] : shapes);
	}, [shapes, live, rect]);

	const down = (e: React.MouseEvent) => {
		if (e.button !== 0) return;
		e.preventDefault();
		const at = (ev: { clientX: number; clientY: number }): [number, number] => [Math.max(0, Math.min(rect.w, ev.clientX - rect.x)), Math.max(0, Math.min(rect.h, ev.clientY - rect.y))];
		const first = at(e);
		let cur: Shape = { tool, colour, pts: [first, first] };
		setLive(cur);
		followMouse(
			(ev) => {
				const p = at(ev);
				cur = { ...cur, pts: tool === "free" ? [...cur.pts, p] : [first, p] };
				setLive(cur);
			},
			() => {
				const moved = cur.pts.length > 2 || Math.hypot(cur.pts[1][0] - first[0], cur.pts[1][1] - first[1]) > 4;
				if (moved) setShapes((s) => [...s, cur]);
				setLive(null);
			},
			{ cursor: "crosshair" },
		);
	};

	const send = useCallback(async () => {
		setErr(null);
		// the dimming and the toolbar leave first, then two frames, so the picture has only the window and the drawing
		setHide(true);
		await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));
		try {
			const png = await call("screen.capture", { x: rect.x, y: rect.y, width: rect.w, height: rect.h });
			const t = new Date();
			const p = (n: number) => String(n).padStart(2, "0");
			const file = new File([png as unknown as BlobPart], `ekrans-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.png`, { type: "image/png" });
			screenGrab.cancel();
			windows.openWindow("chat");
			attachBus.send([file]);
		} catch (e) {
			setHide(false);
			setErr(errText(e));
		}
	}, [rect]);

	// the toolbar sits under the rectangle, or above it when there is no room, or inside its top edge when there is neither
	const barH = 46;
	const below = rect.y + rect.h + 8 + barH <= window.innerHeight;
	const above = rect.y - 8 - barH >= 0;
	const barTop = below ? rect.y + rect.h + 8 : above ? rect.y - 8 - barH : rect.y + 8;
	const barLeft = Math.max(8, Math.min(rect.x, window.innerWidth - 560));

	return (
		<div className={`grab-root ${hide ? "grab-hide" : ""}`}>
			<div className="grab-rect grab-dim" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
			<canvas ref={canvas} className="grab-canvas" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} onMouseDown={down} />
			<div className="grab-bar" style={{ left: barLeft, top: barTop }} onMouseDown={(e) => e.stopPropagation()}>
				{TOOLS.map((t) => (
					<button key={t.id} className={`grab-tool ${tool === t.id ? "on" : ""}`} title={t.label} onClick={() => setTool(t.id)}>
						<span>{t.icon}</span>
						{t.label}
					</button>
				))}
				<span className="grab-sep" />
				{COMMENT_COLOURS.map((c) => (
					<button key={c.id} className={`ctool-swatch ${colour === c.hex ? "on" : ""}`} style={{ background: c.hex }} title={tr(c.id)} aria-label={tr(c.id)} onClick={() => setColour(c.hex)} />
				))}
				<span className="grab-sep" />
				<button className="grab-tool" title="Ctrl+Z" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}>
					↶ {tr("Atsaukt")}
				</button>
				<span className="grab-sep" />
				<button className="primary" onClick={() => void send()}>
					{tr("Nosūtīt aģentam")}
				</button>
				<button onClick={() => screenGrab.cancel()}>{tr("Atcelt")}</button>
				{err && <span className="err small">{err}</span>}
			</div>
		</div>
	);
}

export function ScreenGrab() {
	const g = useGrab();
	if (g.phase === "idle") return null;
	return g.phase === "select" ? <Select colour={g.colour} /> : <Mark rect={g.rect} colour={g.colour} />;
}
