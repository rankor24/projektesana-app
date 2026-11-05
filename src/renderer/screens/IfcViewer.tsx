// IFC viewer on @ifc-lite, following BIM Crew's working viewer (apps/client/src/components/IfcViewerArtifact/useIfcViewerModel.ts):
// parser + geometry + WebGPU renderer, orbit/pan/zoom, click-to-pick; a pick gives the element's IFC GlobalId, which is what a 3D pin attaches to.
import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api";

export interface Picked {
	guid: string;
	type: string;
	name: string;
}

interface Props {
	root: string;
	file: string;
	/** GlobalIds to highlight (pins, diff results) */
	highlight: string[];
	onPick: (p: Picked) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function IfcViewer({ root, file, highlight, onPick }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const renderer = useRef<any>(null);
	const store = useRef<any>(null);
	const geo = useRef<any>(null);
	const sel = useRef<{ ids: Set<number> }>({ ids: new Set() });
	const raf = useRef<number | null>(null);
	const [progress, setProgress] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const pick = useRef(onPick);
	pick.current = onPick;

	useEffect(() => {
		let cancelled = false;
		let ro: ResizeObserver | null = null;
		setReady(false);
		setErr(null);
		(async () => {
			try {
				setProgress("Ielādē skatītāju…");
				const [{ IfcParser }, { GeometryProcessor }, { Renderer }, wasm] = await Promise.all([import("@ifc-lite/parser"), import("@ifc-lite/geometry"), import("@ifc-lite/renderer"), import("@ifc-lite/wasm")]);
				const bytes = await api<Uint8Array>("fileRead", root, file);
				if (cancelled || !canvas.current) return;
				const r = new Renderer(canvas.current);
				renderer.current = r;
				await r.init();
				await (wasm as any).default();
				const geometry = new GeometryProcessor();
				await geometry.init();
				setProgress("Nolasa IFC…");
				const parsed = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {});
				if (cancelled) return;
				store.current = parsed;
				setProgress("Būvē ģeometriju…");
				const g = await geometry.process(new Uint8Array(bytes));
				if (cancelled) return;
				geo.current = g;
				r.loadGeometry(g);
				r.fitToView();
				const loop = () => {
					const c = canvas.current;
					if (c && c.clientWidth > 0 && c.clientHeight > 0) r.render({ selectedId: [...sel.current.ids][0] ?? null, selectedIds: sel.current.ids });
					raf.current = requestAnimationFrame(loop);
				};
				loop();
				ro = new ResizeObserver((es) => {
					const b = es[0]?.contentRect;
					if (b && b.width > 1 && b.height > 1) r.resize(b.width, b.height);
				});
				ro.observe(canvas.current);
				setProgress("");
				setReady(true);
			} catch (e) {
				if (!cancelled) setErr(errText(e));
			}
		})();
		return () => {
			cancelled = true;
			if (raf.current) cancelAnimationFrame(raf.current);
			ro?.disconnect();
			renderer.current = null;
		};
	}, [root, file]);

	// camera + picking
	useEffect(() => {
		const c = canvas.current;
		const r = renderer.current;
		if (!c || !r || !ready) return;
		const cam = r.getCamera();
		let down = false;
		let pan = false;
		let moved = false;
		let lx = 0;
		let ly = 0;
		const md = (e: MouseEvent) => {
			down = true;
			moved = false;
			pan = e.button === 1 || e.button === 2 || e.shiftKey;
			lx = e.clientX;
			ly = e.clientY;
		};
		const mm = (e: MouseEvent) => {
			if (!down) return;
			const dx = e.clientX - lx;
			const dy = e.clientY - ly;
			if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
			lx = e.clientX;
			ly = e.clientY;
			if (pan) cam.pan(dx, dy);
			else cam.orbit(dx, dy);
		};
		const mu = () => (down = false);
		const wh = (e: WheelEvent) => {
			e.preventDefault();
			const b = c.getBoundingClientRect();
			cam.zoom(e.deltaY, e.clientX - b.left, e.clientY - b.top, c.width, c.height);
		};
		const click = async (e: MouseEvent) => {
			if (moved) return;
			const b = c.getBoundingClientRect();
			const res = await r.pick(e.clientX - b.left, e.clientY - b.top, {});
			const id: number | null = res?.expressId ?? null;
			sel.current.ids = id === null ? new Set() : new Set([id]);
			if (id === null) return;
			const ent = store.current?.entities;
			const guid: string = ent?.getGlobalId?.(id) ?? "";
			if (guid) pick.current({ guid, type: ent?.getTypeName?.(id) ?? "Entity", name: ent?.getName?.(id) ?? "" });
		};
		const ctx = (e: MouseEvent) => e.preventDefault();
		c.addEventListener("mousedown", md);
		c.addEventListener("mousemove", mm);
		window.addEventListener("mouseup", mu);
		c.addEventListener("wheel", wh, { passive: false });
		c.addEventListener("click", click);
		c.addEventListener("contextmenu", ctx);
		return () => {
			c.removeEventListener("mousedown", md);
			c.removeEventListener("mousemove", mm);
			window.removeEventListener("mouseup", mu);
			c.removeEventListener("wheel", wh);
			c.removeEventListener("click", click);
			c.removeEventListener("contextmenu", ctx);
		};
	}, [ready]);

	// highlight requested GlobalIds
	useEffect(() => {
		if (!ready || !store.current?.entities?.getGlobalId) return;
		const wanted = new Set(highlight);
		const ids = new Set<number>();
		const ent = store.current.entities;
		for (const m of (geo.current?.meshes ?? []) as any[]) if (wanted.has(ent.getGlobalId(m.expressId))) ids.add(m.expressId);
		if (ids.size) sel.current.ids = ids;
	}, [highlight, ready]);

	return (
		<div>
			{progress && <div className="muted">{progress}</div>}
			{err && <div className="err">{err}</div>}
			<canvas ref={canvas} className="ifc" />
			<div className="muted" style={{ fontSize: 12 }}>
				Pele: griezt · Shift/labā: pārbīdīt · ritenis: tuvināt · klikšķis: izvēlēties elementu
			</div>
		</div>
	);
}
