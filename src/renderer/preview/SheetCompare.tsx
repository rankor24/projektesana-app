// Sheet compare: two issues of a sheet, paired by sheet number. Left: A with the pixel overlay (red = only in A, blue =
// only in B) after B is laid onto A's sheet frame; zones outlined. Right: the named changes from the vectors (moved lines,
// changed dimensions, texts). A change becomes a pin on A's page or goes to the agent's Fokuss.
import { PDF_WASM_URL } from "../pdf-assets";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { SheetDiffRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge, Empty } from "../ui";
import { computeDiff, type DiffZone } from "./pixel-diff";
import { TracePanel } from "./TracePanel";
import { tr } from "../i18n";
import type { Markup } from "../../core/model";
import { MarkupDraw, MarkupShapes, MarkupTools } from "./Markup";
import { pageMarks, paneSurface, usePageMarks } from "../page-marks";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.6;
const MM_PT = 72 / 25.4;

async function renderPage(bytes: Uint8Array, n: number, w?: number, h?: number, frame?: { from: SheetDiffRow["frameA"]; to: SheetDiffRow["frameA"] }): Promise<ImageData> {
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), wasmUrl: PDF_WASM_URL });
	const doc = await task.promise;
	try {
		const page = await doc.getPage(n);
		const vp = page.getViewport({ scale: SCALE });
		const c = document.createElement("canvas");
		c.width = w ?? Math.ceil(vp.width);
		c.height = h ?? Math.ceil(vp.height);
		const ctx = c.getContext("2d")!;
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, c.width, c.height);
		let transform: number[] | undefined;
		if (frame?.from && frame.to) {
			// B's frame onto A's frame (sheet mm → canvas px, y down)
			const s = (frame.to.x1 - frame.to.x0) / (frame.from.x1 - frame.from.x0 || 1);
			const k = SCALE * MM_PT;
			const ox = (frame.to.x0 - frame.from.x0 * s) * k;
			const oy = (frame.to.y0 - frame.from.y0 * s) * k;
			transform = [s, 0, 0, s, ox, -oy + (1 - s) * c.height];
		}
		await page.render({ canvas: c, canvasContext: ctx, viewport: vp, transform }).promise;
		return ctx.getImageData(0, 0, c.width, c.height);
	} finally {
		await task.destroy();
	}
}

export function SheetCompare({ projectId, a, b, aLabel, bLabel, only = false, paneIndex = 0 }: { projectId: string; a: string; b: string; aLabel: string; bLabel: string; /** list only the sheets that differ (9.9) */ only?: boolean; paneIndex?: number }) {
	const [rows, setRows] = useState<SheetDiffRow[] | null>(null);
	const [i, setI] = useState(0);
	// marks drawn on the sheet (fractions of it), for the page's comment strip ("Apgabals" takes the rectangle); they belong to one sheet
	const surface = paneSurface(paneIndex);
	const marks = usePageMarks().by[surface] ?? [];
	const [shape, setShape] = useState<Markup["shape"] | null>(null);
	useEffect(() => () => pageMarks.clear(surface), [surface, i]);
	const [zones, setZones] = useState<DiffZone[]>([]);
	const [err, setErr] = useState<string | null>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const bytes = useRef<{ a: Uint8Array; b: Uint8Array } | null>(null);
	// A | B (9.9 / V2): both issues side by side on the same sheet, scrolled and zoomed together
	const [mode, setMode] = useState<"overlay" | "split">("overlay");
	const [zoom, setZoom] = useState(1);
	const sides = useRef<{ a: ImageData; b: ImageData } | null>(null);
	const canA = useRef<HTMLCanvasElement>(null);
	const canB = useRef<HTMLCanvasElement>(null);
	const scA = useRef<HTMLDivElement>(null);
	const scB = useRef<HTMLDivElement>(null);
	const [drawn, setDrawn] = useState(0);

	useEffect(() => {
		let live = true;
		Promise.all([call("sheets.bytes", projectId, a), call("sheets.bytes", projectId, b), call("sheets.diff", projectId, a, b)])
			.then(([x, y, d]) => {
				if (!live) return;
				bytes.current = { a: x, b: y };
				// "only changes": the sheets the diff found something on (the list is the same either way)
				setRows(only ? d.filter((r) => r.summary.length > 0) : d);
				setI(0);
			})
			.catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
		};
	}, [projectId, a, b, only]);

	useEffect(() => {
		const r = rows?.[i];
		if (!r || !bytes.current) return;
		let live = true;
		(async () => {
			const ia = await renderPage(bytes.current!.a, r.a);
			const ib = await renderPage(bytes.current!.b, r.b, ia.width, ia.height, { from: r.frameB, to: r.frameA });
			sides.current = { a: ia, b: ib };
			setDrawn((n) => n + 1);
			const { diff, zones: z } = computeDiff(ia, ib);
			if (!live || !canvas.current) return;
			const c = canvas.current;
			c.width = ia.width;
			c.height = ia.height;
			const ctx = c.getContext("2d")!;
			ctx.putImageData(diff, 0, 0);
			setZones(z);
		})().catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
		};
	}, [rows, i, mode]);

	useEffect(() => {
		if (mode !== "split" || !sides.current) return;
		for (const [c, img] of [
			[canA.current, sides.current.a],
			[canB.current, sides.current.b],
		] as const) {
			if (!c) continue;
			c.width = img.width;
			c.height = img.height;
			c.getContext("2d")!.putImageData(img, 0, 0);
		}
	}, [mode, drawn]);
	const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
		if (!from || !to) return;
		if (Math.abs(to.scrollTop - from.scrollTop) > 1) to.scrollTop = from.scrollTop;
		if (Math.abs(to.scrollLeft - from.scrollLeft) > 1) to.scrollLeft = from.scrollLeft;
	};

	if (err) return <div className="err">{err}</div>;
	if (!rows) return <Empty title={tr("salīdzina…")} />;
	if (!rows.length) return <Empty title={tr("no data")}>{tr("Lapas nav sapārotas.")}</Empty>;
	const r = rows[i];
	const pin = (text: string, x: number, y: number) =>
		a.startsWith("src:") ? call("pins.add", projectId, { sourceId: a.slice(4), page: r.a, x, y }, text).catch((e) => setErr(errText(e))) : setErr(tr("Piezīmi var likt tikai avotam (A ir fails ārpus avotiem)."));
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{aLabel}</b> → <b>{bLabel}</b>
				<select value={i} onChange={(e) => setI(Number(e.target.value))}>
					{rows.map((x, k) => (
						<option key={k} value={k}>
							{x.sheetNo ?? tr("lpp. {a}", { a: x.a })} {tr("({v} izmaiņas)", { v: x.summary.length })}</option>
					))}
				</select>
				<div className="seg">
					<button className={mode === "overlay" ? "on" : ""} onClick={() => setMode("overlay")} title={tr("A un B vienā lapā: sarkans tikai A, zils tikai B")}>
						{tr("Pārklājums")}
					</button>
					<button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title={tr("A pa kreisi, B pa labi: viena lapa, kopā ritina un tuvina")}>
						{tr("A | B")}
					</button>
				</div>
				{mode === "split" && (
					<>
						<button className="small" onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>−</button>
						<button className="small" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
						<button className="small" onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>+</button>
					</>
				)}
				<Badge tone="bad">{tr("sarkans: tikai A")}</Badge>
				<Badge tone="info">{tr("zils: tikai B")}</Badge>
				<span className="dim small">{tr("{v} zonas", { v: zones.length })}</span>
				<span className="grow" />
				<MarkupTools shape={shape} setShape={setShape} count={marks.length} onClear={() => pageMarks.clear(surface)} />
			</div>
			<div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 340px", flex: 1, minHeight: 0 }}>
				{mode === "split" ? (
					<div className="dwg-split">
						<div className="dwg-split-side">
							<div className="dwg-split-label">A · {aLabel}</div>
							<div ref={scA} className="viewer-body" onScroll={() => syncScroll(scA.current, scB.current)}>
								<canvas ref={canA} style={{ background: "#fff", width: `${zoom * 100}%` }} />
							</div>
						</div>
						<div className="dwg-split-side">
							<div className="dwg-split-label">B · {bLabel}</div>
							<div ref={scB} className="viewer-body" onScroll={() => syncScroll(scB.current, scA.current)}>
								<canvas ref={canB} style={{ background: "#fff", width: `${zoom * 100}%` }} />
							</div>
						</div>
					</div>
				) : (
				<div className="viewer-body">
					<div style={{ position: "relative", display: "inline-block" }}>
						<canvas ref={canvas} style={{ background: "#fff", maxWidth: "100%" }} />
						{zones.map((z) => (
							<div key={z.id} className="region" style={{ left: z.x, top: z.y, width: z.width, height: z.height }} />
						))}
						<MarkupShapes marks={marks} />
						{shape && <MarkupDraw shape={shape} onDone={(m) => pageMarks.add(surface, m)} />}
					</div>
				</div>
				)}
				<div className="pane fill" style={{ borderLeft: "1px solid var(--border)" }}>
					<div className="section-title">{tr("Izmaiņas (no vektoriem)")}</div>
					{r.summary.length === 0 && <div className="dim">{tr("Vektoros izmaiņu nav.")}</div>}
					{r.summary.map((s, k) => (
						<div key={k} className="row small">
							<span className="grow">{s}</span>
							<button className="small ghost" onClick={() => pin(`${r.sheetNo ?? ""}: ${s}`, r.where[k]?.x ?? 0.5, r.where[k]?.y ?? 0.5)}>{tr("piezīme")}</button>
							<button className="small ghost" onClick={() => ui.focusAdd({ kind: "text", id: `cmp:${a}:${b}:${r.a}:${k}`, label: `${r.sheetNo ?? ""}: ${s}`.slice(0, 60), data: { a: aLabel, b: bLabel, sheet: r.sheetNo, change: s } })}>
								{tr("→ aģentam")}</button>
						</div>
					))}
					<TracePanel projectId={projectId} a={a} b={b} />
				</div>
			</div>
		</div>
	);
}
