// One view: top bar, timeline, split (preview | agent), panel bar, floating panel windows on top.
import { useEffect } from "react";
import { on } from "./bridge";
import { AgentDock } from "./shell/AgentDock";
import { PanelBar } from "./shell/PanelBar";
import { Preview } from "./shell/Preview";
import { Timeline } from "./shell/Timeline";
import { TopBar } from "./shell/TopBar";
import { WindowLayer } from "./shell/WindowLayer";
import { ui } from "./state";
import { Empty } from "./ui";
import { PANEL_TITLE, useWindows, windows, type PanelId } from "./windows";

function Panel({ id }: { id: PanelId; filter?: string }) {
	return <Empty title="nav projekta">{PANEL_TITLE[id]}</Empty>;
}

export function App() {
	const w = useWindows();
	const docked = w.windows.find((x) => x.mode === "docked");
	useEffect(() => on("data.changed", () => ui.bump()), []);
	return (
		<div className="app">
			<TopBar projectLabel={null} openFindings={null} />
			<Timeline />
			<main className={`split ${docked ? "with-dock" : ""}`}>
				<Preview />
				{docked && (
					<section className="docked">
						<div className="docked-title">
							<span>{docked.title}</span>
							<button title="Atspraust" onClick={() => windows.mode(docked.id, "normal")}>⇤</button>
							<button title="Aizvērt" onClick={() => windows.close(docked.id)}>×</button>
						</div>
						<div className="docked-body">
							<Panel id={docked.id} filter={docked.filter} />
						</div>
					</section>
				)}
				<AgentDock />
			</main>
			<PanelBar />
			<WindowLayer render={(id, filter) => <Panel id={id} filter={filter} />} />
		</div>
	);
}
