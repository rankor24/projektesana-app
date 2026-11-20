// The agents and their conversations: lead first, then the specialists. One dot shows what a thread is doing.
import { useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import { LEAD_ID, type QueueView, type Thread, type ThreadState } from "../../shared/thread-types";
import { agentName, liveState, useThreads } from "./useThreads";
import { THREADS } from "../../shared/layout";
import { errText } from "../bridge";
import { ui, useUi } from "../state";
import { windows } from "../windows";
import { locale, tr } from "../i18n";

export const STATE_TEXT: Record<ThreadState, string> = {
	idle: tr("brīva"),
	queued: tr("gaida rindā"),
	running: tr("strādā"),
	"waiting-confirm": tr("gaida tavu apstiprinājumu"),
	"waiting-reply": tr("gaida atbildi"),
	interrupted: tr("pārtraukta"),
	closed: tr("slēgta"),
};

/** Five dots: idle, running, queued, waiting (both kinds), interrupted. */
const DOT: Record<ThreadState, string> = { idle: "idle", queued: "queued", running: "running", "waiting-confirm": "waiting", "waiting-reply": "waiting", interrupted: "interrupted", closed: "closed" };

export function StateDot({ state }: { state: ThreadState }) {
	return <span className={`tdot ${DOT[state]}`} title={STATE_TEXT[state]} />;
}

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

interface Props {
	threads: Thread[];
	specs: AgentSpec[];
	queue: QueueView;
	/** the thread the chat shows */
	current: string | null;
	onSelect: (id: string) => void;
	onNew: (agent: string) => void;
	onClose: (id: string) => void;
}

export function ThreadList({ threads, specs, queue, current, onSelect, onNew, onClose }: Props) {
	const [closed, setClosed] = useState(false);
	// the lead, the specialists, then agents that still own threads but were removed in Iestatījumi
	const ids = [LEAD_ID, ...specs.map((s) => s.id)];
	for (const t of threads) if (!ids.includes(t.agent)) ids.push(t.agent);
	const shown = threads.filter((t) => closed || t.state !== "closed");
	return (
		<div className="thread-list">
			{ids.map((id) => {
				const own = shown.filter((t) => t.agent === id);
				const gone = id !== LEAD_ID && !specs.some((s) => s.id === id);
				return (
					<div key={id} className="tl-agent">
						<div className="row tl-head">
							<b>{agentName(id, specs)}</b>
							{gone && <span className="badge dim" title={tr("Speciālists ir noņemts Iestatījumos")}>{tr("noņemts")}</span>}
							<span className="grow" />
							{!gone && (
								<button className="ghost small" onClick={() => onNew(id)}>
									{tr("Jauna saruna")}</button>
							)}
						</div>
						{own.map((t) => {
							const st = liveState(t, queue);
							const busy = st === "running" || st === "queued" || st === "waiting-confirm";
							return (
								<div key={t.id} className={`tl-thread ${t.id === current ? "on" : ""} ${t.state === "closed" ? "closed" : ""}`} onClick={() => onSelect(t.id)} title={STATE_TEXT[st]}>
									<StateDot state={st} />
									<span className="tl-title">{t.title}</span>
									<span className="dim small">{when(t.lastAt)}</span>
									{t.state !== "closed" && (
										<button
											className="ghost small x"
											title={busy ? tr("Nevar slēgt, kamēr saruna strādā") : tr("Slēgt sarunu (pieraksts paliek)")}
											disabled={busy}
											onClick={(e) => {
												e.stopPropagation();
												onClose(t.id);
											}}
										>
											×
										</button>
									)}
								</div>
							);
						})}
						{own.length === 0 && <div className="dim small tl-none">{tr("nav sarunu")}</div>}
					</div>
				);
			})}
			<label className="small dim tl-closed">
				<input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> {tr("Rādīt slēgtās")}</label>
		</div>
	);
}

/**
 * The chat's header line: which conversation the chat shows, and a button that opens the list as a window of its own.
 * BIM Crew keeps the history out of the chat (a separate "Chat history" panel); an expanded list here pushed the chat out
 * of the dock. This line never grows.
 */
export function ThreadPanel({ current, threads, specs, queue }: { threads: Thread[]; specs: AgentSpec[]; queue: QueueView; current: string | null }) {
	const t = threads.find((x) => x.id === current);
	const open = threads.filter((x) => x.state !== "closed").length;
	return (
		<div className="threads-line">
			{t && <StateDot state={liveState(t, queue)} />}
			<span className="threads-now" title={t ? `${agentName(t.agent, specs)} · ${t.title}` : undefined}>
				{t ? `${agentName(t.agent, specs)} · ${t.title}` : tr("vadošais aģents")}
			</span>
			<button className="small" onClick={() => windows.toggleThreads()} title={tr("Visas sarunas: katram aģentam savas, jauna saruna, slēgšana")}>
				☰ {tr("Sarunas")}{open > 1 ? ` (${open})` : ""}
			</button>
		</div>
	);
}

/** The list of conversations as a window: the agents and their threads, a new conversation, closing, the closed ones. */
export function ThreadsWindow() {
	const { projectId, thread: selId } = useUi();
	const T = useThreads(projectId);
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <div className="threads-win dim">{tr("Atver projektu, lai redzētu sarunas.")}</div>;
	return (
		<div className="threads-win">
			{err && <div className="err small">{err}</div>}
			<ThreadList
				threads={T.threads}
				specs={T.specs}
				queue={T.queue}
				current={T.viewId}
				onSelect={T.select}
				onNew={(a) => void T.open(a).catch((e) => setErr(errText(e)))}
				onClose={(id) =>
					void T.close(id)
						.then(() => id === selId && ui.selectThread(null))
						.catch((e) => setErr(errText(e)))
				}
			/>
		</div>
	);
}

/** "@" at the start of the message: the agents that fit what is typed. */
export function MentionPop({ options, active, onPick }: { options: AgentSpec[]; active: number; onPick: (id: string) => void }) {
	if (options.length === 0) return null;
	return (
		<div className="mention-pop" role="listbox">
			{options.map((o, i) => (
				<button key={o.id} role="option" aria-selected={i === active} className={`ghost ${i === active ? "on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(o.id)} title={o.description}>
					<b>@{o.id}</b> <span className="dim">{o.name}</span>
				</button>
			))}
		</div>
	);
}

/** A message went to another agent's thread: it does not show in this chat, so say where it went. */
export function SentNotice({ name, onOpen, onClose }: { name: string; onOpen: () => void; onClose: () => void }) {
	return (
		<div className="row small notice">
			<span>{tr("Nosūtīts: {name}.", { name: name })}</span>
			<button className="ghost small" onClick={onOpen}>
				{tr("Atvērt sarunu")}</button>
			<button className="ghost small x" onClick={onClose}>
				×
			</button>
		</div>
	);
}
