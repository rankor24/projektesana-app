// The process strip of the chat window (task 14.8): the seven stages, the one that is on, its iteration and the gate that waits. Shown only while the open
// project is in process mode; a project in Kopdarbs has none of it.
import { stripModel } from "../../shared/process-view";
import { useProcess } from "../state";

const MARK = { done: "✓ ", current: "", skipped: "", todo: "" } as const;
const TITLE = { done: "pabeigta", current: "šobrīd", skipped: "izlaista", todo: "vēl priekšā" } as const;

export function ProcessStrip({ projectId }: { projectId: string | null }) {
	const s = useProcess(projectId);
	if (!s || s.mode !== "process") return null;
	const m = stripModel(s);
	return (
		<div className="pstrip">
			<div className="pstrip-stages">
				{m.stages.map((x) => (
					<span key={x.stage} className={`pstrip-stage ${x.state}`} title={`${x.title} (${TITLE[x.state]})`}>
						{MARK[x.state]}
						{x.stage}
					</span>
				))}
			</div>
			<div className="row small">
				{s.stage === "mācības" && <span className="badge info">mācības</span>}
				{s.stage === "done" && <span className="badge ok">process pabeigts</span>}
				{m.iteration && (
					<span className="dim" title="Stadijas gājiens: katra atgriešana pievieno vienu; pēc trešās atgriešanas lēmums ir tavs">
						iterācija {m.iteration.n} no {m.iteration.of}
					</span>
				)}
				{m.gate && <span className="badge warn">gaida {m.gate}</span>}
				{m.escalated && <span className="badge bad">eskalēts: {m.escalated}</span>}
			</div>
		</div>
	);
}
