// Comment tools (task 9.4): the strip at the foot of every page that has comments. It names what the user picked on the page
// (a row, a cell, a tile, a fact), offers this page's tools (shared/comment-tools.ts), takes the text, and makes a pin that
// reaches the agent in its next prompt. Under it the page's own comments, with → aģentam and → uzdevums on each.
// BIM Crew has no equivalent: its chat is the only place the user points at things.
import { useMemo, useState } from "react";
import type { Pin } from "../../core/model";
import { buildPin, toolsFor, type CommentTool } from "../../shared/comment-tools";
import { pinFocus, pinMeaning, pinWhere, targetKind } from "../../shared/pins-view";
import { call, errText } from "../bridge";
import { commentSubject, useSubject } from "../comment-subject";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";

export function CommentTools({ page }: { page: string }) {
	const { projectId } = useUi();
	const subject = useSubject();
	const tools = toolsFor(page);
	const [text, setText] = useState("");
	const [side, setSide] = useState<"A" | "B">("A");
	const [err, setErr] = useState<string | null>(null);
	const [open, setOpen] = useState(true);
	const pins = useLoad<Pin[]>(() => (projectId ? call("pins.list", projectId) : Promise.resolve([])), [projectId]);
	// the comments that belong to this page's kinds of thing, open first
	const kinds = useMemo(() => new Set(tools.flatMap((t) => t.on)), [tools]);
	const mine = useMemo(() => (pins.data ?? []).filter((p) => p.state !== "closed" && kinds.has(targetKind(p.target)) && targetKind(p.target) !== "page" && targetKind(p.target) !== "element"), [pins.data, kinds]);
	if (!projectId || tools.length === 0) return null;

	const make = (tool: CommentTool) => {
		const target = subject && "thing" in subject.target && subject.target.thing === "change" ? { ...subject.target, side } : (subject?.target ?? null);
		const built = buildPin(tool, target, text);
		if (typeof built === "string") return setErr(built);
		setErr(null);
		call("pins.add", projectId, built.target, built.text, built.opts)
			.then((p) => (setText(""), ui.focusAdd(pinFocus(p)), pins.reload(), ui.bump()))
			.catch((e) => setErr(errText(e)));
	};
	const toTask = (p: Pin) => call("todos.add", projectId, { title: pinMeaning({ ...p, markup: undefined }).slice(0, 120), note: pinWhere(p), refs: { pinId: p.id, ...(p.findingId ? { findingId: p.findingId } : {}) } }).then(() => ui.bump()).catch((e) => setErr(errText(e)));

	return (
		<div className="comment-tools">
			<div className="row">
				<button className="ghost small" onClick={() => setOpen(!open)} title="Komentāri šajā lapā: tā tu saki aģentam, ko labot">
					{open ? "▾" : "▸"} Komentāri{mine.length ? ` (${mine.length})` : ""}
				</button>
				{subject ? (
					<span className="chip" title={pinWhere({ target: subject.target } as Pin)}>
						{subject.label}
						<button className="x" onClick={() => commentSubject.clear()}>×</button>
					</span>
				) : (
					<span className="dim small">klikšķini rindu, šūnu vai kartīti, pie kuras komentēt</span>
				)}
				{subject && "thing" in subject.target && subject.target.thing === "change" && (
					<span className="small">
						<button className={`small ${side === "A" ? "primary" : "ghost"}`} onClick={() => setSide("A")}>A</button>
						<button className={`small ${side === "B" ? "primary" : "ghost"}`} onClick={() => setSide("B")}>B</button>
					</span>
				)}
			</div>
			{open && (
				<>
					<div className="row">
						<input className="grow" placeholder="komentārs aģentam…" value={text} onChange={(e) => setText(e.target.value)} />
					</div>
					<div className="row" style={{ flexWrap: "wrap" }}>
						{tools.map((t) => (
							<button key={t.id} className="small" title={t.hint} onClick={() => make(t)}>
								{t.label}
							</button>
						))}
					</div>
					{err && <div className="err">{err}</div>}
					{mine.slice(0, 8).map((p) => (
						<div key={p.id} className="comment-row small">
							<span className="grow">
								{pinMeaning(p)} <span className="dim">· {pinWhere(p)}</span>
							</span>
							<button className="small ghost" onClick={() => ui.focusAdd(pinFocus(p))}>→ aģentam</button>
							<button className="small ghost" onClick={() => void toTask(p)}>→ uzdevums</button>
							<button className="small ghost" title="Piezīmi aizver tikai tu" onClick={() => call("pins.close", projectId, p.id).then(() => (pins.reload(), ui.bump())).catch((e) => setErr(errText(e)))}>
								aizvērt
							</button>
						</div>
					))}
				</>
			)}
		</div>
	);
}
