// The stage timeline (task 9.6; it used to be a strip under the top bar): the six BIM stages, the stages in the contract
// marked, deliveries as marks and the TN / approval clocks as bars on one date axis, late ones red, today a line. The data is
// shared/dashboard.ts stageTimeline (the same stores as Nodevumi and Grafiks, never a copy). A click on a mark or a bar opens
// Nodevumi; a click on the title opens Grafiks.
import type { StageTimeline } from "../../core/summary-types";
import { windows } from "../windows";
import { tr } from "../i18n";

export function Timeline({ t }: { t: StageTimeline }) {
	return (
		<div className="stl">
			<div className="stl-head">
				<button className="ghost small" onClick={() => windows.go("grafiks")} title={tr("Atvērt Grafiku")}>
					<b>{tr("Stadijas")}</b>
				</button>
				<span className="dim small">
					{t.from} → {t.to}
				</span>
			</div>
			{t.stages.map((s) => (
				<div key={s.stage} className={`stl-row ${s.current ? "current" : ""}`} style={s.inContract ? undefined : { opacity: 0.6 }}>
					<div className="stl-name" title={s.inContract ? tr("stadija ir līgumā") : ""}>
						{s.stage}
						{s.current && <span className="chip"> {tr("tagad")}</span>}
					</div>
					<div className="stl-track">
						<div className="stl-today" style={{ left: `${t.todayPos}%` }} title={tr("šodien {today}", { today: t.today })} />
						{s.bars.map((b) => (
							<button key={b.id} className={`stl-bar ${b.late ? "late" : ""} ${b.done ? "done" : ""}`} style={{ left: `${Math.min(b.fromPos, b.toPos)}%`, width: `${Math.max(1.5, Math.abs(b.toPos - b.fromPos))}%` }} title={`${b.label}: ${b.from} → ${b.to}${b.late ? " (kavē)" : ""}`} onClick={() => windows.go("nodevumi")}>
								<span>{b.label}</span>
							</button>
						))}
						{s.marks.map((m) => (
							<button key={m.id} className={`stl-mark ${m.late ? "late" : ""} ${m.sent ? "sent" : ""}`} style={{ left: `${m.pos}%` }} title={`${m.label} · ${m.date}${m.sent ? " · nosūtīts" : m.late ? " · kavējas" : " · plānots"}`} onClick={() => windows.go("nodevumi", m.id)}>
								{m.kind}
							</button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
