import { useEffect, useState } from "react";
import { api } from "./api";
import { Dashboard } from "./screens/Dashboard";
import { Laws } from "./screens/Laws";
import { TechRules } from "./screens/TechRules";
import { Inputs } from "./screens/Inputs";
import { Chat } from "./screens/Chat";
import { Views } from "./screens/Views";
import { Settings } from "./screens/Settings";
import { History } from "./screens/History";
import type { ProjectRow } from "./types";
import { ErrorBoundary } from "./ErrorBoundary";

export type Screen = "dash" | "p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7" | "p8" | "p9" | "p10" | "settings" | "history";

// Boris's sidebar order (design §4): laws 1–4, technical rules 5–6, PU and source data 7–8, chat 9, views 10.
const NAV: { id: Screen; n: string; label: string; group?: string }[] = [
	{ id: "p1", n: "1", label: "Likumi", group: "Likumi" },
	{ id: "p2", n: "2", label: "MK noteikumi un LBN" },
	{ id: "p3", n: "3", label: "LVS standarti" },
	{ id: "p4", n: "4", label: "ES standarti un tiesības" },
	{ id: "p5", n: "5", label: "Pašvaldība", group: "Tehniskie noteikumi" },
	{ id: "p6", n: "6", label: "Tīklu īpašnieki" },
	{ id: "p7", n: "7", label: "Projektēšanas uzdevums", group: "PU un izejas dati" },
	{ id: "p8", n: "8", label: "Izejas dati" },
	{ id: "p9", n: "9", label: "Čats", group: "Darbs" },
	{ id: "p10", n: "10", label: "Skati (PDF · IFC)" },
];

export function App() {
	const [screen, setScreen] = useState<Screen>("dash");
	const [project, setProject] = useState<ProjectRow | null>(null);
	const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");

	useEffect(() => {
		api<{ theme: "auto" | "light" | "dark" }>("settingsGet").then((s) => setTheme(s.theme)).catch(() => {});
	}, []);
	useEffect(() => {
		if (theme === "auto") document.documentElement.removeAttribute("data-theme");
		else document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	const root = project?.root ?? null;
	const needsProject = screen !== "dash" && screen !== "settings" && !["p1", "p2", "p3", "p4"].includes(screen);

	return (
		<div className="app">
			<nav className="side">
				<div className="brand">Projektēšanas App</div>
				<div className="proj">
					{project?.meta ? (
						<>
							<b>{project.meta.name}</b>
							{project.root}
						</>
					) : (
						"Projekts nav izvēlēts"
					)}
				</div>
				<button className={`nav ${screen === "dash" ? "on" : ""}`} onClick={() => setScreen("dash")}>
					<span className="n">◧</span>Pārskats
				</button>
				{NAV.map((n) => (
					<div key={n.id}>
						{n.group && <div className="group">{n.group}</div>}
						<button className={`nav ${screen === n.id ? "on" : ""}`} onClick={() => setScreen(n.id)} disabled={!root && !["p1", "p2", "p3", "p4"].includes(n.id)} title={!root && !["p1", "p2", "p3", "p4"].includes(n.id) ? "Vispirms izvēlies projektu pārskatā" : undefined}>
							<span className="n">{n.n}</span>
							{n.label}
						</button>
					</div>
				))}
				<div className="grow" />
				<button className={`nav ${screen === "history" ? "on" : ""}`} onClick={() => setScreen("history")} disabled={!root}>
					<span className="n">≡</span>Vēsture (žurnāls)
				</button>
				<button className={`nav ${screen === "settings" ? "on" : ""}`} onClick={() => setScreen("settings")}>
					<span className="n">⚙</span>Iestatījumi
				</button>
			</nav>
			<main className="main">
				<ErrorBoundary key={screen} onHome={() => setScreen("dash")}>
				{screen === "dash" && <Dashboard selected={root} onSelect={(p) => setProject(p)} onOpen={(p, s) => (setProject(p), setScreen(s))} />}
				{screen === "p1" && <Laws tab="p1" root={root} />}
				{screen === "p2" && <Laws tab="p2" root={root} />}
				{screen === "p3" && <Laws tab="p3" root={root} />}
				{screen === "p4" && <Laws tab="p4" root={root} />}
				{needsProject && !root && <div className="empty">Izvēlies projektu pārskatā.</div>}
				{root && screen === "p5" && <TechRules root={root} issuer="state_municipal" />}
				{root && screen === "p6" && <TechRules root={root} issuer="network_owner" />}
				{root && screen === "p7" && <Inputs root={root} mode="pu" />}
				{root && screen === "p8" && <Inputs root={root} mode="data" />}
				{root && screen === "p9" && <Chat root={root} onModel={() => setScreen("p10")} />}
				{root && screen === "p10" && <Views root={root} />}
				{root && screen === "history" && <History root={root} />}
				{screen === "settings" && <Settings theme={theme} onTheme={setTheme} />}
				</ErrorBoundary>
			</main>
		</div>
	);
}
