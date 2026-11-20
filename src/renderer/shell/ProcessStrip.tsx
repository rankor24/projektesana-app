// The process strip of the chat window (task 14.8): the seven stages, the one that is on, its iteration and the gate that waits. Shown only while the open
// project is in process mode; a project in Kopdarbs has none of it.
import { stripModel } from "../../shared/process-view";
import { useProcess } from "../state";
import { tr } from "../i18n";

const MARK = { done: "✓ ", current: "", skipped: "", todo: "" } as const;
const TITLE = { done: tr("pabeigta"), current: tr("šobrīd"), skipped: tr("izlaista"), todo: tr("vēl priekšā") } as const;

export function ProcessStrip({ projectId }: { projectId: string | null }) {
	const s = useProcess(projectId);
	if (!s || s.mode !== "process") return null;
	const m = stripModel(s);
	return (
		<div className="pstrip">
			<div className="pstrip-stages">
				{m.stages.map((x) => (
					<span key={x.stage} className={`pstrip-stage ${x.state}`} title={`${tr(x.title)} (${TITLE[x.state]})`}>
						{MARK[x.state]}
						{x.stage}
					</span>
				))}
			</div>
			<div className="row small">
				{s.stage === "mācības" && <span className="badge info">{tr("mācības")}</span>}
				{s.stage === "done" && <span className="badge ok">{tr("process pabeigts")}</span>}
				{m.iteration && (
					<span className="dim" title={tr("Stadijas gājiens: katra atgriešana pievieno vienu; pēc trešās atgriešanas lēmums ir tavs")}>
						{tr("iterācija {n} no {of}", { n: m.iteration.n, of: m.iteration.of })}</span>
				)}
				{m.gate && <span className="badge warn">{tr("gaida {gate}", { gate: m.gate })}</span>}
				{m.escalated && <span className="badge bad">{tr("eskalēts: {escalated}", { escalated: m.escalated })}</span>}
			</div>
		</div>
	);
}
