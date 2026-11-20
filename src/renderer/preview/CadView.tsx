// A DWG in CadCraft (cadcraft://, the CadCraft copy in resources/cadcraft), driven through its bridge add-on
// (src/cadcraft-addon/projektesana): the bytes go in as a message and open through CadCraft's own open, so the drawing shows
// as CAD shows it (text, hatches, lineweights, layers, sheets, measure). A compare draws its changes over the drawing
// (`marks`), never into it; two frames follow each other through `view` / `onView` (A | B). The twin of IfcView for IFC.
import { useEffect, useRef, useState } from "react";
import { call, errText } from "../bridge";
import { Badge } from "../ui";
import { tr } from "../i18n";

export interface CadMarkSet {
	lines: number[];
	color: string;
	width?: number;
	dash?: number[];
}
export interface CadMarks {
	name: string;
	sets: CadMarkSet[];
}
export interface CadViewState {
	cx: number;
	cy: number;
	zoom: number;
}

type FromCad = { pj: 1; type: "ready" } | { pj: 1; type: "opened"; name: string; objects: number | null; layers: number | null } | ({ pj: 1; type: "view" } & CadViewState) | { pj: 1; type: "error"; message: string };

const withExt = (name: string) => (/\.(dwg|dxf)$/i.test(name) ? name : `${name}.dwg`);

export function CadView({ projectId, path, name, marks, view, onView, fly, label }: { projectId: string; path: string; name: string; marks?: CadMarks[]; /** the other frame's view to follow */ view?: CadViewState | null; onView?: (v: CadViewState) => void; /** a place to centre, `n` changes each time */ fly?: { x: number; y: number; n: number } | null; /** a small caption over the frame (A · …) */ label?: string }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [state, setState] = useState<"loading" | "opening" | "open" | "error">("loading");
	const [info, setInfo] = useState<string | null>(null);
	const post = (m: object) => frame.current?.contentWindow?.postMessage({ pj: 1, ...m }, "*");
	const onViewRef = useRef(onView);
	onViewRef.current = onView;

	useEffect(() => {
		let live = true;
		const onMsg = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow || !e.data || e.data.pj !== 1) return;
			const m = e.data as FromCad;
			if (m.type === "ready") {
				setState("opening");
				call("dwg.bytes", projectId, path)
					.then((bytes) => live && post({ type: "open", name: withExt(name), bytes }))
					.catch((x) => live && (setState("error"), setInfo(errText(x))));
			} else if (m.type === "opened") {
				setState("open");
				setInfo(m.objects !== null ? tr("{n} objekti · {l} slāņi", { n: m.objects, l: m.layers ?? "?" }) : null);
			} else if (m.type === "view") onViewRef.current?.({ cx: m.cx, cy: m.cy, zoom: m.zoom });
			else if (m.type === "error") (setState("error"), setInfo(m.message));
		};
		window.addEventListener("message", onMsg);
		return () => {
			live = false;
			window.removeEventListener("message", onMsg);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [projectId, path, name]);

	// the marks, the linked view and the watch go in once the drawing is open, and again when they change
	useEffect(() => {
		if (state === "open") post({ type: "marks", spaces: marks ?? [] });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state, marks]);
	useEffect(() => {
		if (state === "open") post({ type: "watch", on: !!onView });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state, !!onView]);
	useEffect(() => {
		if (state === "open" && view) post({ type: "view", ...view });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state, view?.cx, view?.cy, view?.zoom]);
	useEffect(() => {
		if (state === "open" && fly) post({ type: "fly", x: fly.x, y: fly.y });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state, fly?.n]);

	return (
		<div className="cad-frame">
			{(label || state !== "open") && (
				<div className="dwg-split-label">
					{label}
					{state !== "open" && (
						<>
							{" "}
							<Badge tone={state === "error" ? "bad" : "dim"}>{state === "loading" ? tr("ielādē CadCraft…") : state === "opening" ? tr("atver rasējumu…") : tr("kļūda")}</Badge>
						</>
					)}
					{info && <span className="dim small"> · {info}</span>}
				</div>
			)}
			<iframe ref={frame} title={tr("CadCraft")} src="cadcraft://app/" className="cad-iframe" />
		</div>
	);
}
