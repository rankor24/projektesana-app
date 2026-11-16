// The rail: the pages, grouped (Projekts / Dati / Nodošana), expanded with names or collapsed to icons with the name as a
// tooltip; Iestatījumi and the collapse button at the bottom. BIM Crew shell/NavRail.tsx is the model.
import { useState } from "react";
import { railGroups } from "../../shared/pages";
import { useWindows, windows } from "../windows";

const KEY = "projektesana:rail";
const readCollapsed = (): boolean => {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
};

export function Rail() {
	const { page } = useWindows();
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
					{!collapsed && <div className="rail-group-title">{g.title}</div>}
					{g.pages.map((p) => (
						<button key={p.id} className={`rail-item ${page === p.id ? "on" : ""}`} title={`${p.title} — ${p.hint}`} onClick={() => windows.go(p.id)}>
							<span className="rail-icon">{p.icon}</span>
							{!collapsed && <span>{p.title}</span>}
						</button>
					))}
				</div>
			))}
			<div className="rail-grow" />
			<button className="rail-item" title="Prasmes — biroja prasmju bibliotēka" onClick={() => windows.go("prasmes")}>
				<span className="rail-icon">✦</span>
				{!collapsed && <span>Prasmes</span>}
			</button>
			<button className="rail-item" title="Iestatījumi" onClick={() => windows.go("iestatijumi")}>
				<span className="rail-icon">⚙</span>
				{!collapsed && <span>Iestatījumi</span>}
			</button>
			<button className="rail-item" title={collapsed ? "Izvērst joslu" : "Sakļaut joslu"} onClick={toggle}>
				<span className="rail-icon">{collapsed ? "»" : "«"}</span>
				{!collapsed && <span>Sakļaut</span>}
			</button>
		</nav>
	);
}
