// The rail: the pages, grouped (Projekts / Dati / Nodošana), expanded with names or collapsed to icons with the name as a
// tooltip; Iestatījumi and the collapse button at the bottom. BIM Crew shell/NavRail.tsx is the model.
import { useState } from "react";
import { groupOf, THREADS } from "../../shared/layout";
import { LOG_PANEL, railGroups } from "../../shared/pages";
import { useWindows, windows } from "../windows";
import { tr } from "../i18n";
import { Icon, PAGE_ICON } from "../icons";

const KEY = "projektesana:rail";
const readCollapsed = (): boolean => {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
};

export function Rail() {
	const { page, layout, sidebar } = useWindows();
	const mark = (id: string) => (page === id ? "on" : "");
	const [collapsed, setCollapsed] = useState(readCollapsed);
	const toggle = () => {
		setCollapsed(!collapsed);
		try {
			localStorage.setItem(KEY, collapsed ? "0" : "1");
		} catch {
			// not remembered: the rail opens expanded next time
		}
	};
	return (
		<nav className={`rail ${collapsed ? "rail-collapsed" : ""}`}>
			{railGroups().map((g) => (
				<div key={g.id} className="rail-group">
					{!collapsed && <div className="rail-group-title">{tr(g.title)}</div>}
					{g.pages.map((p) => (
						<button key={p.id} className={`rail-item ${mark(p.id)}`} title={`${tr(p.title)} — ${tr(p.hint)}`} onClick={() => windows.railClick(p.id)}>
							<span className="rail-icon">{PAGE_ICON[p.id] ? <Icon name={PAGE_ICON[p.id]} /> : p.icon}</span>
							{!collapsed && <span>{tr(p.title)}</span>}
						</button>
					))}
				</div>
			))}
			<div className="rail-grow" />
			<div className="rail-foot">
				{/* BIM Crew's "Chat history": the conversations are a panel of their own, never part of the chat */}
				<button className={`rail-item ${(sidebar.open && sidebar.id === THREADS) || groupOf(layout, THREADS) ? "on" : ""}`} title={tr("Sarunas — visas sarunas ar aģentiem")} onClick={() => windows.toggleThreads()}>
					<span className="rail-icon"><Icon name="messages" /></span>
					{!collapsed && <span>{tr("Sarunas")}</span>}
				</button>
				<button className={`rail-item ${page === "prasmes" ? "on" : ""}`} title={tr("Prasmes — biroja prasmju bibliotēka")} onClick={() => windows.go("prasmes")}>
					<span className="rail-icon"><Icon name="zap" /></span>
					{!collapsed && <span>{tr("Prasmes")}</span>}
				</button>
				<button className={`rail-item ${page === "agenti" ? "on" : ""}`} title={tr("Aģenti — saraksts, lomas, ierobežojumi")} onClick={() => windows.go("agenti")}>
					<span className="rail-icon"><Icon name="bot" /></span>
					{!collapsed && <span>{tr("Aģenti")}</span>}
				</button>
				{/* the agent log opens in the right panel like the lists, whatever page is open */}
				<button className={`rail-item ${groupOf(layout, LOG_PANEL) ? "on" : ""}`} title={tr("Žurnāls — viss, ko aģents dara un saņem")} onClick={() => windows.toggleLog()}>
					<span className="rail-icon"><Icon name="terminal" /></span>
					{!collapsed && <span>{tr("Žurnāls")}</span>}
				</button>
				<button className={`rail-item ${page === "iestatijumi" ? "on" : ""}`} title={tr("Iestatījumi")} onClick={() => windows.go("iestatijumi")}>
					<span className="rail-icon"><Icon name="sliders" /></span>
					{!collapsed && <span>{tr("Iestatījumi")}</span>}
				</button>
				<button className="rail-item" title={collapsed ? tr("Izvērst joslu") : tr("Sakļaut joslu")} aria-label={collapsed ? tr("Izvērst joslu") : tr("Sakļaut joslu")} aria-expanded={!collapsed} onClick={toggle}>
					<span className="rail-icon"><Icon name={collapsed ? "panelOpen" : "panelClose"} /></span>
					{!collapsed && <span>{tr("Sakļaut")}</span>}
				</button>
			</div>
		</nav>
	);
}
