// Top bar: app name, the open project, the open-findings counter, settings.
import { windows } from "../windows";
import { useUi } from "../state";

export function TopBar({ projectLabel, openFindings, openInfo = 0 }: { projectLabel: string | null; openFindings: number | null; openInfo?: number }) {
	const { projectId } = useUi();
	return (
		<header className="topbar">
			<span className="brand">Projektēšanas App</span>
			<button className="project-pick" onClick={() => windows.open("projekts")} title="Projekti">
				{projectLabel ?? "nav projekta"}
			</button>
			<div className="spacer" />
			{projectId && (
				<button className={`counter ${openFindings ? "bad" : ""}`} onClick={() => windows.open("prasibas", "findings")} title="Atvērtās kļūdas un brīdinājumi; info neaptur nodevumu">
					{openFindings === null ? "atradumi: no data" : `atradumi: ${openFindings}${openInfo ? ` (+${openInfo} info)` : ""}`}
				</button>
			)}
			<span className="dim small" title="Ātrā meklēšana: paneļi, projekti, avoti, aģenta uzdevumi">Ctrl+K</span>
			<button className="ghost" onClick={() => windows.open("iestatijumi")}>
				Iestatījumi
			</button>
		</header>
	);
}
