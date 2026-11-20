// A project source in the PDF view, with its overlays: the plan geometry read from a vector inventory (3.4) and the user's
// pins (6.4, 8.2). The overlay draws in page fractions, so it stays on the plan at any zoom. Pins are made with the note
// field in the toolbar (Electron has no window.prompt): write the note, press Piezīme, click the page.
import { useCallback, useEffect, useState } from "react";
import type { Markup, Pin } from "../../core/model";
import { MarkupTools } from "./Markup";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { viewer } from "../viewer-store";
import { factReview } from "../fact-review";
import { pinFocus } from "../../shared/pins-view";
import { PdfView } from "./PdfView";
import { PinSide, useFilePins } from "./Annotate";
import { tr } from "../i18n";

type Geo = Awaited<ReturnType<typeof call<"rooms.geometry">>>;

export function SourcePdf({ projectId, sourceId, title, page, quote, paneIndex = 0, focused = true }: { projectId: string; sourceId: string; title: string; page?: number; quote?: string; paneIndex?: number; focused?: boolean }) {
	const [geo, setGeo] = useState<Geo | null>(null);
	const [geoOn, setGeoOn] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [active, setActive] = useState<string | null>(null);
	const [jump, setJump] = useState<number | undefined>(page);
	// marks drawn and not yet saved with a note (page, mark), and the shape being drawn
	const [shape, setShape] = useState<Markup["shape"] | null>(null);
	const [drawn, setDrawn] = useState<{ page: number; m: Markup }[]>([]);
	// a linked split turns this page when the other one turns
	useEffect(() => {
		if (page) setJump(page);
	}, [page]);
	const belongs = useCallback((p: Pin) => "sourceId" in p.target && p.target.sourceId === sourceId, [sourceId]);
	const pins = useFilePins(projectId, belongs);
	const toggleGeo = async () => {
		if (geoOn) return setGeoOn(false);
		try {
			setGeo(geo ?? (await call("rooms.geometry", projectId, sourceId)));
			setGeoOn(true);
		} catch (e) {
			setErr(errText(e));
		}
	};
	const focusPin = (p: Pin) => ui.focusAdd(pinFocus(p));
	const select = (p: Pin) => {
		setActive(p.id);
		focusPin(p);
		if ("page" in p.target && p.target.page) setJump(p.target.page);
	};
	const numberOf = new Map(pins.items.map((x) => [x.pin.id, x.n]));
	return (
		<>
			{err && <div className="err">{err}</div>}
			<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
				<div className="fill-col" style={{ minWidth: 0 }}>
					<PdfView
						key={sourceId}
						load={() => call("sources.bytes", projectId, sourceId)}
						sourceId={sourceId}
						title={title}
						initialPage={jump}
						highlight={quote}
						onQuote={(k) => factReview.quoteFound(k)}
						onPage={(pg) => {
							if (focused) ui.setView({ page: pg });
							viewer.pageChanged(paneIndex, sourceId, pg);
						}}
						markup={{ shape, shown: (pg) => [...pins.items.filter(({ pin }) => "page" in pin.target && pin.target.page === pg).flatMap(({ pin }) => pin.markup ?? []), ...drawn.filter((d) => d.page === pg).map((d) => d.m)], onDone: (pg, m) => setDrawn((d) => [...d, { page: pg, m }]) }}
						sketchNote={note}
						onSketchSent={() => setNote("")}
						toolbar={
							<>
								<input placeholder="piezīme: Piezīme + klikšķis, vai Skice + taisnstūris" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 230 }} />
								<MarkupTools shape={shape} setShape={setShape} count={drawn.length} onClear={() => setDrawn([])} />
								<button className={geoOn ? "primary" : ""} onClick={toggleGeo} title="Plāna līnijas no vektoru PDF">
									Ģeometrija
								</button>
								{geoOn && (
									<button onClick={() => call("rooms.geometryCsv", projectId, sourceId).catch((e) => setErr(errText(e)))} title="Līnijas un punkti CSV failā">
										CSV
									</button>
								)}
							</>
						}
						onPageClick={(pg, x, y) => {
							if (!note.trim()) return setErr(tr("Ieraksti piezīmi laukā virs lapas, tad klikšķini lapā."));
							setErr(null);
							const marks = drawn.filter((d) => d.page === pg).map((d) => d.m);
							call("pins.add", projectId, { sourceId, page: pg, x, y }, note.trim(), marks.length ? { intent: "mark", markup: marks } : undefined)
								.then((p) => (setNote(""), setDrawn((d) => d.filter((x) => x.page !== pg)), setActive(p.id), pins.reload()))
								.catch((e) => setErr(errText(e)));
						}}
						overlay={(pg) => {
							const g = geoOn ? geo?.find((p) => p.page === pg) : null;
							const here = pins.items.filter(({ pin }) => "page" in pin.target && pin.target.page === pg);
							return (
								<>
									{g && (
										<svg className="overlay-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
											{g.fractions.map((s, i) => (
												<line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#e0675a" strokeWidth={0.0025} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
											))}
										</svg>
									)}
									{here.map(({ pin: p, n }) =>
										"x" in p.target ? (
											<div
												key={p.id}
												className={`pin-dot ${p.state === "closed" ? "closed" : ""} ${active === p.id ? "active" : ""}`}
												style={{ left: `${p.target.x * 100}%`, top: `${p.target.y * 100}%` }}
												title={`${p.text}${p.comments.length ? `\n— ${p.comments.map((c) => c.text).join("\n— ")}` : ""}`}
												onClick={(e) => {
													e.stopPropagation();
													setActive(p.id);
													focusPin(p);
												}}
											>
												{numberOf.get(p.id) ?? n}
											</div>
										) : null,
									)}
								</>
							);
						}}
					/>
				</div>
				<PinSide projectId={projectId} items={pins.items} activeId={active} onSelect={select} onChanged={pins.reload} onError={setErr} />
			</div>
		</>
	);
}
