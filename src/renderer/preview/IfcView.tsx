// IFC preview: BimCraft in a frame (bimcraft://), driven through its bridge add-on. The model bytes go in as a message;
// the user's selection comes back and becomes Fokuss items (elements with GlobalId); the agent's highlight tool and the sketch
// capture use the same channel. Nothing BimCraft edits is saved anywhere by the app: changes go through Revit.
// Annotation (8.2): the toolbar makes a pin on the selected element (with the camera it was seen from), the pins of this
// model are numbered dots in 3D, listed beside the view; a click on a dot or a row flies back to the pin.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pin, PinTarget } from "../../core/model";
import { elementFocus, isBimcraftMessage, sketchFocus, type BimcraftItem, type HostToBimcraft, type PinMarker } from "../../shared/bimcraft-protocol";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge } from "../ui";
import { PinPanel, useFilePins } from "./Annotate";

type Cmd = Exclude<HostToBimcraft, { type: "open" }>;
const listeners = new Set<(c: Cmd) => void>();
/** Other parts of the renderer (the agent's tool results) send commands to the open viewer through here. */
export const bimcraft = { send: (c: Cmd) => listeners.forEach((l) => l(c)) };

type Captured = Extract<import("../../shared/bimcraft-protocol").BimcraftToHost, { type: "captured" }>;

export function IfcView({ projectId, load, name, compareWith }: { projectId: string; load: () => Promise<Uint8Array>; name: string; compareWith?: { name: string; load: () => Promise<Uint8Array> } }) {
	const [cmp, setCmp] = useState<{ added: number; removed: number; changed: number; same: number } | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const [state, setState] = useState<"loading" | "ready" | "open" | "error">("loading");
	const [msg, setMsg] = useState<string | null>(null);
	const [sel, setSel] = useState<BimcraftItem[]>([]);
	const [note, setNote] = useState("");
	const [active, setActive] = useState<string | null>(null);
	const wantCapture = useRef<((c: Captured) => void) | null>(null);

	// pins on elements of THIS model; one the agent made without naming a model shows wherever its element is found
	const belongs = useCallback((p: Pin) => "elementGuid" in p.target && (p.target.model === undefined || p.target.model === name), [name]);
	const pins = useFilePins(projectId, belongs);
	const markers = useMemo<PinMarker[]>(() => pins.items.map(({ pin, n }) => ({ id: pin.id, guid: (pin.target as { elementGuid: string }).elementGuid, n, state: pin.state })), [pins.items]);
	const markersRef = useRef(markers);
	markersRef.current = markers;

	const post = (m: HostToBimcraft) => frame.current?.contentWindow?.postMessage(m, "*");

	useEffect(() => {
		const onMsg = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow || !isBimcraftMessage(e.data)) return;
			const m = e.data;
			if (m.type === "ready") {
				setState("ready");
				(compareWith
					? Promise.all([load(), compareWith.load()]).then(([a, b]) => post({ pj: 1, type: "compare", a: { name, bytes: a }, b: { name: compareWith.name, bytes: b } }))
					: load().then((bytes) => post({ pj: 1, type: "open", name, bytes })))
					.catch((err) => (setState("error"), setMsg(errText(err))));
			} else if (m.type === "opened") {
				setState("open");
				if (!compareWith) post({ pj: 1, type: "markers", markers: markersRef.current });
				// elements a traced sheet change named: selected as soon as the model is open
				const want = ui.get().highlight;
				if (want?.length) {
					post({ pj: 1, type: "highlight", guids: want });
					ui.highlightNext(null);
				}
			} else if (m.type === "selection") {
				setSel(m.items);
				for (const it of m.items.slice(0, 10)) ui.focusAdd(elementFocus(it, name));
			} else if (m.type === "compared") {
				setState("open");
				setCmp(m);
			} else if (m.type === "highlighted") setMsg(`iezīmēti ${m.found} no ${m.asked}`);
			else if (m.type === "sketch") ui.focusAdd(sketchFocus(m.items, m.note, name));
			else if (m.type === "captured") {
				wantCapture.current?.(m);
				wantCapture.current = null;
			} else if (m.type === "marker") {
				setActive(m.id);
				const p = pins.all.find((x) => x.id === m.id);
				if (p) ui.focusAdd({ kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, target: p.target } });
			} else if (m.type === "markers") {
				if (m.drawn < m.asked) setMsg(`${m.asked - m.drawn} piezīmju elementu šajā modelī nav (cita versija?)`);
			} else if (m.type === "error") setMsg(m.message);
		};
		window.addEventListener("message", onMsg);
		const l = (c: Cmd) => post(c);
		listeners.add(l);
		return () => {
			window.removeEventListener("message", onMsg);
			listeners.delete(l);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [name, compareWith?.name, pins.all]);

	// the dots follow the pins: a new, closed or reopened pin redraws them
	useEffect(() => {
		if (state === "open" && !compareWith) post({ pj: 1, type: "markers", markers });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [markers, state]);

	const makePin = () => {
		if (!note.trim()) return setMsg("Ieraksti piezīmi laukā, iezīmē elementu modelī, tad spied Piezīme.");
		if (!sel.some((s) => s.guid)) return setMsg("Vispirms iezīmē elementu modelī: piezīme tiek pie tā.");
		wantCapture.current = (c) => {
			const el = c.items.find((i) => i.guid);
			if (!el?.guid) return setMsg("Iezīmētajam elementam nav GlobalId.");
			const target: PinTarget = { elementGuid: el.guid, model: name, ...(c.camera ? { camera: c.camera } : {}), ...(c.viewpoint ? { viewpoint: c.viewpoint } : {}) };
			call("pins.add", projectId, target, note.trim())
				.then((p) => (setNote(""), setActive(p.id), setMsg(null), pins.reload()))
				.catch((e) => setMsg(errText(e)));
		};
		post({ pj: 1, type: "capture" });
	};

	const select = (p: Pin) => {
		setActive(p.id);
		ui.focusAdd({ kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, target: p.target } });
		if ("elementGuid" in p.target) post({ pj: 1, type: "fly", ...(p.target.camera ? { camera: p.target.camera } : { guid: p.target.elementGuid }) });
	};

	const exportBcf = () => call("bcf.exportPins", projectId).then((f) => setMsg(`BCF: ${f}`)).catch((e) => setMsg(errText(e)));

	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{name}</b>
				<Badge tone={state === "open" ? "ok" : state === "error" ? "bad" : "dim"}>{state === "loading" ? "ielādē BimCraft…" : state === "ready" ? "atver modeli…" : state === "open" ? "atvērts" : "kļūda"}</Badge>
				{compareWith && <span className="small">→ <b>{compareWith.name}</b></span>}
				{cmp && (
					<span className="small">
						<Badge tone="info">+{cmp.added}</Badge> <Badge tone="bad">−{cmp.removed}</Badge> <Badge tone="warn">~{cmp.changed}</Badge> <span className="dim">nemainīti {cmp.same}</span>
					</span>
				)}
				{sel.length > 0 && <span className="dim small">iezīmēti {sel.length}</span>}
				<span className="grow" />
				{!compareWith && (
					<>
						<input placeholder="piezīme pinam vai skicei aģentam" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && state === "open" && makePin()} style={{ width: 240 }} />
						<button className="primary" disabled={state !== "open"} title="Piezīme tiek pie iezīmētā elementa, kopā ar skatu, no kura to redzēji" onClick={makePin}>
							Piezīme
						</button>
					</>
				)}
				<button disabled={state !== "open"} title="Iezīmētos elementus ar piezīmi nodod aģentam kā norādījumu" onClick={() => (post({ pj: 1, type: "sketch", note }), setNote(""))}>
					Skice → aģentam
				</button>
			</div>
			{msg && <div className="dim small" style={{ padding: "2px 10px" }}>{msg}</div>}
			<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
				<iframe ref={frame} title="BimCraft" src="bimcraft://app/" style={{ flex: 1, minWidth: 0, border: "none", background: "#fff" }} />
				{!compareWith && (
					<PinPanel
						projectId={projectId}
						items={pins.items}
						activeId={active}
						onSelect={select}
						onChanged={pins.reload}
						onError={setMsg}
						footer={
							<div className="pin-foot">
								<button className="small" disabled={pins.items.length === 0} title="Piezīmes uz elementiem kā BCF fails (Solibri, Navisworks, BimCraft)" onClick={exportBcf}>
									Piezīmes → BCF
								</button>
							</div>
						}
					/>
				)}
			</div>
		</div>
	);
}
