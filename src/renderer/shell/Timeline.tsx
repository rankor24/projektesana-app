// Timeline strip under the top bar: the six BIM stages. Deliveries and clocks come in tasks 1.11, 4.1 and 4.2.
import { BIM_STAGES } from "../../core/model";

export function Timeline() {
	return (
		<div className="timeline">
			{BIM_STAGES.map((s) => (
				<div key={s} className="stage">
					<span className="stage-name">{s}</span>
				</div>
			))}
		</div>
	);
}
