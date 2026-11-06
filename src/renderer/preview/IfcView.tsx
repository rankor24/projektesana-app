// IFC preview: BimCraft in a frame (bimcraft://), driven through its bridge add-on. The model bytes go in as a message;
// Boris's selection comes back and becomes Fokuss items (elements with GlobalId); the agent's highlight tool and the sketch
// capture use the same channel. Nothing BimCraft edits is saved anywhere by the app: changes go through Revit.
import { useEffect, useRef, useState } from "react";
import { elementFocus, isBimcraftMessage, sketchFocus, type BimcraftItem, type HostToBimcraft } from "../../shared/bimcraft-protocol";
import { errText } from "../bridge";
import { ui } from "../state";
import { Badge } from "../ui";

type Cmd = Exclude<HostToBimcraft, { type: "open" }>;
const listeners = new Set<(c: Cmd) => void>();
/** Other parts of the renderer (the agent's tool results) send commands to the open viewer through here. */
export const bimcraft = { send: (c: Cmd) => listeners.forEach((l) => l(c)) };

export function IfcView({ load, name, compareWith }: { load: () => Promise<Uint8Array>; name: string; compareWith?: { name: string; load: () => Promise<Uint8Array> } }) {
	const [cmp, setCmp] = useState<{ added: number; removed: number; changed: number; same: number } | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const [state, setState] = useState<"loading" | "ready" | "open" | "error">("loading");
	const [msg, setMsg] = useState<string | null>(null);
	const [sel, setSel] = useState<BimcraftItem[]>([]);
	const [note, setNote] = useState("");

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
			} else if (m.type === "opened") setState("open");
			else if (m.type === "selection") {
				setSel(m.items);
				for (const it of m.items.slice(0, 10)) ui.focusAdd(elementFocus(it, name));
			} else if (m.type === "compared") {
				setState("open");
				setCmp(m);
			} else if (m.type === "highlighted") setMsg(`iezīmēti ${m.found} no ${m.asked}`);
			else if (m.type === "sketch") ui.focusAdd(sketchFocus(m.items, m.note, name));
			else if (m.type === "error") setMsg(m.message);
		};
		window.addEventListener("message", onMsg);
		const l = (c: Cmd) => post(c);
		listeners.add(l);
		return () => {
			window.removeEventListener("message", onMsg);
			listeners.delete(l);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [name, compareWith?.name]);

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
				<input placeholder="skices piezīme aģentam" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 220 }} />
				<button disabled={state !== "open"} title="Iezīmētos elementus ar piezīmi nodod aģentam kā norādījumu" onClick={() => (post({ pj: 1, type: "sketch", note }), setNote(""))}>
					Skice → aģentam
				</button>
			</div>
			{msg && <div className="dim small" style={{ padding: "2px 10px" }}>{msg}</div>}
			<iframe ref={frame} title="BimCraft" src="bimcraft://app/" style={{ flex: 1, border: "none", background: "#fff" }} />
		</div>
	);
}
