// Comment tools (task 9.4, as planned on the board: X1, X2, M1, M2): the tool bar, a WINDOW like any other (id "tools"): it
// floats, docks on any side, joins a tab group or pops out, and stays where the user put it on every page. It lays itself out
// by its width: a row of tools when it is wide (docked on top, the default), a column when it is narrow (docked at a side). From the top: what the user picked on the page (a row, a cell, a tile, a fact), this
// page's tools (shared/comment-tools.ts) as icon buttons, the colour (a tool of its own: it goes with the next comment), and on
// a page with the model open the viewer's tools (pin, marks, sketch, isolate, colour by). A tool that needs words opens a
// small box beside the column; the comment becomes a pin the agent reads in its next prompt. The page's open comments fold
// out from the foot of the column, with → aģentam and → uzdevums on each.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Markup, Pin } from "../../core/model";
import { buildPin, COMMENT_COLOURS, toolsFor, VIEWER_TOOLS, withColour, type CommentColour, type CommentTool } from "../../shared/comment-tools";
import { pinFocus, pinMeaning, pinWhere, targetKind } from "../../shared/pins-view";
import { call, errText } from "../bridge";
import { commentSubject, useSubject } from "../comment-subject";
import { ui, useUi } from "../state";
import { useWindows } from "../windows";
import { useLoad } from "../ui";
import { tr } from "../i18n";
import { pageMarks } from "../page-marks";
import { useViewerActions, type ViewerActions } from "../viewer-actions";
import { screenGrab } from "./ScreenGrab";

/** One glyph per tool, so the column stays narrow; the label is under it and the hint in the tooltip. */
const ICON: Record<string, string> = {
	"tile-note": "✎",
	"fix-value": "✓",
	"move-date": "⇥",
	"cell-note": "✎",
	"storey-mark": "≡",
	correct: "✓",
	"region-note": "▭",
	"accept-change": "✓",
	"reject-change": "✕",
	"colour-room": "◐",
	"room-note": "✎",
	"item-note": "✎",
	block: "⛔",
	approve: "✓",
	justify: "¶",
	accept: "✓",
	override: "⤼",
	pin: "📍",
	line: "╱",
	circle: "◯",
	rect: "▭",
	free: "〰",
};
const SHAPE_OF: Record<string, Markup["shape"]> = { line: "line", circle: "circle", rect: "rect", free: "free" };

type Asking = { kind: "page"; tool: CommentTool } | { kind: "pin" } | { kind: "sketch" } | { kind: "colourBy" };

export function CommentTools() {
	const { page } = useWindows();
	const { projectId } = useUi();
	const subject = useSubject();
	const va = useViewerActions();
	const tools = toolsFor(page);
	const [asking, setAsking] = useState<Asking | null>(null);
	const [text, setText] = useState("");
	const [colour, setColour] = useState<CommentColour | null>(null);
	const [side, setSide] = useState<"A" | "B">("A");
	const [err, setErr] = useState<string | null>(null);
	const [list, setList] = useState(false);
	// the boxes that open beside the column sit just right of it (fixed: the column scrolls and would clip them)
	const col = useRef<HTMLElement>(null);
	const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
	useEffect(() => {
		if (!asking && !list) return;
		const r = col.current?.getBoundingClientRect();
		// a wide bar opens its box below itself, a narrow column opens it beside itself; never off the screen
		if (r) setAnchor(r.width > 240 ? { left: Math.min(r.left + 8, window.innerWidth - 320), top: Math.min(r.bottom + 6, window.innerHeight - 260) } : { left: Math.min(r.right + 6, window.innerWidth - 320), top: Math.min(r.top + 8, window.innerHeight - 260) });
	}, [asking, list]);
	const pins = useLoad<Pin[]>(() => (projectId ? call("pins.list", projectId) : Promise.resolve([])), [projectId]);
	const kinds = useMemo(() => new Set(tools.flatMap((t) => t.on)), [tools]);
	const mine = useMemo(() => (pins.data ?? []).filter((p) => p.state !== "closed" && kinds.has(targetKind(p.target)) && targetKind(p.target) !== "page" && targetKind(p.target) !== "element"), [pins.data, kinds]);
	const viewer = va && va.ready ? va : null;
	// the screen grab works on every page, with or without a project; the page's own tools come on top of it
	const own = tools.length > 0 || !!viewer;

	const make = (tool: CommentTool, words: string) => {
		const target = subject && "thing" in subject.target && subject.target.thing === "change" ? { ...subject.target, side } : (subject?.target ?? null);
		// the marks drawn on the view (the surface drawn on last): "Apgabals" takes its rectangle
		const drawn = pageMarks.latest();
		const built = buildPin(tool, target, words, drawn.marks, colour);
		if (typeof built === "string") return setErr(built);
		setErr(null);
		if (!projectId) return;
		call("pins.add", projectId, built.target, built.text, built.opts)
			.then((p) => {
				setText("");
				setAsking(null);
				if (built.opts.markup?.length && drawn.surface) pageMarks.clear(drawn.surface);
				ui.focusAdd(pinFocus(p));
				pins.reload();
				ui.bump();
			})
			.catch((e) => setErr(errText(e)));
	};
	const pick = (tool: CommentTool) => {
		setErr(null);
		if (tool.needsText) return (setAsking({ kind: "page", tool }), setText(""));
		make(tool, "");
	};
	const submit = () => {
		if (!asking) return;
		if (asking.kind === "page") return make(asking.tool, text);
		if (!viewer) return;
		if (asking.kind === "pin") viewer.pin(withColour(text, colour));
		else if (asking.kind === "sketch") viewer.sketch(withColour(text, colour));
		else viewer.colourBy(text.trim() || "klase");
		setText("");
		setAsking(null);
	};
	const toTask = (p: Pin) => !projectId ? undefined : call("todos.add", projectId, { title: pinMeaning({ ...p, markup: undefined }).slice(0, 120), note: pinWhere(p), refs: { pinId: p.id, ...(p.findingId ? { findingId: p.findingId } : {}) } }).then(() => ui.bump()).catch((e) => setErr(errText(e)));
	const isChange = !!subject && "thing" in subject.target && subject.target.thing === "change";

	return (
		<div className="ctool-win">
		<aside ref={col} className="ctool-col" aria-label={tr("Komentāru rīki")}>
			<ToolButton
				icon="⛶"
				label={tr("Ekrāna apgabals")}
				hint={tr("Atzīmē apgabalu logā, uzzīmē uz tā un nosūti aģentam (jebkurā lapā)")}
				onClick={() => screenGrab.start(COMMENT_COLOURS.find((c) => c.id === colour)?.hex)}
			/>
			<div className="ctool-sep" />
			{own && projectId && (
			<div className={`ctool-subject ${subject ? "on" : ""}`} title={subject ? pinWhere({ target: subject.target } as Pin) : tr("klikšķini rindu, šūnu vai kartīti, pie kuras komentēt")}>
				{subject ? (
					<>
						<span className="ctool-subject-text">{subject.label}</span>
						<button className="x" onClick={() => commentSubject.clear()} title={tr("Notīrīt")}>
							×
						</button>
					</>
				) : (
					<span className="dim">{tr("izvēlies lapā")}</span>
				)}
			</div>
			)}
			{isChange && (
				<div className="ctool-ab">
					<button className={side === "A" ? "on" : ""} onClick={() => setSide("A")}>
						A
					</button>
					<button className={side === "B" ? "on" : ""} onClick={() => setSide("B")}>
						B
					</button>
				</div>
			)}
			{tools.map((t) => (
				<ToolButton key={t.id} icon={ICON[t.id] ?? "•"} label={tr(t.label)} hint={tr(t.hint)} on={asking?.kind === "page" && asking.tool.id === t.id} onClick={() => pick(t)} />
			))}
			<div className="ctool-sep" />
			<div className="ctool-colours" title={tr("Krāsa: iet līdzi nākamajam komentāram (aģents to lasa)")}>
				{COMMENT_COLOURS.map((c) => (
					<button key={c.id} className={`ctool-swatch ${colour === c.id ? "on" : ""}`} style={{ background: c.hex }} aria-label={tr(c.id)} title={tr(c.id)} onClick={() => setColour(colour === c.id ? null : c.id)} />
				))}
			</div>
			{viewer && <ViewerTools va={viewer} asking={asking} ask={(a) => (setAsking(a), setText(""), setErr(null))} />}
			<div className="grow" />
			{mine.length > 0 && (
				<ToolButton icon="💬" label={tr("Komentāri ({n})", { n: mine.length })} hint={tr("Šīs lapas atvērtie komentāri")} on={list} onClick={() => setList(!list)} />
			)}
			{asking && (
				<AskBox
					at={anchor ? { left: anchor.left, top: anchor.top } : undefined}
					title={asking.kind === "page" ? tr(asking.tool.label) : asking.kind === "pin" ? tr("Piezīme pie elementa") : asking.kind === "sketch" ? tr("Skice → aģentam") : tr("Krāsot pēc")}
					hint={asking.kind === "page" ? tr(asking.tool.hint) : asking.kind === "colourBy" ? tr("klase, typename, objecttype vai Pset.Nosaukums") : asking.kind === "pin" ? tr("Iezīmē elementu modelī; piezīme tiek pie tā ar skatu") : tr("Iezīmētie elementi ar šo tekstu aiziet aģentam")}
					value={text}
					setValue={setText}
					colour={asking.kind === "colourBy" ? null : colour}
					err={err}
					onSubmit={submit}
					onCancel={() => (setAsking(null), setErr(null))}
				/>
			)}
			{!asking && err && <div className="ctool-err err small">{err}</div>}
			{list && (
				<div className="ctool-flyout" style={anchor ? { left: anchor.left, top: anchor.top } : undefined}>
					<div className="row">
						<b>{tr("Komentāri")}</b>
						<span className="grow" />
						<button className="ghost small" onClick={() => setList(false)}>
							×
						</button>
					</div>
					{mine.map((p) => (
						<div key={p.id} className="comment-row small">
							<span className="grow">
								{pinMeaning(p)} <span className="dim">· {pinWhere(p)}</span>
							</span>
							<button className="small ghost" onClick={() => ui.focusAdd(pinFocus(p))}>
								{tr("→ aģentam")}
							</button>
							<button className="small ghost" onClick={() => void toTask(p)}>
								{tr("→ uzdevums")}
							</button>
							<button className="small ghost" title={tr("Piezīmi aizver tikai tu")} onClick={() => call("pins.close", projectId ?? "", p.id).then(() => (pins.reload(), ui.bump())).catch((e) => setErr(errText(e)))}>
								{tr("aizvērt")}
							</button>
						</div>
					))}
				</div>
			)}
		</aside>
		</div>
	);
}

function ToolButton({ icon, label, hint, on, disabled, onClick }: { icon: string; label: string; hint: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
	return (
		<button className={`ctool ${on ? "on" : ""}`} title={hint} disabled={disabled} onClick={onClick}>
			<span className="ctool-icon">{icon}</span>
			<span className="ctool-label">{label}</span>
		</button>
	);
}

/** The model viewer's tools (M2): a pin with the camera, marks over the view, the sketch for the agent, isolate, colour by. */
function ViewerTools({ va, asking, ask }: { va: ViewerActions; asking: Asking | null; ask: (a: Asking) => void }) {
	const marks = VIEWER_TOOLS.filter((t) => t.id !== "pin");
	return (
		<>
			<div className="ctool-sep" />
			<div className="ctool-head">{tr("Modelis")}</div>
			<ToolButton icon={ICON.pin} label={tr("Piezīme")} hint={tr("Piezīme pie iezīmētā elementa, ar skatu")} on={asking?.kind === "pin"} disabled={!va.selected} onClick={() => ask({ kind: "pin" })} />
			{marks.map((t) => {
				const shape = SHAPE_OF[t.id];
				return <ToolButton key={t.id} icon={ICON[t.id] ?? "•"} label={tr(t.label)} hint={tr(t.hint)} on={va.shape === shape} onClick={() => va.setShape(va.shape === shape ? null : shape)} />;
			})}
			{va.marks > 0 && <ToolButton icon="⌫" label={tr("Notīrīt ({n})", { n: va.marks })} hint={tr("Notīrīt zīmējumu virs skata")} onClick={va.clearMarks} />}
			<ToolButton icon="➜" label={tr("Skice")} hint={tr("Iezīmētos elementus ar tekstu nodod aģentam kā norādījumu")} on={asking?.kind === "sketch"} disabled={!va.selected} onClick={() => ask({ kind: "sketch" })} />
			<ToolButton icon="◎" label={tr("Izolēt")} hint={tr("Rādīt tikai iezīmētos, pārējie pelēki")} disabled={!va.selected} onClick={va.isolate} />
			<ToolButton icon="◉" label={tr("Rādīt visu")} hint={tr("Atkal rādīt visus elementus")} onClick={va.showAll} />
			<ToolButton icon="🎨" label={tr("Krāsot pēc")} hint={tr("Krāsot modeli pēc klases vai īpašības")} on={asking?.kind === "colourBy"} onClick={() => ask({ kind: "colourBy" })} />
		</>
	);
}

function AskBox({ at, title, hint, value, setValue, colour, err, onSubmit, onCancel }: { at?: { left: number; top: number }; title: string; hint: string; value: string; setValue: (v: string) => void; colour: CommentColour | null; err: string | null; onSubmit: () => void; onCancel: () => void }) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		ref.current?.focus();
	}, []);
	const hex = COMMENT_COLOURS.find((c) => c.id === colour)?.hex;
	return (
		<div className="ctool-ask" style={at} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
			<div className="row">
				<b>{title}</b>
				{hex && <span className="ctool-swatch on" style={{ background: hex }} />}
			</div>
			<div className="dim small">{hint}</div>
			<textarea
				ref={ref}
				rows={3}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						onSubmit();
					}
				}}
			/>
			{err && <div className="err small">{err}</div>}
			<div className="row">
				<span className="grow" />
				<button className="ghost small" onClick={onCancel}>
					{tr("Atcelt")}
				</button>
				<button className="primary small" onClick={onSubmit}>
					{tr("Saglabāt")}
				</button>
			</div>
		</div>
	);
}
