// Timeline strip under the top bar: the six BIM stages, the stages in the contract (from the profile), and the
// deliveries (4.1) and clocks (4.2) when they exist. BP spans Tehniskais to Detalizācijas (design doc, answer 1).
import { BIM_STAGES, type BimStage, type Delivery, type Fact } from "../../core/model";
import { STAGES_OF } from "../../core/stages";
import { call } from "../bridge";
import { useUi } from "../state";
import { useLoad } from "../ui";
import { windows } from "../windows";

export function Timeline() {
	const { projectId } = useUi();
	const facts = useLoad<Fact[]>(() => (projectId ? call("facts.list", projectId) : Promise.resolve([])), [projectId]);
	const deliveries = useLoad<Delivery[]>(() => (projectId ? call("deliveries.list", projectId) : Promise.resolve([])), [projectId]);
	const stagesInContract = new Set(
		(facts.data ?? [])
			.filter((f) => f.key === "profile.stagesInContract" && f.state !== "rejected")
			.flatMap((f) => STAGES_OF[(f.value as keyof typeof STAGES_OF) ?? "custom"] ?? []),
	);
	const sent = (deliveries.data ?? []).filter((d) => d.submittedDate || d.sent);
	const current: BimStage | null = sent.length ? sent.sort((a, b) => ((a.submittedDate ?? "") < (b.submittedDate ?? "") ? 1 : -1))[0].stage : null;
	return (
		<div className="timeline">
			{BIM_STAGES.map((s) => (
				<div key={s} className={`stage ${current === s ? "current" : ""}`} style={stagesInContract.has(s) ? { borderColor: "var(--border-strong)" } : { opacity: projectId && stagesInContract.size ? 0.55 : 1 }}>
					<span className="stage-name">{s}</span>
					{(deliveries.data ?? [])
						.filter((d) => d.stage === s)
						.map((d) => (
							<button key={d.id} className="chip" title={`${d.label}${d.plannedDate ? ` · plānots ${d.plannedDate}` : ""}${d.submittedDate ? ` · iesniegts ${d.submittedDate}` : ""}`} onClick={() => windows.open("nodevumi", d.id)}>
								{d.kind}
								{d.submittedDate ? ` ${d.submittedDate.slice(2).replace(/-/g, "")}` : d.plannedDate ? ` ⏱ ${d.plannedDate.slice(5)}` : ""}
							</button>
						))}
				</div>
			))}
		</div>
	);
}
