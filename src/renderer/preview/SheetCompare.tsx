// Sheet compare: two issues of a sheet, paired by sheet number. Left: A with the pixel overlay (red = only in A, blue =
// only in B) after B is laid onto A's sheet frame; zones outlined. Right: the named changes from the vectors (moved lines,
// changed dimensions, texts). A change becomes a pin on A's page or goes to the agent's Fokuss.
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { SheetDiffRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge, Empty } from "../ui";
import { computeDiff, type DiffZone } from "./pixel-diff";
import { TracePanel } from "./TracePanel";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const SCALE = 1.6;
const MM_PT = 72 / 25.4;

async function renderPage(bytes: Uint8Array, n: number, w?: number, h?: number, frame?: { from: SheetDiffRow["frameA"]; to: SheetDiffRow["frameA"] }): Promise<ImageData> {
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
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

export function SheetCompare({ projectId, a, b, aLabel, bLabel }: { projectId: string; a: string; b: string; aLabel: string; bLabel: string }) {
	const [rows, setRows] = useState<SheetDiffRow[] | null>(null);
	const [i, setI] = useState(0);
	const [zones, setZones] = useState<DiffZone[]>([]);
	const [err, setErr] = useState<string | null>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const bytes = useRef<{ a: Uint8Array; b: Uint8Array } | null>(null);

	useEffect(() => {
		let live = true;
		Promise.all([call("sheets.bytes", projectId, a), call("sheets.bytes", projectId, b), call("sheets.diff", projectId, a, b)])
			.then(([x, y, d]) => {
				if (!live) return;
				bytes.current = { a: x, b: y };
				setRows(d);
				setI(0);
			})
			.catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
		};
	}, [projectId, a, b]);

	useEffect(() => {
		const r = rows?.[i];
		if (!r || !bytes.current || !canvas.current) return;
		let live = true;
		(async () => {
			const ia = await renderPage(bytes.current!.a, r.a);
			const ib = await renderPage(bytes.current!.b, r.b, ia.width, ia.height, { from: r.frameB, to: r.frameA });
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
	}, [rows, i]);

	if (err) return <div className="err">{err}</div>;
	if (!rows) return <Empty title="salīdzina…" />;
	if (!rows.length) return <Empty title="no data">Lapas nav sapārotas.</Empty>;
	const r = rows[i];
	const pin = (text: string, x: number, y: number) =>
		a.startsWith("src:") ? call("pins.add", projectId, { sourceId: a.slice(4), page: r.a, x, y }, text).catch((e) => setErr(errText(e))) : setErr("Piezīmi var likt tikai avotam (A ir fails ārpus avotiem).");
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{aLabel}</b> → <b>{bLabel}</b>
				<select value={i} onChange={(e) => setI(Number(e.target.value))}>
					{rows.map((x, k) => (
						<option key={k} value={k}>
							{x.sheetNo ?? `lpp. ${x.a}`} ({x.summary.length} izmaiņas)
						</option>
					))}
				</select>
				<Badge tone="bad">sarkans: tikai A</Badge>
				<Badge tone="info">zils: tikai B</Badge>
				<span className="dim small">{zones.length} zonas</span>
			</div>
			<div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 340px", flex: 1, minHeight: 0 }}>
				<div className="viewer-body">
					<div style={{ position: "relative", display: "inline-block" }}>
						<canvas ref={canvas} style={{ background: "#fff", maxWidth: "100%" }} />
						{zones.map((z) => (
							<div key={z.id} className="region" style={{ left: z.x, top: z.y, width: z.width, height: z.height }} />
						))}
					</div>
				</div>
				<div className="pane fill" style={{ borderLeft: "1px solid var(--border)" }}>
					<div className="section-title">Izmaiņas (no vektoriem)</div>
					{r.summary.length === 0 && <div className="dim">Vektoros izmaiņu nav.</div>}
					{r.summary.map((s, k) => (
						<div key={k} className="row small">
							<span className="grow">{s}</span>
							<button className="small ghost" onClick={() => pin(`${r.sheetNo ?? ""}: ${s}`, r.where[k]?.x ?? 0.5, r.where[k]?.y ?? 0.5)}>piezīme</button>
							<button className="small ghost" onClick={() => ui.focusAdd({ kind: "text", id: `cmp:${a}:${b}:${r.a}:${k}`, label: `${r.sheetNo ?? ""}: ${s}`.slice(0, 60), data: { a: aLabel, b: bLabel, sheet: r.sheetNo, change: s } })}>
								→ aģentam
							</button>
						</div>
					))}
					<TracePanel projectId={projectId} a={a} b={b} />
				</div>
			</div>
		</div>
	);
}
