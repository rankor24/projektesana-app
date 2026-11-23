// The Settings window: a grouped left navigation with a search box, and the page that is open. One mode, every setting shown.
// Search finds a setting by its Latvian or English words; opening a result goes to its page, scrolls to the setting, focuses its control and
// lights it for a moment. The window can be docked narrow: below NARROW_PX the navigation and the page are one column each, with a back
// button between them, so nothing needs sideways scrolling.
// Ported from OpenMausBot src/components/settings/SettingsWindow.tsx: `revealAnchor` (scroll the pane to the block, focus, `data-settings-highlight`
// for 1.2 s), a narrow layout that shows the list first, and the "/" key that focuses the search. Left out: places, accounts, Simple / Advanced.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Err } from "../../ui";
import { tr } from "../../i18n";
import { windows } from "../../windows";
import { pageById, type SettingsIndexEntry, type SettingsPageId } from "../../../shared/settings-index";
import { useSettingsData } from "./data";
import { RecentChanges } from "./RecentChanges";
import { SettingsNav } from "./SettingsNav";
import { SettingsPageHeader } from "./SettingsPageHeader";
import { SettingsPageBody } from "./pages";
import { onSettingsRequest, takeSettingsRequest, type SettingsTarget } from "./settings-jump";

const NARROW_PX = 620;
let lastPage: SettingsPageId = "providers";

/** Scrolls the pane to a block, focuses its first control and lights it (the block may be a table row, so the light is an outline). */
export function revealAnchor(scroller: HTMLElement | null, anchor: string | null | undefined): void {
	if (!scroller || !anchor) return;
	const block = scroller.querySelector<HTMLElement>(`[data-settings-block="${CSS.escape(anchor)}"]`);
	if (!block) return;
	const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
	scroller.scrollTop = Math.max(0, top - 24);
	block.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
	block.setAttribute("data-settings-highlight", "");
	window.setTimeout(() => block.removeAttribute("data-settings-highlight"), 1200);
}

export function SettingsWindow() {
	const [err, setErr] = useState<string | null>(null);
	const x = useSettingsData(setErr);
	const root = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [narrow, setNarrow] = useState(false);
	const first = useRef<SettingsTarget | null>(takeSettingsRequest());
	const [page, setPage] = useState<SettingsPageId>(first.current?.page ?? lastPage);
	// in a narrow window the list shows first; a request from outside or a search result goes straight to the page
	const [showList, setShowList] = useState(!first.current);
	const [reveal, setReveal] = useState<{ anchor: string; n: number } | null>(first.current?.anchor ? { anchor: first.current.anchor, n: 0 } : null);

	const go = useCallback((t: SettingsTarget) => {
		lastPage = t.page;
		setPage(t.page);
		setShowList(false);
		setReveal(t.anchor ? { anchor: t.anchor, n: Date.now() } : null);
	}, []);
	useEffect(() => onSettingsRequest((t) => (takeSettingsRequest(), go(t))), [go]);

	useLayoutEffect(() => {
		const el = root.current;
		if (!el) return;
		const measure = () => setNarrow(el.clientWidth < NARROW_PX);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// after the page is drawn (and again once its data arrives) the wanted block is scrolled to and lit
	useEffect(() => {
		if (!reveal) return;
		const t = window.setTimeout(() => revealAnchor(body.current, reveal.anchor), 60);
		return () => window.clearTimeout(t);
	}, [reveal, page, narrow, showList, x.providers.length]);

	const openHit = (e: SettingsIndexEntry) => (e.jump ? windows.open(e.jump) : go({ page: e.page, anchor: e.anchor }));
	const def = pageById(page);
	const listOnly = narrow && showList;
	const pageOnly = narrow && !showList;

	return (
		<div
			ref={root}
			className={`st ${narrow ? "narrow" : ""}`}
			onKeyDown={(e) => {
				// "/" jumps to the search box, as in OpenMausBot's settings
				const t = e.target as HTMLElement;
				if (e.key === "/" && !e.ctrlKey && !e.metaKey && t.tagName !== "INPUT" && t.tagName !== "TEXTAREA" && t.tagName !== "SELECT") {
					e.preventDefault();
					root.current?.querySelector<HTMLInputElement>("[data-settings-search]")?.focus();
				}
			}}
		>
			{!pageOnly && (
				<SettingsNav
					page={narrow ? null : page}
					onPage={(p) => go({ page: p })}
					onHit={openHit}
				/>
			)}
			{!listOnly && (
				<div className="st-main" ref={body}>
					{narrow && (
						<button className="small ghost st-back" onClick={() => setShowList(true)}>
							← {tr("Iestatījumi")}
						</button>
					)}
					{err && <div className="err">{err}</div>}
					{x.loadError ? <Err error={x.loadError} /> : null}
					<RecentChanges />
					<SettingsPageHeader page={def} />
					<div className="st-page-body" aria-labelledby="settings-page-title">
						<SettingsPageBody page={page} x={x} />
					</div>
				</div>
			)}
		</div>
	);
}

