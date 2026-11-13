// Top bar: app name, the project switcher, one status pill at most (open errors, else the stage), Ctrl+K, settings.
import { statusPill } from "../../shared/pages";
import type { BimStage } from "../../core/model";
import { windows } from "../windows";
import { useUi } from "../state";

export function TopBar({ projectLabel, openFindings, openInfo = 0, stage = null }: { projectLabel: string | null; openFindings: number | null; openInfo?: number; stage?: BimStage | null }) {
	const { projectId } = useUi();
	const pill = projectId && openFindings !== null ? statusPill({ stage, openFindings, openInfo }) : null;
	return (
		<header className="topbar">
			<span className="brand">Projektēšanas App</span>
			<button className="project-pick" onClick={() => windows.open("projekts")} title="Projekti">
				{projectLabel ?? "nav projekta"} ▾
			</button>
			{projectId && openFindings === null && <span className="dim small">atradumi: no data</span>}
			{pill && (
				<button className={`counter ${pill.tone === "bad" ? "bad" : ""}`} onClick={() => windows.open(pill.open.panel, pill.open.filter)} title={pill.tone === "bad" ? "Atvērtās kļūdas un brīdinājumi; info neaptur nodevumu" : "Projekta stadija"}>
					{pill.text}
				</button>
			)}
			<div className="spacer" />
			<span className="dim small" title="Ātrā meklēšana: lapas, projekti, avoti, aģenta uzdevumi">Ctrl+K</span>
			<button className="ghost" onClick={() => windows.open("iestatijumi")}>
				Iestatījumi
			</button>
		</header>
	);
}
