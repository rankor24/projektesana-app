// A project source in the PDF view, with its overlays: the plan geometry read from a vector inventory (3.4) and Boris's
// pins (6.4). The overlay draws in page fractions, so it stays on the plan at any zoom.
import { useState } from "react";
import type { Pin } from "../../core/model";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { useLoad } from "../ui";
import { PdfView } from "./PdfView";

type Geo = Awaited<ReturnType<typeof call<"rooms.geometry">>>;

export function SourcePdf({ projectId, sourceId, title, page }: { projectId: string; sourceId: string; title: string; page?: number }) {
	const [geo, setGeo] = useState<Geo | null>(null);
	const [geoOn, setGeoOn] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const pins = useLoad<Pin[]>(() => call("pins.list", projectId), [projectId]);
	const toggleGeo = async () => {
		if (geoOn) return setGeoOn(false);
		try {
			setGeo(geo ?? (await call("rooms.geometry", projectId, sourceId)));
			setGeoOn(true);
		} catch (e) {
			setErr(errText(e));
		}
	};
	const pinsHere = (pins.data ?? []).filter((p) => "sourceId" in p.target && p.target.sourceId === sourceId);
	return (
		<>
			{err && <div className="err">{err}</div>}
			<PdfView
				key={sourceId}
				load={() => call("sources.bytes", projectId, sourceId)}
				sourceId={sourceId}
				title={title}
				initialPage={page}
				toolbar={
					<>
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
					const text = prompt("Piezīme šajā vietā:");
					if (text?.trim()) call("pins.add", projectId, { sourceId, page: pg, x, y }, text.trim()).then(() => pins.reload()).catch((e) => setErr(errText(e)));
				}}
				overlay={(pg) => {
					const g = geoOn ? geo?.find((p) => p.page === pg) : null;
					const here = pinsHere.filter((p) => "page" in p.target && p.target.page === pg);
					return (
						<>
							{g && (
								<svg className="overlay-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
									{g.fractions.map((s, i) => (
										<line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#e0675a" strokeWidth={0.0025} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
									))}
								</svg>
							)}
							{here.map((p, i) =>
								"x" in p.target ? (
									<div
										key={p.id}
										className={`pin-dot ${p.state === "closed" ? "closed" : ""}`}
										style={{ left: `${p.target.x * 100}%`, top: `${p.target.y * 100}%` }}
										title={`${p.text}${p.comments.length ? `\n— ${p.comments.map((c) => c.text).join("\n— ")}` : ""}`}
										onClick={(e) => {
											e.stopPropagation();
											ui.focusAdd({ kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, target: p.target } });
										}}
									>
										{i + 1}
									</div>
								) : null,
							)}
						</>
					);
				}}
			/>
		</>
	);
}
