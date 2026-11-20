// One collapsed row per running or queued thread of the open project, with its last step and a stop button; above them the queue's own controls.
import type { AgentSpec } from "../../shared/agent-types";
import type { Wave } from "../../shared/thread-types";
import { waveLine } from "../../shared/wave";
import { StateDot } from "./ThreadList";
import { agentName, type LaneItem } from "./useThreads";
import { tr } from "../i18n";

export function Lane({ lane, specs, onOpen, onStop }: { lane: LaneItem; specs: AgentSpec[]; onOpen: (threadId: string) => void; onStop: (threadId: string) => void }) {
	const step = lane.state === "queued" ? tr("gaida rindā") : (lane.step ?? tr("strādā…"));
	return (
		<div className="run-lane" onClick={() => onOpen(lane.threadId)} title={lane.title}>
			<StateDot state={lane.state} />
			<b>{agentName(lane.agent, specs)}</b>
			<span className="run-lane-step small dim">{step}</span>
			<span className="grow" />
			<button
				className="small"
				onClick={(e) => {
					e.stopPropagation();
					onStop(lane.threadId);
				}}
			>
				{tr("Apturēt")}</button>
		</div>
	);
}

interface BarProps {
	lanes: LaneItem[];
	specs: AgentSpec[];
	paused: boolean;
	/** the open project's current wave, shown beside Stop */
	wave: Wave | null;
	/** running or queued in other projects */
	elsewhere: number;
	onOpen: (threadId: string) => void;
	onStop: (threadId: string) => void;
	onStopAll: () => void;
	onTogglePause: () => void;
}

/** Shown only while something runs, waits in the queue, or the queue is paused: an idle window has no strip. */
export function LaneBar({ lanes, specs, paused, wave, elsewhere, onOpen, onStop, onStopAll, onTogglePause }: BarProps) {
	if (lanes.length === 0 && elsewhere === 0 && !paused) return null;
	return (
		<div className="run-lanes">
			<div className="row lanes-head small">
				<span className="dim">{tr("Darbi:")}</span>
				<b>{lanes.length}</b>
				{elsewhere > 0 && <span className="dim">{tr("· citos projektos {elsewhere}", { elsewhere: elsewhere })}</span>}
				{paused && <span className="badge warn">{tr("rinda apturēta")}</span>}
				<span className="grow" />
				{wave && <span className={`small ${wave.paused ? "badge warn" : "dim"}`}>{waveLine(wave)}</span>}
				<button className="small" onClick={onTogglePause} title={paused ? tr("Rindā gaidošie darbi sāks darbu") : tr("Kas jau strādā, turpina; jauni darbi gaida")}>
					{paused ? tr("Turpināt rindu") : tr("Pauzēt rindu")}
				</button>
				<button className="small danger" onClick={onStopAll} disabled={lanes.length === 0 && elsewhere === 0} title={tr("Aptur visus darbus, arī citos projektos")}>
					{tr("Apturēt visu")}</button>
			</div>
			{lanes.map((l) => (
				<Lane key={`${l.threadId}:${l.state}`} lane={l} specs={specs} onOpen={onOpen} onStop={onStop} />
			))}
		</div>
	);
}
