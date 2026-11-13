// Bottom bar: one button per panel; a click opens, focuses or minimises its floating window.
import { groupOf } from "../../shared/layout";
import { PANEL_TITLE, useWindows, windows, type PanelId } from "../windows";

const BAR: PanelId[] = ["projekts", "faili", "grafiks", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas"];

export function PanelBar() {
	const { layout } = useWindows();
	return (
		<nav className="panelbar">
			{BAR.map((id) => {
				const g = groupOf(layout, id);
				const state = !g ? "" : g.place.kind === "min" || (g.place.kind === "dock" && g.place.collapsed) ? "min" : "open";
				return (
					<button key={id} className={`panel-btn ${state} ${layout.focused === id ? "focused" : ""}`} onClick={() => windows.toggle(id)}>
						{PANEL_TITLE[id]}
					</button>
				);
			})}
		</nav>
	);
}
