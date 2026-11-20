// IFC preview: BimCraft in a frame (bimcraft://), driven through its bridge add-on. The model bytes go in as a message;
// the user's selection comes back and becomes Fokuss items (elements with GlobalId); the agent's highlight tool and the sketch
// capture use the same channel. Nothing BimCraft edits is saved anywhere by the app: changes go through Revit.
// Annotation (8.2): the toolbar makes a pin on the selected element (with the camera it was seen from), the pins of this
// model are numbered dots in 3D, listed beside the view; a click on a dot or a row flies back to the pin.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Markup, Pin, PinTarget } from "../../core/model";
import { MarkupDraw, MarkupShapes, MarkupTools } from "./Markup";
import { pageMarks, paneSurface, usePageMarks } from "../page-marks";
import { elementFocus, isBimcraftMessage, sketchFocus, type BimcraftItem, type BimcraftToHost, type HostToBimcraft, type PinMarker } from "../../shared/bimcraft-protocol";
import { followerOf } from "../../shared/viewer";
import { pinFocus } from "../../shared/pins-view";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge } from "../ui";
import { cameraBus, viewer, viewerInfo, useViewer } from "../viewer-store";
import { useFilePins } from "./Annotate";
import { tr } from "../i18n";
import { viewerActions, type ViewerActions } from "../viewer-actions";

type Cmd = Exclude<HostToBimcraft, { type: "open" }>;
const listeners = new Set<(c: Cmd) => void>();
/** Other parts of the renderer (the agent's tool results) send commands to the open viewer through here. */
let relay: ((c: Cmd) => void) | null = null;
export const bimcraft = {
	send: (c: Cmd) => (relay ? relay(c) : listeners.forEach((l) => l(c))),
	/** in a popped-out window there is no viewer: its messages go to the main window's (task 9.11) */
	setRelay: (fn: ((c: Cmd) => void) | null) => {
		relay = fn;
	},
};

type Captured = Extract<import("../../shared/bimcraft-protocol").BimcraftToHost, { type: "captured" }>;

export function IfcView({ projectId, load, name, compareWith, scene, paneIndex = 0, focused = true }: { projectId: string; load: () => Promise<Uint8Array>; name: string; compareWith?: { name: string; load: () => Promise<Uint8Array> }; /** several IFC files in ONE scene (the federated 3D of Koordinācija, 9.8): `load` is ignored */ scene?: { name: string; load: () => Promise<Uint8Array> }[]; paneIndex?: number; focused?: boolean }) {
	// a compare or a scene of several models: no pins, no marks, no element panels (those belong to one model)
	const multi = !!compareWith || !!scene;
	// only the focused pane answers the chat, the toolbar and the side panels; both panes feed a linked camera
	const focusedRef = useRef(focused);
	focusedRef.current = focused;
	const vs = useViewer();
	const camLinked = vs.panes.length === 2 && vs.linkedCamera;
	const [cmp, setCmp] = useState<{ added: number; removed: number; changed: number; same: number } | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const [state, setState] = useState<"loading" | "ready" | "open" | "error">("loading");
	const [msg, setMsg] = useState<string | null>(null);
	const [sel, setSel] = useState<BimcraftItem[]>([]);
	const [note, setNote] = useState("");
	const [active, setActive] = useState<string | null>(null);
	const wantCapture = useRef<((c: Captured) => void) | null>(null);
	// marks drawn over the view, kept with the next pin and the camera it was drawn from
	const [shape, setShape] = useState<Markup["shape"] | null>(null);
	// kept in the shared store (page-marks.ts) under this pane, so the page's comment strip can take them too
	const surface = paneSurface(paneIndex);
	const marks = usePageMarks().by[surface] ?? [];
	// unsaved marks belong to this view: they go with it, as when they were its own state
	useEffect(() => () => pageMarks.clear(surface), [surface]);
	// the legend of a colouring the agent (or the user) asked for
	const [legend, setLegend] = useState<Extract<BimcraftToHost, { type: "coloured" }> | null>(null);

	// pins on elements of THIS model; one the agent made without naming a model shows wherever its element is found
	const belongs = useCallback((p: Pin) => "elementGuid" in p.target && (p.target.model === undefined || p.target.model === name), [name]);
	const pins = useFilePins(projectId, belongs);
	const markers = useMemo<PinMarker[]>(() => pins.items.map(({ pin, n }) => ({ id: pin.id, guid: (pin.target as { elementGuid: string }).elementGuid, n, state: pin.state })), [pins.items]);
	const markersRef = useRef(markers);
	markersRef.current = markers;

	const post = (m: HostToBimcraft) => frame.current?.contentWindow?.postMessage(m, "*");
	/** The side panels read the focused model: its tree and metadata now, the element's properties as it is selected. */
	const publishInfo = () => {
		viewerInfo.reset(name);
		post({ pj: 1, type: "tree" });
		post({ pj: 1, type: "meta" });
		const first = ui.get().view.selection[0];
		if (first?.guid) post({ pj: 1, type: "props", guid: first.guid });
	};
	// the pane that is focused again tells the panels about its model
	useEffect(() => {
		if (focused && state === "open" && !multi) publishInfo();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [focused, state]);
	// a linked split: this view posts its camera and the other one follows it
	useEffect(() => {
		if (state !== "open" || multi) return;
		post({ pj: 1, type: "watch", on: camLinked });
		return () => post({ pj: 1, type: "watch", on: false });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [camLinked, state]);
	useEffect(
		() => {
			const off = cameraBus.on((from, camera) => {
				if (followerOf(viewer.get(), from, "camera") === paneIndex) post({ pj: 1, type: "fly", camera });
			});
			return () => void off();
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[paneIndex],
	);

	useEffect(() => {
		const onMsg = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow || !isBimcraftMessage(e.data)) return;
			const m = e.data;
			if (m.type === "ready") {
				setState("ready");
				(scene
					? Promise.all(scene.map((x) => x.load().then((bytes) => ({ name: x.name, bytes })))).then((models) => post({ pj: 1, type: "scene", models }))
					: compareWith
					? Promise.all([load(), compareWith.load()]).then(([a, b]) => post({ pj: 1, type: "compare", a: { name, bytes: a }, b: { name: compareWith.name, bytes: b } }))
					: load().then((bytes) => post({ pj: 1, type: "open", name, bytes })))
					.catch((err) => (setState("error"), setMsg(errText(err))));
			} else if (m.type === "opened") {
				setState("open");
				if (focusedRef.current && !multi) publishInfo();
				if (!multi) post({ pj: 1, type: "markers", markers: markersRef.current });
				// elements a traced sheet change named: selected as soon as the model is open
				const want = ui.get().highlight;
				if (want?.length) {
					post({ pj: 1, type: "highlight", guids: want });
					ui.highlightNext(null);
				}
			} else if (m.type === "selection") {
				setSel(m.items);
				if (focusedRef.current) {
					ui.setView({ selection: m.items.map((i) => ({ guid: i.guid, cls: i.cls, name: i.name })) });
					if (m.items[0]) post({ pj: 1, type: "props", id: m.items[0].id });
					else viewerInfo.set({ props: null });
				}
				for (const it of m.items.slice(0, 10)) ui.focusAdd(elementFocus(it, name));
			} else if (m.type === "properties") {
				if (focusedRef.current) viewerInfo.set({ props: m.item, error: null });
			} else if (m.type === "tree") {
				if (focusedRef.current) viewerInfo.set({ tree: m.nodes });
			} else if (m.type === "meta") {
				if (focusedRef.current) viewerInfo.set({ meta: m.info });
			} else if (m.type === "scene") {
				setState("open");
				setMsg(tr("{n} modeļi vienā ainā", { n: m.models.length }));
			} else if (m.type === "modelShown") {
				setMsg(m.name ? tr("rādīts tikai {name}", { name: m.name }) : tr("rādīti visi modeļi"));
			} else if (m.type === "viewed") {
				setMsg(m.action === "isolate" ? tr("izolēti {found} no {asked}", { found: m.found, asked: m.asked }) : m.action === "show_all" ? tr("rādīts viss modelis") : tr("krāsas noņemtas"));
				if (m.action === "uncolour") setLegend(null);
			} else if (m.type === "coloured") {
				setLegend(m);
				setMsg(tr("krāsots pēc {property}: {painted} no {total}{partial}", { property: m.property, painted: m.painted, total: m.total, partial: m.partial ? tr(" (tikai sākums)") : "" }));
			} else if (m.type === "camera") {
				cameraBus.emit(paneIndex, m.camera);
			} else if (m.type === "compared") {
				setState("open");
				setCmp(m);
			} else if (m.type === "highlighted") setMsg(tr("iezīmēti {found} no {asked}", { found: m.found, asked: m.asked }));
			else if (m.type === "sketch") ui.focusAdd(sketchFocus(m.items, m.note, name));
			else if (m.type === "captured") {
				ui.setView({ camera: m.camera });
				wantCapture.current?.(m);
				wantCapture.current = null;
			} else if (m.type === "marker") {
				setActive(m.id);
				const p = pins.all.find((x) => x.id === m.id);
				if (p) ui.focusAdd(pinFocus(p));
			} else if (m.type === "markers") {
				if (m.drawn < m.asked) setMsg(tr("{n} piezīmju elementu šajā modelī nav (cita versija?)", { n: m.asked - m.drawn }));
			} else if (m.type === "error") {
				setMsg(m.message);
				if (focusedRef.current) viewerInfo.set({ error: m.message });
			}
		};
		window.addEventListener("message", onMsg);
		const l = (c: Cmd) => focusedRef.current && post(c);
		listeners.add(l);
		return () => {
			window.removeEventListener("message", onMsg);
			listeners.delete(l);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [name, compareWith?.name, pins.all]);

	// the dots follow the pins: a new, closed or reopened pin redraws them
	useEffect(() => {
		if (state === "open" && !multi) post({ pj: 1, type: "markers", markers });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [markers, state]);

	const makePin = (text: string = note) => {
		if (!text.trim()) return setMsg(tr("Ieraksti piezīmi laukā, iezīmē elementu modelī, tad spied Piezīme."));
		if (!sel.some((s) => s.guid)) return setMsg(tr("Vispirms iezīmē elementu modelī: piezīme tiek pie tā."));
		wantCapture.current = (c) => {
			const el = c.items.find((i) => i.guid);
			if (!el?.guid) return setMsg(tr("Iezīmētajam elementam nav GlobalId."));
			const target: PinTarget = { elementGuid: el.guid, model: name, ...(c.camera ? { camera: c.camera } : {}), ...(c.viewpoint ? { viewpoint: c.viewpoint } : {}) };
			call("pins.add", projectId, target, text.trim(), marks.length ? { intent: "mark", markup: marks } : undefined)
				.then((p) => (setNote(""), pageMarks.clear(surface), setShape(null), setActive(p.id), setMsg(null), pins.reload()))
				.catch((e) => setMsg(errText(e)));
		};
		post({ pj: 1, type: "capture" });
	};

	const select = (p: Pin) => {
		setActive(p.id);
		ui.focusAdd(pinFocus(p));
		if ("elementGuid" in p.target) post({ pj: 1, type: "fly", ...(p.target.camera ? { camera: p.target.camera } : { guid: p.target.elementGuid }) });
	};

	// the comment tool column drives this viewer while it is the focused one with one model (viewer-actions.ts)
	useEffect(() => {
		if (multi || !focused) return;
		const guids = () => sel.map((x) => x.guid).filter((g): g is string => !!g);
		const a: ViewerActions = {
			ready: state === "open",
			selected: sel.length,
			shape,
			marks: marks.length,
			pin: (t) => makePin(t),
			sketch: (t) => post({ pj: 1, type: "sketch", note: t }),
			setShape,
			clearMarks: () => pageMarks.clear(surface),
			isolate: () => (guids().length ? post({ pj: 1, type: "isolate", guids: guids(), ghost: true }) : setMsg(tr("Vispirms iezīmē elementus modelī."))),
			showAll: () => post({ pj: 1, type: "isolate", guids: [] }),
			colourBy: (property) => post({ pj: 1, type: "colour", property }),
		};
		viewerActions.set(a);
		return () => viewerActions.clear(a);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [multi, focused, state, sel, shape, marks.length, surface]);

	const exportBcf = () => call("bcf.exportPins", projectId).then((f) => setMsg(`BCF: ${f}`)).catch((e) => setMsg(errText(e)));

	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{name}</b>
				<Badge tone={state === "open" ? "ok" : state === "error" ? "bad" : "dim"}>{state === "loading" ? tr("ielādē BimCraft…") : state === "ready" ? tr("atver modeli…") : state === "open" ? tr("atvērts") : tr("kļūda")}</Badge>
				{compareWith && <span className="small">→ <b>{compareWith.name}</b></span>}
				{cmp && (
					<span className="small">
						<Badge tone="info">+{cmp.added}</Badge> <Badge tone="bad">−{cmp.removed}</Badge> <Badge tone="warn">~{cmp.changed}</Badge> <span className="dim">{tr("nemainīti {same}", { same: cmp.same })}</span>
					</span>
				)}
				{sel.length > 0 && <span className="dim small">{tr("iezīmēti {v}", { v: sel.length })}</span>}
				<span className="grow" />
				{/* the pin, the marks and the sketch moved to the comment tool column at the canvas edge (D6) */}
				{multi && (
					<button disabled={state !== "open"} title={tr("Iezīmētos elementus ar piezīmi nodod aģentam kā norādījumu")} onClick={() => (post({ pj: 1, type: "sketch", note }), setNote(""))}>
						{tr("Skice → aģentam")}</button>
				)}
			</div>
			{msg && <div className="dim small" style={{ padding: "2px 10px" }}>{msg}</div>}
			<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
				<div style={{ position: "relative", display: "flex", flex: 1, minWidth: 0 }}>
					<iframe ref={frame} title={tr("BimCraft")} src="bimcraft://app/" style={{ flex: 1, minWidth: 0, border: "none", background: "#fff" }} />
					{legend && (
						<div className="legend">
							<div className="row">
								<b className="small">{legend.property}</b>
								<span className="grow" />
								<button className="x" title={tr("Noņemt krāsas")} onClick={() => post({ pj: 1, type: "colour", property: "" })}>×</button>
							</div>
							{legend.legend.map((l) => (
								<div key={l.value || "—"} className="legend-row small">
									<span className="legend-sw" style={{ background: l.color }} /> {l.value || <span className="dim">{tr("nav vērtības")}</span>} <span className="dim">· {l.count}</span>
								</div>
							))}
						</div>
					)}
					{!multi && <MarkupShapes marks={marks} />}
					{!multi && shape && <MarkupDraw shape={shape} onDone={(m) => pageMarks.add(surface, m)} />}
				</div>
			</div>
		</div>
	);
}
