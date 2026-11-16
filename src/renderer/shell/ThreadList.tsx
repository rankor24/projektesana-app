// The agents and their conversations: lead first, then the specialists. One dot shows what a thread is doing.
import { useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import { LEAD_ID, type QueueView, type Thread, type ThreadState } from "../../shared/thread-types";
import { agentName, liveState } from "./useThreads";

export const STATE_TEXT: Record<ThreadState, string> = {
	idle: "brīva",
	queued: "gaida rindā",
	running: "strādā",
	"waiting-confirm": "gaida tavu apstiprinājumu",
	"waiting-reply": "gaida atbildi",
	interrupted: "pārtraukta",
	closed: "slēgta",
};

/** Five dots: idle, running, queued, waiting (both kinds), interrupted. */
const DOT: Record<ThreadState, string> = { idle: "idle", queued: "queued", running: "running", "waiting-confirm": "waiting", "waiting-reply": "waiting", interrupted: "interrupted", closed: "closed" };

export function StateDot({ state }: { state: ThreadState }) {
	return <span className={`tdot ${DOT[state]}`} title={STATE_TEXT[state]} />;
}

const when = (iso: string) => new Date(iso).toLocaleString("lv", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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
							{gone && <span className="badge dim" title="Speciālists ir noņemts Iestatījumos">noņemts</span>}
							<span className="grow" />
							{!gone && (
								<button className="ghost small" onClick={() => onNew(id)}>
									Jauna saruna
								</button>
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
											title={busy ? "Nevar slēgt, kamēr saruna strādā" : "Slēgt sarunu (pieraksts paliek)"}
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
						{own.length === 0 && <div className="dim small tl-none">nav sarunu</div>}
					</div>
				);
			})}
			<label className="small dim tl-closed">
				<input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> Rādīt slēgtās
			</label>
		</div>
	);
}

/** The collapsed header of the list: what the chat shows now; opened, the agents and their threads. */
export function ThreadPanel({ current, ...list }: Props) {
	const t = list.threads.find((x) => x.id === current);
	return (
		<details className="threads">
			<summary>
				{t && <StateDot state={liveState(t, list.queue)} />}
				<b>Sarunas</b>
				<span className="dim">{t ? `${agentName(t.agent, list.specs)} · ${t.title}` : "vadošais aģents"}</span>
			</summary>
			<ThreadList current={current} {...list} />
		</details>
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
			<span>Nosūtīts: {name}.</span>
			<button className="ghost small" onClick={onOpen}>
				Atvērt sarunu
			</button>
			<button className="ghost small x" onClick={onClose}>
				×
			</button>
		</div>
	);
}
