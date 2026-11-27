// A tab group: one strip with a tab per window, the active window's body under it. Used by the dock areas and by the
// floating windows. Tabs drag out (float), onto a screen edge (dock) or onto another strip (join); the empty part of the
// strip drags the whole group. BIM Crew's windows have a title bar per window; here the title bar is the tab strip.
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "../icons";
import { CHAT, canClose, clampGeo, minWOf, tabIndexAt, TOOLS, type Group } from "../../shared/layout";
import { WINDOW_TITLE, useWindows, windows } from "../windows";
import { dragActive, tabRects, track } from "./drag";
import { tr } from "../i18n";

/** Widths (px) at which the comment tools' window changes shape: colours in threes, then the header in a row with a wrapped grid of tools. */
const SLIM_MID = 100;
const SLIM_WIDE = 140;

/** The icons of the comment tools window that take part in its wrapping (the colour dots flow with them). */
const TOOL_ITEMS = ".ctool, .ctool-ab, .ctool-swatch, .ctool-sep";
/** The window's own header needs this much width in a row; narrower than SLIM_MID it is the one-column tier, left as it is. */
const FIT_MIN_W = SLIM_WIDE;
/** Widening to remove a lone icon on the last row is allowed only up to this width. */
const FIT_MAX_W = 520;

/** How many rows the icons sit in now, and how many icons (dividers not counted) the last row holds. */
function toolRows(col: HTMLElement): { rows: number; last: number } {
	// the note box opens beside the column but is its child: its colour dot is not one of the icons
	const icons = [...col.querySelectorAll<HTMLElement>(TOOL_ITEMS)].filter((el) => !el.closest(".ctool-ask"));
	const items = icons.map((el) => {
		const r = el.getBoundingClientRect();
		return { y: r.top + r.height / 2, sep: el.classList.contains("ctool-sep") };
	});
	items.sort((a, b) => a.y - b.y);
	let rows = 0;
	let last = 0;
	let prev = -1e9;
	for (const it of items) {
		if (it.y - prev > 8) {
			rows++;
			last = 0;
		}
		prev = it.y;
		if (!it.sep) last++;
	}
	return { rows, last };
}

/**
 * The comment tools' window is always as compact as it can be: exactly as tall as its icons need, as narrow as those rows need,
 * and never with one icon alone on the last row (it gets a little wider for one row fewer, up to FIT_MAX_W). Probes the real
 * layout by setting the window's width on the element (nothing is stored until the answer is known), then stores the fitted
 * size once. Run whenever the icons re-flow (a width change, other tools on the page), after every move or resize, and on a
 * double-click on the grip. The one-column tier (under 100 px wide) keeps its width and only fits its height.
 */
export function fitToolsHeight(id: string): void {
	const fw = document.querySelector<HTMLElement>(`[data-strip="${id}"]`)?.closest<HTMLElement>(".fw");
	const body = fw?.querySelector<HTMLElement>(".ctool-win");
	const col = fw?.querySelector<HTMLElement>(".ctool-col");
	if (!fw || !body || !col) return;
	const vp = { w: window.innerWidth, h: window.innerHeight };
	const w0 = fw.offsetWidth;
	let w = w0;
	// a scroll bar appearing while the window is probed would change the width the icons wrap in
	const overflow = body.style.overflow;
	body.style.overflow = "hidden";
	if (w0 >= SLIM_MID) {
		const at = (x: number) => {
			fw.style.width = `${x}px`;
			return toolRows(col);
		};
		/** the narrowest width in [FIT_MIN_W, hi] that keeps the icons in at most `rows` rows */
		const narrowest = (rows: number, hi: number) => {
			let lo = FIT_MIN_W;
			let up = hi;
			while (up - lo > 1) {
				const mid = Math.floor((lo + up) / 2);
				if (at(mid).rows <= rows) up = mid;
				else lo = mid;
			}
			return at(lo).rows <= rows ? lo : up;
		};
		const wide = Math.max(FIT_MIN_W, Math.min(vp.w - 16, Math.max(w0, FIT_MAX_W)));
		let now = at(Math.max(FIT_MIN_W, w0));
		let rows = now.rows;
		w = narrowest(rows, Math.max(FIT_MIN_W, w0));
		now = at(w);
		// a lone icon (or two) on the last row: one row fewer, if that costs no more than FIT_MAX_W
		while (rows > 1 && now.last <= 2) {
			const wider = narrowest(rows - 1, wide);
			if (wider > FIT_MAX_W || at(wider).rows > rows - 1) break;
			rows -= 1;
			w = wider;
			now = at(w);
		}
		fw.style.width = `${w0}px`;
	}
	// the height follows the rows at the chosen width (measured with that width on the element, then put back)
	fw.style.width = `${w}px`;
	const delta = col.offsetHeight - body.clientHeight;
	fw.style.width = `${w0}px`;
	body.style.overflow = overflow;
	const want = clampGeo({ x: fw.offsetLeft, y: fw.offsetTop, w, h: fw.offsetHeight + delta }, vp, minWOf([TOOLS]));
	if (Math.abs(want.w - w0) < 2 && Math.abs(want.h - fw.offsetHeight) < 2) return; // already as compact as the screen allows: no store write, no loop
	windows.resize(id, want);
}

export function TabGroup({
	group,
	render,
	mode,
	onStripDown,
}: {
	group: Group;
	render: (id: string, filter?: string) => ReactNode;
	/** `edge`: the slim column beside the chat (B1): drags like a docked group, two buttons only (float, pop out) */
	mode: "dock" | "float" | "edge";
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
	// many tabs scroll inside their own region (the wheel scrolls them sideways) and the active one is kept in view; the window
	// buttons are outside that region, so a crowded strip can never push them off the screen
	const tabsRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		tabsRef.current?.querySelector<HTMLElement>(".tg-tab.on")?.scrollIntoView({ inline: "nearest", block: "nearest" });
	}, [own, group.tabs.length]);
	// the comment tools alone in a window: the strip is as slim as their icon column (no title, the buttons stacked)
	const slim = group.tabs.length === 1 && group.tabs[0] === TOOLS;
	// the slim window adapts to the size the user gives it (a container query would make the group a containing block for the
	// comment boxes, which are fixed to the screen): data-tier is "xs" (a column), "s" (colours in threes) or "m" (header in a row, tools wrap, colours in a row)
	const tg = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = tg.current;
		if (!slim || !el || typeof ResizeObserver === "undefined") return;
		const set = (w: number) => {
			el.dataset.tier = w >= SLIM_WIDE ? "m" : w >= SLIM_MID ? "s" : "xs";
		};
		set(el.clientWidth);
		const ro = new ResizeObserver((e) => set(e[0]?.contentRect.width ?? el.clientWidth));
		ro.observe(el);
		return () => {
			ro.disconnect();
			delete el.dataset.tier;
		};
	}, [slim]);
	// the floating comment tools keep themselves as compact as possible at all times: whenever the icons re-flow (width, the page's
	// tools, colours) the height is fitted again; while the window is being dragged nothing is touched (the drag ends with a fit)
	useEffect(() => {
		const el = tg.current;
		if (!slim || mode !== "float" || !el) return;
		let raf = 0;
		const schedule = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				if (!dragActive()) fitToolsHeight(own);
			});
		};
		const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
		ro?.observe(el);
		const col = el.querySelector(".ctool-col");
		if (col) ro?.observe(col);
		const mo = new MutationObserver(schedule);
		mo.observe(el.querySelector(".tg-body") ?? el, { childList: true, subtree: true });
		schedule();
		return () => {
			cancelAnimationFrame(raf);
			ro?.disconnect();
			mo.disconnect();
		};
	}, [slim, mode, own]);
	return (
		<div ref={tg} className={`tg ${mode === "edge" ? "tg-edge" : ""} ${slim ? "tg-slim" : ""}`}>
			<div className="tg-strip" data-strip={own} data-tabs={group.tabs.join(",")} onMouseDown={startGroup} onDoubleClick={() => (slim ? (mode === "float" ? fitToolsHeight(own) : undefined) : mode === "float" ? windows.maximize(own) : windows.undock(own))}>
				{/* the slim strip is all buttons: this grip is the part that moves the window (or drags the column off its edge) */}
				{slim && (
					<div className="tg-grip" title={tr("Vilkt, lai pārvietotu; dubultklikšķis: logs pēc satura augstuma")} aria-hidden>
						⋮⋮
					</div>
				)}
				<div
					ref={tabsRef}
					className="tg-tabs"
					onWheel={(e) => {
						if (e.deltaY && !e.shiftKey) e.currentTarget.scrollLeft += e.deltaY;
					}}
				>
					{group.tabs.map((id) => (
						<div key={id} data-tab={id} className={`tg-tab ${id === own ? "on" : ""}`} title={WINDOW_TITLE[id] ?? id} onMouseDown={(e) => startTab(e, id)}>
							<span className="tg-name">{WINDOW_TITLE[id] ?? id}</span>
							{canClose(id) && (
								<button className="tg-x" title={tr("Aizvērt")} aria-label={tr("Aizvērt")} onClick={() => windows.close(id)}>
									×
								</button>
							)}
						</div>
					))}
					<span className="tg-grow" />
				</div>
				<div className="tg-buttons">
					{/* the comment tools' home is the column beside the chat: one click takes them back from wherever they were moved */}
					{mode !== "edge" && group.tabs.includes(TOOLS) && (
						<button title={tr("Uz kolonnu blakus čatam")} aria-label={tr("Uz kolonnu blakus čatam")} onClick={() => windows.toEdge(own, { whole: true })}>
							<Icon name="dockEdge" size={14} />
						</button>
					)}
					{mode !== "float" && (
						<button title={tr("Atspraust: peldošs logs")} aria-label={tr("Atspraust: peldošs logs")} onClick={() => windows.undock(own)}>
							<Icon name="winFloat" size={14} />
						</button>
					)}
					<button title={tr("Iznest atsevišķā logā (otrs monitors); aizverot logu, tas atgriežas")} aria-label={tr("Iznest atsevišķā logā")} onClick={() => windows.popOut(own)}>
						<Icon name="winPop" size={14} />
					</button>
					{mode !== "edge" && (
						<button title={mode === "dock" ? tr("Sakļaut joslu") : tr("Minimizēt")} aria-label={mode === "dock" ? tr("Sakļaut joslu") : tr("Minimizēt")} onClick={() => windows.collapse(own, true)}>
							<Icon name="winMin" size={14} />
						</button>
					)}
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
