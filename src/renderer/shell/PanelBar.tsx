// Bottom bar: one button per panel; a click opens, focuses or minimises its floating window.
import { PANEL_TITLE, useWindows, windows, type PanelId } from "../windows";

const BAR: PanelId[] = ["projekts", "faili", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas"];

export function PanelBar() {
	const s = useWindows();
	return (
		<nav className="panelbar">
			{BAR.map((id) => {
				const w = s.windows.find((x) => x.id === id);
				const state = !w ? "" : w.mode === "minimized" ? "min" : "open";
				return (
					<button key={id} className={`panel-btn ${state} ${s.focused === id ? "focused" : ""}`} onClick={() => windows.toggle(id)}>
						{PANEL_TITLE[id]}
					</button>
				);
			})}
		</nav>
	);
}
