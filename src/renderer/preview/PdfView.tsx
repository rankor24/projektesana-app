// PDF preview: pdfjs page canvas + text layer, page navigation, zoom. Selecting text or dragging a region (Apgabals)
// puts it in the Fokuss with the text inside. `overlay` draws on top of the page (pins, inventory geometry).
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { regionFocus, textFocus } from "../../shared/focus-items";
import { errText } from "../bridge";
import { ui } from "../state";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageSize {
	width: number;
	height: number;
	/** PDF user-space size of the page (points) */
	pdfWidth: number;
	pdfHeight: number;
	scale: number;
}

export function PdfView({
	load,
	sourceId,
	title,
	initialPage,
	overlay,
	onPageClick,
	toolbar,
}: {
	load: () => Promise<Uint8Array>;
	sourceId: string;
	title: string;
	initialPage?: number;
	overlay?: (page: number, size: PageSize) => ReactNode;
	/** a click in "pin" mode: page fractions */
	onPageClick?: (page: number, x: number, y: number) => void;
	toolbar?: ReactNode;
}) {
	const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [page, setPage] = useState(initialPage ?? 1);
	const [zoom, setZoom] = useState<number | "fit">("fit");
	const [mode, setMode] = useState<"text" | "region" | "pin">("text");
	const [size, setSize] = useState<PageSize | null>(null);
	const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	const body = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const textDiv = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let live = true;
		let task: pdfjs.PDFDocumentLoadingTask | null = null;
		setDoc(null);
		setErr(null);
		load()
			.then((bytes) => {
				// pdfjs takes ownership of the buffer it is given: hand it a copy
				task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
				return task.promise;
			})
			.then((d) => live && (setDoc(d), setPage(Math.min(initialPage ?? 1, d.numPages))))
			.catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
			void task?.destroy();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sourceId]);

	useEffect(() => {
		if (initialPage) setPage(initialPage);
	}, [initialPage]);

	useEffect(() => {
		if (!doc || !canvas.current || !textDiv.current || !body.current) return;
		let cancelled = false;
		let renderTask: pdfjs.RenderTask | null = null;
		(async () => {
			const p = await doc.getPage(page);
			const base = p.getViewport({ scale: 1 });
			const scale = zoom === "fit" ? Math.max(0.2, (body.current!.clientWidth - 40) / base.width) : zoom;
			const vp = p.getViewport({ scale });
			const dpr = window.devicePixelRatio || 1;
			const c = canvas.current!;
			c.width = Math.floor(vp.width * dpr);
			c.height = Math.floor(vp.height * dpr);
			c.style.width = `${Math.floor(vp.width)}px`;
			c.style.height = `${Math.floor(vp.height)}px`;
			const ctx = c.getContext("2d")!;
			renderTask = p.render({ canvas: c, canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
			await renderTask.promise;
			if (cancelled) return;
			const tl = textDiv.current!;
			tl.replaceChildren();
			tl.parentElement!.style.setProperty("--scale-factor", String(scale));
			await new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: tl, viewport: vp }).render();
			if (!cancelled) setSize({ width: vp.width, height: vp.height, pdfWidth: base.width, pdfHeight: base.height, scale });
		})().catch((e) => {
			if (!cancelled && !/cancel/i.test(String(e))) setErr(errText(e));
		});
		return () => {
			cancelled = true;
			renderTask?.cancel();
		};
	}, [doc, page, zoom]);

	// text selected in the text layer goes to the Fokuss
	const onMouseUp = () => {
		if (mode !== "text") return;
		const sel = window.getSelection()?.toString() ?? "";
		if (sel.trim().length >= 3) ui.focusAdd(textFocus(sourceId, title, page, sel));
	};

	const rel = (e: React.MouseEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
	};

	const finishRegion = () => {
		if (!drag || !textDiv.current) return setDrag(null);
		const x = Math.min(drag.x0, drag.x1);
		const y = Math.min(drag.y0, drag.y1);
		const w = Math.abs(drag.x1 - drag.x0);
		const h = Math.abs(drag.y1 - drag.y0);
		setDrag(null);
		if (w < 0.005 || h < 0.005) return;
		const box = textDiv.current.getBoundingClientRect();
		const inside = [...textDiv.current.querySelectorAll("span")]
			.filter((s) => {
				const r = s.getBoundingClientRect();
				const cx = (r.left + r.width / 2 - box.left) / box.width;
				const cy = (r.top + r.height / 2 - box.top) / box.height;
				return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
			})
			.map((s) => s.textContent ?? "")
			.join(" ");
		ui.focusAdd(regionFocus(sourceId, title, page, { x, y, w, h }, inside));
	};

	const n = doc?.numPages ?? 0;
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>
					{title}
				</b>
				<button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
				<input style={{ width: 46 }} value={page} onChange={(e) => setPage(Math.max(1, Math.min(n || 1, Number(e.target.value) || 1)))} />
				<span className="dim">/ {n || "…"}</span>
				<button disabled={page >= n} onClick={() => setPage(page + 1)}>›</button>
				<button onClick={() => setZoom("fit")} className={zoom === "fit" ? "primary" : ""}>platums</button>
				<button onClick={() => setZoom(Math.max(0.25, (size?.scale ?? 1) / 1.25))}>−</button>
				<button onClick={() => setZoom(Math.min(8, (size?.scale ?? 1) * 1.25))}>+</button>
				<span className="dim small">{size ? `${Math.round(size.scale * 100)}%` : ""}</span>
				<span className="grow" />
				<button className={mode === "text" ? "primary" : ""} onClick={() => setMode("text")} title="Iezīmē tekstu — tas nonāk Fokusā">Teksts</button>
				<button className={mode === "region" ? "primary" : ""} onClick={() => setMode("region")} title="Velc taisnstūri — apgabals nonāk Fokusā">Apgabals</button>
				{onPageClick && (
					<button className={mode === "pin" ? "primary" : ""} onClick={() => setMode("pin")} title="Klikšķis lapā pievieno piezīmi">Piezīme</button>
				)}
				{toolbar}
			</div>
			{err && <div className="err">{err}</div>}
			<div className="viewer-body" ref={body}>
				<div className="pdf-page" style={size ? { width: size.width, height: size.height } : undefined} onMouseUp={onMouseUp}>
					<canvas ref={canvas} />
					<div className="textLayer" ref={textDiv} />
					{size && overlay?.(page, size)}
					{mode !== "text" && (
						<div
							className="region-layer"
							onMouseDown={(e) => {
								const p = rel(e);
								if (mode === "pin") return onPageClick?.(page, p.x, p.y);
								setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
							}}
							onMouseMove={(e) => drag && setDrag({ ...drag, x1: rel(e).x, y1: rel(e).y })}
							onMouseUp={finishRegion}
						>
							{drag && <div className="region" style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }} />}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
