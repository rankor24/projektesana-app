// The agent dock: right half of the split view. Fokuss header, the conversation, the input.
// Events stream from main (agent.event); a `confirm` event shows the batch with Atļaut / Noraidīt.
// What the agent does between the question and the answer (thinking, tool calls, sources, facts) is the run card,
// drawn from the activity feed (main/activity.ts), not from the raw events.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { groupRuns, isRunning } from "../../shared/activity";
import { useActivity } from "../activity";
import { RunCard } from "./RunCard";
import { apply, placeSteered, runLines, startChatStreams, streamedLines, type Line } from "./chat-lines";
import { HeldMessage } from "./HeldMessage";
import { PlanBlock } from "./PlanBlock";
import { attachBus } from "../attach-bus";
import { Icon } from "../icons";
import { Markdown } from "./Markdown";
import { effectiveMode, focusForSend } from "../../shared/view-context";
import type { AgentStatus, ChatAttachmentRef, ContextInfo } from "../../shared/api";
import { fmtTokens } from "../../shared/tokens";
import { ACCEPT, pastedFiles, readAttachment, sizeText, type Pending } from "../attach";
import { call, errText, on } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";
import { windows, type PanelId } from "../windows";
import { readUi } from "../../shared/ui-instruction";
import { runUi } from "../run-ui";
import { bimcraft } from "../preview/IfcView";
import { parseMention } from "../../shared/mention";
import { parseEveryone } from "../../shared/everyone";
import { BPV_ID } from "../../shared/departments";
import { LaneHead, LaneRows, whyText } from "./Lane";
import { ProcessStrip } from "./ProcessStrip";
import { followMouse } from "./drag";
import { MentionPop, SentNotice, ThreadPanel } from "./ThreadList";
import { currentWave } from "../../shared/wave";
import { agentName, mentionOptions, useThreads } from "./useThreads";
import { Waiting } from "./Waiting";
import { TeamOffer } from "./TeamOffer";
import { tr } from "../i18n";
import { confirmNotes } from "../../shared/confirm-text";
import { cycleReasoning, REASONING_LABEL, useReasoning } from "../reasoning-pref";

const INPUT_H_KEY = "projektesana.chatInputHeight";
/** the message box: never smaller than its two lines, never taller than most of the window (the chat above must stay in sight) */
const INPUT_H_MIN = 52;
const clampInputH = (h: number) => Math.round(Math.max(INPUT_H_MIN, Math.min(h, Math.max(INPUT_H_MIN, window.innerHeight * 0.7))));

function readInputH(): number | null {
	try {
		const v = Number(localStorage.getItem(INPUT_H_KEY));
		return Number.isFinite(v) && v > 0 ? clampInputH(v) : null;
	} catch {
		return null;
	}
}

export function AgentDock() {
	startChatStreams();
	const { projectId, focus, view, viewChoice } = useUi();
	const T = useThreads(projectId, { markSeen: true });
	const { selId, viewId, viewThread, leadPath, viewKey } = T;
	// Auto adds one item built from the viewer to every message (the 3D tab); Manual sends only the Fokuss (documents)
	const mode = effectiveMode(viewChoice, view.kind);
	const sendFocus = useMemo(() => focusForSend(focus, mode, view), [focus, mode, view]);
	const status = useLoad<AgentStatus>(() => call("agent.status"), []);
	const tasks = useLoad(() => call("tasks.list"), []);
	const reasoning = useReasoning();
	const [lines, setLines] = useState<Line[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const runRef = useRef<string | null>(null);
	/** the current run is still waiting in the queue (no event has come yet) */
	const queuedRef = useRef(false);
	const [chatEl, setChatEl] = useState<HTMLDivElement | null>(null);
	/** the chat follows the newest text while the user is at the bottom; scrolled up to read, it stays where they are */
	const stick = useRef(true);
	const fileRef = useRef<HTMLInputElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	/** the message box's own height, set by dragging its top edge up (empty: the two-line default); kept per computer */
	const [inputH, setInputH] = useState<number | null>(readInputH);
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
						? { kind: "compact", phase: "past", text: `Saruna saspiesta: ${fmtTokens(m.tokens?.before ?? 0)} → ${fmtTokens(m.tokens?.after ?? 0)} tokeni`, summary: m.text, archive: m.archive }
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
		// what the run streamed while this conversation was not on screen comes back with its card. It is read here, in the same step that sets
		// `runRef`: an event after this point reaches the line list through `apply`, one before it is in the buffer, so no text is doubled or lost.
		const streamed = streamedLines(id);
		setLines((ls) => (ls.some((l) => l.kind === "run" && l.runId === id) ? ls : [...ls, ...runLines(id, streamed)]));
	}, [runs, loadedFor, viewKey, viewId]);

	useEffect(
		() =>
			on("agent.event", ({ runId: id, event }) => {
				if (id !== runRef.current) return;
				queuedRef.current = false;
				// a run started to deliver a held message: its card is here already, the message goes above it
				setLines((ls) => (event.type === "steered" && event.starts ? placeSteered(ls, id, event) : apply(ls, event)));
				if (event.type === "tool_result" && event.ok) runUi(readUi(event.output));
				if (event.type === "done" || event.type === "error") {
					runRef.current = null;
					setRunId(null);
					ui.bump();
				}
			}),
		[],
	);

	// Stick to the bottom: any growth (a new line, a run card filling with steps, streamed text) and any resize of the panel (the text
	// reflows) scrolls to the end while the user is there. One scroll up past ~60 px lets go; scrolling back down holds again.
	useEffect(() => {
		if (!chatEl) return;
		const toEnd = () => {
			if (stick.current) chatEl.scrollTop = chatEl.scrollHeight;
		};
		const onScroll = () => {
			stick.current = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 60;
		};
		const resized = new ResizeObserver(toEnd);
		resized.observe(chatEl);
		const changed = new MutationObserver(toEnd);
		changed.observe(chatEl, { childList: true, subtree: true, characterData: true });
		chatEl.addEventListener("scroll", onScroll, { passive: true });
		toEnd();
		return () => {
			resized.disconnect();
			changed.disconnect();
			chatEl.removeEventListener("scroll", onScroll);
		};
	}, [chatEl]);
	// another conversation opens at its newest line
	useEffect(() => {
		stick.current = true;
		if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
	}, [viewKey, chatEl]);

	// a picture from elsewhere in the window (the comment tools' screen grab) joins the attachments like a pasted screenshot
	const addRef = useRef(addFiles);
	addRef.current = addFiles;
	useEffect(() => attachBus.on((f) => void addRef.current(f)), []);

	const closedView = viewThread?.state === "closed";
	// the agent is answering in this chat (or its run waits in the queue): a message is held for it, not refused
	const workingHere = !!runId || (!!viewId && (T.queue.running.some((r) => r.threadId === viewId) || T.queue.queued.some((q) => q.threadId === viewId && q.state === "queued")));
	const held = viewId ? T.queue.steering.find((m) => m.threadId === viewId) : undefined;
	const canSend = (text.trim().length > 0 || pending.length > 0) && reading === 0 && !closedView;
	const saveInputH = (h: number | null) => {
		setInputH(h);
		try {
			if (h) localStorage.setItem(INPUT_H_KEY, String(h));
			else localStorage.removeItem(INPUT_H_KEY);
		} catch {
			// not remembered: the box starts at two lines next time
		}
	};
	/** drag the box's top edge: up makes it taller, down smaller (BIM Crew's ResizeHandle pattern; the height is written while dragging, saved on release) */
	const startInputResize = (e: React.MouseEvent) => {
		e.preventDefault();
		const ta = inputRef.current;
		if (!ta) return;
		const y0 = e.clientY;
		const h0 = ta.getBoundingClientRect().height;
		let h = h0;
		let raf = 0;
		followMouse(
			(ev) => {
				h = clampInputH(h0 + (y0 - ev.clientY));
				cancelAnimationFrame(raf);
				raf = requestAnimationFrame(() => {
					ta.style.height = `${h}px`;
				});
			},
			() => {
				cancelAnimationFrame(raf);
				saveInputH(h);
			},
			{ cursor: "row-resize" },
		);
	};

	const send = async () => {
		if (!canSend) return;
		setErr(null);
		const t = text;
		const files = pending;
		sending.current = true;
		// what the user just sent, and the answer to it, are followed again
		stick.current = true;
		try {
			// Auto in 3D: ask the viewer for the camera as it is now, so the message carries what the user is looking at
			if (mode === "auto" && view.kind === "ifc") {
				bimcraft.send({ pj: 1, type: "capture" });
				await ui.nextView();
			}
			const focus = focusForSend(ui.get().focus, mode, ui.get().view);
			const atts = files.map(({ name, mimeType, data, thumb }) => ({ name, mimeType, data, thumb }));
			// "@ar …" names an agent: for another agent than this thread's, main routes it (`agent.send`) and the answer shows in that agent's thread
			// "@visi …" (a line to everyone) goes to BPV alone, always through main (it adds BPV's instruction)
			const everyone = parseEveryone(t);
			const m = everyone ? { agent: BPV_ID, text: everyone.text } : parseMention(t, T.specs);
			const here = !everyone && m && viewThread && m.agent === viewThread.agent ? m : null;
			if (m && !here) {
				await call("agent.send", projectId, t, focus, atts);
				setText("");
				setPending([]);
				setNotice({ agent: m.agent });
				T.reload();
				return;
			}
			const body = here ? here.text : t;
			// the agent of this chat is answering: the message is held (it reaches the agent after its current step), not refused
			if (workingHere && viewId) {
				const h = await call("threads.hold", viewId, projectId, body, focus, atts);
				if (h) {
					setText("");
					setPending([]);
					return;
				}
				// the run ended while the message was being prepared: it is sent the normal way below
			}
			if (runId) throw new Error(tr("Aģents vēl strādā: pagaidi mirkli vai aptur."));
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
	// Darbi, the queue's pause and Apturēt visu: the right end of the Uzdevumi row (there only while something runs, waits or is paused)
	const jobsHead = (
		<LaneHead
			count={T.lanes.length}
			paused={T.queue.paused}
			wave={currentWave(T.queue.waves, T.queue.running, projectId)}
			elsewhere={T.elsewhere}
			onStopAll={stopAll}
			onTogglePause={() => void call(T.queue.paused ? "queue.resume" : "queue.pause")}
		/>
	);
	// why the conversation on screen waits (its own lane carries the reason); null reads as plain "queued"
	const queuedWhy = T.lanes.find((l) => l.threadId === viewId && l.state === "queued")?.why ?? null;
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
					<span className="badge dim" title={tr("Revit MCP")}>{tr("Revit:")} {st?.revit ?? "…"}</span>
					<span className="grow" />
					<AutoMode />
					<button className="icon-btn" title={tr("Atvērt aģenta žurnālu: viss, ko aģents dara un saņem")} aria-label={tr("Žurnāls")} onClick={() => windows.openLog(viewId ? `thread:${viewId}` : undefined)}>
						<Icon name="terminal" />
					</button>
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
				{/* the lead's chat needs no name line (its name is on every run card); another agent's thread says whose it is */}
				{viewThread && viewThread.agent !== "lead" && <ThreadPanel threads={T.threads} specs={T.specs} queue={T.queue} current={viewId} />}
			</div>
			<ProcessStrip projectId={projectId} />
			<TeamOffer specs={T.specs} onDone={T.reload} />
			<Waiting items={T.waiting} specs={T.specs} projectId={projectId} onConfirm={T.confirm} onOpen={T.select} />
			<div className="chat" ref={setChatEl}>
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
							<div key={l.runId} className="dim small">{l.queued ? whyText(queuedWhy) : tr("strādā…")}</div>
						)
					) : l.kind === "confirm" && !l.answered && T.pending(l.id) ? null : (
						// a card that waits for an answer shows once, in Gaida tevi above the chat; it joins the chat when answered
						<ChatLine key={i} line={l.kind === "confirm" && !l.answered && T.settled(l.id) ? { ...l, answered: true } : l} onAnswer={answer} thread={viewId ?? undefined} projectId={projectId} />
					),
				)}
				{held && viewId && (
					<HeldMessage
						key={held.at}
						held={held}
						act={{
							edit: async (t) => (await call("threads.holdEdit", viewId, projectId, t)) !== null,
							cancel: () => call("threads.unhold", viewId, projectId),
							send: async () => {
								const r = await call("threads.holdSend", viewId, projectId);
								// the run this starts is picked up by the card effect above (it is going in the run table); a queued start has its card too
								if (r.queued) setErr(null);
							},
						}}
					/>
				)}
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
			{/* the thread on screen is not a row: its run card, Gaida tevi and the composer's Apturēt already say it */}
			<LaneRows lanes={T.lanes.filter((l) => l.threadId !== viewId)} specs={T.specs} onOpen={T.select} onStop={stopLane} />
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
					<PlanBlock projectId={projectId} aside={jobsHead} />
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
					<div className="composer-field">
						<div
							className="composer-grip"
							role="separator"
							aria-orientation="horizontal"
							title={tr("Velc uz augšu, lai ziņas lauks būtu lielāks (dubultklikšķis: atpakaļ uz parasto)")}
							onMouseDown={startInputResize}
							onDoubleClick={() => saveInputH(null)}
						/>
						<textarea
							ref={inputRef}
							rows={2}
							style={inputH ? { height: inputH } : undefined}
							value={text}
							placeholder={closedView ? tr("Saruna ir slēgta") : st && !st.signedIn ? tr("nav pieslēgts — atver Iestatījumi") : workingHere ? tr("Aģents strādā — raksti tālāk, ziņa nonāks pie viņa pēc tekošā soļa (Ctrl+Enter)") : tr("Raksti aģentam… @ izvēlas speciālistu (Ctrl+Enter) · Ctrl+V ielīmē ekrānuzņēmumu")}
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
					</div>
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
						{st ? (
							<button
								className={`chip model-chip ${st.signedIn ? "" : "bad"}`}
								onClick={() => windows.open("iestatijumi")}
								title={`${st.providerLabel} · ${st.model} · ${st.signedIn ? tr("pieslēgts") : tr("nav pieslēgts")}${st.reason ? `\n${st.reason}` : ""}`}
							>
								{st.providerLabel} · {st.model}
								{st.signedIn ? "" : ` · ${tr("nav pieslēgts")}`}
							</button>
						) : null}
						<span className="grow" />
						<button className={`ghost small reasoning-btn ${reasoning}`} title={tr("Modeļa domāšana sarunā: paslēpta, sakļauta (atveras tikai tā, kas top) vai atvērta")} onClick={cycleReasoning}>
							{tr("Domāšana:")} {REASONING_LABEL[reasoning]}
						</button>
						{runId && (
							<button className="stop-btn" onClick={stop}>
								<Icon name="square" size={12} />
								{tr("Apturēt")}
							</button>
						)}
						<button className="send-btn" title={workingHere ? tr("Sūtīt: ziņa nonāks pie aģenta pēc tekošā soļa") : tr("Sūtīt")} aria-label={tr("Sūtīt")} disabled={!canSend || blind} onClick={send}>
							<Icon name="send" />
						</button>
					</div>
				</div>
			</div>
		</aside>
	);
}

function ChatLine({ line: l, onAnswer, thread, projectId }: { line: Line; onAnswer: (id: string, allow: boolean) => void; thread?: string; projectId: string | null }) {
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
				<Markdown text={l.text} />
			</div>
		);
	if (l.kind === "run") return null;
	if (l.kind === "compact")
		return (
			<details className={`compact-line ${l.phase}`}>
				<summary>{l.text}</summary>
				{l.summary ? <pre>{l.summary}</pre> : null}
				{l.archive !== undefined && thread ? <ArchiveView thread={thread} projectId={projectId} id={l.archive} /> : null}
			</details>
		);
	if (l.kind === "confirm") return <ConfirmLine l={l} onAnswer={onAnswer} />;
	if (l.kind === "retry") return <div className="retry">{l.text}</div>;
	return <div className="err">{l.text}</div>;
}

/** The conversation as it was before this compaction replaced it by its summary: kept in the threads database, read here on a click (it can be long). */
function ArchiveView({ thread, projectId, id }: { thread: string; projectId: string | null; id: number }) {
	const [a, setA] = useState<{ text: string; at: string; engine: string; sessionId: string | null } | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const open = async () => {
		setBusy(true);
		setErr(null);
		try {
			setA(await call("threads.archive", thread, projectId, id));
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};
	if (a)
		return (
			<>
				<div className="dim">
					{tr("Oriģināls, saglabāts {at} ({engine})", { at: a.at.slice(0, 16).replace("T", " "), engine: a.engine })}
					{a.sessionId ? ` · ${tr("dzinēja sesija {id}", { id: a.sessionId })}` : ""}
				</div>
				<pre>{a.text}</pre>
			</>
		);
	return (
		<div>
			<button className="ghost small" disabled={busy} onClick={open} title={tr("Saspiešanas brīdī saglabātā pilnā saruna: nekas no tās nav zaudēts")}>
				{busy ? tr("ielādē…") : tr("Atvērt oriģinālo sarunu")}
			</button>
			{err ? <div className="err">{err}</div> : null}
		</div>
	);
}

/**
 * The batch approval card. Waiting for an answer it is open (the batch and Atļaut / Noraidīt); once answered it shrinks to one line,
 * the tool and the answer, so old approvals do not fill the chat. The chevron opens or closes it either way; a choice made by hand stays.
 */
/** The Auto mode button (Settings.autoApprove): while it is on, the app answers every approval card with yes, except what stays with the user (agent changes, the delivery copy into the office folder). */
function AutoMode() {
	const settings = useLoad(() => call("settings.get"), []);
	const [on, setOn] = useState<boolean | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const value = on ?? settings.data?.autoApprove === true;
	const flip = () => {
		const next = !value;
		setOn(next);
		setErr(null);
		call("settings.set", { autoApprove: next }).then((s) => setOn(s.autoApprove === true)).catch((e) => (setOn(!next), setErr(errText(e))));
	};
	return (
		<button
			className={`auto-btn${value ? " on" : ""}`}
			title={err ?? (value ? tr("Auto režīms ir ieslēgts: aģenta jautājumi tiek atļauti bez klikšķa. Nospied, lai izslēgtu.") : tr("Auto režīms: atļaut visu, ko aģents jautā, bez klikšķa. Nemainās: biroja mapes, send_code_to_revit, darba kopijas pārbaude."))}
			aria-pressed={value}
			onClick={flip}
		>
			<Icon name="zap" /> {tr("Auto")}
		</button>
	);
}

function ConfirmLine({ l, onAnswer }: { l: Extract<Line, { kind: "confirm" }>; onAnswer: (id: string, allow: boolean) => void }) {
	const [pick, setPick] = useState<boolean | null>(null);
	const open = pick ?? !l.answered;
	const badge = l.answered ? (
		<span className={`badge ${l.allow === undefined ? "dim" : l.allow ? "ok" : "bad"}`}>{l.allow === undefined ? tr("atbildēts") : l.allow ? tr("atļauts") : tr("noraidīts")}</span>
	) : null;
	return (
		<div className={`confirm${open ? "" : " folded"}`}>
			<div className="confirm-head">
				<span className="confirm-title">
					<b>{tr("Apstiprini partiju:")}</b> {l.tool}
				</span>
				{!open && badge}
				<button className="confirm-fold" title={open ? tr("Sakļaut") : tr("Izvērst")} aria-label={open ? tr("Sakļaut") : tr("Izvērst")} aria-expanded={open} onClick={() => setPick(!open)}>
					{open ? "▾" : "▸"}
				</button>
			</div>
			{open && confirmNotes(l.batch).map((n, i) => <div key={i} className="confirm-note">{tr(n.text, n.vars)}</div>)}
			{open && <pre>{l.batch}</pre>}
			{open && (l.answered ? badge : (
				<div className="row">
					<button className="primary" onClick={() => onAnswer(l.id, true)}>{tr("Atļaut")}</button>
					<button onClick={() => onAnswer(l.id, false)}>{tr("Noraidīt")}</button>
				</div>
			))}
		</div>
	);
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
