// Gaida tevi: everything that waits for an answer, of every project. A confirmation shows its batch and the agent; the restart question offers Turpināt / Atmest.
import { useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import type { WaitingItem } from "../../shared/waiting";
import { call, errText } from "../bridge";
import { agentName } from "./useThreads";

interface Props {
	items: WaitingItem[];
	specs: AgentSpec[];
	projectId: string | null;
	onConfirm: (id: string, allow: boolean) => Promise<void>;
	onOpen: (threadId: string) => void;
}

const REASON = { runs: "darbu skaita robeža", cost: "izmaksu robeža" } as const;

export function Waiting({ items, specs, projectId, onConfirm, onOpen }: Props) {
	const [err, setErr] = useState<string | null>(null);
	if (items.length === 0) return null;
	// the answer is main's; the list changes when main says so, never from the click
	const run = (job: Promise<unknown>) => {
		setErr(null);
		job.catch((e) => setErr(errText(e)));
	};
	return (
		<div className="waiting-block">
			<div className="row small">
				<b>Gaida tevi</b>
				<span className="badge warn">{items.length}</span>
			</div>
			{items.map((w, i) => {
				switch (w.kind) {
					case "confirm":
						return (
							<div key={w.id} className="confirm">
								<div className="row small">
									<b>{agentName(w.agent, specs)}</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`} title={w.projectId === projectId ? "Atvērtais projekts" : "Cits projekts"}>
										{w.projectId ?? "bez projekta"}
									</span>
									<span className="dim">apstiprini partiju: {w.tool}</span>
									<span className="grow" />
									{w.projectId === projectId && (
										<button className="ghost small" onClick={() => onOpen(w.threadId)}>
											Atvērt sarunu
										</button>
									)}
								</div>
								<pre>{w.batch}</pre>
								<div className="row">
									<button className="primary" onClick={() => run(onConfirm(w.id, true))}>Atļaut</button>
									<button onClick={() => run(onConfirm(w.id, false))}>Noraidīt</button>
								</div>
							</div>
						);
					case "interrupted":
						return (
							<div key={`interrupted${i}`} className="confirm">
								<div>
									{w.interrupted} darbi tika pārtraukti, {w.queued} gaida rindā
								</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeInterrupted"))}>Turpināt</button>
									<button onClick={() => run(call("queue.discardInterrupted"))}>Atmest</button>
								</div>
							</div>
						);
					case "wave-paused":
						return (
							<div key={`wave${w.wave}`} className="confirm">
								<div className="row small">
									<b>Vilnis apturēts</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`}>{w.projectId ?? "bez projekta"}</span>
									<span className="dim">{REASON[w.reason]}</span>
								</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeWave", w.wave))} title="Skaitītāji sākas no nulles; rindā gaidošie darbi sāk darbu">Turpināt</button>
								</div>
							</div>
						);
					// the two below are filled by later phases; a line each until they have their own controls
					case "question":
						return (
							<div key={`q${w.noteId}`} className="small">
								{agentName(w.from, specs)} jautā ({w.projectId}): {w.title}
							</div>
						);
					case "gate":
						return (
							<div key={`g${w.gate}${w.noteId}`} className="small">
								Vārti {w.gate} gaida apstiprinājumu ({w.projectId})
							</div>
						);
				}
			})}
			{err && <div className="err">{err}</div>}
		</div>
	);
}
