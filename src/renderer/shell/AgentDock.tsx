// The agent dock: right half of the split view. Fokuss header, the conversation, the input.
// Events stream from main (agent.event); a `confirm` event shows the batch with Atļaut / Noraidīt.
// What the agent does between the question and the answer (thinking, tool calls, sources, facts) is the run card,
// drawn from the activity feed (main/activity.ts), not from the raw events.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { groupRuns, isRunning } from "../../shared/activity";
import { useActivity } from "../activity";
import { RunCard } from "./RunCard";
import type { AgentStatus, ChatAttachmentRef, ContextInfo } from "../../shared/api";
import { fmtTokens } from "../../shared/tokens";
import type { RunEvent } from "../../shared/types";
import { ACCEPT, pastedFiles, readAttachment, sizeText, type Pending } from "../attach";
import { call, errText, on } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";
import { windows, type PanelId } from "../windows";
import { readUi, type UiInstruction } from "../../shared/ui-instruction";
import { bimcraft } from "../preview/IfcView";

/** Carries out what an agent tool asked the window to do. */
function runUi(u: UiInstruction | null) {
	if (!u) return;
	if (u.open_panel) windows.open(u.open_panel.name as PanelId, u.open_panel.filter);
	if (u.show_source) ui.show({ kind: "source", sourceId: u.show_source.sourceId, page: u.show_source.page });
	if (u.highlight) bimcraft.send({ pj: 1, type: "highlight", guids: u.highlight.guids });
}

type Line =
	| { kind: "user"; text: string; attachments?: ChatAttachmentRef[] }
	| { kind: "assistant"; text: string; thinking?: string }
	/** the run card of one run: its steps come from the activity feed */
	| { kind: "run"; runId: string }
	| { kind: "compact"; phase: "start" | "done" | "failed" | "past"; text: string; summary?: string }
	| { kind: "confirm"; id: string; tool: string; batch: string; answered?: boolean; allow?: boolean }
	| { kind: "error"; text: string }
	| { kind: "retry"; text: string };

export function AgentDock() {
	const { projectId, focus } = useUi();
	const status = useLoad<AgentStatus>(() => call("agent.status"), []);
	const tasks = useLoad(() => call("tasks.list"), []);
	const [lines, setLines] = useState<Line[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const runRef = useRef<string | null>(null);
	const endRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	// files waiting to go with the next message: pasted screenshots, dropped or picked files
	const [pending, setPending] = useState<Pending[]>([]);
	const [reading, setReading] = useState(0);
	const [dragging, setDragging] = useState(false);
	const [compacting, setCompacting] = useState(false);
	const acts = useActivity();
	const runs = useMemo(() => new Map(groupRuns(acts).map((g) => [g.run, g.lines])), [acts]);
	// the project whose history is on screen, and whether a send is under way (a run then belongs to that send)
	const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
	const sending = useRef(false);

	// the text is measured a moment after typing stops, not on every key
	const [typed, setTyped] = useState("");
	useEffect(() => {
		const t = setTimeout(() => setTyped(text), 400);
		return () => clearTimeout(t);
	}, [text]);
	const ctx = useLoad<ContextInfo>(() => call("agent.context", projectId, { text: typed, focus }), [projectId, typed, focus]);

	// the limits of the chosen model, read by the paste handler below
	const limitsRef = useRef<AgentStatus["imageLimits"]>(null);
	limitsRef.current = status.data?.imageLimits ?? null;

	const addFiles = async (files: File[]) => {
		if (!files.length) return;
		setErr(null);
		setReading((r) => r + files.length);
		for (const f of files) {
			try {
				const a = await readAttachment(f, limitsRef.current);
				setPending((p) => [...p, a]);
			} catch (e) {
				setErr(errText(e));
			} finally {
				setReading((r) => r - 1);
			}
		}
		inputRef.current?.focus();
	};

	// Ctrl+V of a screenshot anywhere in the window goes to the chat, unless the paste lands in another text field
	useEffect(() => {
		const onPaste = (e: ClipboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && t !== inputRef.current && (t.closest("input, textarea, select, [contenteditable='true']") || t.isContentEditable)) return;
			const files = e.clipboardData ? pastedFiles(e.clipboardData) : [];
			if (!files.length) return;
			e.preventDefault();
			void addFiles(files);
		};
		document.addEventListener("paste", onPaste);
		return () => document.removeEventListener("paste", onPaste);
	}, []);

	// conversation of the open project
	useEffect(() => {
		let live = true;
		call("agent.history", projectId).then((h) => {
			if (!live) return;
			setLines(
				h.map((m): Line =>
					m.kind === "compaction"
						? { kind: "compact", phase: "past", text: `Saruna saspiesta: ${fmtTokens(m.tokens?.before ?? 0)} → ${fmtTokens(m.tokens?.after ?? 0)} tokeni`, summary: m.text }
						: m.role === "user"
							? { kind: "user", text: m.text, attachments: m.attachments }
							: { kind: "assistant", text: m.text },
				),
			);
			setLoadedFor(projectId);
		});
		return () => {
			live = false;
		};
	}, [projectId]);

	// a run of this project that is still going (the window reloaded, or the project was opened again mid-run):
	// show its card and follow its events, so the answer arrives and Apturēt works
	useEffect(() => {
		if (loadedFor !== projectId || runRef.current || sending.current) return;
		const going = [...runs].find(([, ls]) => ls[0].who === "agent" && ls[0].project === projectId && isRunning(ls));
		if (!going) return;
		const [id] = going;
		runRef.current = id;
		setRunId(id);
		setLines((ls) => (ls.some((l) => l.kind === "run" && l.runId === id) ? ls : [...ls, { kind: "run", runId: id }]));
	}, [runs, loadedFor, projectId]);

	useEffect(
		() =>
			on("agent.event", ({ runId: id, event }) => {
				if (id !== runRef.current) return;
				setLines((ls) => apply(ls, event));
				if (event.type === "tool_result" && event.ok) runUi(readUi(event.output));
				if (event.type === "done" || event.type === "error") {
					runRef.current = null;
					setRunId(null);
					ui.bump();
				}
			}),
		[],
	);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [lines]);

	const canSend = (text.trim().length > 0 || pending.length > 0) && reading === 0;
	const send = async () => {
		if (!canSend || runId) return;
		setErr(null);
		const t = text;
		const files = pending;
		sending.current = true;
		try {
			const r = await call(
				"agent.send",
				projectId,
				t,
				focus,
				files.map(({ name, mimeType, data, thumb }) => ({ name, mimeType, data, thumb })),
			);
			runRef.current = r.runId;
			setRunId(r.runId);
			const refs: ChatAttachmentRef[] = files.map((f) => ({ name: f.name, kind: f.kind, thumb: f.thumb }));
			setLines((ls) => [...ls, { kind: "user", text: t, attachments: refs.length ? refs : undefined }, { kind: "run", runId: r.runId }]);
			setText("");
			setPending([]);
		} catch (e) {
			// refused (a file the model cannot take, the agent busy): text and files stay so nothing is lost
			setErr(errText(e));
		} finally {
			sending.current = false;
		}
	};

	const compactNow = async () => {
		if (runId || compacting) return;
		setErr(null);
		setCompacting(true);
		try {
			const r = await call("agent.compact", projectId);
			setLines((ls) => [...ls, { kind: "compact", phase: "done", text: `Saruna saspiesta: ${fmtTokens(r.before)} → ${fmtTokens(r.after)} tokeni` }]);
		} catch (e) {
			setErr(errText(e));
		} finally {
			setCompacting(false);
			ctx.reload();
		}
	};

	const answer = async (id: string, allow: boolean) => {
		try {
			await call("agent.confirm", id, allow);
			setLines((ls) => ls.map((l) => (l.kind === "confirm" && l.id === id ? { ...l, answered: true, allow } : l)));
		} catch (e) {
			setErr(errText(e));
		}
	};

	const st = status.data;
	const blind = st?.images === false && pending.some((p) => p.kind === "image");
	// what the message being typed adds: the main process measures text, Fokuss and pins; the files were measured when attached
	const c = ctx.data;
	const draftCost =
		c?.draft && (text.trim() || pending.length)
			? (() => {
					const files = pending.reduce((n, p) => n + p.cost.tokens, 0);
					const total = c.draft.text + c.draft.focus + c.draft.pins + files;
					return { ...c.draft, files, total, over: (c.used ?? c.fixedEstimate) + total > c.compactAt };
				})()
			: null;
	const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");
	const lastRun = [...lines].reverse().find((l): l is Extract<Line, { kind: "run" }> => l.kind === "run")?.runId ?? null;
	return (
		<aside
			className={`agent-dock ${dragging ? "dropping" : ""}`}
			onDragOver={(e) => {
				if (!hasFiles(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "copy";
				setDragging(true);
			}}
			onDragLeave={(e) => {
				// leaving into a child is not leaving the dock
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
			}}
			onDrop={(e) => {
				if (!hasFiles(e)) return;
				e.preventDefault();
				setDragging(false);
				void addFiles([...e.dataTransfer.files]);
			}}
		>
			<div className="agent-head">
				<div className="row">
					<b>Aģents</b>
					{st ? (
						<button className={`chip ${st.signedIn ? "" : "bad"}`} onClick={() => windows.open("iestatijumi")} title={st.reason}>
							{st.providerLabel} · {st.model} · {st.signedIn ? "pieslēgts" : "nav pieslēgts"}
						</button>
					) : (
						<span className="dim small">…</span>
					)}
					<span className="badge dim" title="Revit MCP">Revit: {st?.revit ?? "…"}</span>
					<span className="grow" />
					<button className="ghost small" title="Sākt jaunu sarunu (pieraksts paliek)" onClick={() => call("agent.reset", projectId).then(() => setLines([]))}>
						jauna saruna
					</button>
				</div>
				<div className="focus-head">
					<span className="dim">Fokuss:</span>
					{focus.length === 0 ? (
						<span className="dim">nekas</span>
					) : (
						<>
							{focus.map((f) => (
								<span key={`${f.kind}:${f.id}`} className="chip" title={JSON.stringify(f.data ?? {})}>
									{f.label}
									<button className="x" onClick={() => ui.focusRemove(f.kind, f.id)}>×</button>
								</span>
							))}
							<button className="ghost small" onClick={() => ui.focusClear()}>notīrīt</button>
						</>
					)}
				</div>
				{ctx.data && <ContextMeter c={ctx.data} busy={!!runId || compacting} compacting={compacting} onCompact={compactNow} />}
			</div>
			<div className="chat">
				{lines.length === 0 && <div className="dim small chat-empty">{projectId ? "Saruna par šo projektu vēl nav sākta." : "nav projekta — saruna bez projekta datiem."}</div>}
				{lines.map((l, i) =>
					l.kind === "run" ? (
						runs.get(l.runId) ? (
							<RunCard key={l.runId} lines={runs.get(l.runId)!} latest={l.runId === lastRun} />
						) : (
							<div key={l.runId} className="dim small">strādā…</div>
						)
					) : (
						<ChatLine key={i} line={l} onAnswer={answer} />
					),
				)}
				<div ref={endRef} />
			</div>
			{err && <div className="err">{err}</div>}
			<div className="chat-input">
				<div className="row">
					<span className="dim small">Uzdevumi:</span>
					{(tasks.data ?? []).map((t) => (
						<button key={t.id} className="small ghost" title={t.text} onClick={() => setText(t.text)}>
							{t.label}
						</button>
					))}
				</div>
				{(pending.length > 0 || reading > 0) && (
					<div className="attach-strip">
						{pending.map((p) => (
							<div key={p.key} className={`attach ${p.kind}`} title={`${p.name} · ${sizeText(p.size)}${p.cost.pages ? ` · ${p.cost.pages} lpp.` : ""}${p.cost.cut ? " · garāks par limitu, iet tikai sākums" : ""}`}>
								{p.thumb ? <img src={p.thumb} alt={p.name} /> : <span className="attach-doc">{p.name.split(".").pop()?.toUpperCase()}</span>}
								<span className="attach-name">{p.name}</span>
								<span className={`attach-cost ${p.cost.cut ? "warn" : ""}`}>
									{p.cost.pages ? `${p.cost.pages} lpp. · ` : ""}≈{fmtTokens(p.cost.tokens)}
									{p.cost.cut ? " (sākums)" : ""}
								</span>
								<button className="x" title="Noņemt" onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))}>×</button>
							</div>
						))}
						{reading > 0 && <span className="dim small">sagatavo {reading}…</span>}
					</div>
				)}
				{draftCost && (
					<div className={`draft-cost small ${draftCost.over ? "warn" : "dim"}`} title="Aptuvens: teksts + Fokuss + atvērtās piezīmes + pielikumi. Precīzu skaitu pēc atbildes dod modelis.">
						Šī ziņa pievienos ≈{fmtTokens(draftCost.total)}: teksts {fmtTokens(draftCost.text)} · fokuss {fmtTokens(draftCost.focus)} · piezīmes {fmtTokens(draftCost.pins)}
						{draftCost.files > 0 && ` · pielikumi ${fmtTokens(draftCost.files)}`}
						{draftCost.over && " — pārsniegs saspiešanas robežu: saruna tiks saspiesta pirms atbildes"}
					</div>
				)}
				{blind && <div className="attach-warn small">Modelis {st?.model} neredz attēlus — Iestatījumos izvēlies citu modeli vai noņem attēlu.</div>}
				<textarea
					ref={inputRef}
					rows={3}
					value={text}
					placeholder={st && !st.signedIn ? "nav pieslēgts — atver Iestatījumi" : "Raksti aģentam… (Ctrl+Enter) · Ctrl+V ielīmē ekrānuzņēmumu"}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
					}}
				/>
				<div className="row">
					<button className="ghost" title="Pievienot failu vai attēlu (arī: Ctrl+V, ievilkt)" onClick={() => fileRef.current?.click()}>
						📎
					</button>
					<input
						ref={fileRef}
						type="file"
						multiple
						accept={ACCEPT}
						hidden
						onChange={(e) => {
							void addFiles([...(e.target.files ?? [])]);
							e.target.value = "";
						}}
					/>
					<span className="grow" />
					{runId ? (
						<button onClick={() => call("agent.stop")}>Apturēt</button>
					) : (
						<button className="primary" disabled={!canSend || blind} onClick={send}>
							Sūtīt
						</button>
					)}
				</div>
			</div>
		</aside>
	);
}

function apply(ls: Line[], e: RunEvent): Line[] {
	const last = ls[ls.length - 1];
	switch (e.type) {
		case "text":
			if (last?.kind === "assistant") return [...ls.slice(0, -1), { ...last, text: last.text + e.text }];
			return [...ls, { kind: "assistant", text: e.text }];
		case "thinking":
		case "tool":
		case "tool_result":
			// shown in the run card, from the activity feed
			return ls;
		case "compact": {
			// one line per compaction: "start" opens it, "done" / "failed" replace it
			const line: Line =
				e.phase === "start"
					? { kind: "compact", phase: "start", text: `Saruna ir ${fmtTokens(e.before)} tokenu — saspiež vecāko daļu…` }
					: e.phase === "done"
						? { kind: "compact", phase: "done", text: `Saruna saspiesta: ${fmtTokens(e.before)} → ≈${fmtTokens(e.after ?? 0)} tokeni` }
						: { kind: "compact", phase: "failed", text: `Saspiešana neizdevās, darbs turpinās bez tās: ${e.message ?? ""}` };
			return last?.kind === "compact" && last.phase === "start" ? [...ls.slice(0, -1), line] : [...ls, line];
		}
		case "confirm":
			return [...ls, { kind: "confirm", id: e.id, tool: e.tool, batch: e.batch }];
		case "retry": {
			// one line per run of restarts: the next attempt replaces the previous one
			const line: Line = { kind: "retry", text: `Savienojums pārtrūka (${e.message}). Atkārto ${e.attempt}/${e.of} pēc ${Math.round(e.delayMs / 1000)} s…` };
			return last?.kind === "retry" ? [...ls.slice(0, -1), line] : [...ls, line];
		}
		case "error":
			return [...ls, { kind: "error", text: e.message }];
		case "done":
			// the streamed text is already shown; a provider that does not stream sends the whole answer here
			if (last?.kind === "assistant" || !e.text) return ls;
			return [...ls, { kind: "assistant", text: e.text }];
		default:
			return ls;
	}
}

function ChatLine({ line: l, onAnswer }: { line: Line; onAnswer: (id: string, allow: boolean) => void }) {
	if (l.kind === "user")
		return (
			<div className="msg user">
				{l.attachments?.length ? (
					<div className="msg-attach">
						{l.attachments.map((a, i) =>
							a.thumb ? (
								<img key={i} src={a.thumb} alt={a.name} title={a.name} />
							) : (
								<span key={i} className="chip" title={a.name}>
									{a.kind === "image" ? "🖼" : "📄"} {a.name}
								</span>
							),
						)}
					</div>
				) : null}
				{l.text}
			</div>
		);
	if (l.kind === "assistant")
		return (
			<div className="msg assistant">
				{l.thinking && (
					<details className="thinking">
						<summary>domāšana</summary>
						{l.thinking}
					</details>
				)}
				{l.text}
			</div>
		);
	if (l.kind === "run") return null;
	if (l.kind === "compact")
		return (
			<details className={`compact-line ${l.phase}`}>
				<summary>{l.text}</summary>
				{l.summary ? <pre>{l.summary}</pre> : null}
			</details>
		);
	if (l.kind === "confirm")
		return (
			<div className="confirm">
				<div>
					<b>Apstiprini partiju:</b> {l.tool}
				</div>
				<pre>{l.batch}</pre>
				{l.answered ? (
					<span className={`badge ${l.allow ? "ok" : "bad"}`}>{l.allow ? "atļauts" : "noraidīts"}</span>
				) : (
					<div className="row">
						<button className="primary" onClick={() => onAnswer(l.id, true)}>Atļaut</button>
						<button onClick={() => onAnswer(l.id, false)}>Noraidīt</button>
					</div>
				)}
			</div>
		);
	if (l.kind === "retry") return <div className="retry">{l.text}</div>;
	return <div className="err">{l.text}</div>;
}

const PART_COLOR = { fixed: "#888780", chat: "#7F77DD", docs: "#1D9E75", tools: "#D4537E", images: "#D85A30" } as const;
const PART_LABEL = { fixed: "pamats (noteikumi, rīki)", chat: "saruna", docs: "dokumentu teksts", tools: "rīku atbildes", images: "attēli" } as const;

/** How full the model's context is: the bar is the model's window, the red mark is where compaction starts. */
function ContextMeter({ c, busy, compacting, onCompact }: { c: ContextInfo; busy: boolean; compacting: boolean; onCompact: () => void }) {
	const used = c.used ?? c.fixedEstimate;
	const parts = c.parts ?? { fixed: c.fixedEstimate, chat: 0, docs: 0, tools: 0, images: 0 };
	// the segments are sizes; when the provider's own count is known they are scaled to it
	const sum = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
	const k = used / sum;
	const pct = Math.round((used / c.window) * 100);
	const hot = used >= c.compactAt;
	const label = c.source === "usage" ? "provaidera skaits" : c.source === "estimate" ? "aptuveni" : "tikai pamats, saruna vēl nav sākta";
	return (
		<div className="ctx">
			<div className="ctx-bar" title={`Konteksta logs ${c.window.toLocaleString("lv")} tokenu; saspiešana sākas pie ${c.compactAt.toLocaleString("lv")}`}>
				{(Object.keys(PART_COLOR) as (keyof typeof PART_COLOR)[]).map((key) => (parts[key] > 0 ? <div key={key} style={{ width: `${((parts[key] * k) / c.window) * 100}%`, background: PART_COLOR[key] }} title={`${PART_LABEL[key]}: ≈${fmtTokens(parts[key] * k)}`} /> : null))}
				<div className="ctx-line" style={{ left: `${(c.compactAt / c.window) * 100}%` }} />
			</div>
			<div className="row ctx-text small">
				<span className={hot ? "warn" : ""} title={label}>
					Konteksts {c.used === null ? "≈" : ""}
					{fmtTokens(used)} / {fmtTokens(c.window)} ({pct}%)
				</span>
				{c.lastAdded ? <span className="dim" title="Cik pēdējā ziņa kopā ar atbildi un rīkiem pievienoja kontekstam">· pēdējā +{fmtTokens(c.lastAdded)}</span> : null}
				{c.imageCount > 0 ? <span className="dim">· {c.imageCount} att.</span> : null}
				{c.compactions > 0 ? <span className="dim">· saspiests {c.compactions}×</span> : null}
				<span className="grow" />
				<button className="ghost small" disabled={busy || c.used === null} onClick={onCompact} title="Aizstāt vecāko sarunu ar kopsavilkumu tagad (pats notiek pie sarkanās atzīmes)">
					{compacting ? "saspiež…" : "saspiest"}
				</button>
			</div>
			<details className="small ctx-more">
				<summary className="dim">kur paliek konteksts</summary>
				<table>
					<tbody>
						{(Object.keys(PART_COLOR) as (keyof typeof PART_COLOR)[]).map((key) => (
							<tr key={key}>
								<td>
									<i style={{ background: PART_COLOR[key] }} />
									{PART_LABEL[key]}
								</td>
								<td className="num">≈{fmtTokens(parts[key] * k)}</td>
							</tr>
						))}
						<tr>
							<td className="dim">saspiešana sākas pie</td>
							<td className="num">{fmtTokens(c.compactAt)}</td>
						</tr>
					</tbody>
				</table>
				<div className="dim">Pamatā ir noteikumi, prasmes un lietotnes rīku apraksti. Revit rīki nāk klāt, kad Revit ir savienots. Vecie ekrānuzņēmumi sarunā tiek aizstāti ar īsu piezīmi, kad to ir vairāk par 6 (paliek jaunākie 3).</div>
			</details>
		</div>
	);
}
