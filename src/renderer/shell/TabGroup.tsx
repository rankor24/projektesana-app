// A tab group: one strip with a tab per window, the active window's body under it. Used by the dock areas and by the
// floating windows. Tabs drag out (float), onto a screen edge (dock) or onto another strip (join); the empty part of the
// strip drags the whole group. BIM Crew's windows have a title bar per window; here the title bar is the tab strip.
import type { ReactNode } from "react";
import { CHAT, canClose, tabIndexAt, type Group, type Side } from "../../shared/layout";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { tabRects, track } from "./drag";

const SIDE_BTN: { side: Side; glyph: string; title: string }[] = [
	{ side: "left", glyph: "◧", title: "Piespraust pa kreisi" },
	{ side: "right", glyph: "◨", title: "Piespraust pa labi" },
	{ side: "top", glyph: "⬒", title: "Piespraust augšā" },
	{ side: "bottom", glyph: "⬓", title: "Piespraust apakšā" },
];

export function TabGroup({
	group,
	render,
	mode,
	onStripDown,
}: {
	group: Group;
	render: (id: string, filter?: string) => ReactNode;
	mode: "dock" | "float";
	/** a floating window moves by its strip: the parent starts the move */
	onStripDown?: (e: React.MouseEvent) => void;
}) {
	const { layout } = useWindows();
	const own = group.active;

	const startTab = (e: React.MouseEvent, id: string) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest(".tg-x")) return;
		e.stopPropagation();
		windows.setActive(id);
		track(e, id, WINDOW_TITLE[id] ?? id, {
			onMove() {},
			onEnd(x, y, moved, target) {
				if (!moved) return;
				if (target?.kind === "tabs") return windows.mergeInto(id, target.targetId, tabIndexAt(tabRects(target.targetId), x));
				if (target?.kind === "side") return windows.dock(id, target.side);
				const strip = [...document.querySelectorAll<HTMLElement>("[data-strip]")].find((el) => el.dataset.tabs?.split(",").includes(id));
				const r = strip?.getBoundingClientRect();
				if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return windows.reorder(id, tabIndexAt(tabRects(group.active), x));
				windows.pullOut(id, { x: x - 80, y: y - 12 });
				windows.move(id, x - 80, y - 12);
			},
		});
	};

	// the empty part of a docked strip drags the whole group
	const startGroup = (e: React.MouseEvent) => {
		if (mode === "float") return onStripDown?.(e);
		if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
		track(e, own, WINDOW_TITLE[own] ?? own, {
			onMove() {},
			onEnd(x, y, moved, target) {
				if (!moved) return;
				if (target?.kind === "tabs") return windows.mergeGroup(own, target.targetId);
				if (target?.kind === "side") return windows.dock(own, target.side, { whole: true });
				windows.undock(own);
				windows.move(own, x - 120, y - 12);
			},
		});
	};

	const keepChat = group.tabs.includes(CHAT);
	return (
		<div className="tg">
			<div className="tg-strip" data-strip={own} data-tabs={group.tabs.join(",")} onMouseDown={startGroup} onDoubleClick={() => (mode === "dock" ? windows.undock(own) : windows.dock(own, "right", { whole: true }))}>
				{group.tabs.map((id) => (
					<div key={id} data-tab={id} className={`tg-tab ${id === own ? "on" : ""}`} onMouseDown={(e) => startTab(e, id)}>
						<span>{WINDOW_TITLE[id] ?? id}</span>
						{canClose(id) && (
							<button className="tg-x" title="Aizvērt" onClick={() => windows.close(id)}>
								×
							</button>
						)}
					</div>
				))}
				<span className="tg-grow" />
				<div className="tg-buttons">
					{mode === "float" && SIDE_BTN.map((b) => (
						<button key={b.side} title={b.title} onClick={() => windows.dock(own, b.side, { whole: true })}>
							{b.glyph}
						</button>
					))}
					{mode === "dock" && (
						<button title="Atspraust (peldošs logs)" onClick={() => windows.undock(own)}>
							⇱
						</button>
					)}
					<button title={mode === "dock" ? "Sakļaut joslu" : "Minimizēt"} onClick={() => windows.collapse(own, true)}>
						–
					</button>
				</div>
			</div>
			<div className="tg-body">
				{group.tabs.map((id) =>
					id === own || (id === CHAT && keepChat) ? (
						<div key={id} className="tg-pane" style={id === own ? undefined : { display: "none" }}>
							{render(id, layout.filters[id])}
						</div>
					) : null,
				)}
			</div>
		</div>
	);
}
