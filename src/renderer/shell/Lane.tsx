// One collapsed row per running or queued thread of the open project, with its last step and a stop button; above them the queue's own controls.
import type { AgentSpec } from "../../shared/agent-types";
import { StateDot } from "./ThreadList";
import { agentName, type LaneItem } from "./useThreads";

export function Lane({ lane, specs, onOpen, onStop }: { lane: LaneItem; specs: AgentSpec[]; onOpen: (threadId: string) => void; onStop: (threadId: string) => void }) {
	const step = lane.state === "queued" ? "gaida rindā" : (lane.step ?? "strādā…");
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
				Apturēt
			</button>
		</div>
	);
}

interface BarProps {
	lanes: LaneItem[];
	specs: AgentSpec[];
	paused: boolean;
	/** running or queued in other projects */
	elsewhere: number;
	onOpen: (threadId: string) => void;
	onStop: (threadId: string) => void;
	onStopAll: () => void;
	onTogglePause: () => void;
}

/** Shown only while something runs, waits in the queue, or the queue is paused: an idle window has no strip. */
export function LaneBar({ lanes, specs, paused, elsewhere, onOpen, onStop, onStopAll, onTogglePause }: BarProps) {
	if (lanes.length === 0 && elsewhere === 0 && !paused) return null;
	return (
		<div className="run-lanes">
			<div className="row lanes-head small">
				<span className="dim">Darbi:</span>
				<b>{lanes.length}</b>
				{elsewhere > 0 && <span className="dim">· citos projektos {elsewhere}</span>}
				{paused && <span className="badge warn">rinda apturēta</span>}
				<span className="grow" />
				<button className="small" onClick={onTogglePause} title={paused ? "Rindā gaidošie darbi sāks darbu" : "Kas jau strādā, turpina; jauni darbi gaida"}>
					{paused ? "Turpināt rindu" : "Pauzēt rindu"}
				</button>
				<button className="small danger" onClick={onStopAll} disabled={lanes.length === 0 && elsewhere === 0} title="Aptur visus darbus, arī citos projektos">
					Apturēt visu
				</button>
			</div>
			{lanes.map((l) => (
				<Lane key={`${l.threadId}:${l.state}`} lane={l} specs={specs} onOpen={onOpen} onStop={onStop} />
			))}
		</div>
	);
}
