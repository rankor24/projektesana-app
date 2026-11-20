// The agent dock: right half of the split view. Fokuss header, the conversation, the input.
// Events stream from main (agent.event); a `confirm` event shows the batch with Atļaut / Noraidīt.
// What the agent does between the question and the answer (thinking, tool calls, sources, facts) is the run card,
// drawn from the activity feed (main/activity.ts), not from the raw events.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { groupRuns, isRunning } from "../../shared/activity";
import { useActivity } from "../activity";
import { RunCard } from "./RunCard";
import { PlanBlock } from "./PlanBlock";
import { attachBus } from "../attach-bus";
import { Icon } from "../icons";
import { effectiveMode, focusForSend } from "../../shared/view-context";
import type { AgentStatus, ChatAttachmentRef, ContextInfo } from "../../shared/api";
import { fmtTokens } from "../../shared/tokens";
import type { RunEvent } from "../../shared/types";
import { ACCEPT, pastedFiles, readAttachment, sizeText, type Pending } from "../attach";
import { call, errText, on } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";
import { windows, type PanelId } from "../windows";
import { readUi } from "../../shared/ui-instruction";
import { runUi } from "../run-ui";
import { bimcraft } from "../preview/IfcView";
import { parseMention } from "../../shared/mention";
import { LaneBar } from "./Lane";
import { ProcessStrip } from "./ProcessStrip";
import { MentionPop, SentNotice, ThreadPanel } from "./ThreadList";
import { currentWave } from "../../shared/wave";
import { agentName, mentionOptions, useThreads } from "./useThreads";
import { Waiting } from "./Waiting";
import { tr } from "../i18n";

type Line =
	| { kind: "user"; text: string; attachments?: ChatAttachmentRef[] }
	| { kind: "assistant"; text: string; thinking?: string }
	/** the run card of one run: its steps come from the activity feed */
	| { kind: "run"; runId: string; queued?: boolean }
	| { kind: "compact"; phase: "start" | "done" | "failed" | "past"; text: string; summary?: string }
	| { kind: "confirm"; id: string; tool: string; batch: string; answered?: boolean; allow?: boolean }
	| { kind: "error"; text: string }
	| { kind: "retry"; text: string };

export function AgentDock() {
	const { projectId, focus, view, viewChoice } = useUi();
	const T = useThreads(projectId);
	const { selId, viewId, viewThread, leadPath, viewKey } = T;
	// Auto adds one item built from the viewer to every message (the 3D tab); Manual sends only the Fokuss (documents)
	const mode = effectiveMode(viewChoice, view.kind);
	const sendFocus = useMemo(() => focusForSend(focus, mode, view), [focus, mode, view]);
	const status = useLoad<AgentStatus>(() => call("agent.status"), []);
	const tasks = useLoad(() => call("tasks.list"), []);
	const [lines, setLines] = useState<Line[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const runRef = useRef<string | null>(null);
	/** the current run is still waiting in the queue (no event has come yet) */
	const queuedRef = useRef(false);
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
	const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
	/** bumps to read the shown thread again (the one on screen was closed) */
	const [viewN, setViewN] = useState(0);
	/** a message went to another agent's thread: where it is, one click away */
	const [notice, setNotice] = useState<{ agent: string } | null>(null);
	const [pick, setPick] = useState(0);
	/** Saruna = the thread on screen; Telpa = what the agents say to each other */
	const sending = useRef(false);

	// the text is measured a moment after typing stops, not on every key
	const [typed, setTyped] = useState("");
	// a task template chosen in the command palette lands in the message box, ready to send or edit
	const { draft } = useUi();
	useEffect(() => {
		if (draft === null) return;
		setText(draft);
		ui.draft(null);
		inputRef.current?.focus();
	}, [draft]);
	useEffect(() => {
		const t = setTimeout(() => setTyped(text), 400);
		return () => clearTimeout(t);
	}, [text]);
	const ctx = useLoad<ContextInfo>(() => call("agent.context", projectId, { text: typed, focus: sendFocus }), [projectId, typed, sendFocus]);

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

	// conversation of the thread on screen: the lead's current one by `agent.history` as before, any other by `threads.history`
	useEffect(() => {
		let live = true;
		// what belongs to the thread that was on screen goes: its lines and its run (a run goes on in main; its lane stays)
		setLines([]);
		setLoadedFor(undefined);
		setErr(null);
		setNotice(null);
		runRef.current = null;
		queuedRef.current = false;
		setRunId(null);
		(selId ? call("threads.history", selId, projectId) : call("agent.history", projectId)).then((h) => {
			if (!live) return;
			// reading the lead's chat can make its thread in main (first use, or after Jauna saruna): the list learns of it now
			if (!selId) T.reload();
			setLines(
				h.map((m): Line =>
					m.kind === "compaction"
						? { kind: "compact", phase: "past", text: `Saruna saspiesta: ${fmtTokens(m.tokens?.before ?? 0)} → ${fmtTokens(m.tokens?.after ?? 0)} tokeni`, summary: m.text }
						: m.role === "user"
							? { kind: "user", text: m.text, attachments: m.attachments }
							: { kind: "assistant", text: m.text },
				),
			);
			setLoadedFor(viewKey);
		});
		return () => {
			live = false;
		};
	}, [projectId, selId, viewN]);

	// a run of this thread that is still going (the window reloaded, the thread was opened again mid-run, or a lane was clicked):
	// show its card and follow its events, so the answer arrives and Apturēt works
	useEffect(() => {
		if (loadedFor !== viewKey || runRef.current || sending.current) return;
		const going = [...runs].find(([, ls]) => ls[0].who === "agent" && ls[0].thread === viewId && isRunning(ls));
		if (!going) return;
		const [id] = going;
		runRef.current = id;
		setRunId(id);
		setLines((ls) => (ls.some((l) => l.kind === "run" && l.runId === id) ? ls : [...ls, { kind: "run", runId: id }]));
	}, [runs, loadedFor, viewKey, viewId]);

	useEffect(
		() =>
			on("agent.event", ({ runId: id, event }) => {
				if (id !== runRef.current) return;
				queuedRef.current = false;
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

	// a picture from elsewhere in the window (the comment tools' screen grab) joins the attachments like a pasted screenshot
	const addRef = useRef(addFiles);
	addRef.current = addFiles;
	useEffect(() => attachBus.on((f) => void addRef.current(f)), []);

	const closedView = viewThread?.state === "closed";
	const canSend = (text.trim().length > 0 || pending.length > 0) && reading === 0 && !closedView;
	const send = async () => {
		if (!canSend || runId) return;
		setErr(null);
		const t = text;
		const files = pending;
		sending.current = true;
		try {
			// Auto in 3D: ask the viewer for the camera as it is now, so the message carries what the user is looking at
			if (mode === "auto" && view.kind === "ifc") {
				bimcraft.send({ pj: 1, type: "capture" });
				await ui.nextView();
			}
			const focus = focusForSend(ui.get().focus, mode, ui.get().view);
			const atts = files.map(({ name, mimeType, data, thumb }) => ({ name, mimeType, data, thumb }));
			// "@ar …" names an agent: for another agent than this thread's, main routes it (`agent.send`) and the answer shows in that agent's thread
			const m = parseMention(t, T.specs);
			const here = m && viewThread && m.agent === viewThread.agent ? m : null;
			if (m && !here) {
				await call("agent.send", projectId, t, focus, atts);
				setText("");
				setPending([]);
				setNotice({ agent: m.agent });
				T.reload();
				return;
			}
			const body = here ? here.text : t;
			const r = leadPath ? await call("agent.send", projectId, t, focus, atts) : await call("threads.send", viewId!, projectId, body, focus, atts);
			const refs: ChatAttachmentRef[] = files.map((f) => ({ name: f.name, kind: f.kind, thumb: f.thumb }));
			const user = { kind: "user" as const, text: body, attachments: refs.length ? refs : undefined };
			// a queued start has the id its run will have; its card says "Gaida rindā" until the first event
			const id = r.runId!;
			runRef.current = id;
			queuedRef.current = r.queued;
			setRunId(id);
			setLines((ls) => [...ls, user, { kind: "run", runId: id, queued: r.queued }]);
			setText("");
			setPending([]);
		} catch (e) {
			// refused (a file the model cannot take, the agent busy): text and files stay so nothing is lost
			setErr(errText(e));
		} finally {
			sending.current = false;
		}
	};

	/** a queued start has no events that would end it: clear it here */
	const dropQueued = () => {
		if (!queuedRef.current) return;
		queuedRef.current = false;
		setRunId(null);
		const id = runRef.current;
		runRef.current = null;
		setLines((ls) => ls.filter((l) => !(l.kind === "run" && l.runId === id)));
	};
	// this thread only; the lanes' Apturēt visu stops everything
	const stop = () => {
		void (viewId ? call("threads.stop", viewId) : call("agent.stop"));
		dropQueued();
	};
	const stopAll = () => {
		void call("agent.stop");
		dropQueued();
	};
	const stopLane = (id: string) => {
		void call("threads.stop", id);
		if (id === viewId) dropQueued();
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
			await T.confirm(id, allow);
			setLines((ls) => ls.map((l) => (l.kind === "confirm" && l.id === id ? { ...l, answered: true, allow } : l)));
		} catch (e) {
			setErr(errText(e));
		}
	};

	const closeThread = async (id: string) => {
		try {
			await T.close(id);
			// the thread on screen is gone: back to the lead's current one
			if (id === viewId) {
				ui.selectThread(null);
				setViewN((n) => n + 1);
			}
		} catch (e) {
			setErr(errText(e));
		}
	};
	// "@" at the very start offers the agents; picking one writes "@id "
	const options = mentionOptions(text, T.specs);
	const choose = (id: string) => {
		setText((x) => x.replace(/^(\s*)@\S*$/, `$1@${id} `));
		inputRef.current?.focus();
	};

	const st = status.data;
	const blind = st?.images === false && pending.some((p) => p.kind === "image");
	// what the message being typed adds: the main process measures text, Fokuss and pins; the files were measured when attached
	const c = ctx.data;
	const draftCost =
		c?.draft && (text.trim() || pending.length)
			? (() => {
					const files = pending.reduce((n, p) => n + p.cost.tokens, 0);
					const total = c.draft.text + c.draft.focus + c.draft.pins + c.draft.plan + files;
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
					<b>{tr("Aģents")}</b>
					{st ? (
						<button className={`chip ${st.signedIn ? "" : "bad"}`} onClick={() => windows.open("iestatijumi")} title={st.reason}>
							{st.providerLabel} · {st.model} · {st.signedIn ? tr("pieslēgts") : tr("nav pieslēgts")}
						</button>
					) : (
						<span className="dim small">…</span>
					)}
					<span className="badge dim" title={tr("Revit MCP")}>{tr("Revit:")} {st?.revit ?? "…"}</span>
					<span className="grow" />
					{/* the ring and compaction are the lead's conversation; another thread has no meter of its own yet */}
					{ctx.data && leadPath && <ContextRing c={ctx.data} busy={!!runId || compacting} compacting={compacting} onCompact={compactNow} draft={draftCost} />}
					{leadPath && (
						<button
							className="icon-btn"
							title={tr("Sākt jaunu sarunu ar vadošo aģentu (pieraksts paliek)")}
							aria-label={tr("jauna saruna")}
							onClick={() =>
								call("agent.reset", projectId).then(() => {
									ui.selectThread(null);
									setViewN((n) => n + 1);
								})
							}
						>
							<Icon name="plus" />
						</button>
					)}
				</div>
				<div className="focus-head">
					<span className="dim">{tr("Fokuss:")}</span>
					{focus.length === 0 ? (
						<span className="dim">{tr("nekas")}</span>
					) : (
						<>
							{focus.map((f) => (
								<span key={`${f.kind}:${f.id}`} className="chip" title={JSON.stringify(f.data ?? {})}>
									{f.label}
									<button className="x" onClick={() => ui.focusRemove(f.kind, f.id)}>×</button>
								</span>
							))}
							<button className="ghost small" onClick={() => ui.focusClear()}>{tr("notīrīt")}</button>
						</>
					)}
				</div>
				<ThreadPanel threads={T.threads} specs={T.specs} queue={T.queue} current={viewId} />
			</div>
			<ProcessStrip projectId={projectId} />
			<Waiting items={T.waiting} specs={T.specs} projectId={projectId} onConfirm={T.confirm} onOpen={T.select} />
			<div className="chat">
				{lines.length === 0 && loadedFor === viewKey && (
					<div className="chat-empty-wrap">
						<div className="dim small chat-empty">{viewThread && viewThread.agent !== "lead" ? tr("Saruna vēl nav sākta.") : projectId ? tr("Saruna par šo projektu vēl nav sākta.") : tr("nav projekta — saruna bez projekta datiem.")}</div>
						{(tasks.data ?? []).length > 0 && (
							<div>
								<div className="suggest-title">{tr("Ieteiktās darbības")}</div>
								<div className="suggest-list">
									{(tasks.data ?? []).map((t) => (
										<button
											key={t.id}
											className="suggest"
											title={t.text}
											onClick={() => {
												setText(t.text);
												inputRef.current?.focus();
											}}
										>
											<span className="grow">{t.label}</span>
											<Icon name="arrowRight" size={14} />
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				)}
				{lines.map((l, i) =>
					l.kind === "run" ? (
						runs.get(l.runId) ? (
							<RunCard key={l.runId} lines={runs.get(l.runId)!} latest={l.runId === lastRun} />
						) : (
							<div key={l.runId} className="dim small">{l.queued ? tr("Gaida rindā") : tr("strādā…")}</div>
						)
					) : (
						<ChatLine key={i} line={l.kind === "confirm" && !l.answered && T.settled(l.id) ? { ...l, answered: true } : l} onAnswer={answer} />
					),
				)}
				<div ref={endRef} />
			</div>
			{err && <div className="err">{err}</div>}
			{notice && (
				<SentNotice
					name={agentName(notice.agent, T.specs)}
					onOpen={() => {
						const t = T.threads.find((x) => x.agent === notice.agent && x.state !== "closed");
						if (t) T.select(t.id);
					}}
					onClose={() => setNotice(null)}
				/>
			)}
			<LaneBar
				lanes={T.lanes}
				specs={T.specs}
				paused={T.queue.paused}
				wave={currentWave(T.queue.waves, T.queue.running, projectId)}
				elsewhere={T.elsewhere}
				onOpen={T.select}
				onStop={stopLane}
				onStopAll={stopAll}
				onTogglePause={() => void call(T.queue.paused ? "queue.resume" : "queue.pause")}
			/>
			<div className="chat-input">
				{/* only the warning stays by the message; the full count of what it adds is in the context popover */}
				{leadPath && draftCost?.over && (
					<div className="draft-cost small warn" title={tr("Aptuvens: teksts + Fokuss + atvērtās piezīmes + pielikumi. Precīzu skaitu pēc atbildes dod modelis.")}>
						{tr("Šī ziņa pievienos ≈{total}: teksts {text} · fokuss {focus} · piezīmes {pins}", { total: fmtTokens(draftCost.total), text: fmtTokens(draftCost.text), focus: fmtTokens(draftCost.focus), pins: fmtTokens(draftCost.pins) })}
						{tr(" — pārsniegs saspiešanas robežu: saruna tiks saspiesta pirms atbildes")}
					</div>
				)}
				{blind && <div className="attach-warn small">{tr("Modelis {model} neredz attēlus — Iestatījumos izvēlies citu modeli vai noņem attēlu.", { model: st?.model })}</div>}
				<MentionPop options={options} active={Math.min(pick, options.length - 1)} onPick={choose} />
				<div className="composer">
					<PlanBlock projectId={projectId} />
					{(pending.length > 0 || reading > 0) && (
						<div className="attach-strip composer-attach">
							{pending.map((p) => (
								<div key={p.key} className={`attach ${p.kind}`} title={`${p.name} · ${sizeText(p.size)}${p.cost.pages ? ` · ${p.cost.pages} lpp.` : ""}${p.cost.cut ? " · garāks par limitu, iet tikai sākums" : ""}`}>
									{p.thumb ? <img src={p.thumb} alt={p.name} /> : <span className="attach-doc">{p.name.split(".").pop()?.toUpperCase()}</span>}
									<span className="attach-name">{p.name}</span>
									<span className={`attach-cost ${p.cost.cut ? "warn" : ""}`}>
										{p.cost.pages ? tr("{pages} lpp. · ", { pages: p.cost.pages }) : ""}≈{fmtTokens(p.cost.tokens)}
										{p.cost.cut ? tr(" (sākums)") : ""}
									</span>
									<button className="x" title={tr("Noņemt")} onClick={() => setPending((ps) => ps.filter((x) => x.key !== p.key))}>×</button>
								</div>
							))}
							{reading > 0 && <span className="dim small">{tr("sagatavo {reading} …", { reading: reading })}</span>}
						</div>
					)}
					<textarea
						ref={inputRef}
						rows={2}
						value={text}
						placeholder={closedView ? tr("Saruna ir slēgta") : st && !st.signedIn ? tr("nav pieslēgts — atver Iestatījumi") : tr("Raksti aģentam… @ izvēlas speciālistu (Ctrl+Enter) · Ctrl+V ielīmē ekrānuzņēmumu")}
						onChange={(e) => {
							setText(e.target.value);
							setPick(0);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) return void send();
							if (options.length === 0) return;
							const at = Math.min(pick, options.length - 1);
							if (e.key === "ArrowDown" || e.key === "ArrowUp") {
								e.preventDefault();
								setPick((at + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
							} else if (e.key === "Tab" || e.key === "Enter") {
								e.preventDefault();
								choose(options[at].id);
							}
						}}
					/>
					<div className="composer-bar">
						<button className="icon-btn" title={tr("Pievienot failu vai attēlu (arī: Ctrl+V, ievilkt)")} aria-label={tr("Pievienot failu vai attēlu (arī: Ctrl+V, ievilkt)")} onClick={() => fileRef.current?.click()}>
							<Icon name="paperclip" />
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
						<div className="view-toggle" title={tr("Auto: katrai ziņai līdzi iet atvērtais fails, lapa, iezīmētie elementi un kamera (3D). Manuāli: tikai Fokuss, ko tu esi izvēlējies.")}>
							<span className="dim small">{tr("Skats:")}</span>
							<button className={mode === "auto" ? "on" : ""} onClick={() => ui.setViewMode("auto")}>{tr("Auto")}</button>
							<button className={mode === "manual" ? "on" : ""} onClick={() => ui.setViewMode("manual")}>{tr("Manuāli")}</button>
						</div>
						<span className="grow" />
						{runId ? (
							<button className="stop-btn" onClick={stop}>
								<Icon name="square" size={12} />
								{tr("Apturēt")}
							</button>
						) : (
							<button className="send-btn" title={tr("Sūtīt")} aria-label={tr("Sūtīt")} disabled={!canSend || blind} onClick={send}>
								<Icon name="send" />
							</button>
						)}
					</div>
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
					? { kind: "compact", phase: "start", text: tr("Saruna ir {tokens} tokenu — saspiež vecāko daļu…", { tokens: fmtTokens(e.before) }) }
					: e.phase === "done"
						? { kind: "compact", phase: "done", text: `Saruna saspiesta: ${fmtTokens(e.before)} → ≈${fmtTokens(e.after ?? 0)} tokeni` }
						: { kind: "compact", phase: "failed", text: tr("Saspiešana neizdevās, darbs turpinās bez tās: {message}", { message: e.message ?? "" }) };
			return last?.kind === "compact" && last.phase === "start" ? [...ls.slice(0, -1), line] : [...ls, line];
		}
		case "confirm":
			return [...ls, { kind: "confirm", id: e.id, tool: e.tool, batch: e.batch }];
		case "retry": {
			// one line per run of restarts: the next attempt replaces the previous one
			const line: Line = { kind: "retry", text: tr("Savienojums pārtrūka ({message}). Atkārto {attempt}/{of} pēc {s} s…", { message: e.message, attempt: e.attempt, of: e.of, s: Math.round(e.delayMs / 1000) }) };
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
						<summary>{tr("domāšana")}</summary>
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
					<b>{tr("Apstiprini partiju:")}</b> {l.tool}
				</div>
				<pre>{l.batch}</pre>
				{l.answered ? (
					<span className={`badge ${l.allow === undefined ? "dim" : l.allow ? "ok" : "bad"}`}>{l.allow === undefined ? tr("atbildēts") : l.allow ? tr("atļauts") : tr("noraidīts")}</span>
				) : (
					<div className="row">
						<button className="primary" onClick={() => onAnswer(l.id, true)}>{tr("Atļaut")}</button>
						<button onClick={() => onAnswer(l.id, false)}>{tr("Noraidīt")}</button>
					</div>
				)}
			</div>
		);
	if (l.kind === "retry") return <div className="retry">{l.text}</div>;
	return <div className="err">{l.text}</div>;
}

type Draft = NonNullable<ContextInfo["draft"]> & { files: number; total: number; over: boolean };

/**
 * The context in the dock header is a small ring (the share of the model's window in use); a click opens the detail: the bar,
 * where it goes, Saspiest, and what the message being typed will add. The ring turns amber near the compaction mark and red past it.
 */
function ContextRing({ c, busy, compacting, onCompact, draft }: { c: ContextInfo; busy: boolean; compacting: boolean; onCompact: () => void; draft: Draft | null }) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const popRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const down = (e: PointerEvent) => {
			const t = e.target as Node;
			if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", down);
		document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("pointerdown", down);
			document.removeEventListener("keydown", key);
		};
	}, [open]);
	const used = c.used ?? c.fixedEstimate;
	const frac = Math.min(1, used / c.window);
	const pct = Math.round(frac * 100);
	const color = used >= c.compactAt ? "var(--bad)" : used >= c.compactAt * 0.8 ? "var(--warn)" : "var(--accent)";
	const R = 8;
	const len = 2 * Math.PI * R;
	return (
		<>
			<button ref={btnRef} className="icon-btn" aria-expanded={open} aria-label={`${tr("Konteksts")} ${pct}%`} title={`${tr("Konteksts")} ${pct}% · ${fmtTokens(used)} / ${fmtTokens(c.window)}`} onClick={() => setOpen(!open)}>
				<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
					<circle cx="11" cy="11" r={R} fill="none" stroke="var(--elev2)" strokeWidth="2.5" />
					<circle cx="11" cy="11" r={R} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${Math.max(frac, 0.012) * len} ${len}`} transform="rotate(-90 11 11)" />
				</svg>
			</button>
			{open && (
				<div ref={popRef} className="ctx-pop" role="dialog" aria-label={tr("Konteksts")}>
					<ContextMeter c={c} busy={busy} compacting={compacting} onCompact={onCompact} />
					{draft && (
						<div className={`small ${draft.over ? "warn" : "dim"}`} title={tr("Aptuvens: teksts + Fokuss + atvērtās piezīmes + pielikumi. Precīzu skaitu pēc atbildes dod modelis.")}>
							{tr("Šī ziņa pievienos ≈{total}: teksts {text} · fokuss {focus} · piezīmes {pins}", { total: fmtTokens(draft.total), text: fmtTokens(draft.text), focus: fmtTokens(draft.focus), pins: fmtTokens(draft.pins) })}
							{draft.plan > 0 && tr(" · plāns {plan}", { plan: fmtTokens(draft.plan) })}
							{draft.files > 0 && tr(" · pielikumi {files}", { files: fmtTokens(draft.files) })}
							{draft.over && tr(" — pārsniegs saspiešanas robežu: saruna tiks saspiesta pirms atbildes")}
						</div>
					)}
				</div>
			)}
		</>
	);
}

const PART_COLOR = { fixed: "#888780", chat: "#7F77DD", docs: "#1D9E75", tools: "#D4537E", images: "#D85A30" } as const;
const PART_LABEL = { fixed: tr("pamats (noteikumi, rīki)"), chat: tr("saruna"), docs: tr("dokumentu teksts"), tools: tr("rīku atbildes"), images: tr("attēli") } as const;

/** How full the model's context is: the bar is the model's window, the red mark is where compaction starts. */
function ContextMeter({ c, busy, compacting, onCompact }: { c: ContextInfo; busy: boolean; compacting: boolean; onCompact: () => void }) {
	const used = c.used ?? c.fixedEstimate;
	const parts = c.parts ?? { fixed: c.fixedEstimate, chat: 0, docs: 0, tools: 0, images: 0 };
	// the segments are sizes; when the provider's own count is known they are scaled to it
	const sum = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
	const k = used / sum;
	const pct = Math.round((used / c.window) * 100);
	const hot = used >= c.compactAt;
	const label = c.source === "usage" ? tr("provaidera skaits") : c.source === "estimate" ? tr("aptuveni") : tr("tikai pamats, saruna vēl nav sākta");
	return (
		<div className="ctx">
			<div className="ctx-bar" title={tr("Konteksta logs {v} tokenu; saspiešana sākas pie {v2}", { v: c.window.toLocaleString("lv"), v2: c.compactAt.toLocaleString("lv") })}>
				{(Object.keys(PART_COLOR) as (keyof typeof PART_COLOR)[]).map((key) => (parts[key] > 0 ? <div key={key} style={{ width: `${((parts[key] * k) / c.window) * 100}%`, background: PART_COLOR[key] }} title={`${PART_LABEL[key]}: ≈${fmtTokens(parts[key] * k)}`} /> : null))}
				<div className="ctx-line" style={{ left: `${(c.compactAt / c.window) * 100}%` }} />
			</div>
			<div className="row ctx-text small">
				<span className={hot ? "warn" : ""} title={label}>
					{tr("Konteksts")} {c.used === null ? "≈" : ""}
					{fmtTokens(used)} / {fmtTokens(c.window)} ({pct}%)
				</span>
				{c.lastAdded ? <span className="dim" title={tr("Cik pēdējā ziņa kopā ar atbildi un rīkiem pievienoja kontekstam")}>{tr("· pēdējā +{lastAdded}", { lastAdded: fmtTokens(c.lastAdded) })}</span> : null}
				{c.imageCount > 0 ? <span className="dim">{tr("· {imageCount} att.", { imageCount: c.imageCount })}</span> : null}
				{c.compactions > 0 ? <span className="dim">{tr("· saspiests {compactions}×", { compactions: c.compactions })}</span> : null}
				<span className="grow" />
				<button className="ghost small" disabled={busy || c.used === null} onClick={onCompact} title={tr("Aizstāt vecāko sarunu ar kopsavilkumu tagad (pats notiek pie sarkanās atzīmes)")}>
					{compacting ? tr("saspiež…") : tr("saspiest")}
				</button>
			</div>
			<details className="small ctx-more">
				<summary className="dim">{tr("kur paliek konteksts")}</summary>
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
							<td className="dim">{tr("saspiešana sākas pie")}</td>
							<td className="num">{fmtTokens(c.compactAt)}</td>
						</tr>
					</tbody>
				</table>
				<div className="dim">{tr("Pamatā ir noteikumi, prasmes un lietotnes rīku apraksti. Revit rīki nāk klāt, kad Revit ir savienots. Vecie ekrānuzņēmumi sarunā tiek aizstāti ar īsu piezīmi, kad to ir vairāk par 6 (paliek jaunākie 3).")}</div>
			</details>
		</div>
	);
}
