// One view: top bar, timeline, split (preview | agent), panel bar, floating panel windows on top.
import { useEffect, useState } from "react";
import type { ProjectRow } from "../shared/api";
import { call, on } from "./bridge";
import { AgentDock } from "./shell/AgentDock";
import { PanelBar } from "./shell/PanelBar";
import { Preview } from "./shell/Preview";
import { Timeline } from "./shell/Timeline";
import { TopBar } from "./shell/TopBar";
import { WindowLayer } from "./shell/WindowLayer";
import { ui, useUi } from "./state";
import { Empty } from "./ui";
import { Iestatijumi } from "./panels/Iestatijumi";
import { Projekts } from "./panels/Projekts";
import { Avoti } from "./panels/Avoti";
import { PANEL_TITLE, useWindows, windows, type PanelId } from "./windows";

function Panel({ id, filter }: { id: PanelId; filter?: string }) {
	if (id === "iestatijumi") return <Iestatijumi />;
	if (id === "projekts") return <Projekts />;
	if (id === "avoti") return <Avoti filter={filter} />;
	return <Empty title="nav projekta">{PANEL_TITLE[id]}</Empty>;
}

export function App() {
	const w = useWindows();
	const docked = w.windows.find((x) => x.mode === "docked");
	useEffect(() => on("data.changed", () => ui.bump()), []);
	const { tick, projectId } = useUi();
	const [row, setRow] = useState<ProjectRow | null>(null);
	useEffect(() => {
		call("settings.get").then((s) => {
			const dark = s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
		});
	}, [tick]);
	useEffect(() => {
		if (!projectId) return setRow(null);
		call("projects.list")
			.then((l) => {
				const r = l.find((p) => p.id === projectId) ?? null;
				setRow(r);
				// a project removed from the list is no longer open
				if (!r) ui.setProject(null);
			})
			.catch(() => setRow(null));
	}, [projectId, tick]);
	return (
		<div className="app">
			<TopBar projectLabel={row ? row.name : null} openFindings={row ? row.openFindings : null} />
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
