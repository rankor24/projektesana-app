// Top bar: app name, the open project, the open-findings counter, settings.
import { windows } from "../windows";
import { useUi } from "../state";

export function TopBar({ projectLabel, openFindings }: { projectLabel: string | null; openFindings: number | null }) {
	const { projectId } = useUi();
	return (
		<header className="topbar">
			<span className="brand">Projektēšanas App</span>
			<button className="project-pick" onClick={() => windows.open("projekts")} title="Projekti">
				{projectLabel ?? "nav projekta"}
			</button>
			<div className="spacer" />
			{projectId && (
				<button className={`counter ${openFindings ? "bad" : ""}`} onClick={() => windows.open("prasibas", "findings")} title="Atvērtie atradumi">
					{openFindings === null ? "atradumi: no data" : `atradumi: ${openFindings}`}
				</button>
			)}
			<button className="ghost" onClick={() => windows.open("iestatijumi")}>
				Iestatījumi
			</button>
		</header>
	);
}
