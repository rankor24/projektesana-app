import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api";
import type { Pin } from "../types";

/** pdf.js is loaded on first use, not at app start. */
async function pdfjsLib() {
	const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	return pdfjs;
}

interface Props {
	root: string;
	/** project-relative path of the PDF */
	file: string;
	pins: Pin[];
	/** when set, a click on the page places a pin at the normalised position */
	placing: boolean;
	onPlace: (x: number, y: number) => void;
	onPinClick: (p: Pin) => void;
	width?: number;
}

/** One PDF page with Boris's pins on top. Pin positions are normalised 0..1 from the top-left of the page. */
export function PdfViewer({ root, file, pins, placing, onPlace, onPinClick, width = 880 }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setErr(null);
		(async () => {
			try {
				const pdfjs = await pdfjsLib();
				const bytes = await api<Uint8Array>("fileRead", root, file);
				const doc = await pdfjs.getDocument({ data: bytes }).promise;
				const page = await doc.getPage(1);
				const base = page.getViewport({ scale: 1 });
				const viewport = page.getViewport({ scale: width / base.width });
				const c = canvas.current;
				if (!c || cancelled) return;
				c.width = Math.floor(viewport.width);
				c.height = Math.floor(viewport.height);
				await page.render({ canvas: c, viewport }).promise;
				if (!cancelled) setSize({ w: c.width, h: c.height });
			} catch (e) {
				if (!cancelled) setErr(errText(e));
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [root, file, width]);

	function click(e: React.MouseEvent<HTMLDivElement>) {
		if (!placing || !size) return;
		const r = e.currentTarget.getBoundingClientRect();
		onPlace((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
	}

	return (
		<div>
			{err && <div className="err">{err}</div>}
			<div className="viewer">
				<canvas ref={canvas} />
				<div className="pinlayer" style={{ cursor: placing ? "crosshair" : "default" }} onClick={click}>
					{pins.map((p, i) =>
						p.target.kind === "pdf" ? (
							<div
								key={p.id}
								className={`pinmark ${p.state}`}
								style={{ left: `${p.target.x * 100}%`, top: `${p.target.y * 100}%` }}
								title={`${p.id}: ${p.text}`}
								onClick={(e) => {
									e.stopPropagation();
									onPinClick(p);
								}}
							>
								{i + 1}
							</div>
						) : null,
					)}
				</div>
			</div>
		</div>
	);
}
