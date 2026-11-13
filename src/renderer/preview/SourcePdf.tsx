// A project source in the PDF view, with its overlays: the plan geometry read from a vector inventory (3.4) and the user's
// pins (6.4, 8.2). The overlay draws in page fractions, so it stays on the plan at any zoom. Pins are made with the note
// field in the toolbar (Electron has no window.prompt): write the note, press Piezīme, click the page.
import { useCallback, useState } from "react";
import type { Pin } from "../../core/model";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { PdfView } from "./PdfView";
import { PinPanel, useFilePins } from "./Annotate";

type Geo = Awaited<ReturnType<typeof call<"rooms.geometry">>>;

export function SourcePdf({ projectId, sourceId, title, page }: { projectId: string; sourceId: string; title: string; page?: number }) {
	const [geo, setGeo] = useState<Geo | null>(null);
	const [geoOn, setGeoOn] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [active, setActive] = useState<string | null>(null);
	const [jump, setJump] = useState<number | undefined>(page);
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
	const focusPin = (p: Pin) => ui.focusAdd({ kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, target: p.target } });
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
						toolbar={
							<>
								<input placeholder="piezīme, tad Piezīme un klikšķis lapā" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 230 }} />
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
							if (!note.trim()) return setErr("Ieraksti piezīmi laukā virs lapas, tad klikšķini lapā.");
							setErr(null);
							call("pins.add", projectId, { sourceId, page: pg, x, y }, note.trim())
								.then((p) => (setNote(""), setActive(p.id), pins.reload()))
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
				<PinPanel projectId={projectId} items={pins.items} activeId={active} onSelect={select} onChanged={pins.reload} onError={setErr} />
			</div>
		</>
	);
}
