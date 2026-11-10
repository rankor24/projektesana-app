// One line per run that is going — the agent's or the app's own folder scan, in any project — above the panel bar, so
// background work stays visible when a floating panel covers the dock or another project is open. A run that ended
// stays for a few seconds with how it ended and what it changed.
import { useEffect, useState } from "react";
import { changesText, groupRuns, isRunning, type Activity } from "../../shared/activity";
import { useActivity } from "../activity";
import { call } from "../bridge";
import { useUi } from "../state";
import { windows } from "../windows";
import { duration, summaryOf } from "./RunCard";

const LINGER_MS = 8000;

/** What the run is doing now: its newest step that says something. */
function nowLine(lines: Activity[]): Activity | null {
	for (let i = lines.length - 1; i >= 0; i--) {
		const l = lines[i];
		if (l.kind === "tool" || l.kind === "thinking" || l.kind === "note" || l.kind === "confirm" || l.kind === "answer") return l;
	}
	return null;
}

export function StatusStrip() {
	const acts = useActivity();
	const { projectId } = useUi();
	// the state only makes the strip draw again each second; the time is read now, as the state is stale after an idle spell
	const [, setTick] = useState(0);
	const now = Date.now();
	const runs = groupRuns(acts)
		.map((g) => ({ ...g, end: g.lines.find((l) => l.kind === "done" || l.kind === "error") ?? null }))
		.filter((g) => isRunning(g.lines) || (g.end && now - Date.parse(g.end.at) < LINGER_MS))
		.slice(-3);
	const shown = runs.length > 0;
	// tick while something is shown: elapsed time moves and finished runs leave on time
	useEffect(() => {
		if (!shown) return;
		const t = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, [shown]);
	if (!shown) return null;
	return (
		<div className="status-strip" role="status" aria-live="polite">
			{runs.map(({ run, lines, end }) => {
				const first = lines[0];
				const start = lines.find((l) => l.kind === "start");
				const s = summaryOf(lines);
				const cur = nowLine(lines);
				const app = first.who === "app";
				const other = first.project !== projectId;
				const took = (end ? Date.parse(end.at) : now) - Date.parse(first.at);
				const progress = cur?.progress && cur.progress.total ? cur.progress.done / cur.progress.total : null;
				const read = s?.sources.filter((x) => x.state === "read").length ?? 0;
				const changed = s ? changesText(s.changes) : "";
				return (
					<div key={run} className={`strip-run ${end ? (end.kind === "error" ? "failed" : "done") : "running"}`}>
						{end ? <span className={end.kind === "error" ? "bad-mark" : "ok-mark"}>{end.kind === "error" ? "✗" : "✓"}</span> : <span className="pulse" />}
						<b>{app ? "Lietotne" : "Aģents"}</b>
						<span className="strip-title">{start?.text ?? "Uzdevums"}</span>
						{other && <span className="badge dim">cits projekts</span>}
						<span className="strip-now">{end ? (end.kind === "error" ? end.text : changed || "Pabeigts") : (cur?.text ?? "sāk…")}</span>
						{progress !== null && !end && (
							<span className="strip-bar" aria-hidden>
								<span style={{ width: `${Math.round(progress * 100)}%` }} />
							</span>
						)}
						<span className="grow" />
						<span className="dim small">
							{!app && s ? `solis ${s.steps}${s.sources.length ? ` · ${read}${s.listed !== null ? `/${s.listed}` : ""} avoti` : ""} · ` : ""}
							{duration(took)}
						</span>
						{app ? (
							<button className="ghost small" onClick={() => windows.open("projekts")}>Projekts</button>
						) : (
							!end && (
								<button className="small" onClick={() => void call("agent.stop")}>
									Apturēt
								</button>
							)
						)}
					</div>
				);
			})}
		</div>
	);
}
