// Top bar: app name, the project switcher, one status pill at most (open errors, else the stage), Ctrl+K, settings.
import { statusPill } from "../../shared/pages";
import type { BimStage } from "../../core/model";
import { windows } from "../windows";
import { useUi } from "../state";
import { tr } from "../i18n";
import { WindowsMenu } from "./WindowsMenu";

export function TopBar({ projectLabel, openFindings, openInfo = 0, stage = null }: { projectLabel: string | null; openFindings: number | null; openInfo?: number; stage?: BimStage | null }) {
	const { projectId } = useUi();
	const pill = projectId && openFindings !== null ? statusPill({ stage, openFindings, openInfo }) : null;
	return (
		<header className="topbar">
			<span className="brand">{tr("Projektēšanas App")}</span>
			<button className="project-pick" onClick={() => windows.open("projekts")} title={tr("Projekti")}>
				{projectLabel ?? tr("nav projekta")} ▾
			</button>
			{projectId && openFindings === null && <span className="dim small">{tr("atradumi: no data")}</span>}
			{pill && (
				<button className={`counter ${pill.tone === "bad" ? "bad" : ""}`} onClick={() => windows.open(pill.open.panel, pill.open.filter)} title={pill.tone === "bad" ? tr("Atvērtās kļūdas un brīdinājumi; info neaptur nodevumu") : tr("Projekta stadija")}>
					{pill.text}
				</button>
			)}
			<div className="spacer" />
			<WindowsMenu />
			<span className="dim small" title={tr("Ātrā meklēšana: lapas, projekti, avoti, aģenta uzdevumi")}>{tr("Ctrl+K")}</span>
			<button className="ghost" onClick={() => windows.open("iestatijumi")}>
				{tr("Iestatījumi")}</button>
		</header>
	);
}
